import type Database from "better-sqlite3";
import { appleFilter, type PlatformApiClient } from "./platform-api-client.ts";

// One consistent Apple Ads popularity (5–100) per keyword × storefront.
//
// Why a separate store: Apple exposes popularity on two scales. Keyword
// recommendations (`/suggestions/keywords/query`) return `popularity` 5–100,
// while impression-share rows carry a coarse `searchPopularity1to5` bucket.
// Mixing them (bucket × 20) made «dicom» US read 7 in one batch and 40 in the
// next. The recommendation value is the only one on the scale Apple Ads shows
// in its UI, and — verified 2026-09-25 — a single-term query always echoes the
// requested term with its own popularity (5 is Apple's floor, i.e. «≤5»), while
// multi-term queries return only a subset and sibling values differ from the
// term's own (horos AE: 16 as a sibling, 7 alone). So each term is fetched alone,
// cached per UTC day in the Ads DB, and older days are served as «stale» while
// today's value is being fetched in the background.

type JsonRecord = Record<string, unknown>;

export const POPULARITY_SOURCE = "apple-ads-keyword-recommendations";
export const POPULARITY_FLOOR = 5;
const RETRY_AFTER_ERROR_MS = 10 * 60_000;
const MAX_TERMS = 2000;

export type PopularityStatus = "ok" | "stale" | "pending" | "none" | "error";

export interface PopularityItem {
  term: string;
  /** Apple Ads popularity 5–100; 5 means «≤5, low volume», never zero. */
  popularity: number | null;
  /** Display label: "≤5" at Apple's floor, otherwise the number. */
  label: string | null;
  low: boolean;
  /** UTC day the value was observed. */
  day: string | null;
  fetchedAt: string | null;
  status: PopularityStatus;
}

export interface PopularityResponse {
  source: typeof POPULARITY_SOURCE;
  sourceLabel: string;
  scale: "apple_5_to_100";
  storefront: string;
  day: string;
  items: PopularityItem[];
  pending: number;
}

export function normalizePopularityTerm(term: string): string {
  return term.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function popularityLabel(value: number | null): string | null {
  if (value === null) return null;
  return value <= POPULARITY_FLOOR ? `≤${POPULARITY_FLOOR}` : String(Math.round(value));
}

/** Clamp an Apple recommendation value onto the 5–100 scale. */
export function toPopularity5to100(value: unknown): number | null {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return null;
  return Math.max(POPULARITY_FLOOR, Math.min(100, Math.round(n)));
}

interface StoredRow { term: string; popularity: number | null; day: string; fetched_at: string }

type QueryClient = Pick<PlatformApiClient, "queryRows">;

export class KeywordPopularityService {
  private readonly db: Database.Database;
  private readonly client: QueryClient;
  private readonly now: () => Date;
  private readonly concurrency: number;
  private readonly queue: Array<{ key: string; appId: number; storefront: string; term: string }> = [];
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly failedUntil = new Map<string, number>();
  private active = 0;

  constructor(db: Database.Database, client: QueryClient, options: { now?: () => Date; concurrency?: number } = {}) {
    this.db = db;
    this.client = client;
    this.now = options.now ?? (() => new Date());
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS asa_keyword_popularity (
        storefront TEXT NOT NULL,
        term TEXT NOT NULL,
        day TEXT NOT NULL,
        popularity INTEGER,
        source TEXT NOT NULL,
        app_id INTEGER,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (storefront, term, day)
      );
      CREATE INDEX IF NOT EXISTS idx_asa_kw_popularity_term ON asa_keyword_popularity(storefront, term, day DESC);
    `);
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  /** Cached values only (today, else latest older day); schedules fetches for the rest. */
  peek(appId: number, storefront: string, terms: string[], fill = true): Map<string, PopularityItem> {
    const sf = storefront.toUpperCase();
    const unique = [...new Set(terms.map(normalizePopularityTerm).filter(Boolean))].slice(0, MAX_TERMS);
    const today = this.today();
    const latest = this.readLatest(sf, unique);
    const out = new Map<string, PopularityItem>();
    for (const term of unique) {
      const row = latest.get(term);
      const key = `${sf}|${term}`;
      const fresh = row?.day === today;
      if (!fresh && fill) this.enqueue(key, appId, sf, term);
      const failed = (this.failedUntil.get(key) ?? 0) > Date.now();
      const status: PopularityStatus = row
        ? fresh ? row.popularity === null ? "none" : "ok" : "stale"
        : failed ? "error" : "pending";
      out.set(term, {
        term,
        popularity: row?.popularity ?? null,
        label: popularityLabel(row?.popularity ?? null),
        low: row?.popularity != null && row.popularity <= POPULARITY_FLOOR,
        day: row?.day ?? null,
        fetchedAt: row?.fetched_at ?? null,
        status,
      });
    }
    return out;
  }

  /** Cached + fresh values; waits up to `waitMs` for missing ones, the rest keep filling in the background. */
  async lookup(appId: number, storefront: string, terms: string[], waitMs = 0): Promise<PopularityResponse> {
    const sf = storefront.toUpperCase();
    if (!/^[A-Z]{2}$/.test(sf)) throw new Error("country must be an ISO 3166-1 alpha-2 code");
    if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error("app_id must be a positive integer");
    let items = this.peek(appId, sf, terms);
    const missing = [...items.values()].filter((item) => item.status !== "ok" && item.status !== "none");
    if (missing.length && waitMs > 0) {
      const done = Promise.all(missing.map((item) => this.whenSettled(`${sf}|${item.term}`)));
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, waitMs))]);
      items = this.peek(appId, sf, terms);
    }
    const list = [...items.values()];
    return {
      source: POPULARITY_SOURCE,
      sourceLabel: "Apple Ads · рекомендации ключей (popularity 5–100)",
      scale: "apple_5_to_100",
      storefront: sf,
      day: this.today(),
      items: list,
      pending: list.filter((item) => item.status === "pending" || item.status === "stale").length,
    };
  }

  private readLatest(storefront: string, terms: string[]): Map<string, StoredRow> {
    const out = new Map<string, StoredRow>();
    for (let i = 0; i < terms.length; i += 400) {
      const chunk = terms.slice(i, i + 400);
      const rows = this.db.prepare(`
        SELECT term, popularity, day, fetched_at FROM asa_keyword_popularity
        WHERE storefront = ? AND term IN (${chunk.map(() => "?").join(",")})
        ORDER BY day DESC
      `).all(storefront, ...chunk) as StoredRow[];
      for (const row of rows) if (!out.has(row.term)) out.set(row.term, row);
    }
    return out;
  }

  private whenSettled(key: string): Promise<void> {
    if (!this.inflight.has(key) && !this.queue.some((job) => job.key === key)) return Promise.resolve();
    return new Promise((resolve) => this.waiters.set(key, [...(this.waiters.get(key) ?? []), resolve]));
  }

  private enqueue(key: string, appId: number, storefront: string, term: string): void {
    if (this.inflight.has(key) || this.queue.some((job) => job.key === key)) return;
    if ((this.failedUntil.get(key) ?? 0) > Date.now()) return;
    this.queue.push({ key, appId, storefront, term });
    this.pump();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.active += 1;
      const run = this.fetchOne(job.appId, job.storefront, job.term)
        .then(() => { this.failedUntil.delete(job.key); })
        .catch(() => { this.failedUntil.set(job.key, Date.now() + RETRY_AFTER_ERROR_MS); })
        .finally(() => {
          this.active -= 1;
          this.inflight.delete(job.key);
          for (const resolve of this.waiters.get(job.key) ?? []) resolve();
          this.waiters.delete(job.key);
          this.pump();
        });
      this.inflight.set(job.key, run);
    }
  }

  private async fetchOne(appId: number, storefront: string, term: string): Promise<void> {
    const read = await this.client.queryRows<JsonRecord>("/suggestions/keywords/query", {
      filters: [
        appleFilter("promotedObjectId", "EQUALS", [String(appId)]),
        appleFilter("promotedObjectType", "EQUALS", ["APPSTORE_APP"]),
        appleFilter("countriesOrRegions", "IN", [storefront]),
        appleFilter("terms", "IN", [term]),
      ],
    }, 100);
    const own = read.data.find((row) => typeof row.text === "string" && normalizePopularityTerm(row.text) === term);
    const value = own ? toPopularity5to100(own.popularity) : null;
    this.db.prepare(`
      INSERT INTO asa_keyword_popularity (storefront, term, day, popularity, source, app_id, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(storefront, term, day) DO UPDATE SET popularity = excluded.popularity, fetched_at = excluded.fetched_at
    `).run(storefront, term, this.today(), value, POPULARITY_SOURCE, appId, this.now().toISOString());
    // Siblings Apple returns alongside are NOT reused: verified 2026-09-25, «horos»
    // AE reads 16 as a sibling of «dicom» but 7 when queried alone.
  }
}
