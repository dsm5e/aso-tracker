import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { computeMatrix } from './matrix.js';

function fixture() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, app TEXT NOT NULL, locale TEXT NOT NULL,
      keyword TEXT NOT NULL, position INTEGER, total INTEGER, top5_json TEXT, error TEXT,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX ix_snapshots_app_locale_kw_date ON snapshots(app, locale, keyword, date);
  `);
  const insert = database.prepare('INSERT INTO snapshots (date, app, locale, keyword, position, error) VALUES (?, ?, ?, ?, ?, ?)');
  const add = (date: string, locale: string, keyword: string, position: number | null, error: string | null = null, app = 'medscan') =>
    insert.run(date, app, locale, keyword, position, error);
  return { database, add };
}

const cellOf = (matrix: ReturnType<typeof computeMatrix>, locale: string, keyword: string) => {
  const index = matrix.keywords.findIndex((item) => item.toLocaleLowerCase() === keyword.toLocaleLowerCase());
  return matrix.cells[locale].find((cell) => cell[0] === index);
};

test('matrix: latest position, Δ1d / Δ7d baselines, re-runs, errors and untracked cells', () => {
  const { database, add } = fixture();
  // us «dicom»: 20 → 12 (8 days before latest) → 9 (day before) → 5 (latest; a same-day re-run wins)
  add('2026-09-01', 'us', 'dicom', 20);
  add('2026-09-10', 'us', 'dicom', 12);
  add('2026-09-17', 'us', 'dicom', 9);
  add('2026-09-18', 'us', 'dicom', 7);
  add('2026-09-18', 'us', 'dicom', 5);
  // A failed fetch after the latest good snapshot must not read as «not ranked».
  add('2026-09-19', 'us', 'dicom', null, 'HTTP 429');
  // us «ct viewer»: ranked a week ago, dropped out of results now.
  add('2026-09-11', 'us', 'ct viewer', 30);
  add('2026-09-18', 'us', 'ct viewer', null);
  // mx «dicom»: a single snapshot — no baselines.
  add('2026-09-18', 'mx', 'DICOM', 3);
  // Data for another app and an untracked storefront is ignored.
  add('2026-09-18', 'us', 'dicom', 1, null, 'other');
  add('2026-09-18', 'de', 'dicom', 2);

  const keywordMap = { us: ['dicom', 'ct viewer', 'mri'], mx: ['dicom', 'visor dicom'], de: ['dicom'] };
  const matrix = computeMatrix(database, 'medscan', keywordMap, ['us', 'mx', 'xx']);

  assert.deepEqual(matrix.locales, ['us', 'mx'], 'unknown storefronts are dropped, order kept');
  assert.deepEqual(matrix.keywords, ['ct viewer', 'dicom', 'mri', 'visor dicom'], 'case-insensitive union, sorted');

  const dicom = cellOf(matrix, 'us', 'dicom')!;
  assert.equal(dicom[1], 5, 'latest row of the latest day');
  assert.equal(dicom[2], 9, 'Δ1d baseline = previous snapshot day');
  assert.equal(dicom[3], 12, 'Δ7d baseline = newest day at least 7 days older');
  assert.equal(matrix.dates[dicom[4]], '2026-09-18');

  const ct = cellOf(matrix, 'us', 'ct viewer')!;
  assert.deepEqual(ct.slice(1, 4), [0, 30, 30], 'not in results now = 0; ranked 30 in the previous snapshot, which is also the 7d baseline');

  const mri = cellOf(matrix, 'us', 'mri')!;
  assert.deepEqual(mri, [matrix.keywords.indexOf('mri'), null, null, null, -1], 'tracked but never snapshotted');

  const mx = cellOf(matrix, 'mx', 'dicom')!;
  assert.deepEqual(mx.slice(1, 4), [3, null, null], 'snapshot keyword case differs from the list');

  assert.equal(cellOf(matrix, 'mx', 'ct viewer'), undefined, 'not tracked in this storefront → no cell');
  assert.deepEqual(matrix.stats.us, { tracked: 3, ranked: 1, top10: 1, avg: 5 });
  assert.equal(matrix.latestDate, '2026-09-18');
});

test('matrix: all storefronts when none requested; 1900 keywords × 89 storefronts stays fast', () => {
  const { database, add } = fixture();
  const locales = Array.from({ length: 89 }, (_, index) => String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26)));
  const keywords = Array.from({ length: 1900 }, (_, index) => `keyword ${index}`);
  const dates = ['2026-09-10', '2026-09-17', '2026-09-18'];
  database.transaction(() => {
    for (const date of dates) for (const locale of locales) for (let k = 0; k < keywords.length; k++) {
      add(date, locale, keywords[k], (k * 7 + locale.charCodeAt(1)) % 5 === 0 ? null : ((k + locale.charCodeAt(0)) % 250) + 1);
    }
  })();
  const keywordMap = Object.fromEntries(locales.map((locale) => [locale, keywords]));
  const coldStart = performance.now();
  const cold = computeMatrix(database, 'medscan', keywordMap);
  const coldMs = performance.now() - coldStart;
  const warmStart = performance.now();
  const warm = computeMatrix(database, 'medscan', keywordMap);
  const warmMs = performance.now() - warmStart;
  assert.equal(cold.cached, false);
  assert.equal(warm.cached, true, 'unchanged snapshots are served from the per-app summary');
  assert.equal(warm.locales.length, 89);
  assert.equal(warm.keywords.length, 1900);
  assert.equal(Object.values(warm.cells).reduce((sum, list) => sum + list.length, 0), 1900 * 89);
  console.log(`# matrix 1900×89 over ${dates.length * 1900 * 89} snapshot rows: cold ${coldMs.toFixed(0)} ms, cached ${warmMs.toFixed(0)} ms`);
  // Generous bounds: CI machines are slower than a dev laptop.
  assert.ok(coldMs < 3000, `cold matrix took ${coldMs.toFixed(0)} ms`);
  assert.ok(warmMs < 1000, `cached matrix took ${warmMs.toFixed(0)} ms`);

  // A new snapshot invalidates the cache.
  add('2026-09-19', 'aa', 'keyword 1', 1);
  const fresh = computeMatrix(database, 'medscan', keywordMap, ['aa']);
  assert.equal(fresh.cached, false);
  assert.equal(fresh.cells.aa.find((cell) => fresh.keywords[cell[0]] === 'keyword 1')![1], 1);
});
