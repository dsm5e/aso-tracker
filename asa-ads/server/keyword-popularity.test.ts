import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";
import type { PlatformApiClient, PlatformRequestMeta } from "./platform-api-client.ts";
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
