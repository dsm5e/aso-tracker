import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";
import { PLATFORM_API_METHODS } from "./platform-api-methods.ts";
import { PlatformApiError, type PlatformApiClient, type PlatformRequestMeta } from "./platform-api-client.ts";
import { modelTermTraffic, parseTrafficQuery, TrafficIntelligenceService, type LocalKeywordRow } from "./traffic-intelligence.ts";

const meta: PlatformRequestMeta = {
  request: { method: "POST", path: "/mock", correlationId: "test" },
  response: { status: 200, topLevelFields: ["result"] },
  attempts: 1,
  durationMs: 1,
  fetchedAt: "2026-09-04T00:00:00.000Z",
  cached: false,
};

test("official method registry contains 99 unique endpoints and seven live integrations", () => {
  assert.equal(PLATFORM_API_METHODS.length, 99);
  assert.equal(new Set(PLATFORM_API_METHODS.map((item) => `${item.method} ${item.path}`)).size, 99);
  assert.equal(PLATFORM_API_METHODS.filter((item) => item.integration === "traffic-intelligence").length, 7);
});

test("normalizes arbitrary input dates to completed Apple weeks", () => {
  const parsed = parseTrafficQuery({
    appId: "medscan",
    itunesId: "6762091560",
    locale: "en-BR",
    terms: " DICOM, dicom , Raio   X ",
    start: "2026-08-04",
    end: "2026-09-03",
  }, new Date("2026-09-04T00:00:00.000Z"));
  assert.equal(parsed.start, "2026-08-02");
  assert.equal(parsed.end, "2026-08-29");
  assert.deepEqual(parsed.terms, ["dicom", "raio x"]);
});

test("prefers the numeric App Store id used by the ASO frontend", () => {
  const parsed = parseTrafficQuery({
    appId: "medscan",
    itunesId: "6762091560",
    locale: "us",
  }, new Date("2026-09-04T00:00:00.000Z"));
  assert.equal(parsed.appId, 6762091560);
  assert.equal(parsed.country, "US");
});

test("models captured and remaining demand with bounded eligible inventory", () => {
  const keyword: LocalKeywordRow = {
    keywordId: 1,
    campaignId: 2,
    campaignName: "BR Exact",
    adGroupId: 3,
    text: "dicom",
    matchType: "EXACT",
    bid: 0.2,
    status: "ACTIVE",
    impressions: 20,
    taps: 4,
    installs: 1,
    spend: 0.8,
  };
  const result = modelTermTraffic({
    term: "dicom",
    origins: ["owned-keyword", "impression-share"],
    impressionShareRows: [{ week: "2026-08-23", lowImpressionShare: 0.2, highImpressionShare: 0.2, rank: 3, searchPopularity1to5: 4 }],
    popularityRows: [{ week: "2026-08-23", searchPopularity1to100: 80 }],
    keywords: [keyword],
  });
  assert.equal(result.demandIndex, 80);
  assert.equal(result.capturedIndex, 16);
  assert.equal(result.availableIndex, 64);
  assert.equal(result.competitorsAhead, 2);
  assert.deepEqual(result.eligibleInventory, {
    lower: 100,
    upper: 100,
    remainingLower: 80,
    remainingUpper: 80,
    modeled: true,
    explanation: "Bounded as exact-match impressions / Apple's high-to-low share range; broad/Search Match overlap and privacy suppression can make this directional.",
  });
  assert.equal(result.difficulty.value, 69);
  assert.equal(result.opportunity.value, 64);
});

test("composite response keeps successful sources when one Apple endpoint fails", async () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE asa_campaigns (id INTEGER PRIMARY KEY, app_id INTEGER, country TEXT, countries_json TEXT, name TEXT, status TEXT);
    CREATE TABLE asa_ad_groups (id INTEGER PRIMARY KEY, campaign_id INTEGER, status TEXT);
    CREATE TABLE asa_keywords (id INTEGER PRIMARY KEY, campaign_id INTEGER, ad_group_id INTEGER, text TEXT, match_type TEXT, bid REAL, status TEXT, deleted INTEGER);
    CREATE TABLE asa_kw_daily (keyword_id INTEGER, date TEXT, impressions INTEGER, taps INTEGER, installs INTEGER, spend REAL);
    CREATE TABLE asa_search_terms (campaign_id INTEGER, date TEXT, term TEXT, impressions INTEGER, taps INTEGER, installs INTEGER, spend REAL);
    INSERT INTO asa_campaigns VALUES (10, 6762091560, 'US', '["US"]', 'US Exact', 'ENABLED');
    INSERT INTO asa_campaigns VALUES (11, 6762091560, 'US', '["US"]', 'Deleted legacy', 'DELETED');
    INSERT INTO asa_campaigns VALUES (12, 6762091560, 'US', '["US","CA"]', 'US first but multi-country', 'ENABLED');
    INSERT INTO asa_ad_groups VALUES (30, 10, 'ENABLED');
    INSERT INTO asa_ad_groups VALUES (31, 11, 'ENABLED');
    INSERT INTO asa_ad_groups VALUES (32, 12, 'ENABLED');
    INSERT INTO asa_keywords VALUES (20, 10, 30, 'dicom', 'EXACT', 0.40, 'ACTIVE', 0);
    INSERT INTO asa_keywords VALUES (21, 11, 31, 'legacy dead key', 'EXACT', 0.40, 'ACTIVE', 0);
    INSERT INTO asa_keywords VALUES (22, 12, 32, 'bundle contaminated key', 'EXACT', 0.40, 'ACTIVE', 0);
    INSERT INTO asa_kw_daily VALUES (20, '2026-08-23', 20, 4, 1, 0.80);
    INSERT INTO asa_kw_daily VALUES (22, '2026-08-23', 900, 90, 45, 30.00);
    INSERT INTO asa_search_terms VALUES (12, '2026-08-23', 'bundle contaminated term', 500, 50, 25, 20.00);
  `);
  const fake = {
    resolveAdAccount: async () => ({ adAccountId: "7", raw: {} }),
    queryRows: async (path: string, body: { filters?: Array<{ field: string; operator: string; value: unknown }> }) => {
      if (path === "/recommendations/daily-budgets/query") throw new PlatformApiError("temporary failure", 503, "request-1", true);
      if (path === "/insights/apps/impression-share/query") {
        assert.deepEqual(body.filters?.find((filter) => filter.field === "promotedObjectId"), { field: "promotedObjectId", operator: "IN", value: ["6762091560"] });
        return { data: [{ week: "2026-08-23", searchTerm: "dicom", lowImpressionShare: 0.2, highImpressionShare: 0.2, rank: 2, searchPopularity1to5: 4 }], meta };
      }
      if (path === "/insights/apps/search-term-popularity/query") return { data: [
        { week: "2026-08-23", searchTerm: "dicom", searchPopularity1to100: 80 },
        { week: "2026-08-23", searchTerm: "unrelated workout", searchPopularity1to100: 99 },
      ], meta };
      if (path === "/suggestions/keywords/query") return { data: [{ text: "dicom viewer", popularity: 70 }], meta };
      return { data: [], meta };
    },
    queryObject: async () => ({ data: null, meta }),
  } as unknown as PlatformApiClient;
  const service = new TrafficIntelligenceService(db, fake);
  const input = { appId: 6762091560, country: "US", terms: ["dicom"], start: "2026-08-02", end: "2026-08-29" };
  const result = await service.get(input);
  const sources = result.sources as Record<string, { status: string; error?: { statusCode?: number } }>;
  const terms = result.terms as Array<{ term: string }>;
  const discovery = result.discovery as Array<{ keyword: string }>;
  const unverifiedSuggestions = result.unverifiedSuggestions as Array<{ keyword: string }>;
  const ownedKeywords = result.keywords as Array<{ keyword: string }>;

  assert.equal(sources.impressionShare.status, "ok");
  assert.equal(sources.dailyBudgetRecommendations.status, "error");
  assert.equal(sources.dailyBudgetRecommendations.error?.statusCode, 503);
  assert.ok(terms.some((term) => term.term === "dicom"));
  assert.ok(terms.some((term) => term.term === "dicom viewer"));
  assert.ok(!terms.some((term) => term.term === "unrelated workout"));
  assert.ok(!discovery.some((term) => term.keyword === "dicom viewer"));
  assert.ok(unverifiedSuggestions.some((term) => term.keyword === "dicom viewer"));
  assert.ok(!ownedKeywords.some((term) => term.keyword === "legacy dead key"));
  assert.ok(!terms.some((term) => term.term === "bundle contaminated key"));
  assert.ok(!terms.some((term) => term.term === "bundle contaminated term"));

  let restartedCalls = 0;
  const rateLimited = {
    resolveAdAccount: async () => ({ adAccountId: "7", raw: {} }),
    queryRows: async () => {
      restartedCalls += 1;
      throw new PlatformApiError("rate limited", 503, "request-restart", true);
    },
    queryObject: async () => {
      restartedCalls += 1;
      throw new PlatformApiError("rate limited", 503, "request-restart", true);
    },
  } as unknown as PlatformApiClient;

  // A new service instance simulates a backend restart. The durable SQLite
  // snapshot must be returned without making any Apple request.
  const restartedService = new TrafficIntelligenceService(db, rateLimited);
  const cached = await restartedService.get(input);
  assert.equal(cached.servedFromCache, true);
  assert.equal((cached.cache as { status: string }).status, "fresh");
  assert.equal(restartedCalls, 0);

  // An explicit refresh may contact Apple; if Apple responds with a transient
  // failure, the last good snapshot remains visible and is marked stale.
  const fallback = await restartedService.get({ ...input, forceRefresh: true });
  assert.ok(restartedCalls > 0);
  assert.equal(fallback.servedFromCache, true);
  assert.equal(fallback.stale, true);
  assert.equal((fallback.cache as { status: string }).status, "stale-if-error");
  assert.ok((fallback.keywords as Array<{ keyword: string }>).some((term) => term.keyword === "dicom"));

  const callsAfterFailure = restartedCalls;
  const cooldown = await restartedService.get(input);
  assert.equal(cooldown.stale, true);
  assert.equal((cooldown.cache as { status: string }).status, "stale-if-error");
  assert.equal(restartedCalls, callsAfterFailure);
  db.close();
});
