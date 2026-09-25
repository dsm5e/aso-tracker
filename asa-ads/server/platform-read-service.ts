import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { PlatformApiClient, PlatformApiError, appleFilter, isSensitivePlatformKey, redactPlatformText, type PlatformRead, type PlatformRequestMeta } from "./platform-api-client.ts";
import { PLATFORM_API_METHODS, type PlatformApiMethod } from "./platform-api-methods.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonRecord = Record<string, unknown>;

const DEFAULT_TTL_MS = 6 * 60 * 60_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_FILTERS = 50;
const READ_METHODS = new Set(["GET", "POST"]);
const APP_BOUND_PATH = /^(?:\/apps\/|\/campaigns(?:\/|$)|\/adgroups(?:\/|$)|\/keywords(?:\/|$)|\/negative-keywords(?:\/|$)|\/ads(?:\/|$)|\/creatives(?:\/|$)|\/assets(?:\/|$)|\/product-pages(?:\/|$)|\/reports\/apps\/|\/insights\/apps\/|\/suggestions\/|\/recommendations\/)/;

export interface PlatformSourceError {
  source: string;
  message: string;
  statusCode?: number;
  requestId?: string;
  retryable?: boolean;
}

export interface PlatformSource<T = unknown> {
  status: "ok" | "error" | "skipped";
  data: T | null;
  meta: PlatformRequestMeta | { fetchedAt: string; cached: boolean } | null;
  error?: PlatformSourceError;
}

export interface PlatformSnapshot<T = unknown> {
  source: string;
  methodId: string;
  /** Account context resolved from Apple before this snapshot was read. */
  accountId: string;
  data: T;
  normalized: Json;
  meta: PlatformRequestMeta;
  fetchedAt: string;
  cache: { status: "live" | "fresh" | "stale-if-error"; generatedAt: string; expiresAt: string };
}

export interface GenericPlatformReadInput {
  methodId: string;
  pathParams?: Record<string, string | number>;
  body?: JsonRecord;
  appId?: number;
  force?: boolean;
}

interface CacheRow {
  payload: string;
  generated_at: string;
  expires_at: number;
  last_error: string | null;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function safeJson(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(safeJson);
  if (!value || typeof value !== "object") return String(value);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    isSensitivePlatformKey(key) ? "[redacted]" : safeJson(child),
  ]));
}

function serialised(value: unknown): string {
  return JSON.stringify(safeJson(value));
}

function sourceError(source: string, error: unknown): PlatformSourceError {
  if (error instanceof PlatformApiError) {
    return { source, message: redactPlatformText(error.message), statusCode: error.status, requestId: error.requestId, retryable: error.retryable };
  }
  return { source, message: redactPlatformText(error instanceof Error ? error.message : String(error)) };
}

function normalize(value: unknown): Json {
  const root = record(value);
  const rows = Array.isArray(root.result) ? root.result : Array.isArray(root.data) ? root.data : null;
  const first = rows?.[0] && typeof rows[0] === "object" ? record(rows[0]) : {};
  return {
    kind: rows ? "rows" : "object",
    rowCount: rows?.length ?? (Object.keys(root).length ? 1 : 0),
    fields: Object.keys(first).sort(),
    topLevelFields: Object.keys(root).sort(),
  };
}

function idOf(row: JsonRecord): string | null {
  for (const key of ["id", "campaignId", "adGroupId"]) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return null;
}

function dateRange(days: number): { start: string; end: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(1, Math.min(90, days)) + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function queryBody(filters: JsonRecord[] = []): JsonRecord {
  return { filters };
}

function methodId(method: Pick<PlatformApiMethod, "method" | "path">): string {
  return `${method.method} ${method.path}`;
}

function directAppFilterValues(body: JsonRecord | undefined): string[] {
  const filters = body?.filters;
  if (!Array.isArray(filters)) return [];
  return filters.flatMap((candidate) => {
    const filter = record(candidate);
    if (filter.field !== "adamId" && filter.field !== "promotedObjectId") return [];
    const value = filter.value;
    return (Array.isArray(value) ? value : [value]).map(String);
  });
}

/**
 * Read-only façade over Apple Ads Platform API. It intentionally cannot issue
 * PUT/DELETE or a POST that Apple documents as a mutation. Every successful
 * response is retained append-only; a cache points to the latest good result.
 */
export class PlatformReadService {
  private readonly db: Database.Database;
  private readonly client: PlatformApiClient;
  private readonly methods = new Map(PLATFORM_API_METHODS.map((item) => [methodId(item), item]));

  constructor(db: Database.Database, client: PlatformApiClient) {
    this.db = db;
    this.client = client;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS platform_api_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_key TEXT NOT NULL, source TEXT NOT NULL,
        method_id TEXT NOT NULL, app_id INTEGER, raw_payload TEXT NOT NULL,
        normalized_payload TEXT NOT NULL, request_meta TEXT NOT NULL, fetched_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_platform_snapshot_key ON platform_api_snapshots(snapshot_key, id DESC);
      CREATE TABLE IF NOT EXISTS platform_api_cache (
        cache_key TEXT PRIMARY KEY, snapshot_id INTEGER NOT NULL, source TEXT NOT NULL,
        payload TEXT NOT NULL, generated_at TEXT NOT NULL, expires_at INTEGER NOT NULL, last_error TEXT
      );
    `);
  }

  catalog() {
    return PLATFORM_API_METHODS.map((item) => {
      const collector = collectorFor(item.path);
      const read = item.kind === "read" && READ_METHODS.has(item.method);
      return {
        ...item,
        id: methodId(item),
        capability: item.kind === "mutation" ? "approval-gated-mutation" : read ? "read-only-query" : "catalog-only",
        status: item.kind === "mutation" ? "blocked-in-audit-mode" : collector ? "typed-collector" : read ? "generic-read-ready" : "unsupported-http-method",
        collector,
      };
    });
  }

  private key(input: GenericPlatformReadInput, path: string, accountId: string): string {
    // Account context belongs in the durable key. A database may survive a
    // credentials/org switch; never serve one advertiser's snapshot to the
    // next account merely because its app id and query shape happen to match.
    return createHash("sha256").update(serialised({
      accountId,
      methodId: input.methodId,
      path,
      body: input.body ?? null,
      appId: input.appId ?? null,
    })).digest("hex");
  }

  private cached<T>(key: string): { value: PlatformSnapshot<T>; expiresAt: number } | null {
    const row = this.db.prepare(`SELECT payload, generated_at, expires_at, last_error FROM platform_api_cache WHERE cache_key = ?`).get(key) as CacheRow | undefined;
    if (!row) return null;
    try {
      const value = JSON.parse(row.payload) as PlatformSnapshot<T>;
      return { value, expiresAt: Number(row.expires_at) };
    } catch { return null; }
  }

  private save<T>(key: string, source: string, method: PlatformApiMethod, appId: number | undefined, accountId: string, read: PlatformRead<T>): PlatformSnapshot<T> {
    const fetchedAt = read.meta.fetchedAt;
    const expiresAt = Date.now() + DEFAULT_TTL_MS;
    const snapshot: PlatformSnapshot<T> = {
      source,
      methodId: methodId(method),
      accountId,
      data: safeJson(read.data) as T,
      normalized: normalize(read.data),
      meta: read.meta,
      fetchedAt,
      cache: { status: "live", generatedAt: fetchedAt, expiresAt: new Date(expiresAt).toISOString() },
    };
    const insert = this.db.prepare(`
      INSERT INTO platform_api_snapshots
      (snapshot_key, source, method_id, app_id, raw_payload, normalized_payload, request_meta, fetched_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(key, source, snapshot.methodId, appId ?? null, serialised(read.data), serialised(snapshot.normalized), serialised(read.meta), fetchedAt, new Date().toISOString());
    this.db.prepare(`
      INSERT INTO platform_api_cache (cache_key, snapshot_id, source, payload, generated_at, expires_at, last_error)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(cache_key) DO UPDATE SET snapshot_id=excluded.snapshot_id, source=excluded.source,
        payload=excluded.payload, generated_at=excluded.generated_at, expires_at=excluded.expires_at, last_error=NULL
    `).run(key, Number(insert.lastInsertRowid), source, serialised(snapshot), fetchedAt, expiresAt);
    return snapshot;
  }

  private noteFailure(key: string, message: string): void {
    this.db.prepare(`UPDATE platform_api_cache SET last_error = ? WHERE cache_key = ?`).run(message.slice(0, 1_000), key);
  }

  private resolveMethod(input: GenericPlatformReadInput): { method: PlatformApiMethod; path: string } {
    const item = this.methods.get(input.methodId);
    if (!item) throw new Error("Unknown Apple Ads Platform API method");
    if (item.kind !== "read" || !READ_METHODS.has(item.method)) throw new Error("This endpoint is not available in read-only mode");
    const supplied = input.pathParams ?? {};
    let path = item.path.replace(/\{([^}]+)\}/g, (_whole, key: string) => {
      const value = supplied[key];
      if (value === undefined || value === null) throw new Error(`Missing path parameter: ${key}`);
      const text = String(value);
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(text)) throw new Error(`Invalid path parameter: ${key}`);
      return encodeURIComponent(text);
    });
    if (/\{[^}]+\}/.test(path)) throw new Error("Unresolved path parameter");
    return { method: item, path };
  }

  private validateBody(body: JsonRecord | undefined): JsonRecord | undefined {
    if (body === undefined) return undefined;
    const text = serialised(body);
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("Read query body exceeds 64 KB");
    const filters = body.filters;
    if (Array.isArray(filters) && filters.length > MAX_FILTERS) throw new Error("Read query accepts at most 50 filters");
    return JSON.parse(text) as JsonRecord;
  }

  /**
   * The public generic endpoint is deliberately narrower than typed collectors.
   * Typed inventory can safely follow campaign ids obtained from an already
   * app-filtered campaign list; arbitrary browser input cannot prove that
   * relationship, so it must use an explicit adamId/promotedObjectId filter.
   */
  private assertGenericAppScope(input: GenericPlatformReadInput, method: PlatformApiMethod, body: JsonRecord | undefined): void {
    if (!APP_BOUND_PATH.test(method.path)) return;
    if (!input.appId) throw new Error("App-bound generic reads require appId and an explicit app filter");
    const pathAdamId = input.pathParams?.adamId;
    if (pathAdamId !== undefined) {
      if (String(pathAdamId) !== String(input.appId)) throw new Error("Path app id must match appId");
      return;
    }
    const values = directAppFilterValues(body);
    if (!values.length) throw new Error("App-bound generic reads require an adamId or promotedObjectId filter");
    if (values.some((value) => value !== String(input.appId))) throw new Error("App filter must match appId");
  }

  /** Entry point for untrusted request bodies from `/api/platform/read`. */
  async executeGeneric(input: GenericPlatformReadInput): Promise<PlatformSnapshot> {
    const { method } = this.resolveMethod(input);
    const body = this.validateBody(input.body);
    this.assertGenericAppScope(input, method, body);
    return this.execute(input);
  }

  async execute(input: GenericPlatformReadInput): Promise<PlatformSnapshot> {
    const { method, path } = this.resolveMethod(input);
    const body = this.validateBody(input.body);
    if (method.method === "GET" && body !== undefined) throw new Error("GET read endpoints do not accept a JSON body");
    // Resolve before a persistent-cache lookup so a changed org/account can
    // never reuse a previous account's data. PlatformApiClient coalesces this
    // ACL read, including forced concurrent dashboard refreshes.
    const account = await this.client.resolveAdAccount();
    const key = this.key({ ...input, body }, path, account.adAccountId);
    const cached = this.cached(key);
    if (!input.force && cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, cache: { ...cached.value.cache, status: "fresh" } };
    }
    try {
      const safeMethod = method.method as "GET" | "POST";
      let read: PlatformRead<unknown>;
      if (safeMethod === "POST" && path.endsWith("/query")) {
        read = await this.client.queryRows<JsonRecord>(path, body ?? {}, 5000, input.force === true);
      } else {
        read = await this.client.read<unknown>(safeMethod, path, { body, forceRefresh: input.force === true });
      }
      return this.save(key, "generic", method, input.appId, account.adAccountId, read);
    } catch (error) {
      const message = sourceError("generic", error).message;
      this.noteFailure(key, message);
      if (cached) return { ...cached.value, cache: { ...cached.value.cache, status: "stale-if-error" } };
      throw error;
    }
  }

  private async collect<T>(source: string, input: GenericPlatformReadInput): Promise<PlatformSource<T>> {
    try {
      const snapshot = await this.execute(input);
      return { status: "ok", data: snapshot.data as T, meta: snapshot.meta };
    } catch (error) {
      return { status: "error", data: null, meta: null, error: sourceError(source, error) };
    }
  }

  async inventory(appId: number, force = false) {
    if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error("appId must be a positive integer");
    const account = await this.client.resolveAdAccount()
      .then((data) => ({ status: "ok" as const, data: safeJson(data), meta: { fetchedAt: new Date().toISOString(), cached: false } }))
      .catch((error) => ({ status: "error" as const, data: null, meta: null, error: sourceError("account", error) }));
    const appDetails = this.collect("appDetails", { methodId: "GET /apps/{adamId}", pathParams: { adamId: appId }, appId, force });
    const eligibility = this.collect("eligibility", { methodId: "POST /eligibilities/apps/query", body: queryBody([appleFilter("adamId", "EQUALS", appId)]), appId, force });
    // Supported-language inventory is account-independent reference data. The
    // endpoint filters by countryCode, not adamId; an empty query returns the
    // complete Apple Ads market/language catalog.
    const languages = this.collect("supportedLanguages", { methodId: "POST /metadata/apps/supported-languages/query", body: queryBody(), appId, force });
    const localeDetails = this.collect("localeDetails", { methodId: "POST /apps/{adamId}/locale-details/query", pathParams: { adamId: appId }, body: queryBody(), appId, force });
    const campaigns = await this.collect<JsonRecord[]>("campaigns", { methodId: "POST /campaigns/query", body: queryBody([
      appleFilter("promotedObjectId", "EQUALS", [String(appId)]), appleFilter("promotedObjectType", "EQUALS", ["APPSTORE_APP"]),
    ]), appId, force });
    const campaignIds = campaigns.status === "ok" && Array.isArray(campaigns.data)
      ? campaigns.data.map((row) => idOf(record(row))).filter((value): value is string => Boolean(value)).slice(0, 250)
      : [];
    const dependentFilters = campaignIds.length ? [appleFilter("campaignId", "IN", campaignIds)] : [];
    const adGroups = campaignIds.length
      ? await this.collect<JsonRecord[]>("adGroups", { methodId: "POST /adgroups/query", body: queryBody(dependentFilters), appId, force })
      : skipped("adGroups", "No app campaigns returned");
    const adGroupIds = adGroups.status === "ok" && Array.isArray(adGroups.data)
      ? adGroups.data.map((row) => idOf(record(row))).filter((value): value is string => Boolean(value)).map(Number).slice(0, 1_000)
      : [];
    // Keyword queries only allow campaignId EQUALS; adGroupId IN is the
    // documented bulk shape and accepts up to 1,000 values. Negative keyword
    // queries have the same required adGroupId scope for ad-group negatives.
    const adGroupFilters = adGroupIds.length ? [appleFilter("adGroupId", "IN", adGroupIds)] : [];
    const [keywords, negatives, ads, creatives, productPages, assets] = await Promise.all([
      adGroupIds.length ? this.collect("keywords", { methodId: "POST /keywords/query", body: queryBody(adGroupFilters), appId, force }) : skipped("keywords", "No app ad groups returned"),
      adGroupIds.length ? this.collect("negativeKeywords", { methodId: "POST /negative-keywords/query", body: queryBody(adGroupFilters), appId, force }) : skipped("negativeKeywords", "No app ad groups returned"),
      campaignIds.length ? this.collect("ads", { methodId: "POST /ads/query", body: queryBody(dependentFilters), appId, force }) : skipped("ads", "No app campaigns returned"),
      // Neither query supports a direct adamId filter. Do not label account-
      // wide assets/creatives as this app's inventory; ads above remain joined
      // to the app-filtered campaign list.
      skipped("creatives", "Apple creative query is account-scoped; omitted from app-isolated inventory"),
      this.collect("productPages", { methodId: "POST /product-pages/query", body: queryBody([appleFilter("adamId", "EQUALS", [String(appId)])]), appId, force }),
      skipped("assets", "Apple asset query is account-scoped; omitted from app-isolated inventory"),
    ]);
    const [resolvedAppDetails, resolvedEligibility, resolvedLanguages, resolvedLocaleDetails] = await Promise.all([appDetails, eligibility, languages, localeDetails]);
    const sources = { account, appDetails: resolvedAppDetails, eligibility: resolvedEligibility, supportedLanguages: resolvedLanguages, localeDetails: resolvedLocaleDetails, campaigns, adGroups, keywords, negativeKeywords: negatives, ads, creatives, productPages, assets };
    const errors = Object.values(sources).flatMap((item) => item.status === "error" && item.error ? [item.error] : []);
    return {
      mode: "read-only" as const,
      appId,
      generatedAt: new Date().toISOString(),
      sources,
      partialErrors: errors,
      limitations: ["Only this advertiser account is queried.", "Apple Ads Platform API does not expose competitors' bids, spend, keywords, or conversion data.", "Each source keeps its last good cached snapshot when Apple is temporarily unavailable."],
    };
  }

  async reports(appId: number, days = 30, force = false) {
    if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error("appId must be a positive integer");
    const range = dateRange(days);
    // AppsReportingRequest requires campaignId for every report entity. Resolve
    // those ids from an app-scoped campaign query first so a report can never
    // leak rows from another promoted app in the same ad account.
    const campaigns = await this.collect<JsonRecord[]>("reportCampaignScope", {
      methodId: "POST /campaigns/query",
      body: queryBody([
        appleFilter("promotedObjectId", "EQUALS", [String(appId)]),
        appleFilter("promotedObjectType", "EQUALS", ["APPSTORE_APP"]),
      ]),
      appId,
      force,
    });
    const campaignIds = campaigns.status === "ok" && Array.isArray(campaigns.data)
      ? campaigns.data.map((row) => idOf(record(row))).filter((value): value is string => Boolean(value)).slice(0, 1_000)
      : [];
    if (!campaignIds.length) {
      const reason = campaigns.status === "error"
        ? campaigns.error?.message ?? "App campaign scope could not be loaded"
        : "No app campaigns returned";
      const sources = Object.fromEntries(["campaigns", "adGroups", "keywords", "searchTerms", "ads"].map((source) => [source, skipped(source, reason)]));
      return { mode: "read-only" as const, appId, window: range, generatedAt: new Date().toISOString(), sources };
    }
    const routes = [
      ["campaigns", "POST /reports/apps/campaigns/query"], ["adGroups", "POST /reports/apps/adgroups/query"],
      ["keywords", "POST /reports/apps/keywords/query"], ["searchTerms", "POST /reports/apps/searchterms/query"], ["ads", "POST /reports/apps/ads/query"],
    ] as const;
    const collected = new Map<string, { rows: JsonRecord[]; meta: PlatformSource["meta"]; failures: PlatformSourceError[]; successes: number }>();
    for (const [source] of routes) collected.set(source, { rows: [], meta: null, failures: [], successes: 0 });

    // Apple documents campaignId as a single-campaign EQUALS scope. Fan out
    // over the already app-scoped ids; PlatformApiClient keeps transport
    // concurrency bounded and each campaign/entity response cached separately.
    await Promise.all(campaignIds.flatMap((campaignId) => routes.map(async ([source, id]) => {
      const body = {
        filters: [appleFilter("campaignId", "EQUALS", campaignId)],
        groupBy: ["countryOrRegion"],
        timeRange: { ...range, timeZone: "ORTZ", granularity: "DAILY" },
      };
      const item = await this.collect<JsonRecord[]>(`${source}:${campaignId}`, { methodId: id, body, appId, force });
      const bucket = collected.get(source)!;
      if (item.status === "ok") {
        bucket.successes += 1;
        bucket.meta = item.meta;
        if (Array.isArray(item.data)) bucket.rows.push(...item.data);
      } else if (item.error) {
        bucket.failures.push({ ...item.error, source });
      }
    })));

    const sources = Object.fromEntries(routes.map(([source]) => {
      const bucket = collected.get(source)!;
      const value: PlatformSource<JsonRecord[]> = bucket.successes > 0
        ? { status: "ok", data: bucket.rows, meta: bucket.meta }
        : { status: "error", data: null, meta: null, error: bucket.failures[0] ?? { source, message: "No report request succeeded" } };
      return [source, value];
    }));
    return {
      mode: "read-only" as const,
      appId,
      window: range,
      generatedAt: new Date().toISOString(),
      sources,
      partialErrors: [...collected.values()].flatMap((bucket) => bucket.failures),
    };
  }

  async suggestions(appId: number, country: string, force = false) {
    if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error("appId must be a positive integer");
    const territory = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(territory)) throw new Error("country must be ISO alpha-2");
    const promotedObjectFilters = [
      appleFilter("promotedObjectId", "EQUALS", [String(appId)]),
      appleFilter("promotedObjectType", "EQUALS", ["APPSTORE_APP"]),
    ];
    // These routes intentionally use different territory fields. Keyword
    // suggestions accept `countriesOrRegions`, target-CPA suggestions accept
    // `countryOrRegion`, and phrase/category discovery requires queryType.
    const keywordFilters = [...promotedObjectFilters, appleFilter("countriesOrRegions", "IN", [territory])];
    const phraseCategoryFilters = [...promotedObjectFilters, appleFilter("queryType", "EQUALS", ["SUGGESTION"])];
    const targetCpaFilters = [...promotedObjectFilters, appleFilter("countryOrRegion", "IN", [territory])];
    const recommendationFilters = [...promotedObjectFilters, appleFilter("state", "EQUALS", ["AVAILABLE"])];
    const [keywords, phrases, categories, targetCpa, dailyBudget, targetCpaRecommendations] = await Promise.all([
      this.collect("keywordSuggestions", { methodId: "POST /suggestions/keywords/query", body: queryBody(keywordFilters), appId, force }),
      this.collect("phraseSuggestions", { methodId: "POST /suggestions/phrases/query", body: queryBody(phraseCategoryFilters), appId, force }),
      this.collect("categorySuggestions", { methodId: "POST /suggestions/categories/query", body: queryBody(phraseCategoryFilters), appId, force }),
      this.collect("targetCpaSuggestion", { methodId: "POST /suggestions/target-cpas/query", body: queryBody(targetCpaFilters), appId, force }),
      this.collect("dailyBudgetRecommendations", { methodId: "POST /recommendations/daily-budgets/query", body: queryBody(recommendationFilters), appId, force }),
      this.collect("targetCpaRecommendations", { methodId: "POST /recommendations/target-cpas/query", body: queryBody(recommendationFilters), appId, force }),
    ]);
    const sources = { keywords, phrases, categories, targetCpa, dailyBudget, targetCpaRecommendations };
    return { mode: "read-only" as const, appId, country: territory, generatedAt: new Date().toISOString(), sources, partialErrors: Object.values(sources).flatMap((item) => item.status === "error" && item.error ? [item.error] : []) };
  }
}

function skipped(source: string, message: string): PlatformSource {
  return { status: "skipped", data: null, meta: null, error: { source, message } };
}

function collectorFor(path: string): string | null {
  if (path === "/apps/{adamId}" || path.includes("eligibilities/apps") || path.includes("locale-details") || path.includes("supported-languages")) return "inventory";
  if (["/campaigns/query", "/adgroups/query", "/keywords/query", "/negative-keywords/query", "/ads/query", "/creatives/query", "/product-pages/query", "/assets/query"].includes(path)) return "inventory";
  if (path.startsWith("/reports/apps/")) return "reports";
  if (path.includes("/suggestions/") || path.includes("/recommendations/")) return "suggestions";
  if (path.includes("/insights/apps/")) return "traffic-intelligence";
  return null;
}
