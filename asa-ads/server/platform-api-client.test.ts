import assert from "node:assert/strict";
import test from "node:test";
import { PlatformApiClient, type PlatformTransport } from "./platform-api-client.ts";

function response(statusCode: number, payload: unknown, headers: Record<string, string> = {}) {
  return { statusCode, headers, text: async () => JSON.stringify(payload) };
}

test("resolves adAccountId, paginates query results, and caches read pages", async () => {
  const calls: Array<{ url: string; body?: string; context?: string }> = [];
  const transport: PlatformTransport = async (url, init) => {
    calls.push({ url, body: init.body, context: init.headers["x-ap-context"] });
    if (url.endsWith("/acls")) {
      return response(200, { result: { acls: [
        { roles: ["Read Only"], adAccount: { id: 1, orgId: "other" } },
        { roles: ["API Campaign Manager"], adAccount: { id: 7, orgId: "42" } },
      ] } });
    }
    const body = JSON.parse(init.body ?? "{}") as { pagination: { offset: number } };
    return response(200, {
      result: [{ id: body.pagination.offset + 1 }],
      pagination: { offset: body.pagination.offset, pageSize: 1, totalCount: 2 },
    }, { "x-request-id": `request-${body.pagination.offset}` });
  };
  const client = new PlatformApiClient({ token: async () => "secret-token" }, "42", transport);

  // Apple may clamp a requested page size. totalCount must drive pagination,
  // rather than treating a short clamped page as the end.
  const first = await client.queryRows<{ id: number }>("/campaigns/query", { filters: [] }, 5000);
  const second = await client.queryRows<{ id: number }>("/campaigns/query", { filters: [] }, 5000);

  assert.deepEqual(first.data, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(second.data, first.data);
  assert.equal(calls.filter((call) => call.url.endsWith("/acls")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/campaigns/query")).length, 2);
  assert.ok(calls.filter((call) => call.url.endsWith("/campaigns/query")).every((call) => call.context === "adAccountId=7"));
  assert.ok(calls.filter((call) => call.url.endsWith("/campaigns/query")).every((call) => {
    const body = JSON.parse(call.body ?? "{}") as { pagination?: { pageSize?: number } };
    return body.pagination?.pageSize === 1_000;
  }));
  assert.equal(second.meta.cached, true);
});

test("retries rate limits and redacts secret-shaped fields from metadata", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const transport: PlatformTransport = async () => {
    attempts += 1;
    if (attempts < 3) return response(429, { message: "slow down" });
    return response(200, { result: { ok: true } });
  };
  const client = new PlatformApiClient(
    { token: async () => "secret-token" },
    undefined,
    transport,
    async (ms) => { delays.push(ms); },
  );

  const result = await client.read("POST", "/test/query", {
    accountContext: false,
    cacheMs: 0,
    body: { accessToken: "must-not-leak", nested: { clientSecret: "must-not-leak" }, safe: "visible" },
  });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
  assert.deepEqual(result.meta.request.body, {
    accessToken: "[redacted]",
    nested: { clientSecret: "[redacted]" },
    safe: "visible",
  });
  assert.equal(result.meta.attempts, 3);
});

test("caps concurrent Apple transports across distinct requests", async () => {
  let active = 0;
  let peak = 0;
  const transport: PlatformTransport = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return response(200, { result: { ok: true } });
  };
  const client = new PlatformApiClient({ token: async () => "secret-token" }, undefined, transport);

  await Promise.all(Array.from({ length: 6 }, (_, index) => client.read("GET", `/test/${index}`, {
    accountContext: false,
    cacheMs: 0,
  })));

  assert.equal(peak, 2);
});

test("retries transient transport failures and rejects malformed JSON without leaking a response body", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const client = new PlatformApiClient(
    { token: async () => "secret-token" },
    undefined,
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("socket reset");
      return { statusCode: 200, headers: {}, text: async () => "not-json-private-response" };
    },
    async (ms) => { delays.push(ms); },
  );
  await assert.rejects(
    client.read("GET", "/test/malformed", { accountContext: false, cacheMs: 0 }),
    (error: unknown) => error instanceof Error && /invalid JSON/.test(error.message) && !error.message.includes("private-response"),
  );
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [250]);
});

test("redacts secret-looking content echoed by an upstream error before it reaches callers", async () => {
  const client = new PlatformApiClient(
    { token: async () => "real-bearer-token" },
    undefined,
    async () => response(400, { message: "authorization: Bearer real-bearer-token; apiKey=upstream-secret" }),
  );
  await assert.rejects(
    client.read("GET", "/test/error-echo", { accountContext: false, cacheMs: 0 }),
    (error: unknown) => error instanceof Error
      && /\[redacted\]/.test(error.message)
      && !error.message.includes("real-bearer-token")
      && !error.message.includes("upstream-secret"),
  );
});
