import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ASO_HOME = process.env.ASO_STUDIO_HOME ?? join(homedir(), ".aso-studio");
const RANKINGS_DB = join(ASO_HOME, "keywords", "rankings.db");
const APPS_JSON = join(ASO_HOME, "keywords", "apps.json");
const MAX_TERMS = 100;
const MAX_LOCALES = 60;
const MAX_PAGE = 500;
const DEFAULT_PAGE = 100;

interface StoredSnapshotRow {
  locale: string;
  keyword: string;
  date: string;
  position: number | null;
  total: number | null;
  top5_json: string;
}

interface StoredApp {
  id: string;
  iTunesId: string;
  name?: string;
  bundle?: string;
  iconUrl?: string;
}

interface Cursor {
  locale: string;
  term: string;
}

export interface CachedTop5Input {
  appId: number;
  locales?: unknown;
  terms?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface CachedTop5App {
  name: string;
  bundleId: string | null;
  iTunesId: string | null;
  developer: string | null;
  rank: number;
  // The tracker snapshot has no artwork field. This null is intentional so
  // clients can retain an existing artwork cache without triggering N lookups.
  iconUrl: string | null;
  isOwn: boolean;
}

export interface CachedTop5Item {
  locale: string;
  term: string;
  observedAt: string;
  freshness: "latest-successful-snapshot";
  error: null;
  yourRank: number | null;
  total: number | null;
  apps: CachedTop5App[];
}

export interface CachedTop5Payload {
  source: "cached-aso-snapshots";
  liveRefresh: false;
  generatedAt: string | null;
  appId: number;
  slug: string | null;
  items: CachedTop5Item[];
  missing: Array<{ locale: string; term: string; reason: "no_cached_snapshot" }>;
  nextCursor: string | null;
  page: { limit: number; returned: number };
  limitations: string[];
}

function normalizeTerm(value: unknown): string {
  if (typeof value !== "string") throw new Error("terms must contain text");
  const term = value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (!term || term.length > 200) throw new Error("each term must be 1–200 characters");
  return term;
}

function normalizeLocale(value: unknown): string {
  if (typeof value !== "string") throw new Error("locales must contain storefront codes");
  const locale = value.trim().toLocaleLowerCase();
  if (!/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/i.test(locale)) throw new Error("invalid storefront code");
  return locale;
}

function arrayOf(value: unknown, field: string, maximum: number, normalize: (entry: unknown) => string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${field} must contain at most ${maximum} values`);
  return [...new Set(value.map(normalize))];
}

function decodeCursor(value: unknown): Cursor | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 512) throw new Error("invalid cursor");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const item = parsed as Record<string, unknown>;
    return { locale: normalizeLocale(item.locale), term: normalizeTerm(item.term) };
  } catch {
    throw new Error("invalid cursor");
  }
}

function encodeCursor(row: CachedTop5Item): string {
  return Buffer.from(JSON.stringify({ locale: row.locale, term: row.term })).toString("base64url");
}

export function parseCachedTop5Input(value: unknown): {
  appId: number;
  locales?: string[];
  terms?: string[];
  limit: number;
  cursor: Cursor | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("request body must be an object");
  const body = value as Record<string, unknown>;
  const appId = Number(body.appId);
  if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error("appId must be a positive integer");
  const locales = arrayOf(body.locales, "locales", MAX_LOCALES, normalizeLocale);
  const terms = arrayOf(body.terms, "terms", MAX_TERMS, normalizeTerm);
  const rawLimit = body.limit === undefined ? DEFAULT_PAGE : Number(body.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_PAGE) throw new Error(`limit must be 1–${MAX_PAGE}`);
  if (locales && terms && locales.length * terms.length > MAX_PAGE) {
    throw new Error(`locales × terms must not exceed ${MAX_PAGE}; use cursor pages`);
  }
  return { appId, locales, terms, limit: rawLimit, cursor: decodeCursor(body.cursor) };
}

function parseTop5(raw: string): CachedTop5App[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 5).flatMap((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) return [];
      const rank = Number(item.pos ?? index + 1);
      if (!Number.isSafeInteger(rank) || rank < 1 || rank > 200) return [];
      const bundleId = typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
      const developer = typeof item.dev === "string" && item.dev.trim() ? item.dev.trim() : null;
      const iTunesId = typeof item.tid === "number" || typeof item.tid === "string"
        ? String(item.tid).trim() || null
        : null;
      return [{ name, bundleId, iTunesId, developer, rank, iconUrl: null, isOwn: false }];
    });
  } catch {
    return [];
  }
}

export function latestCachedTop5(
  rankings: Database.Database,
  slug: string,
  input: ReturnType<typeof parseCachedTop5Input>,
  ownApp: StoredApp,
): Omit<CachedTop5Payload, "appId" | "slug"> {
  const rows = rankings.prepare(`
    WITH latest_date AS (
      SELECT locale, keyword, MAX(date) AS date
        FROM snapshots
       WHERE app = ? AND top5_json IS NOT NULL AND error IS NULL
    GROUP BY locale, keyword
    ), latest_id AS (
      SELECT s.locale, s.keyword, MAX(s.id) AS id
        FROM snapshots s
        JOIN latest_date d ON d.locale = s.locale AND d.keyword = s.keyword AND d.date = s.date
       WHERE s.app = ? AND s.top5_json IS NOT NULL AND s.error IS NULL
    GROUP BY s.locale, s.keyword
    )
    SELECT s.locale, s.keyword, s.date, s.position, s.total, s.top5_json
      FROM snapshots s
      JOIN latest_id l ON l.id = s.id
  `).all(slug, slug) as StoredSnapshotRow[];
  const localeSet = input.locales ? new Set(input.locales) : null;
  const termSet = input.terms ? new Set(input.terms) : null;
  const filtered = rows
    .filter((row) => (!localeSet || localeSet.has(row.locale.toLocaleLowerCase())) && (!termSet || termSet.has(normalizeTerm(row.keyword))))
    .map((row): CachedTop5Item => {
      const yourRank = row.position === null ? null : Number(row.position);
      const parsed = parseTop5(row.top5_json);
      const ownId = String(ownApp.iTunesId);
      const ownBundle = ownApp.bundle?.toLocaleLowerCase();
      let apps = parsed.map((app) => {
        const isOwn = app.iTunesId === ownId || (ownBundle !== undefined && app.bundleId?.toLocaleLowerCase() === ownBundle);
        return isOwn ? { ...app, isOwn: true, iconUrl: ownApp.iconUrl ?? null } : app;
      });
      // Legacy ASO snapshots sometimes omitted the tracked app from `top5`
      // while retaining its exact position. Repair only that known slot; this
      // never invents a competitor or changes a rank not stored in the row.
      if (!apps.some((app) => app.isOwn) && yourRank !== null && yourRank <= 5) {
        apps = apps.filter((app) => app.rank !== yourRank);
        apps.push({
          name: ownApp.name?.trim() || "Tracked app",
          bundleId: ownApp.bundle?.trim() || null,
          iTunesId: ownId,
          developer: null,
          rank: yourRank,
          iconUrl: ownApp.iconUrl ?? null,
          isOwn: true,
        });
      }
      apps.sort((a, b) => a.rank - b.rank || Number(b.isOwn) - Number(a.isOwn) || a.name.localeCompare(b.name));
      return {
        locale: row.locale.toLocaleLowerCase(), term: normalizeTerm(row.keyword), observedAt: row.date,
        freshness: "latest-successful-snapshot", error: null, yourRank,
        total: row.total === null ? null : Number(row.total), apps: apps.slice(0, 5),
      };
    })
    .sort((a, b) => a.locale.localeCompare(b.locale) || a.term.localeCompare(b.term));
  const afterCursor = input.cursor
    ? filtered.filter((row) => row.locale > input.cursor!.locale || (row.locale === input.cursor!.locale && row.term > input.cursor!.term))
    : filtered;
  const items = afterCursor.slice(0, input.limit);
  const present = new Set(filtered.map((item) => `${item.locale}\u0000${item.term}`));
  const knownLocales = input.locales ?? [...new Set(filtered.map((item) => item.locale))];
  const missing = (input.terms ?? []).flatMap((term) => knownLocales
    .filter((locale) => !present.has(`${locale}\u0000${term}`))
    .map((locale) => ({ locale, term, reason: "no_cached_snapshot" as const })));
  return {
    source: "cached-aso-snapshots",
    liveRefresh: false,
    generatedAt: items.map((item) => item.observedAt).sort().at(-1) ?? null,
    items,
    missing,
    nextCursor: afterCursor.length > items.length && items.length ? encodeCursor(items.at(-1)!) : null,
    page: { limit: input.limit, returned: items.length },
    limitations: [
      "Read only from the last successful local ASO snapshot; this request never calls the App Store.",
      "A missing item means no successful saved snapshot for this app/storefront/term, not that the app is absent from current search results.",
      "App artwork is intentionally not fetched here; use the existing artwork cache or an explicit rate-limited refresh for visible rows.",
    ],
  };
}

function appForAdamId(appId: number, appsPath = APPS_JSON): StoredApp | null {
  try {
    const apps = JSON.parse(readFileSync(appsPath, "utf8")) as StoredApp[];
    return apps.find((app) => Number(app.iTunesId) === appId) ?? null;
  } catch { return null; }
}

/** Fast SQLite-only request. It has no Apple request and therefore no refresh stampede/rate-limit impact. */
export function getCachedTop5Batch(value: unknown, options: { rankingsPath?: string; appsPath?: string } = {}): CachedTop5Payload {
  const input = parseCachedTop5Input(value);
  const ownApp = appForAdamId(input.appId, options.appsPath);
  if (!ownApp) return {
    source: "cached-aso-snapshots", liveRefresh: false, generatedAt: null, appId: input.appId, slug: null,
    items: [], missing: [], nextCursor: null, page: { limit: input.limit, returned: 0 },
    limitations: ["No ASO Tracker app mapping exists for this Apple app id. No live lookup was attempted."],
  };
  const slug = ownApp.id;
  const rankingsPath = options.rankingsPath ?? RANKINGS_DB;
  if (!existsSync(rankingsPath)) return {
    source: "cached-aso-snapshots", liveRefresh: false, generatedAt: null, appId: input.appId, slug,
    items: [], missing: [], nextCursor: null, page: { limit: input.limit, returned: 0 },
    limitations: ["ASO Tracker snapshot database is unavailable. No live lookup was attempted."],
  };
  const rankings = new Database(rankingsPath, { readonly: true, fileMustExist: true });
  try {
    return { ...latestCachedTop5(rankings, slug, input, ownApp), appId: input.appId, slug };
  } finally {
    rankings.close();
  }
}
