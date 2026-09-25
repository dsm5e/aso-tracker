import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";
import { TrafficSyncScheduler, type TrafficCacheRefresher } from "./traffic-sync-scheduler.ts";
import type { TrafficIntelligenceInput } from "./traffic-intelligence.ts";

function fixtureDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE asa_campaigns (id INTEGER PRIMARY KEY, app_id INTEGER, country TEXT, status TEXT);
    CREATE TABLE asa_daily (campaign_id INTEGER, date TEXT, spend REAL);
    INSERT INTO asa_campaigns VALUES (1, 100, 'US', 'ENABLED');
    INSERT INTO asa_campaigns VALUES (2, 200, 'BR', 'ENABLED');
    INSERT INTO asa_campaigns VALUES (3, 300, 'CA', 'PAUSED');
    INSERT INTO asa_daily VALUES (1, '2026-09-03', 30);
    INSERT INTO asa_daily VALUES (2, '2026-09-03', 2);
  `);
  return db;
}

test("nightly traffic scheduler discovers every enabled geo and gives spending geos priority", async () => {
  const db = fixtureDb();
  const seen: TrafficIntelligenceInput[] = [];
  const refresher: TrafficCacheRefresher = { get: async (input) => {
    seen.push(input);
    return { servedFromCache: false, stale: false };
  } };
  const now = Date.parse("2026-09-04T03:00:00.000Z");
  const scheduler = new TrafficSyncScheduler(db, refresher, {
    now: () => now,
    random: () => 0,
    standardIntervalMs: 24 * 60 * 60_000,
    priorityIntervalMs: 6 * 60 * 60_000,
  });

  const status = await scheduler.runNightly();
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((input) => [input.appId, input.country]), [[100, "US"], [200, "BR"]]);
  assert.equal(status.succeeded, 2);
  assert.equal(status.failed, 0);
  assert.equal(status.targets.length, 2);
  assert.equal(status.targets[0]?.priority, true);
  assert.equal(status.targets[0]?.nextRunAt, now + 6 * 60 * 60_000);
  assert.equal(status.targets[1]?.priority, false);
  assert.equal(status.targets[1]?.nextRunAt, now + 24 * 60 * 60_000);
  db.close();
});

test("stale refresh has bounded retry with jitter and persists a later retry instead of looping", async () => {
  const db = fixtureDb();
  let calls = 0;
  const waits: number[] = [];
  const refresher: TrafficCacheRefresher = { get: async () => {
    calls += 1;
    return { servedFromCache: true, stale: true, partialErrors: [{ scope: "impressionShare", message: "Apple 503" }] };
  } };
  let now = Date.parse("2026-09-04T03:00:00.000Z");
  const scheduler = new TrafficSyncScheduler(db, refresher, {
    now: () => now,
    random: () => 0,
    retryBaseMs: 130_000,
    retryMaxMs: 130_000,
    sleep: async (ms) => { waits.push(ms); now += ms; },
  });

  const status = await scheduler.runNightly();
  assert.equal(calls, 4, "two targets × at most two attempts");
  assert.deepEqual(waits, [130_000, 130_000]);
  assert.equal(status.retries, 2);
  assert.equal(status.failed, 2);
  assert.ok(status.targets.every((target) => target.failureCount === 1));
  assert.ok(status.targets.every((target) => target.nextRunAt > now));

  await scheduler.tick();
  assert.equal(calls, 4, "no immediate retry loop after an exhausted run");
  db.close();
});
