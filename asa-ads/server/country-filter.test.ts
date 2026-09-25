import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AsaClient } from "./asa-client.ts";
import { recommend, suggestSearchTermActions } from "./bid-engine.ts";
import { getDb, openDb } from "./db.ts";
import { buildDecisionMatrix } from "./decision-matrix.ts";
import {
  dailyTotals, geoBreakdown, keywordDaily, listAppCountries, listCampaignsWithMetrics,
  listKeywordsWithMetrics, listSearchTerms, normalizeCountry,
} from "./queries.ts";
import { geoSplitCampaignIds, syncKeywordGeoDaily, syncSearchTermGeoDaily } from "./sync.ts";

const APP = 500;
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((acc, row) => acc + pick(row), 0);

// Fixture: WW campaign 1 (BR, US, DE) split by storefront; dedicated US
// campaign 2; DE-only campaign 3 on another app must never leak in.
function seed(): void {
  openDb(mkdtempSync(join(tmpdir(), "asa-country-")));
  const db = getDb();
  const camp = db.prepare(`INSERT INTO asa_campaigns
    (id, org_id, app_id, app_name, name, country, countries_json, status, updated_at, synced_at)
    VALUES (?, 1, ?, 'X', ?, ?, ?, 'ENABLED', 'x', 'x')`);
  camp.run(1, APP, "WW", "BR", JSON.stringify(["BR", "US", "DE"]));
  camp.run(2, APP, "US only", "US", JSON.stringify(["US"]));
  camp.run(3, 999, "Other app DE", "DE", JSON.stringify(["DE"]));
  const adg = db.prepare(`INSERT INTO asa_ad_groups (id, campaign_id, name, status, synced_at) VALUES (?, ?, 'g', 'ENABLED', 'x')`);
  adg.run(10, 1); adg.run(20, 2); adg.run(30, 3);
  const kw = db.prepare(`INSERT INTO asa_keywords (id, ad_group_id, campaign_id, text, match_type, bid, status, synced_at)
    VALUES (?, ?, ?, ?, 'EXACT', ?, 'ACTIVE', 'x')`);
  kw.run(100, 10, 1, "dicom viewer", 1.0);
  kw.run(200, 20, 2, "mri viewer", 2.0);
  kw.run(300, 30, 3, "other", 1.0);

  const daily = db.prepare(`INSERT INTO asa_daily (campaign_id, date, impressions, taps, installs, spend) VALUES (?, ?, ?, ?, ?, ?)`);
  daily.run(1, today, 600, 60, 30, 30);
  daily.run(1, yesterday, 300, 30, 15, 15);
  daily.run(2, today, 100, 10, 4, 8);
  daily.run(3, today, 50, 5, 1, 3);
  const geo = db.prepare(`INSERT INTO asa_geo_daily (campaign_id, date, country, impressions, taps, installs, spend) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  geo.run(1, today, "BR", 400, 40, 20, 12);
  geo.run(1, today, "US", 150, 15, 8, 15);
  geo.run(1, today, "DE", 50, 5, 2, 3);
  geo.run(1, yesterday, "BR", 300, 30, 15, 15);
  geo.run(2, today, "US", 100, 10, 4, 8);
  geo.run(3, today, "DE", 50, 5, 1, 3);

  const kwDaily = db.prepare(`INSERT INTO asa_kw_daily (keyword_id, date, impressions, taps, installs, spend) VALUES (?, ?, ?, ?, ?, ?)`);
  kwDaily.run(100, today, 600, 60, 30, 30);
  kwDaily.run(200, today, 100, 10, 4, 8);
  const kwGeo = db.prepare(`INSERT INTO asa_kw_geo_daily (keyword_id, campaign_id, date, country, impressions, taps, installs, spend) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  kwGeo.run(100, 1, today, "BR", 400, 40, 20, 12);
  kwGeo.run(100, 1, today, "US", 150, 15, 8, 15);
  kwGeo.run(100, 1, today, "DE", 50, 5, 2, 3);
  kwGeo.run(200, 2, today, "US", 100, 10, 4, 8);

  const st = db.prepare(`INSERT INTO asa_search_terms (campaign_id, date, term, source_keyword_id, impressions, taps, installs, spend) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  st.run(1, today, "dicom", 100, 500, 50, 0, 20);
  const stGeo = db.prepare(`INSERT INTO asa_st_geo_daily (campaign_id, date, country, term, source_keyword_id, impressions, taps, installs, spend) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  stGeo.run(1, today, "BR", "dicom", 100, 400, 45, 0, 15);
  stGeo.run(1, today, "US", "dicom", 100, 100, 5, 0, 5);

  const ev = db.prepare(`INSERT INTO asc_events_daily (app_id, date, country, product, event_type, events) VALUES (?, ?, ?, 'p', 'Start Introductory Offer', ?)`);
  ev.run(APP, today, "BR", 7);
  ev.run(APP, today, "US", 3);
  ev.run(999, today, "BR", 100);
}

test("normalizeCountry treats ALL/empty/junk as world", () => {
  assert.equal(normalizeCountry("br"), "BR");
  assert.equal(normalizeCountry("ALL"), undefined);
  assert.equal(normalizeCountry(""), undefined);
  assert.equal(normalizeCountry(undefined), undefined);
  assert.equal(normalizeCountry("USA"), undefined);
});

test("campaign list in a storefront: serving campaigns only, that storefront's metrics", () => {
  seed();
  const world = listCampaignsWithMetrics(7, APP);
  assert.equal(sum(world, (c) => c.spend), 53);

  const br = listCampaignsWithMetrics(7, APP, "BR");
  assert.deepEqual(br.map((c) => c.id), [1]); // US-only campaign does not serve BR
  assert.equal(br[0].spend, 27);
  assert.equal(br[0].installs, 35);
  assert.equal(br[0].trial_starts, 7); // this app's BR trials, not the other app's

  const us = listCampaignsWithMetrics(7, APP, "US");
  assert.deepEqual(us.map((c) => c.id).sort(), [1, 2]);
  assert.equal(sum(us, (c) => c.spend), 23);

  // World total == sum over storefronts.
  const perCountry = listAppCountries(APP).map((row) => sum(listCampaignsWithMetrics(7, APP, row.code), (c) => c.spend));
  assert.equal(sum(perCountry, (v) => v), 53);
});

test("daily totals and geo breakdown follow the storefront", () => {
  const worldDaily = dailyTotals(7, undefined, APP);
  const brDaily = dailyTotals(7, undefined, APP, "BR");
  assert.equal(sum(brDaily, (d) => d.spend), 27);
  assert.equal(brDaily.find((d) => d.date === today)?.trial_starts, 7);
  const countries = listAppCountries(APP).map((row) => row.code);
  const splitSpend = sum(countries, (code) => sum(dailyTotals(7, undefined, APP, code), (d) => d.spend));
  assert.equal(splitSpend, sum(worldDaily, (d) => d.spend));
  // Campaign + storefront.
  assert.equal(sum(dailyTotals(7, 1, undefined, "US"), (d) => d.spend), 15);

  assert.deepEqual(geoBreakdown(7, APP, "BR").map((row) => row.country), ["BR"]);
  assert.equal(geoBreakdown(7, APP, "BR")[0].spend, 27);
});

test("country options are the app's storefronts by spend", () => {
  assert.deepEqual(listAppCountries(APP).map((row) => row.code), ["BR", "US", "DE"]);
  assert.deepEqual(listAppCountries(999).map((row) => row.code), ["DE"]);
});

test("keyword rows per storefront sum to the keyword's world row", () => {
  const world = listKeywordsWithMetrics(7, undefined, APP);
  const dicomWorld = world.find((k) => k.id === 100)!;
  const perCountry = ["BR", "US", "DE"].map((code) => listKeywordsWithMetrics(7, undefined, APP, code).find((k) => k.id === 100)!);
  assert.equal(sum(perCountry, (k) => k.spend), dicomWorld.spend);
  assert.equal(sum(perCountry, (k) => k.installs), dicomWorld.installs);
  // The US-only campaign's keyword is not listed for BR.
  assert.deepEqual(listKeywordsWithMetrics(7, undefined, APP, "BR").map((k) => k.id), [100]);
  assert.equal(sum(keywordDaily(100, 7, "US"), (d) => Number(d.spend)), 15);
  assert.equal(sum(keywordDaily(100, 7), (d) => Number(d.spend)), 30);
});

test("bid recommendations: storefront narrows the list, metrics stay global", () => {
  const worldRecs = recommend(7, undefined, APP);
  const brRecs = recommend(7, undefined, APP, "BR");
  assert.deepEqual(brRecs.map((r) => r.keyword_id), worldRecs.filter((r) => r.keyword_id === 100).map((r) => r.keyword_id));
  const w = worldRecs.find((r) => r.keyword_id === 100);
  const b = brRecs.find((r) => r.keyword_id === 100);
  assert.equal(b?.recommended_bid, w?.recommended_bid); // same global bid, not a BR-only one
});

test("search terms read the term × storefront report in country mode", () => {
  assert.equal(listSearchTerms(7, APP)[0].spend, 20);
  const br = listSearchTerms(7, APP, "BR");
  assert.equal(br.length, 1);
  assert.equal(br[0].spend, 15);
  assert.equal(br[0].source_keyword_id, 100);
  assert.equal(listSearchTerms(7, APP, "DE").length, 0);
  // Negative suggestion thresholds apply to the storefront's own numbers.
  assert.equal(suggestSearchTermActions(7, APP, 30, 5, "BR")[0]?.suggestion, "negative");
  assert.equal(suggestSearchTermActions(7, APP, 30, 10, "US").length, 0); // 5 US taps < 10
  assert.equal(suggestSearchTermActions(7, APP, 30, 10).length, 1); // 50 world taps
});

test("decision matrix in a storefront uses the keyword × country split for multi-country campaigns", () => {
  const br = buildDecisionMatrix(getDb(), { appId: APP, country: "BR", days: 7 }) as { keywords: Array<{ keyword: string; spend: number; installs: number }> };
  const dicom = br.keywords.find((row) => row.keyword === "dicom viewer");
  assert.equal(dicom?.spend, 12);
  assert.equal(dicom?.installs, 20);
});

test("storefront split also covers campaigns paused since they delivered", () => {
  getDb().prepare(`UPDATE asa_campaigns SET status = 'PAUSED' WHERE id = 2`).run();
  assert.deepEqual(geoSplitCampaignIds(today, today, [1]).sort(), [1, 2, 3]);
  assert.deepEqual(geoSplitCampaignIds("2000-01-01", "2000-01-02", [1]), [1]);
  getDb().prepare(`UPDATE asa_campaigns SET status = 'ENABLED' WHERE id = 2`).run();
});

test("keyword geo sync clears a campaign's window only after its report arrived", async () => {
  const db = getDb();
  const report = (country: string, spend: string) => ({
    metadata: { keywordId: 100, campaignId: 1, countryOrRegion: country },
    granularity: [
      { date: today, impressions: 10, taps: 2, totalInstalls: 1, localSpend: { amount: spend } },
      // Apple returns empty days too; they are not stored.
      { date: yesterday, impressions: 0, taps: 0, totalInstalls: 0, localSpend: { amount: "0" } },
    ],
  });
  const asa = {
    keywordGeoReport: async (cid: number) => {
      if (cid === 2) throw new Error("429");
      return [report("BR", "1.5"), report("", "9")];
    },
  } as unknown as Pick<AsaClient, "keywordGeoReport">;
  const r = await syncKeywordGeoDaily(asa, yesterday, today, [1, 2]);
  assert.deepEqual({ campaigns: r.campaigns, failed: r.failed, rows: r.rows }, { campaigns: 1, failed: 1, rows: 1 });
  const rows = db.prepare(`SELECT campaign_id, country, spend FROM asa_kw_geo_daily WHERE date >= ? ORDER BY campaign_id, country`).all(yesterday);
  // Campaign 1 replaced by the fresh report (US/DE rows went to zero → gone);
  // campaign 2 failed and keeps its previous row.
  assert.deepEqual(rows, [{ campaign_id: 1, country: "BR", spend: 1.5 }, { campaign_id: 2, country: "US", spend: 8 }]);

  const st = {
    searchTermGeoReport: async () => [
      { metadata: { campaignId: 1, countryOrRegion: "BR", searchTermText: "dicom", keywordId: 100 }, granularity: [{ date: today, impressions: 5, taps: 1, totalInstalls: 0, localSpend: { amount: "1" } }] },
      { metadata: { campaignId: 1, countryOrRegion: "BR", searchTermText: "dicom", keywordId: 100 }, granularity: [{ date: today, impressions: 5, taps: 1, totalInstalls: 0, localSpend: { amount: "2" } }] },
      { metadata: { campaignId: 1, countryOrRegion: "US", searchTermText: null, keywordId: null }, granularity: [{ date: today, impressions: 3, taps: 0, totalInstalls: 0, localSpend: { amount: "0.5" } }] },
    ],
  } as unknown as Pick<AsaClient, "searchTermGeoReport">;
  await syncSearchTermGeoDaily(st, today, today, [1]);
  const stRows = db.prepare(`SELECT country, term, source_keyword_id AS kw, impressions, spend FROM asa_st_geo_daily WHERE campaign_id = 1 ORDER BY country`).all();
  assert.deepEqual(stRows, [
    { country: "BR", term: "dicom", kw: 100, impressions: 10, spend: 3 }, // duplicate rows accumulate
    { country: "US", term: "", kw: 0, impressions: 3, spend: 0.5 },
  ]);
});
