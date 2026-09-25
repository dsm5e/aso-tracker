import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getDb, openDb } from "./db.ts";
import { geoBreakdown, listApps } from "./queries.ts";

test("listApps returns one row per app_id after store renames, newest name first", () => {
  openDb(mkdtempSync(join(tmpdir(), "asa-apps-")));
  const db = getDb();
  const ins = db.prepare(`INSERT INTO asa_campaigns
    (id, org_id, app_id, app_name, name, country, status, start_time, updated_at, synced_at)
    VALUES (?, 1, ?, ?, ?, 'US', ?, ?, 'x', 'x')`);
  ins.run(1, 100, "MedScan: DICOM CT & MRI Viewer", "old", "PAUSED", "2026-07-01T00:00:00.000");
  ins.run(2, 100, "DICOM Viewer: CT, MRI & X-Ray", "new", "ENABLED", "2026-09-07T00:00:00.000");
  ins.run(3, 100, "DICOM Viewer: MedScan CT MRI", "mid", "PAUSED", "2026-08-19T00:00:00.000");
  ins.run(4, 200, "Elara: Pregnancy Tracker", "e", "PAUSED", "2026-08-01T00:00:00.000");
  const today = new Date().toISOString().slice(0, 10);
  const daily = db.prepare(`INSERT INTO asa_daily (campaign_id, date, installs, spend) VALUES (?, ?, ?, ?)`);
  daily.run(1, today, 3, 5);
  daily.run(2, today, 7, 10);

  const apps = listApps();
  assert.equal(apps.length, 2);
  const med = apps[0];
  assert.equal(med.app_id, 100);
  assert.equal(med.app_name, "DICOM Viewer: CT, MRI & X-Ray");
  assert.deepEqual(med.aliases, [
    "DICOM Viewer: CT, MRI & X-Ray",
    "DICOM Viewer: MedScan CT MRI",
    "MedScan: DICOM CT & MRI Viewer",
  ]);
  assert.equal(med.campaign_count, 3);
  assert.equal(med.active_count, 1);
  // Spend is counted once per app, not once per alias.
  assert.equal(med.spend_14d, 15);
  assert.equal(med.installs_14d, 10);
  assert.equal(apps[1].app_name, "Elara: Pregnancy Tracker");
  assert.equal(new Set(apps.map((a) => a.app_id)).size, apps.length);
});

test("geoBreakdown splits multi-country campaigns by storefront and keeps trials per app", () => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const ins = db.prepare(`INSERT INTO asa_campaigns
    (id, org_id, app_id, app_name, name, country, countries_json, status, updated_at, synced_at)
    VALUES (?, 1, ?, 'X', ?, ?, ?, 'ENABLED', 'x', 'x')`);
  ins.run(10, 300, "WW", "LV", JSON.stringify(["LV", "UA", "TR"]));
  ins.run(11, 300, "UA only", "UA", JSON.stringify(["UA"]));
  ins.run(12, 300, "Multi, no split yet", "US", JSON.stringify(["US", "CA"]));
  const daily = db.prepare(`INSERT INTO asa_daily (campaign_id, date, installs, spend) VALUES (?, ?, ?, ?)`);
  daily.run(10, today, 100, 90);
  daily.run(11, today, 10, 6);
  daily.run(12, today, 4, 2);
  const geo = db.prepare(`INSERT INTO asa_geo_daily (campaign_id, date, country, installs, spend) VALUES (?, ?, ?, ?, ?)`);
  geo.run(10, today, "LV", 10, 10);
  geo.run(10, today, "UA", 50, 50);
  geo.run(10, today, "TR", 40, 30);
  const ev = db.prepare(`INSERT INTO asc_events_daily (app_id, date, country, product, event_type, events) VALUES (?, ?, ?, 'p', 'Start Introductory Offer', ?)`);
  ev.run(300, today, "UA", 12);
  ev.run(999, today, "UA", 500); // another app's trials must not leak in

  const rows = geoBreakdown(7, 300);
  const by = new Map(rows.map((r) => [r.country, r]));
  assert.equal(by.get("LV")?.spend, 10); // not the whole WW campaign
  assert.equal(by.get("UA")?.spend, 56); // WW share + dedicated campaign
  assert.equal(by.get("UA")?.campaigns, 2);
  assert.equal(by.get("UA")?.trials, 12);
  assert.equal(by.get("TR")?.spend, 30);
  assert.equal(by.get("WW")?.spend, 2); // multi-country without a split stays unassigned
  assert.equal(rows.reduce((s, r) => s + r.spend, 0), 98);
});
