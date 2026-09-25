import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PlatformApiError, type PlatformApiClient, type PlatformRequestMeta } from "./platform-api-client.ts";
import { KeywordPopularityService, popularityLabel, toPopularity5to100 } from "./keyword-popularity.ts";
import { modelTermTraffic } from "./traffic-intelligence.ts";

const meta: PlatformRequestMeta = {
  request: { method: "POST", path: "/mock", correlationId: "test" },
  response: { status: 200, topLevelFields: ["result"] },
  attempts: 1,
  durationMs: 1,
  fetchedAt: "2026-09-25T00:00:00.000Z",
  cached: false,
};

// Mirrors Apple's observed behaviour: a single-term query echoes the term with
// its own popularity (floor 5) plus unrelated siblings.
const APPLE: Record<string, number> = { dicom: 7, "dicom viewer": 8, weather: 68 };
function fakeClient() {
  const calls: string[][] = [];
  return {
    calls,
    client: {
      queryRows: async (_path: string, body: { filters: Array<{ field: string; value: unknown }> }) => {
        const terms = body.filters.find((filter) => filter.field === "terms")?.value as string[];
        calls.push(terms);
        const own = terms.map((term) => ({ text: term, popularity: APPLE[term] ?? 5 }));
        return { data: [{ text: "identity v", popularity: 38 }, ...own], meta };
      },
    } as unknown as Pick<PlatformApiClient, "queryRows">,
  };
}

test("popularity stays on one 5–100 scale; 5 is «≤5», not zero", () => {
  assert.equal(toPopularity5to100(7), 7);
  assert.equal(toPopularity5to100(0), 5);
  assert.equal(toPopularity5to100(140), 100);
  assert.equal(toPopularity5to100(null), null);
  assert.equal(popularityLabel(5), "≤5");
  assert.equal(popularityLabel(42), "42");
});

test("a term reads the same popularity regardless of the batch it came with", async () => {
  const db = new Database(":memory:");
  const { client, calls } = fakeClient();
  const service = new KeywordPopularityService(db, client, { now: () => new Date("2026-09-25T10:00:00Z") });
  const first = await service.lookup(6762091560, "us", ["DICOM", "ct scan"], 1000);
  const second = await service.lookup(6762091560, "US", ["dicom", "dicom viewer", "weather"], 1000);
  const dicom1 = first.items.find((item) => item.term === "dicom");
  const dicom2 = second.items.find((item) => item.term === "dicom");
  assert.equal(dicom1?.popularity, 7);
  assert.equal(dicom2?.popularity, 7);
  assert.equal(dicom1?.status, "ok");
  assert.equal(first.items.find((item) => item.term === "ct scan")?.label, "≤5");
  assert.equal(second.items.find((item) => item.term === "weather")?.popularity, 68);
  assert.equal(first.source, "apple-ads-keyword-recommendations");
  assert.equal(first.day, "2026-09-25");
  // One Apple call per term, each cached for the day.
  assert.ok(calls.every((terms) => terms.length === 1));
  const before = calls.length;
  await service.lookup(6762091560, "US", ["dicom", "weather"], 1000);
  assert.equal(calls.length, before);
  db.close();
});

test("yesterday's value is served as stale while today's refetch runs", async () => {
  const db = new Database(":memory:");
  const { client } = fakeClient();
  let now = new Date("2026-09-24T10:00:00Z");
  const service = new KeywordPopularityService(db, client, { now: () => now });
  await service.lookup(6762091560, "US", ["dicom"], 1000);
  now = new Date("2026-09-25T10:00:00Z");
  const stale = await service.lookup(6762091560, "US", ["dicom"], 0);
  assert.equal(stale.items[0].status, "stale");
  assert.equal(stale.items[0].popularity, 7);
  assert.equal(stale.items[0].day, "2026-09-24");
  const fresh = await service.lookup(6762091560, "US", ["dicom"], 1000);
  assert.equal(fresh.items[0].status, "ok");
  assert.equal(fresh.items[0].day, "2026-09-25");
  db.close();
});

test("traffic model never mixes the 1–5 impression-share bucket into popularity", () => {
  const base = { term: "dicom", origins: ["owned-keyword"], popularityRows: [], keywords: [] };
  const shareOnly = modelTermTraffic({
    ...base,
    impressionShareRows: [{ week: "2026-09-13", lowImpressionShare: 0.5, highImpressionShare: 0.5, rank: 1, searchPopularity1to5: 2 }],
  });
  assert.equal(shareOnly.demandIndex, null);
  assert.equal(shareOnly.popularityBucket1to5, 2);
  const withStored = modelTermTraffic({
    ...base,
    impressionShareRows: [{ week: "2026-09-13", lowImpressionShare: 0.5, highImpressionShare: 0.5, rank: 1, searchPopularity1to5: 2 }],
    storedPopularity: 7,
  });
  assert.equal(withStored.demandIndex, 7);
  assert.equal(withStored.demandScale, "apple_5_to_100");
});

// Recorded 2026-09-25 from the live Apple Ads Platform API (text/popularity only).
interface FixtureRow { text: string; popularity: number }
interface Fixtures {
  singles: Record<string, { countries: string[]; totalCount: number; rows: FixtureRow[] }>;
  batches: Array<{ label: string; terms: string[]; identicalToSingleOf: string; echoed: FixtureRow[] }>;
  storefronts: { terms: Record<string, { appId: number; responses: Record<string, { rowCount: number; own: number | null; rows: FixtureRow[] }> }> };
}
const FIXTURES = JSON.parse(readFileSync(new URL("./keyword-popularity.fixtures.json", import.meta.url), "utf8")) as Fixtures;

// Replays Apple's observed behaviour: any query answers for terms[0] only.
function replayClient(options: { failFirst?: number } = {}) {
  const calls: string[][] = [];
  let fail = options.failFirst ?? 0;
  return {
    calls,
    client: {
      queryRows: async (_path: string, body: { filters: Array<{ field: string; value: unknown }> }) => {
        const terms = body.filters.find((filter) => filter.field === "terms")?.value as string[];
        calls.push(terms);
        if (fail > 0) {
          fail -= 1;
          throw new PlatformApiError("Apple Ads POST /suggestions/keywords/query failed (429)", 429, undefined, true);
        }
        return { data: FIXTURES.singles[terms[0]]?.rows ?? [{ text: terms[0], popularity: 5 }], meta };
      },
    } as unknown as Pick<PlatformApiClient, "queryRows">,
  };
}

test("recorded batches: Apple answers terms[0] only and sibling values are not the term's own", () => {
  for (const batch of FIXTURES.batches) {
    assert.equal(batch.identicalToSingleOf, batch.terms[0], batch.label);
    for (const echoed of batch.echoed) {
      const own = FIXTURES.singles[echoed.text]?.rows.find((row) => row.text === echoed.text);
      if (echoed.text === batch.terms[0]) assert.equal(echoed.popularity, own?.popularity, batch.label);
    }
  }
  // The counter-examples that rule out an «echoed exact-match» batching rule.
  const tracker = FIXTURES.singles["pregnancy tracker"].rows;
  const app = FIXTURES.singles["pregnancy app"].rows;
  assert.equal(tracker.find((row) => row.text === "pregnancy app")?.popularity, 9);
  assert.equal(app.find((row) => row.text === "pregnancy app")?.popularity, 53);
  assert.equal(FIXTURES.singles.dicom.rows.find((row) => row.text === "horos")?.popularity, 16);
  assert.equal(FIXTURES.singles.horos.rows.find((row) => row.text === "horos")?.popularity, 7);
});

test("service stores each term's own single-call value, never a sibling's", async () => {
  const db = new Database(":memory:");
  const { client, calls } = replayClient();
  const service = new KeywordPopularityService(db, client, { now: () => new Date("2026-09-25T10:00:00Z") });
  const res = await service.lookup(6771391236, "US", ["pregnancy tracker", "pregnancy app", "baby tracker"], 1000);
  const value = (term: string) => res.items.find((item) => item.term === term)?.popularity;
  assert.equal(value("pregnancy tracker"), 9);
  assert.equal(value("pregnancy app"), 53);
  assert.equal(value("baby tracker"), 53);
  assert.ok(calls.every((terms) => terms.length === 1));
  assert.equal(calls.length, 3);
  db.close();
});

test("in-flight lookups for the same term share one Apple call; status reports hits", async () => {
  const db = new Database(":memory:");
  const { client, calls } = replayClient();
  const service = new KeywordPopularityService(db, client, { now: () => new Date("2026-09-25T10:00:00Z"), concurrency: 8 });
  await Promise.all([
    service.lookup(6762091560, "US", ["dicom", "horos"], 1000),
    service.lookup(6762091560, "us", ["DICOM", "horos"], 1000),
  ]);
  assert.equal(calls.length, 2);
  await service.lookup(6762091560, "US", ["dicom"], 0);
  const status = service.status();
  assert.equal(status.queue.concurrency, 2, "concurrency is capped at 2");
  assert.equal(status.cache.rows, 2);
  assert.equal(status.cache.todayRows, 2);
  assert.equal(status.api.calls, 2);
  assert.equal(status.lookups.fresh, 1);
  assert.equal(status.lookups.miss, 4);
  assert.equal(status.lookups.hitRate, 0.2);
  assert.equal(status.batching.enabled, false);
  db.close();
});

test("a 429 pauses the queue with backoff and retries the same term", async () => {
  const db = new Database(":memory:");
  const { client, calls } = replayClient({ failFirst: 2 });
  const service = new KeywordPopularityService(db, client, {
    now: () => new Date("2026-09-25T10:00:00Z"),
    concurrency: 1,
    backoffBaseMs: 20,
    backoffMaxMs: 40,
  });
  const started = Date.now();
  const res = await service.lookup(6762091560, "US", ["dicom"], 2000);
  assert.equal(res.items[0].popularity, 7);
  assert.equal(res.items[0].status, "ok");
  assert.deepEqual(calls, [["dicom"], ["dicom"], ["dicom"]]);
  assert.ok(Date.now() - started >= 55, "waited 20 ms + 40 ms of backoff");
  const status = service.status();
  assert.equal(status.api.rateLimited, 2);
  assert.equal(status.lastErrors[0].status, 429);
  assert.equal(status.backoff.nextDelayMs, 20, "backoff resets after a success");
  service.stop();
  db.close();
});

test("nightly prefetch refreshes terms requested in the last week", async () => {
  const db = new Database(":memory:");
  const { client, calls } = replayClient();
  let now = new Date("2026-09-20T10:00:00Z");
  const service = new KeywordPopularityService(db, client, { now: () => now });
  await service.lookup(6762091560, "US", ["dicom"], 1000);
  now = new Date("2026-09-24T10:00:00Z");
  await service.lookup(6771391236, "GB", ["baby tracker"], 1000);
  now = new Date("2026-09-25T03:05:00Z");
  calls.length = 0;
  assert.equal(service.prefetchRecent(7), 2);
  await service.lookup(6762091560, "US", ["dicom"], 1000);
  await service.lookup(6771391236, "GB", ["baby tracker"], 1000);
  assert.equal(calls.length, 2, "lookups after the prefetch are served from today's cache");
  assert.equal(service.prefetchRecent(7), 0, "nothing left to refresh today");
  assert.equal(service.status().prefetch.lastEnqueued, 0);
  db.close();
});

test("recorded non-English terms: popularity does not depend on the storefront", () => {
  const terms = Object.entries(FIXTURES.storefronts.terms);
  assert.ok(terms.length >= 10);
  const storefronts = new Set(terms.flatMap(([, entry]) => Object.keys(entry.responses)));
  for (const sf of ["DE", "AT", "ES", "MX", "JP", "SA", "AE", "RU", "UA", "KZ", "US"]) assert.ok(storefronts.has(sf), sf);
  for (const [term, entry] of terms) {
    const responses = Object.values(entry.responses);
    assert.ok(responses.length >= 2, term);
    for (const response of responses) assert.deepEqual(response, responses[0], term);
    assert.notEqual(responses[0].own, null, term);
  }
  assert.equal(FIXTURES.storefronts.terms["wehenzähler"].responses.AT.own, 33);
  assert.equal(FIXTURES.storefronts.terms["胎動カウンター"].responses.US.own, 15);
});

test("one Apple call per term serves every storefront; storefront is kept as provenance", async () => {
  const db = new Database(":memory:");
  const calls: Array<{ term: string; storefront: string }> = [];
  const client = {
    queryRows: async (_path: string, body: { filters: Array<{ field: string; value: unknown }> }) => {
      const term = (body.filters.find((filter) => filter.field === "terms")?.value as string[])[0];
      const storefront = (body.filters.find((filter) => filter.field === "countriesOrRegions")?.value as string[])[0];
      calls.push({ term, storefront });
      const entry = FIXTURES.storefronts.terms[term];
      return { data: entry?.responses[storefront]?.rows ?? [{ text: term, popularity: 5 }], meta };
    },
  } as unknown as Pick<PlatformApiClient, "queryRows">;
  let now = new Date("2026-09-25T10:00:00Z");
  const service = new KeywordPopularityService(db, client, { now: () => now });
  const de = await service.lookup(6771391236, "DE", ["wehenzähler", "babynamen"], 1000);
  const at = await service.lookup(6771391236, "at", ["Wehenzähler", "babynamen"], 1000);
  const us = await service.lookup(6771391236, "US", ["wehenzähler"], 0);
  assert.equal(calls.length, 2, "AT and US are served from the DE fetch");
  for (const res of [de, at, us]) {
    const item = res.items.find((row) => row.term === "wehenzähler");
    assert.equal(item?.popularity, 33);
    assert.equal(item?.status, "ok");
    assert.equal(item?.fetchedFor, "DE");
  }
  assert.equal(at.storefront, "AT");
  // Concurrent requests for the same term from different storefronts share one call.
  await Promise.all([
    service.lookup(6771391236, "JP", ["胎動カウンター"], 1000),
    service.lookup(6771391236, "US", ["胎動カウンター"], 1000),
  ]);
  assert.equal(calls.length, 3);
  const status = service.status();
  assert.equal(status.cacheKey.scope, "term");
  assert.equal(status.cache.terms, 3);
  // The nightly prefetch refreshes each term once, whichever storefronts asked for it.
  now = new Date("2026-09-26T03:05:00Z");
  assert.equal(service.prefetchRecent(7), 3);
  await service.lookup(6771391236, "MX", ["wehenzähler", "babynamen", "胎動カウンター"], 1000);
  assert.equal(calls.length, 6);
  db.close();
});
