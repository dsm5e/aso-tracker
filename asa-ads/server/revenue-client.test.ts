import assert from "node:assert/strict";
import test from "node:test";
import { fetchAdaptyGeoEconomics, fetchAdaptyGeoRevenue, fetchKeywordRevenue } from "./revenue-client.ts";

function response(metric: "common" | "net_revenue", rows: Array<{ type: string; value: number; values?: Array<{ x: string; y: number }> }>) {
  return new Response(JSON.stringify({ data: { [metric]: { data: rows } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("joins Adapty Apple keyword metrics by numeric keyword id", async () => {
  const responses = [
    response("common", [{ type: "101", value: 20 }, { type: "total", value: 20 }]),
    response("common", [{ type: "101", value: 4 }]),
    response("common", [{ type: "101", value: 2 }, { type: "202", value: 1 }]),
    response("net_revenue", [{ type: "101", value: 33.5 }, { type: "202", value: 9 }]),
  ];
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return responses.shift()!;
  };

  const result = await fetchKeywordRevenue(
    { start: "2026-08-01", end: "2026-08-31" },
    { key: "test", fetchImpl: fetchImpl as typeof fetch, throttleMs: 0 },
  );

  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    campaignId: 0,
    keywordId: 101,
    adGroupId: null,
    country: null,
    attributedInstalls: 20,
    trials: 4,
    paid: 2,
    revenueUsd: 33.5,
    windows: [],
  });
  assert.equal((bodies[0].filters as { attribution_source: string[] }).attribution_source[0], "apple_search_ads");
  assert.equal(bodies[0].segmentation, "attribution_creative");
  assert.equal(bodies[0].date_type, "profile_install_date");
});

test("joins Adapty geo metrics and ignores aggregate rows", async () => {
  const responses = [
    response("common", [{ type: "us", value: 8 }, { type: "total", value: 8 }]),
    response("common", [{ type: "us", value: 3 }, { type: "br", value: 1 }]),
    response("net_revenue", [{ type: "us", value: 40 }, { type: "br", value: 12 }]),
  ];
  const fetchImpl = async () => responses.shift()!;
  const rows = await fetchAdaptyGeoRevenue(
    { start: "2026-08-01", end: "2026-08-31" },
    { key: "test", fetchImpl: fetchImpl as typeof fetch, throttleMs: 0 },
  );
  assert.deepEqual(rows, [
    { country: "US", trials: 8, paid: 3, revenueUsd: 40 },
    { country: "BR", trials: 0, paid: 1, revenueUsd: 12 },
  ]);
});

test("filters keyword attribution by country without changing keyword-id grain", async () => {
  const responses = [
    response("common", [{ type: "101", value: 7 }]),
    response("common", [{ type: "101", value: 2 }]),
    response("common", [{ type: "101", value: 1 }]),
    response("net_revenue", [{ type: "101", value: 19 }]),
  ];
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return responses.shift()!;
  };
  const result = await fetchKeywordRevenue(
    { start: "2026-08-01", end: "2026-08-31" },
    { key: "test", country: "US", fetchImpl: fetchImpl as typeof fetch, throttleMs: 0 },
  );
  assert.equal(result.rows[0].country, "US");
  assert.deepEqual((bodies[0].filters as { country: string[] }).country, ["US"]);
});

test("sums per-day net revenue across country rows for the revenue sparkline", async () => {
  const day = (d: string, y: number) => ({ x: `${d}T00:00:00.000000+0000`, y });
  const responses = [
    response("common", [{ type: "us", value: 2 }]),
    response("common", [{ type: "us", value: 1 }]),
    response("net_revenue", [
      { type: "us", value: 30, values: [day("2026-08-01", 10), day("2026-08-02", 20)] },
      { type: "br", value: 5, values: [day("2026-08-02", 5)] },
      { type: "total", value: 35, values: [day("2026-08-01", 10), day("2026-08-02", 25)] },
    ]),
  ];
  const fetchImpl = async () => responses.shift()!;
  const result = await fetchAdaptyGeoEconomics(
    { start: "2026-08-01", end: "2026-08-02" },
    { key: "test", fetchImpl: fetchImpl as typeof fetch, throttleMs: 0 },
  );
  // The aggregate "total" row must not be double-counted.
  assert.deepEqual(result.dailyRevenue, [
    { date: "2026-08-01", revenueUsd: 10 },
    { date: "2026-08-02", revenueUsd: 25 },
  ]);
});
