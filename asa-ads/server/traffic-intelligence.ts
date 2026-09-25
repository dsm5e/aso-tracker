import type Database from "better-sqlite3";
import { PlatformApiClient, PlatformApiError, appleFilter, type PlatformRequestMeta, type PlatformRead } from "./platform-api-client.ts";
import { toPopularity5to100, type KeywordPopularityService } from "./keyword-popularity.ts";

type JsonRecord = Record<string, unknown>;

export interface TrafficIntelligenceInput {
  appId: number;
  country: string;
  terms: string[];
  genre?: string;
  requestedStart?: string;
  requestedEnd?: string;
  start: string;
  end: string;
  forceRefresh?: boolean;
}

interface TrafficCacheRow {
  payload: string;
  generated_at: string;
  expires_at: number;
}

interface TrafficCacheEntry {
  payload: JsonRecord;
  generatedAt: string;
  expiresAt: number;
}

const TRAFFIC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TRAFFIC_STALE_RETRY_MS = 2 * 60 * 1000;
const TRAFFIC_CACHE_SCHEMA = "traffic-intelligence-v4";

interface SourceOk<T> {
  status: "ok";
  data: T;
  meta: unknown;
}

interface SourceError {
  status: "error";
  data: null;
  error: {
    type: "apple" | "local" | "unknown";
    message: string;
    statusCode?: number;
    requestId?: string;
    retryable?: boolean;
  };
}

export type SourceResult<T> = SourceOk<T> | SourceError;

export interface LocalKeywordRow extends JsonRecord {
  keywordId: number;
  campaignId: number;
  campaignName: string;
  adGroupId: number;
  text: string;
  matchType: string;
  bid: number | null;
  status: string;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  trials?: number;
  paid?: number;
  revenueUsd?: number;
  revenueUpdatedAt?: string | null;
}

export interface LocalSearchTermRow extends JsonRecord {
  term: string;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
}

export interface LocalTrafficData {
  keywords: LocalKeywordRow[];
  searchTerms: LocalSearchTermRow[];
}

export interface ModeledMetric {
  value: number | null;
  modeled: true;
  factors: string[];
}

export interface TrafficTermModel {
  term: string;
  origins: string[];
  /** Apple Ads popularity 5–100 (one scale only; see keyword-popularity.ts). */
  demandIndex: number | null;
  demandScale: "apple_5_to_100" | null;
  /** Apple's coarse impression-share bucket (1–5). Informational — never mixed into demandIndex. */
  popularityBucket1to5: number | null;
  share: { low: number; high: number; mid: number; history: JsonRecord[] } | null;
  rank: number | null;
  competitorsAhead: number | null;
  capturedIndex: number | null;
  availableIndex: number | null;
  observed: {
    exactImpressions: number;
    allKeywordImpressions: number;
    searchTermImpressions: number;
    taps: number;
    installs: number;
    spend: number;
    trials: number;
    paid: number;
    revenueUsd: number;
    revenueUpdatedAt: string | null;
    keywords: LocalKeywordRow[];
  };
  eligibleInventory: {
    lower: number;
    upper: number | null;
    remainingLower: number;
    remainingUpper: number | null;
    modeled: true;
    explanation: string;
  } | null;
  difficulty: ModeledMetric;
  opportunity: ModeledMetric;
  validation: {
    status: "strong" | "directional" | "unverified" | "no-demand-signal";
    evidence: string[];
    warning?: string;
  };
}

interface RowCollection<T> {
  data: T[];
  meta: { calls: PlatformRequestMeta[]; rowCount: number };
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeTerm(term: string): string {
  return term.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || isoDate(parsed) !== value) throw new Error(`${name} is not a valid date`);
  return parsed;
}

function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay());
  return copy;
}

function lastCompletedSaturday(now = new Date()): Date {
  const copy = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceSaturday = (copy.getUTCDay() + 1) % 7 || 7;
  copy.setUTCDate(copy.getUTCDate() - daysSinceSaturday);
  return copy;
}

function endOfCompletedWeek(date: Date, cap: Date): Date {
  const copy = new Date(date);
  const daysBack = (copy.getUTCDay() + 1) % 7;
  copy.setUTCDate(copy.getUTCDate() - daysBack);
  return copy > cap ? new Date(cap) : copy;
}

export function parseTrafficQuery(query: Record<string, unknown>, now = new Date()): TrafficIntelligenceInput {
  const rawApp = String(query.app_id ?? query.itunesId ?? query.appId ?? "");
  if (!/^\d+$/.test(rawApp) || !Number.isSafeInteger(Number(rawApp)) || Number(rawApp) <= 0) {
    throw new Error("app_id must be a positive integer");
  }
  const rawCountry = String(query.country ?? query.locale ?? "").trim();
  const country = (rawCountry.split(/[-_]/).at(-1) ?? rawCountry).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("country must be an ISO 3166-1 alpha-2 code");
  const terms = [...new Set(String(query.terms ?? "").split(",").map(normalizeTerm).filter(Boolean))];
  if (terms.length > 100) throw new Error("terms accepts at most 100 comma-separated values");
  if (terms.some((term) => term.length > 200)) throw new Error("each term must be at most 200 characters");
  const genre = query.genre === undefined || String(query.genre).trim() === ""
    ? undefined
    : String(query.genre).trim().toUpperCase();
  if (genre && !/^[A-Z0-9_]+$/.test(genre)) throw new Error("genre contains unsupported characters");

  const completedSaturday = lastCompletedSaturday(now);
  const requestedStart = query.start === undefined ? undefined : String(query.start);
  const requestedEnd = query.end === undefined ? undefined : String(query.end);
  const parsedStart = parseDate(requestedStart, "start");
  const parsedEnd = parseDate(requestedEnd, "end");
  const end = parsedEnd ? endOfCompletedWeek(parsedEnd, completedSaturday) : completedSaturday;
  const defaultStart = new Date(end);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 27);
  const start = parsedStart ? startOfWeek(parsedStart) : defaultStart;
  if (start > end) throw new Error("date range has no completed Sunday-Saturday week");
  const forceRefresh = ["1", "true", "yes"].includes(String(query.force ?? query.refresh ?? "").toLocaleLowerCase());

  return {
    appId: Number(rawApp),
    country,
    terms,
    genre,
    requestedStart,
    requestedEnd,
    start: isoDate(start),
    end: isoDate(end),
    forceRefresh,
  };
}

function weeklyChunks(start: string, end: string): Array<{ start: string; end: string }> {
  const chunks: Array<{ start: string; end: string }> = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 27);
    if (chunkEnd > last) chunkEnd.setTime(last.getTime());
    chunks.push({ start: isoDate(cursor), end: isoDate(chunkEnd) });
    cursor.setUTCDate(cursor.getUTCDate() + 28);
  }
  return chunks;
}

function sourceError(error: unknown, type: SourceError["error"]["type"] = "unknown"): SourceError {
  if (error instanceof PlatformApiError) {
    return {
      status: "error",
      data: null,
      error: {
        type: "apple",
        message: error.message,
        statusCode: error.status,
        requestId: error.requestId,
        retryable: error.retryable,
      },
    };
  }
  return {
    status: "error",
    data: null,
    error: { type, message: error instanceof Error ? error.message : String(error) },
  };
}

function compactSource(source: unknown): JsonRecord {
  if (!source || typeof source !== "object" || Array.isArray(source)) return { status: "unknown" };
  const record = source as JsonRecord;
  if (record.status === "error") return record;
  const data = record.data;
  const existingCount = Number(record.itemCount);
  return {
    status: record.status ?? "ok",
    itemCount: Number.isFinite(existingCount) ? existingCount : Array.isArray(data) ? data.length : data == null ? 0 : 1,
    meta: record.meta ?? null,
  };
}

function compactTrafficPayload(payload: JsonRecord): JsonRecord {
  const rawSources = payload.sources && typeof payload.sources === "object" && !Array.isArray(payload.sources)
    ? payload.sources as JsonRecord
    : {};
  const sources = Object.fromEntries(Object.entries(rawSources).map(([name, source]) => [name, compactSource(source)]));
  return {
    ...payload,
    sources,
    raw: {
      note: "Full Apple row corpora are intentionally omitted from the composite response; per-source counts and request metadata remain available here.",
      sources,
    },
  };
}

async function settleRead<T>(promise: Promise<PlatformRead<T>>): Promise<SourceResult<T>> {
  try {
    const read = await promise;
    return { status: "ok", data: read.data, meta: read.meta };
  } catch (error) {
    return sourceError(error);
  }
}

async function settleRows<T>(promise: Promise<RowCollection<T>>): Promise<SourceResult<T[]>> {
  try {
    const read = await promise;
    return { status: "ok", data: read.data, meta: read.meta };
  } catch (error) {
    return sourceError(error);
  }
}

function loadLocal(db: Database.Database, input: TrafficIntelligenceInput): LocalTrafficData {
  const keywords = db.prepare(`
    SELECT k.id AS keywordId, k.campaign_id AS campaignId, c.name AS campaignName,
           k.ad_group_id AS adGroupId, k.text, k.match_type AS matchType, k.bid, k.status,
           COALESCE(SUM(d.impressions), 0) AS impressions,
           COALESCE(SUM(d.taps), 0) AS taps,
           COALESCE(SUM(d.installs), 0) AS installs,
           COALESCE(SUM(d.spend), 0) AS spend,
           COALESCE(MAX(r.trials), 0) AS trials,
           COALESCE(MAX(r.paid), 0) AS paid,
           COALESCE(MAX(r.revenue_usd), 0) AS revenueUsd,
           MAX(r.updated_at) AS revenueUpdatedAt
    FROM asa_keywords k
    JOIN asa_campaigns c ON c.id = k.campaign_id
    JOIN asa_ad_groups g ON g.id = k.ad_group_id
    LEFT JOIN asa_kw_daily d ON d.keyword_id = k.id AND d.date BETWEEN ? AND ?
    LEFT JOIN asa_kw_revenue r ON r.keyword_id = k.id AND r.campaign_id = k.campaign_id AND r.bounded = 1
    WHERE c.app_id = ? AND UPPER(c.country) = ?
      AND (
        c.countries_json IS NULL OR TRIM(c.countries_json) = ''
        OR c.countries_json = json_array(?)
      )
      AND c.status = 'ENABLED' AND g.status = 'ENABLED'
      AND k.status = 'ACTIVE' AND k.deleted = 0
    GROUP BY k.id
    ORDER BY impressions DESC, k.text
  `).all(input.start, input.end, input.appId, input.country, input.country) as LocalKeywordRow[];
  const searchTerms = db.prepare(`
    SELECT s.term,
           COALESCE(SUM(s.impressions), 0) AS impressions,
           COALESCE(SUM(s.taps), 0) AS taps,
           COALESCE(SUM(s.installs), 0) AS installs,
           COALESCE(SUM(s.spend), 0) AS spend
    FROM asa_search_terms s
    JOIN asa_campaigns c ON c.id = s.campaign_id
    WHERE c.app_id = ? AND UPPER(c.country) = ?
      AND (
        c.countries_json IS NULL OR TRIM(c.countries_json) = ''
        OR c.countries_json = json_array(?)
      )
      AND s.date BETWEEN ? AND ?
    GROUP BY LOWER(TRIM(s.term))
    ORDER BY impressions DESC, s.term
  `).all(input.appId, input.country, input.country, input.start, input.end) as LocalSearchTermRow[];
  return { keywords, searchTerms };
}

function filtersForApp(appId: number): JsonRecord[] {
  return [
    appleFilter("promotedObjectId", "EQUALS", [String(appId)]),
    appleFilter("promotedObjectType", "EQUALS", ["APPSTORE_APP"]),
  ];
}

async function collectWeeklyRows<T extends JsonRecord>(
  client: PlatformApiClient,
  path: string,
  input: TrafficIntelligenceInput,
  filters: JsonRecord[],
  extra: JsonRecord = {},
): Promise<RowCollection<T>> {
  const reads = await Promise.all(weeklyChunks(input.start, input.end).map((range) => client.queryRows<T>(path, {
    filters,
    timeRange: { ...range, granularity: "WEEKLY_SUN_SAT" },
    ...extra,
  })));
  return { data: reads.flatMap((read) => read.data), meta: { calls: reads.map((read) => read.meta), rowCount: reads.reduce((n, read) => n + read.data.length, 0) } };
}

function latestByDate(rows: JsonRecord[]): JsonRecord | undefined {
  return [...rows].sort((a, b) => String(b.week ?? b.day ?? b.month ?? "").localeCompare(String(a.week ?? a.day ?? a.month ?? "")))[0];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function modelTermTraffic(args: {
  term: string;
  origins: string[];
  impressionShareRows: JsonRecord[];
  popularityRows: JsonRecord[];
  suggestionPopularity?: number | null;
  /** Canonical per-keyword value from KeywordPopularityService (storefront-independent). */
  storedPopularity?: number | null;
  keywords: LocalKeywordRow[];
  searchTerm?: LocalSearchTermRow;
}): TrafficTermModel {
  const shareHistory = [...args.impressionShareRows].sort((a, b) => String(a.week ?? a.day ?? "").localeCompare(String(b.week ?? b.day ?? "")));
  const latestShare = latestByDate(shareHistory);
  const latestPopularity = latestByDate(args.popularityRows);
  // One scale only. The 1–5 impression-share bucket used to be multiplied by
  // 20 as a fallback, so the same term read 7 or 40 depending on the batch.
  const demandIndex = toPopularity5to100(args.storedPopularity)
    ?? toPopularity5to100(latestPopularity?.searchPopularity1to100)
    ?? toPopularity5to100(args.suggestionPopularity);
  const demandScale = demandIndex !== null ? "apple_5_to_100" as const : null;
  const popularityBucket1to5 = numberOrNull(latestPopularity?.searchPopularity1to5 ?? latestShare?.searchPopularity1to5);
  const low = numberOrNull(latestShare?.lowImpressionShare);
  const high = numberOrNull(latestShare?.highImpressionShare);
  const share = low === null || high === null ? null : {
    low: round(low, 4),
    high: round(high, 4),
    mid: round((low + high) / 2, 4),
    history: shareHistory,
  };
  const rank = numberOrNull(latestShare?.rank);
  const competitorsAhead = rank === null ? null : Math.max(rank - 1, 0);
  const capturedIndex = demandIndex === null || share === null ? null : round(demandIndex * share.mid);
  const availableIndex = demandIndex === null || share === null ? null : round(demandIndex * (1 - share.mid));
  const exactImpressions = args.keywords
    .filter((keyword) => keyword.matchType === "EXACT")
    .reduce((sum, keyword) => sum + Number(keyword.impressions), 0);
  const allKeywordImpressions = args.keywords.reduce((sum, keyword) => sum + Number(keyword.impressions), 0);
  const taps = args.keywords.reduce((sum, keyword) => sum + Number(keyword.taps), 0);
  const installs = args.keywords.reduce((sum, keyword) => sum + Number(keyword.installs), 0);
  const spend = args.keywords.reduce((sum, keyword) => sum + Number(keyword.spend), 0);
  const trials = args.keywords.reduce((sum, keyword) => sum + Number(keyword.trials ?? 0), 0);
  const paid = args.keywords.reduce((sum, keyword) => sum + Number(keyword.paid ?? 0), 0);
  const revenueUsd = args.keywords.reduce((sum, keyword) => sum + Number(keyword.revenueUsd ?? 0), 0);
  const revenueUpdatedAt = args.keywords
    .map((keyword) => keyword.revenueUpdatedAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1) ?? null;
  const eligibleInventory = exactImpressions > 0 && share && share.high > 0 ? {
    lower: round(exactImpressions / share.high),
    upper: share.low > 0 ? round(exactImpressions / share.low) : null,
    remainingLower: round(Math.max(0, exactImpressions / share.high - exactImpressions)),
    remainingUpper: share.low > 0 ? round(Math.max(0, exactImpressions / share.low - exactImpressions)) : null,
    modeled: true as const,
    explanation: "Bounded as exact-match impressions / Apple's high-to-low share range; broad/Search Match overlap and privacy suppression can make this directional.",
  } : null;
  const competitorPressure = competitorsAhead === null ? 50 : Math.min(100, competitorsAhead * 12.5);
  const unclaimedPressure = share === null ? 50 : (1 - share.mid) * 100;
  const difficultyValue = demandIndex === null ? null : round(0.45 * demandIndex + 0.35 * unclaimedPressure + 0.2 * competitorPressure);
  const opportunityValue = availableIndex;
  const evidence: string[] = [];
  if (args.keywords.some((keyword) => keyword.matchType === "EXACT" && keyword.status === "ACTIVE")) evidence.push("active exact keyword");
  if (args.keywords.some((keyword) => Number(keyword.installs) > 0)) evidence.push("local installs");
  if (args.searchTerm && Number(args.searchTerm.impressions) > 0) evidence.push("observed search term");
  if (args.origins.includes("apple-keyword-suggestion") || args.origins.includes("apple-phrase-suggestion")) evidence.push("Apple suggestion");
  if (demandIndex !== null) evidence.push("Apple demand signal");
  if (share !== null) evidence.push("Apple impression-share signal");
  let validation: TrafficTermModel["validation"];
  if (demandIndex === null) validation = { status: "no-demand-signal", evidence, warning: "No Apple popularity signal; do not treat the term as validated." };
  else if (evidence.includes("local installs") || (evidence.includes("observed search term") && demandIndex >= 40)) validation = { status: "strong", evidence };
  else if (evidence.length >= 2) validation = { status: "directional", evidence, warning: "Relevance and subscription economics still require validation." };
  else validation = { status: "unverified", evidence, warning: "Apple suggestions can be noisy; validate intent before adding this keyword." };
  return {
    term: args.term,
    origins: [...new Set(args.origins)].sort(),
    demandIndex,
    demandScale,
    popularityBucket1to5,
    share,
    rank,
    competitorsAhead,
    capturedIndex,
    availableIndex,
    observed: {
      exactImpressions,
      allKeywordImpressions,
      searchTermImpressions: Number(args.searchTerm?.impressions ?? 0),
      taps,
      installs,
      spend: round(spend),
      trials,
      paid,
      revenueUsd: round(revenueUsd),
      revenueUpdatedAt,
      keywords: args.keywords,
    },
    eligibleInventory,
    difficulty: {
      value: difficultyValue,
      modeled: true,
      factors: ["45% demand index", "35% unclaimed-share pressure (neutral 50 if missing)", "20% paid-rank pressure at 12.5 points per competitor ahead (neutral 50 if missing)"],
    },
    opportunity: {
      value: opportunityValue,
      modeled: true,
      factors: ["Apple demand index × available share", "Relevance is not inferred and defaults to 100%", "Not a forecast of impressions, installs, or revenue"],
    },
    validation,
  };
}

export class TrafficIntelligenceService {
  private readonly db: Database.Database;
  private readonly client: PlatformApiClient;
  private readonly popularity?: KeywordPopularityService;

  constructor(db: Database.Database, client: PlatformApiClient, popularity?: KeywordPopularityService) {
    this.db = db;
    this.client = client;
    this.popularity = popularity;
    // Tests and older local databases may not have run the main migration yet.
    // CREATE IF NOT EXISTS is cheap and keeps this service independently safe.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traffic_intelligence_cache (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS asa_kw_revenue (
        campaign_id INTEGER NOT NULL,
        keyword_id INTEGER NOT NULL,
        country TEXT,
        attributed_installs INTEGER NOT NULL DEFAULT 0,
        trials INTEGER NOT NULL DEFAULT 0,
        paid INTEGER NOT NULL DEFAULT 0,
        revenue_usd REAL NOT NULL DEFAULT 0,
        cohort_start TEXT,
        cohort_end TEXT,
        observed_through TEXT,
        windows_json TEXT,
        bounded INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (campaign_id, keyword_id)
      )
    `);
    const revenueColumns = new Set(
      (this.db.prepare("PRAGMA table_info(asa_kw_revenue)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    if (!revenueColumns.has("bounded")) {
      this.db.exec("ALTER TABLE asa_kw_revenue ADD COLUMN bounded INTEGER NOT NULL DEFAULT 0");
    }
  }

  private cacheKey(input: TrafficIntelligenceInput): string {
    return JSON.stringify({
      schema: TRAFFIC_CACHE_SCHEMA,
      appId: input.appId,
      country: input.country,
      terms: [...input.terms].sort(),
      genre: input.genre ?? null,
      requestedStart: input.requestedStart ?? null,
      requestedEnd: input.requestedEnd ?? null,
      start: input.start,
      end: input.end,
    });
  }

  private readCache(cacheKey: string): TrafficCacheEntry | null {
    const row = this.db.prepare(`
      SELECT payload, generated_at, expires_at
      FROM traffic_intelligence_cache
      WHERE cache_key = ?
    `).get(cacheKey) as TrafficCacheRow | undefined;
    if (!row) return null;
    try {
      const payload = JSON.parse(row.payload) as unknown;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      const compacted = compactTrafficPayload(payload as JsonRecord);
      const serialized = JSON.stringify(compacted);
      if (serialized.length < row.payload.length) {
        this.db.prepare(`UPDATE traffic_intelligence_cache SET payload = ? WHERE cache_key = ?`).run(serialized, cacheKey);
      }
      return { payload: compacted, generatedAt: row.generated_at, expiresAt: Number(row.expires_at) };
    } catch {
      return null;
    }
  }

  private decorateCached(entry: TrafficCacheEntry, status: "fresh" | "stale-if-error", liveErrors: Array<{ scope: string; message: string }> = []): JsonRecord {
    const cachedErrors = Array.isArray(entry.payload.partialErrors)
      ? entry.payload.partialErrors.filter((item): item is { scope: string; message: string } => Boolean(item && typeof item === "object"))
      : [];
    const partialErrors = [...cachedErrors, ...liveErrors].filter((item, index, rows) =>
      rows.findIndex((candidate) => candidate.scope === item.scope && candidate.message === item.message) === index
    );
    return {
      ...entry.payload,
      generatedAt: entry.generatedAt,
      stale: status === "stale-if-error",
      servedFromCache: true,
      partialErrors,
      cache: {
        status,
        persisted: true,
        generatedAt: entry.generatedAt,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        nextRetryAt: status === "stale-if-error" ? new Date(entry.expiresAt).toISOString() : null,
        ttlSeconds: TRAFFIC_CACHE_TTL_MS / 1000,
      },
    };
  }

  private postponeStaleRetry(cacheKey: string, entry: TrafficCacheEntry, liveErrors: Array<{ scope: string; message: string }>): JsonRecord {
    const nextRetryAt = Date.now() + TRAFFIC_STALE_RETRY_MS;
    const fallback = this.decorateCached({ ...entry, expiresAt: nextRetryAt }, "stale-if-error", liveErrors);
    this.db.prepare(`
      UPDATE traffic_intelligence_cache
      SET payload = ?, expires_at = ?
      WHERE cache_key = ?
    `).run(JSON.stringify(fallback), nextRetryAt, cacheKey);
    return fallback;
  }

  private writeCache(cacheKey: string, payload: JsonRecord): void {
    const compacted = compactTrafficPayload(payload);
    const generatedAt = String(payload.generatedAt ?? new Date().toISOString());
    const expiresAt = Date.now() + TRAFFIC_CACHE_TTL_MS;
    this.db.prepare(`
      INSERT INTO traffic_intelligence_cache (cache_key, payload, generated_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        payload = excluded.payload,
        generated_at = excluded.generated_at,
        expires_at = excluded.expires_at
    `).run(cacheKey, JSON.stringify(compacted), generatedAt, expiresAt);
  }

  async get(input: TrafficIntelligenceInput): Promise<JsonRecord> {
    const cacheKey = this.cacheKey(input);
    const cached = this.readCache(cacheKey);
    if (!input.forceRefresh && cached && cached.expiresAt > Date.now()) {
      return this.decorateCached(cached, cached.payload.stale === true ? "stale-if-error" : "fresh");
    }

    let local: SourceResult<LocalTrafficData>;
    try {
      local = {
        status: "ok",
        data: loadLocal(this.db, input),
        meta: {
          database: "asa-ads.db",
          appId: input.appId,
          country: input.country,
          start: input.start,
          end: input.end,
          geoAttribution: "dedicated-country-campaigns-only",
        },
      };
    } catch (error) {
      local = sourceError(error, "local");
    }
    const localData = local.status === "ok" ? local.data : { keywords: [], searchTerms: [] };

    const impressionFilters = [
      appleFilter("promotedObjectId", "IN", [String(input.appId)]),
      appleFilter("countryOrRegion", "EQUALS", input.country),
    ];
    const popularityFilters: JsonRecord[] = [appleFilter("countryOrRegion", "EQUALS", input.country)];
    if (input.genre) popularityFilters.push(appleFilter("genre", "EQUALS", input.genre));
    const popularityTerms = (input.terms.length
      ? input.terms
      : [...new Set([
          ...localData.keywords.map((keyword) => normalizeTerm(keyword.text)),
          ...localData.searchTerms.map((term) => normalizeTerm(term.term)),
        ])]
    ).slice(0, 100);
    if (popularityTerms.length) popularityFilters.push(appleFilter("searchTerm", "IN", popularityTerms));
    const suggestionFilters = [
      ...filtersForApp(input.appId),
      appleFilter("countriesOrRegions", "IN", [input.country]),
      ...(input.terms.length ? [appleFilter("terms", "IN", input.terms)] : []),
    ];
    const recommendationFilters = [
      ...filtersForApp(input.appId),
      appleFilter("state", "EQUALS", ["AVAILABLE"]),
    ];

    const [account, impressionShare, popularity, keywordSuggestions, targetCpaSuggestion, dailyBudgetRecommendations, targetCpaRecommendations] = await Promise.all([
      this.client.resolveAdAccount().then((data) => ({ status: "ok" as const, data, meta: { cachedByClient: true } })).catch((error) => sourceError(error)),
      settleRows(collectWeeklyRows<JsonRecord>(this.client, "/insights/apps/impression-share/query", input, impressionFilters, { options: { impressionShareReportType: "ALL_SLOTS" }, sorting: [{ field: "highImpressionShare", order: "DESC" }] })),
      settleRows(collectWeeklyRows<JsonRecord>(this.client, "/insights/apps/search-term-popularity/query", input, popularityFilters, { sorting: [{ field: "searchPopularity1to100", order: "DESC" }] })),
      settleRead(this.client.queryRows<JsonRecord>("/suggestions/keywords/query", { filters: suggestionFilters }, 1000)),
      settleRead(this.client.queryObject<JsonRecord>("/suggestions/target-cpas/query", { filters: [...filtersForApp(input.appId), appleFilter("countryOrRegion", "IN", [input.country])] })),
      settleRead(this.client.queryRows<JsonRecord>("/recommendations/daily-budgets/query", { filters: recommendationFilters, sorting: [{ field: "suggestedDailyBudgetAmount", order: "DESC" }] }, 1000)),
      settleRead(this.client.queryRows<JsonRecord>("/recommendations/target-cpas/query", { filters: recommendationFilters, sorting: [{ field: "creationTime", order: "DESC" }] }, 1000)),
    ]);

    const shareRows = impressionShare.status === "ok" ? impressionShare.data : [];
    const popularityRows = popularity.status === "ok" ? popularity.data : [];
    const keywordRows = keywordSuggestions.status === "ok" ? keywordSuggestions.data : [];
    const origins = new Map<string, Set<string>>();
    const displayTerms = new Map<string, string>();
    const add = (value: unknown, origin: string) => {
      if (typeof value !== "string") return;
      const normalized = normalizeTerm(value);
      if (!normalized) return;
      if (!origins.has(normalized)) origins.set(normalized, new Set());
      origins.get(normalized)?.add(origin);
      if (!displayTerms.has(normalized)) displayTerms.set(normalized, value.trim());
    };
    input.terms.forEach((term) => add(term, "requested"));
    localData.keywords.forEach((row) => add(row.text, "owned-keyword"));
    localData.searchTerms.forEach((row) => add(row.term, "observed-search-term"));
    shareRows.forEach((row) => add(row.searchTerm, "impression-share"));
    // Search-term popularity can return an entire genre/storefront corpus. It is
    // evidence for terms we already know about, not a trustworthy candidate
    // generator by itself. Adding every popularity row here produced thousands
    // of unrelated "discovery" terms (for example generic fitness searches for
    // a DICOM app). Candidate creation stays limited to account/search-term,
    // impression-share, and Apple suggestion evidence; popularityRows enrich
    // those candidates later through popularityMap.
    keywordRows.forEach((row) => add(row.text, "apple-keyword-suggestion"));

    const byNormalized = <T extends JsonRecord>(rows: T[], field: string): Map<string, T[]> => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        if (typeof row[field] !== "string") continue;
        const key = normalizeTerm(String(row[field]));
        map.set(key, [...(map.get(key) ?? []), row]);
      }
      return map;
    };
    const shareMap = byNormalized(shareRows, "searchTerm");
    const popularityMap = byNormalized(popularityRows, "searchTerm");
    const localKeywordMap = byNormalized(localData.keywords, "text");
    const localSearchTermMap = byNormalized(localData.searchTerms, "term");
    const suggestionPopularity = new Map<string, number>();
    keywordRows.map((row) => ({ text: row.text, popularity: row.popularity })).forEach((row) => {
      if (typeof row.text !== "string") return;
      const popularityValue = numberOrNull(row.popularity);
      if (popularityValue !== null) suggestionPopularity.set(normalizeTerm(row.text), popularityValue);
    });

    // Canonical popularity: read the per-day store (single-term Apple values)
    // and let it fill the rest in the background.
    // Only requested and owned terms are queued for a fetch — suggestion and
    // impression-share corpora can run to hundreds of unrelated terms.
    const stored = this.popularity?.peek(input.appId, input.country, [...origins.keys()], false);
    this.popularity?.peek(input.appId, input.country, [...input.terms, ...localData.keywords.map((row) => row.text)]);

    const terms = [...origins.keys()].map((normalized) => modelTermTraffic({
      term: displayTerms.get(normalized) ?? normalized,
      origins: [...(origins.get(normalized) ?? [])],
      impressionShareRows: shareMap.get(normalized) ?? [],
      popularityRows: popularityMap.get(normalized) ?? [],
      suggestionPopularity: suggestionPopularity.get(normalized),
      storedPopularity: stored?.get(normalized)?.popularity ?? null,
      keywords: localKeywordMap.get(normalized) ?? [],
      searchTerm: localSearchTermMap.get(normalized)?.[0],
    })).sort((a, b) => (b.opportunity.value ?? -1) - (a.opportunity.value ?? -1) || (b.demandIndex ?? -1) - (a.demandIndex ?? -1) || a.term.localeCompare(b.term));

    const keywordView = terms.map((term) => {
      const campaigns = new Set(term.observed.keywords.map((keyword) => keyword.campaignId));
      const confidence = term.validation.status === "strong" ? "high" : term.validation.status === "directional" ? "medium" : "low";
      return {
        keyword: term.term,
        source: term.origins.join(", "),
        tracked: term.origins.includes("owned-keyword"),
        popularity: term.demandIndex,
        impressionShare: term.share ? { value: term.share.mid, lowerBound: term.share.low, upperBound: term.share.high, basis: "bounded" } : null,
        capturedShare: term.share ? { value: term.share.mid, lowerBound: term.share.low, upperBound: term.share.high, basis: "bounded" } : null,
        paidRank: term.rank,
        campaignCount: campaigns.size,
        matchTypes: [...new Set(term.observed.keywords.map((keyword) => keyword.matchType))],
        impressions: term.observed.allKeywordImpressions,
        taps: term.observed.taps,
        installs: term.observed.installs,
        spend: term.observed.spend,
        trials: term.observed.trials,
        paid: term.observed.paid,
        revenueUsd: term.observed.revenueUsd,
        revenueUpdatedAt: term.observed.revenueUpdatedAt,
        cpaTrial: term.observed.trials > 0 ? round(term.observed.spend / term.observed.trials) : null,
        cpaPaid: term.observed.paid > 0 ? round(term.observed.spend / term.observed.paid) : null,
        realizedRoas: term.observed.spend > 0 && term.observed.revenueUpdatedAt
          ? round(term.observed.revenueUsd / term.observed.spend, 4)
          : null,
        economicsGrain: term.observed.revenueUpdatedAt ? "attributed-keyword" : "missing",
        cohortMaturity: "unknown",
        currency: "USD",
        bid: term.observed.keywords.length ? Math.max(...term.observed.keywords.map((keyword) => Number(keyword.bid ?? 0))) : null,
        confidence,
        reason: [...term.validation.evidence, term.validation.warning].filter(Boolean).join(" · "),
        competitorsAhead: term.competitorsAhead,
        capturedIndex: term.capturedIndex,
        availableIndex: term.availableIndex,
        difficulty: term.difficulty,
        opportunity: term.opportunity,
        eligibleInventory: term.eligibleInventory,
        model: term,
      };
    });
    const keywords = keywordView.filter((term) => term.tracked);
    const discoveryPool = keywordView.filter((term) => !term.tracked);
    // Apple keyword suggestions are deliberately broad and can include popular,
    // unrelated app names. They remain available below for auditability, but a
    // suggestion with no impression-share or observed-search-term evidence is
    // not promoted into the dashboard's "valid candidates" queue.
    const discoveryEvidence = new Set(["requested", "observed-search-term", "impression-share"]);
    const discovery = discoveryPool.filter((term) => {
      const origins = String(term.source).split(", ");
      return origins.some((origin) => discoveryEvidence.has(origin));
    });
    const unverifiedSuggestions = discoveryPool.filter((term) => !discovery.includes(term));
    const sourceEntries = {
      local,
      account,
      impressionShare,
      searchTermPopularity: popularity,
      keywordSuggestions,
      targetCpaSuggestion,
      dailyBudgetRecommendations,
      targetCpaRecommendations,
    };
    const partialErrors = Object.entries(sourceEntries)
      .filter((entry): entry is [string, SourceError] => entry[1].status === "error")
      .map(([scope, result]) => ({ scope, message: result.error.message }));

    const livePayload: JsonRecord = {
      generatedAt: new Date().toISOString(),
      mode: "read-only",
      stale: false,
      servedFromCache: false,
      window: { start: input.start, end: input.end, label: "completed Apple weeks" },
      summary: {
        ownedKeywords: keywords.length,
        discoveryCandidates: discovery.length,
        unverifiedSuggestions: unverifiedSuggestions.length,
        measuredShare: terms.filter((term) => term.share !== null).length,
        highOpportunity: terms.filter((term) => (term.opportunity.value ?? 0) >= 25).length,
      },
      query: {
        appId: input.appId,
        country: input.country,
        terms: input.terms,
        genre: input.genre ?? null,
        requestedStart: input.requestedStart ?? null,
        requestedEnd: input.requestedEnd ?? null,
        effectiveStart: input.start,
        effectiveEnd: input.end,
        granularity: "WEEKLY_SUN_SAT",
        note: "Apple weekly insights use only completed Sunday-Saturday weeks; long ranges are split into four-week requests.",
      },
      limitations: {
        paidCompetitorNames: "Apple does not expose paid competitor app names for a search term. competitorsAhead is max(rank - 1, 0).",
        traffic: "Demand, captured, available, difficulty, opportunity, and eligible inventory are relative/modelled indexes unless explicitly labeled observed impressions.",
        multiCountryCampaigns: "Observed keyword and search-term metrics are shown only for campaigns dedicated to the selected country. Apple campaign reports do not provide a trustworthy country split for multi-country campaigns, so bundle totals are excluded instead of being misattributed.",
        privacy: "Apple suppresses impression-share search terms with fewer than 10 impressions in an aggregation period.",
        suggestions: "Apple suggestions are candidate generation, not proof of relevance or profitability.",
      },
      partialErrors,
      keywords,
      discovery,
      unverifiedSuggestions,
      competitors: [],
      sources: Object.fromEntries(Object.entries(sourceEntries).map(([name, source]) => [name, compactSource(source)])),
      terms,
      raw: {
        note: "Full Apple row corpora are intentionally omitted from the composite response; per-source counts and request metadata remain available here.",
        sources: Object.fromEntries(Object.entries(sourceEntries).map(([name, source]) => [name, compactSource(source)])),
      },
    };

    const criticalFailure = local.status === "error" || impressionShare.status === "error" || popularity.status === "error";
    if (criticalFailure && cached) {
      return this.postponeStaleRetry(cacheKey, cached, partialErrors.map((item) => ({
        scope: item.scope,
        message: `Не удалось обновить данные; показан последний сохранённый снимок. ${item.message}`,
      })));
    }

    if (!criticalFailure) this.writeCache(cacheKey, livePayload);
    return {
      ...livePayload,
      cache: {
        status: criticalFailure ? "not-saved-incomplete" : "live",
        persisted: !criticalFailure,
        generatedAt: livePayload.generatedAt,
        expiresAt: criticalFailure ? null : new Date(Date.now() + TRAFFIC_CACHE_TTL_MS).toISOString(),
        ttlSeconds: TRAFFIC_CACHE_TTL_MS / 1000,
      },
    };
  }
}
