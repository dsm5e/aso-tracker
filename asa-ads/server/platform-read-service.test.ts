import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { PlatformApiClient, type PlatformTransport } from "./platform-api-client.ts";
import { PlatformReadService } from "./platform-read-service.ts";

function response(statusCode: number, payload: unknown) {
  return { statusCode, headers: {}, text: async () => JSON.stringify(payload) };
}

function service(transport: PlatformTransport) {
  const client = new PlatformApiClient({ token: async () => "not-to-be-logged" }, undefined, transport, async () => {});
  return new PlatformReadService(new Database(":memory:"), client);
}

test("generic Platform executor refuses catalogued mutations before network I/O", async () => {
  let calls = 0;
  const reads = service(async () => { calls += 1; return response(200, {}); });
  await assert.rejects(reads.executeGeneric({ methodId: "PUT /campaigns/{id}", pathParams: { id: 1 } }), /read-only mode/);
  assert.equal(calls, 0);
});

test("generic Platform executor rejects app-bound paths without a matching direct app scope", async () => {
  let calls = 0;
  const reads = service(async () => { calls += 1; return response(200, {}); });
  await assert.rejects(
    reads.executeGeneric({ methodId: "POST /campaigns/query", appId: 6762091560, body: { filters: [] } }),
    /adamId or promotedObjectId filter/,
  );
  await assert.rejects(
    reads.executeGeneric({ methodId: "GET /apps/{adamId}", appId: 6762091560, pathParams: { adamId: 1 } }),
    /must match/,
  );
  await assert.rejects(
    reads.executeGeneric({ methodId: "POST /campaigns/query", appId: 6762091560, body: { filters: [{ field: "promotedObjectId", operator: "EQUALS", value: ["1"] }] } }),
    /must match/,
  );
  assert.equal(calls, 0);
});

test("durable Platform snapshot serves stale-good data after Apple 5xx", async () => {
  let failed = false;
  const reads = service(async (url) => {
    if (url.endsWith("/acls")) return response(200, { result: { acls: [{ adAccount: { id: 9 } }] } });
    if (failed) return response(503, { message: "temporary outage" });
    return response(200, { result: [{ id: 10, name: "DICOM" }], pagination: { offset: 0, pageSize: 1, totalCount: 1 } });
  });
  const first = await reads.execute({ methodId: "POST /campaigns/query", body: { filters: [] }, appId: 6762091560, force: true });
  assert.equal(first.cache.status, "live");
  failed = true;
  const stale = await reads.execute({ methodId: "POST /campaigns/query", body: { filters: [] }, appId: 6762091560, force: true });
  assert.equal(stale.cache.status, "stale-if-error");
  assert.deepEqual(stale.data, [{ id: 10, name: "DICOM" }]);
});

test("suggestion collector sends each route its documented filter envelope", async () => {
  const seen: Array<{ path: string; body: Record<string, unknown> }> = [];
  const reads = service(async (url, init) => {
    if (url.endsWith("/acls")) return response(200, { result: { acls: [{ adAccount: { id: 9 } }] } });
    const path = new URL(url).pathname;
    seen.push({ path, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    return response(200, { result: [], pagination: { offset: 0, pageSize: 1, totalCount: 0 } });
  });
  const result = await reads.suggestions(6762091560, "US", true);
  assert.equal(result.partialErrors.length, 0);
  for (const path of ["/v1/suggestions/phrases/query", "/v1/suggestions/categories/query"]) {
    const call = seen.find((item) => item.path === path);
    assert.ok(call, `${path} was called`);
    const filters = call.body.filters as Array<{ field?: string; value?: unknown }>;
    assert.ok(Array.isArray(filters));
    assert.equal(filters.some((filter) => filter.field === "queryType" && Array.isArray(filter.value) && filter.value.includes("SUGGESTION")), true);
    assert.equal(filters.some((filter) => filter.field === "promotedObjectType" && Array.isArray(filter.value) && filter.value.includes("APPSTORE_APP")), true);
  }
  const targetCpa = seen.find((item) => item.path === "/v1/suggestions/target-cpas/query");
  const targetCpaFilters = targetCpa?.body.filters as Array<{ field?: string; value?: unknown }>;
  assert.equal(targetCpaFilters.some((filter) => filter.field === "countryOrRegion" && Array.isArray(filter.value) && filter.value.includes("US")), true);
  for (const path of ["/v1/recommendations/daily-budgets/query", "/v1/recommendations/target-cpas/query"]) {
    const call = seen.find((item) => item.path === path);
    const filters = call?.body.filters as Array<{ field?: string; value?: unknown }>;
    assert.equal(filters.some((filter) => filter.field === "promotedObjectType" && Array.isArray(filter.value) && filter.value.includes("APPSTORE_APP")), true);
  }
});

test("reports resolve app campaigns and use the AppsReportingRequest contract", async () => {
  const seen: Array<{ path: string; body: Record<string, unknown> }> = [];
  const reads = service(async (url, init) => {
    if (url.endsWith("/acls")) return response(200, { result: { acls: [{ adAccount: { id: 9 } }] } });
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
    seen.push({ path, body });
    if (path.endsWith("/campaigns/query")) {
      return response(200, { result: [{ id: 101 }, { id: 102 }], pagination: { offset: 0, pageSize: 2, totalCount: 2 } });
    }
    return response(200, { result: [], pagination: { offset: 0, pageSize: 1, totalCount: 0 } });
  });

  const result = await reads.reports(6762091560, 30, true);
  assert.equal(Object.values(result.sources).every((source) => source.status === "ok"), true);
  const reportCalls = seen.filter((call) => call.path.includes("/reports/apps/"));
  assert.equal(reportCalls.length, 10);
  for (const call of reportCalls) {
    const filters = call.body.filters as Array<{ field?: string; operator?: string; value?: unknown }>;
    assert.equal(filters.length, 1);
    assert.equal(filters[0].field, "campaignId");
    assert.equal(filters[0].operator, "EQUALS");
    assert.ok(filters[0].value === "101" || filters[0].value === "102");
    assert.deepEqual(call.body.groupBy, ["countryOrRegion"]);
    const timeRange = call.body.timeRange as Record<string, unknown>;
    assert.equal(timeRange.timeZone, "ORTZ");
    assert.equal(timeRange.granularity, "DAILY");
  }
});

test("durable snapshots are account-scoped and never cross a changed ACL account", async () => {
  const db = new Database(":memory:");
  let account = "9";
  let campaignCalls = 0;
  const transport: PlatformTransport = async (url) => {
    if (url.endsWith("/acls")) return response(200, { result: { acls: [{ adAccount: { id: account } }] } });
    campaignCalls += 1;
    return response(200, { result: [{ id: campaignCalls, account }] });
  };
  // A second service shares the durable DB but has a fresh Platform client,
  // simulating a restart after the configured organization changed.
  const secondDb = db;
  const scopedFirst = new PlatformReadService(secondDb, new PlatformApiClient({ token: async () => "not-to-be-logged" }, undefined, transport, async () => {}));
  const snapshotA = await scopedFirst.execute({ methodId: "POST /campaigns/query", body: { filters: [] }, appId: 6762091560 });
  assert.equal(snapshotA.accountId, "9");
  account = "10";
  const scopedSecond = new PlatformReadService(secondDb, new PlatformApiClient({ token: async () => "not-to-be-logged" }, undefined, transport, async () => {}));
  const snapshotB = await scopedSecond.execute({ methodId: "POST /campaigns/query", body: { filters: [] }, appId: 6762091560 });
  assert.equal(snapshotB.accountId, "10");
  assert.equal(snapshotB.cache.status, "live");
  assert.equal(campaignCalls, 2);
  db.close();
});

test("forced duplicate reads coalesce at Apple instead of creating a refresh stampede", async () => {
  let calls = 0;
  const reads = service(async (url) => {
    if (url.endsWith("/acls")) return response(200, { result: { acls: [{ adAccount: { id: 9 } }] } });
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return response(200, { result: [{ id: 10 }] });
  });
  const snapshots = await Promise.all(Array.from({ length: 6 }, () => reads.execute({
    methodId: "POST /campaigns/query", body: { filters: [] }, appId: 6762091560, force: true,
  })));
  assert.equal(calls, 1);
  assert.ok(snapshots.every((snapshot) => snapshot.accountId === "9"));
});
