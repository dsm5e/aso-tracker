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
//
// Batching re-checked 2026-09-25 (37 read-only calls, US + GB, MedScan + Elara,
// fixtures in keyword-popularity.fixtures.json): a multi-term `terms IN [...]`
// request returns byte-for-byte the response of a single request for terms[0]
// — Apple ignores every other term. Requested terms that happen to show up are
// sibling rows whose values disagree with their own (pregnancy app: 9 as a
// sibling of «pregnancy tracker», 53 alone). A batch of N therefore costs one
// call and yields one trustworthy value, so there is no safe batching rule. The
// single-call path is kept and hardened instead: ≤2 in flight, in-flight dedupe,
// queue-wide backoff on 429, and a nightly refresh of recently requested terms.

type JsonRecord = Record<string, unknown>;

export const POPULARITY_SOURCE = "apple-ads-keyword-recommendations";
export const POPULARITY_FLOOR = 5;
const RETRY_AFTER_ERROR_MS = 10 * 60_000;
const MAX_CONCURRENCY = 2;
const RECENT_ERRORS = 20;
const DAY_MS = 86_400_000;
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

interface Job { key: string; appId: number; storefront: string; term: string }

export interface PopularityErrorEntry { at: string; storefront: string; term: string; status: number | null; message: string }

export interface PopularityServiceStatus {
  source: typeof POPULARITY_SOURCE;
  batching: { enabled: false; reason: string };
  cache: { rows: number; terms: number; storefronts: number; todayRows: number; today: string; oldestDay: string | null };
  lookups: { fresh: number; stale: number; miss: number; hitRate: number | null; since: string };
  queue: { queued: number; inflight: number; concurrency: number };
  api: { calls: number; ok: number; errors: number; rateLimited: number; lastCallAt: string | null };
  backoff: { pausedUntil: string | null; nextDelayMs: number };
  prefetch: { lastRunAt: string | null; lastEnqueued: number; nextRunAt: string | null; lookbackDays: number };
  lastErrors: PopularityErrorEntry[];
}

export interface KeywordPopularityOptions {
  now?: () => Date;
  concurrency?: number;
  /** First queue-wide pause after a 429 that survived the client's own retries. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

export class KeywordPopularityService {
  private readonly db: Database.Database;
  private readonly client: QueryClient;
  private readonly now: () => Date;
  private readonly concurrency: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly queue: Job[] = [];
  private readonly queued = new Set<string>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly failedUntil = new Map<string, number>();
  private active = 0;
  private pausedUntil = 0;
  private nextBackoffMs: number;
  private resumeTimer: NodeJS.Timeout | null = null;
  private nightlyTimer: NodeJS.Timeout | null = null;
  private nextPrefetchAt: Date | null = null;
  private lastPrefetch: { at: string; enqueued: number } | null = null;
  private prefetchLookbackDays = 7;
  private readonly stats = { fresh: 0, stale: 0, miss: 0, calls: 0, ok: 0, errors: 0, rateLimited: 0, lastCallAt: null as string | null, since: new Date().toISOString() };
  private readonly lastErrors: PopularityErrorEntry[] = [];

  constructor(db: Database.Database, client: QueryClient, options: KeywordPopularityOptions = {}) {
    this.db = db;
    this.client = client;
    this.now = options.now ?? (() => new Date());
    this.concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(options.concurrency ?? MAX_CONCURRENCY)));
    this.backoffBaseMs = Math.max(1, options.backoffBaseMs ?? 5_000);
    this.backoffMaxMs = Math.max(this.backoffBaseMs, options.backoffMaxMs ?? 120_000);
    this.nextBackoffMs = this.backoffBaseMs;
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
      if (fill) {
        if (fresh) this.stats.fresh += 1;
        else if (row) this.stats.stale += 1;
        else this.stats.miss += 1;
      }
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
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([done, new Promise((resolve) => { timer = setTimeout(resolve, waitMs); })]);
      clearTimeout(timer);
      items = this.peek(appId, sf, terms, false);
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

  /**
   * Re-fetch every term × storefront requested within the last `days` days that
   * has no value for today yet, so the studio opens on fresh numbers. Returns
   * how many terms were queued.
   */
  prefetchRecent(days = this.prefetchLookbackDays): number {
    const since = new Date(this.now().getTime() - Math.max(1, days) * DAY_MS).toISOString().slice(0, 10);
    const rows = this.db.prepare(`
      SELECT storefront, term, MAX(day) AS day,
             (SELECT app_id FROM asa_keyword_popularity l
               WHERE l.storefront = p.storefront AND l.term = p.term AND l.app_id IS NOT NULL
               ORDER BY l.day DESC LIMIT 1) AS app_id
      FROM asa_keyword_popularity p
      WHERE day >= ?
      GROUP BY storefront, term
      HAVING MAX(day) < ?
    `).all(since, this.today()) as Array<{ storefront: string; term: string; day: string; app_id: number | null }>;
    let enqueued = 0;
    for (const row of rows) {
      if (!row.app_id) continue;
      const key = `${row.storefront}|${row.term}`;
      this.failedUntil.delete(key);
      if (this.enqueue(key, row.app_id, row.storefront, row.term)) enqueued += 1;
    }
    this.lastPrefetch = { at: this.now().toISOString(), enqueued };
    return enqueued;
  }

  /** Daily `prefetchRecent` at `hourUtc`:05 UTC. Idempotent; the timer never keeps the process alive. */
  startNightlyPrefetch(hourUtc = 3, lookbackDays = 7): void {
    this.prefetchLookbackDays = Number.isFinite(lookbackDays) ? Math.max(1, Math.floor(lookbackDays)) : 7;
    if (this.nightlyTimer) return;
    const hour = Number.isFinite(hourUtc) ? Math.max(0, Math.min(23, Math.floor(hourUtc))) : 3;
    const schedule = () => {
      const now = new Date();
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 5));
      if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
      this.nextPrefetchAt = next;
      this.nightlyTimer = setTimeout(() => {
        try { this.prefetchRecent(); } catch (error) { this.recordError("*", "*", error); }
        schedule();
      }, next.getTime() - now.getTime());
      this.nightlyTimer.unref();
    };
    schedule();
  }

  stop(): void {
    if (this.nightlyTimer) clearTimeout(this.nightlyTimer);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.nightlyTimer = null;
    this.resumeTimer = null;
    this.nextPrefetchAt = null;
  }

  status(): PopularityServiceStatus {
    const today = this.today();
    const cache = this.db.prepare(`
      SELECT COUNT(*) AS rows, COUNT(DISTINCT storefront || '|' || term) AS terms,
             COUNT(DISTINCT storefront) AS storefronts,
             SUM(CASE WHEN day = ? THEN 1 ELSE 0 END) AS todayRows, MIN(day) AS oldestDay
      FROM asa_keyword_popularity
    `).get(today) as { rows: number; terms: number; storefronts: number; todayRows: number | null; oldestDay: string | null };
    const lookups = this.stats.fresh + this.stats.stale + this.stats.miss;
    return {
      source: POPULARITY_SOURCE,
      batching: {
        enabled: false,
        reason: "Apple evaluates only terms[0] of a multi-term query; other requested terms come back as siblings with inconsistent values (verified 2026-09-25).",
      },
      cache: { rows: cache.rows, terms: cache.terms, storefronts: cache.storefronts, todayRows: cache.todayRows ?? 0, today, oldestDay: cache.oldestDay },
      lookups: {
        fresh: this.stats.fresh,
        stale: this.stats.stale,
        miss: this.stats.miss,
        hitRate: lookups ? Math.round((this.stats.fresh / lookups) * 1000) / 1000 : null,
        since: this.stats.since,
      },
      queue: { queued: this.queue.length, inflight: this.inflight.size, concurrency: this.concurrency },
      api: { calls: this.stats.calls, ok: this.stats.ok, errors: this.stats.errors, rateLimited: this.stats.rateLimited, lastCallAt: this.stats.lastCallAt },
      backoff: {
        pausedUntil: this.pausedUntil > Date.now() ? new Date(this.pausedUntil).toISOString() : null,
        nextDelayMs: this.nextBackoffMs,
      },
      prefetch: {
        lastRunAt: this.lastPrefetch?.at ?? null,
        lastEnqueued: this.lastPrefetch?.enqueued ?? 0,
        nextRunAt: this.nextPrefetchAt?.toISOString() ?? null,
        lookbackDays: this.prefetchLookbackDays,
      },
      lastErrors: [...this.lastErrors],
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
    if (!this.inflight.has(key) && !this.queued.has(key)) return Promise.resolve();
    return new Promise((resolve) => this.waiters.set(key, [...(this.waiters.get(key) ?? []), resolve]));
  }

  private enqueue(key: string, appId: number, storefront: string, term: string): boolean {
    if (this.inflight.has(key) || this.queued.has(key)) return false;
    if ((this.failedUntil.get(key) ?? 0) > Date.now()) return false;
    this.queue.push({ key, appId, storefront, term });
    this.queued.add(key);
    this.pump();
    return true;
  }

  private recordError(storefront: string, term: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastErrors.unshift({ at: this.now().toISOString(), storefront, term, status: errorStatus(error), message: message.slice(0, 240) });
    this.lastErrors.length = Math.min(this.lastErrors.length, RECENT_ERRORS);
  }

  private settle(key: string): void {
    for (const resolve of this.waiters.get(key) ?? []) resolve();
    this.waiters.delete(key);
  }

  private pump(): void {
    const wait = this.pausedUntil - Date.now();
    if (wait > 0) {
      if (!this.resumeTimer) {
        this.resumeTimer = setTimeout(() => { this.resumeTimer = null; this.pump(); }, wait);
        this.resumeTimer.unref();
      }
      return;
    }
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.queued.delete(job.key);
      this.active += 1;
      this.stats.calls += 1;
      this.stats.lastCallAt = this.now().toISOString();
      const run = this.fetchOne(job.appId, job.storefront, job.term)
        .then(() => {
          this.stats.ok += 1;
          this.failedUntil.delete(job.key);
          this.nextBackoffMs = this.backoffBaseMs;
          return false;
        })
        .catch((error: unknown) => {
          this.stats.errors += 1;
          this.recordError(job.storefront, job.term, error);
          if (errorStatus(error) === 429) {
            // The client already honoured Retry-After for a few attempts; pause the
            // whole queue (doubling up to backoffMaxMs) and retry this term first.
            this.stats.rateLimited += 1;
            this.pausedUntil = Math.max(this.pausedUntil, Date.now() + this.nextBackoffMs);
            this.nextBackoffMs = Math.min(this.backoffMaxMs, this.nextBackoffMs * 2);
            return true;
          }
          this.failedUntil.set(job.key, Date.now() + RETRY_AFTER_ERROR_MS);
          return false;
        })
        .then((requeue) => {
          this.active -= 1;
          this.inflight.delete(job.key);
          if (requeue) {
            this.queue.unshift(job);
            this.queued.add(job.key);
          } else {
            this.settle(job.key);
          }
          this.pump();
        });
      this.inflight.set(job.key, run);
    }
  }

  private async fetchOne(appId: number, storefront: string, term: string): Promise<void> {
    // Always exactly one term: Apple answers a multi-term query for terms[0] only.
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
    // Sibling rows are NOT reused: their values disagree with the term's own
    // (horos 16 next to «dicom», 7 alone; pregnancy app 9 vs 53).
  }
}
