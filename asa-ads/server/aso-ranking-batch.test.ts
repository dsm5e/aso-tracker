import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getCachedTop5Batch, parseCachedTop5Input } from "./aso-ranking-batch.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "asa-top5-"));
  const rankingsPath = join(root, "rankings.db");
  const appsPath = join(root, "apps.json");
  const db = new Database(rankingsPath);
  db.exec(`CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, app TEXT NOT NULL, locale TEXT NOT NULL,
    keyword TEXT NOT NULL, position INTEGER, total INTEGER, top5_json TEXT, error TEXT
  )`);
  writeFileSync(appsPath, JSON.stringify([{
    id: "medscan", iTunesId: "6762091560", name: "MedScan", bundle: "com.nomly.medscan", iconUrl: "https://cdn.example/medscan.png",
  }]));
  return { root, rankingsPath, appsPath, db };
}

test("batch returns the last successful cached top-5, injects the known own-app slot, and never uses a failed newer row", () => {
  const f = fixture();
  try {
    f.db.prepare(`INSERT INTO snapshots (date, app, locale, keyword, position, total, top5_json, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("2026-08-20", "medscan", "us", "dicom", 2, 50, JSON.stringify([
        { name: "IDV", id: "com.imaios.idv", tid: 1444841062, dev: "IMAIOS", pos: 1 },
        { name: "Wrong legacy slot", id: "other", tid: 2, dev: "Other", pos: 2 },
        { name: "Viewer", id: "viewer", tid: 3, pos: 3 },
      ]), null);
    // Failed refresh must not erase the useful older snapshot.
    f.db.prepare(`INSERT INTO snapshots (date, app, locale, keyword, position, total, top5_json, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("2026-09-04", "medscan", "us", "dicom", null, 0, "[]", "iTunes 503");
    f.db.close();

    const result = getCachedTop5Batch({ appId: 6762091560, locales: ["US", "br"], terms: [" DICOM "], limit: 10 }, {
      rankingsPath: f.rankingsPath, appsPath: f.appsPath,
    });
    assert.equal(result.liveRefresh, false);
    assert.equal(result.items.length, 1);
    const row = result.items[0];
    assert.equal(row.observedAt, "2026-08-20");
    assert.equal(row.freshness, "latest-successful-snapshot");
    assert.equal(row.error, null);
    assert.equal(row.apps.find((app) => app.isOwn)?.rank, 2);
    assert.equal(row.apps.find((app) => app.isOwn)?.iconUrl, "https://cdn.example/medscan.png");
    assert.ok(!row.apps.some((app) => app.name === "Wrong legacy slot"));
    assert.deepEqual(result.missing, [{ locale: "br", term: "dicom", reason: "no_cached_snapshot" }]);
  } finally {
    try { f.db.close(); } catch { /* closed above */ }
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("batch bounds request cardinality and keeps cursor parsing deterministic", () => {
  assert.throws(() => parseCachedTop5Input({ appId: 1, locales: ["us", "br", "de", "fr", "it", "es"], terms: Array.from({ length: 100 }, (_, index) => `term ${index}`) }), /locales × terms/);
  assert.throws(() => parseCachedTop5Input({ appId: 1, terms: ["dicom"], limit: 501 }), /limit/);
  assert.throws(() => parseCachedTop5Input({ appId: 1, terms: ["dicom"], cursor: "not-a-cursor" }), /invalid cursor/);
  const parsed = parseCachedTop5Input({ appId: "6762091560", locales: ["US", "us"], terms: ["DICOM", " dicom "], limit: 1 });
  assert.deepEqual(parsed.locales, ["us"]);
  assert.deepEqual(parsed.terms, ["dicom"]);
});
