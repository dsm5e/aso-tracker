import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

// keyword-table.ts resolves files/<app>.tags.json under ASO_STUDIO_HOME.
process.env.ASO_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'aso-kwtable-test-'));
const { applyPairs, applyTagChange, keywordHistory, loadTags, saveTags, setNote, tagPalette } = await import('./keyword-table.js');
const { detectLanguage, parseKeywordList, storefrontsForLanguage } = await import('./keyword-language.js');

test('tags: add / remove on many keywords, app-wide, case-insensitive', () => {
  let tags = applyTagChange({ tags: {}, notes: {} }, ['DICOM viewer', 'ct scan'], ['brand', 'core'], []);
  assert.deepEqual(tags.tags['dicom viewer'], ['brand', 'core']);
  tags = applyTagChange(tags, ['dicom viewer'], ['Core'], ['BRAND']);
  assert.deepEqual(tags.tags['dicom viewer'], ['core']);
  tags = applyTagChange(tags, ['ct scan'], [], ['brand', 'core']);
  assert.equal(tags.tags['ct scan'], undefined);
  assert.deepEqual(tagPalette(tags), [{ tag: 'core', count: 1 }]);
  tags = setNote(tags, 'us', 'DICOM Viewer', ' +5 after title change ');
  assert.equal(tags.notes.us['dicom viewer'], '+5 after title change');
  saveTags('medscan', tags);
  assert.deepEqual(loadTags('medscan'), tags);
  assert.deepEqual(setNote(tags, 'us', 'dicom viewer', '').notes, {});
});

test('bulk pairs: add skips existing (any case), remove works per storefront', () => {
  const result = applyPairs({ us: ['dicom'], mx: ['visor dicom'] }, [
    { keyword: 'Dicom', storefront: 'us' },
    { keyword: 'visor dicom', storefront: 'es' },
    { keyword: 'visor dicom', storefront: 'mx' },
  ], [{ keyword: 'DICOM', storefront: 'mx' }]);
  assert.equal(result.added, 1);
  assert.equal(result.existing, 2);
  assert.equal(result.removed, 0);
  assert.deepEqual(result.map, { us: ['dicom'], mx: ['visor dicom'], es: ['visor dicom'] });
  const removed = applyPairs(result.map, [], [{ keyword: 'VISOR DICOM', storefront: 'mx' }]);
  assert.deepEqual(removed.map.mx, []);
  assert.equal(removed.removed, 1);
});

test('history: Δ1/Δ7 baselines, entered/dropped within 7 days, 30-day trend', () => {
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, app TEXT, locale TEXT, keyword TEXT, position INTEGER, total INTEGER, top5_json TEXT, error TEXT, created_at INTEGER DEFAULT 0)`);
  const insert = database.prepare('INSERT INTO snapshots (date, app, locale, keyword, position, total) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('2026-09-10', 'a', 'us', 'dicom', null, 100);
  insert.run('2026-09-17', 'a', 'us', 'dicom', 30, 110);
  insert.run('2026-09-18', 'a', 'us', 'dicom', 20, 120);
  insert.run('2026-09-10', 'a', 'us', 'mri viewer', 12, 50);
  insert.run('2026-09-18', 'a', 'us', 'mri viewer', null, 55);
  const { rows, trendDates } = keywordHistory(database, 'a', 'us', ['dicom', 'MRI viewer', 'never checked']);
  const dicom = rows.get('dicom')!;
  assert.equal(dicom.current, 20);
  assert.equal(dicom.prev1, 30);
  assert.equal(dicom.prev7, 0, 'not in results on 09-10');
  assert.equal(dicom.entered7, true);
  assert.equal(dicom.total, 120);
  assert.equal(trendDates.at(-1), '2026-09-18');
  assert.equal(dicom.trend.length, 30);
  assert.equal(dicom.trend.at(-1), 20);
  assert.equal(dicom.trend.at(-2), 30);
  const mri = rows.get('mri viewer')!;
  assert.equal(mri.current, 0);
  assert.equal(mri.dropped7, true);
  const never = rows.get('never checked')!;
  assert.equal(never.current, null);
  assert.equal(never.prev7, null);
});

test('language guess preselects the storefronts that index it', () => {
  assert.equal(detectLanguage('visor dicom').lang, 'es');
  assert.equal(detectLanguage('dicom viewer').lang, 'en');
  assert.equal(detectLanguage('просмотр dicom').lang, 'ru');
  assert.equal(detectLanguage('перегляд знімків').lang, 'uk');
  assert.equal(detectLanguage('医学影像').lang, 'zh');
  assert.equal(detectLanguage('ダイコム').lang, 'ja');
  assert.equal(detectLanguage('عارض').lang, 'ar');
  assert.equal(detectLanguage('visualizador de exames').lang, 'pt');
  const tracked = ['us', 'mx', 'es', 'ar', 'co', 'de', 'ru', 'ua', 'kz', 'ae', 'gb'];
  assert.deepEqual(storefrontsForLanguage('es', tracked).sort(), ['ar', 'co', 'es', 'mx', 'us']);
  assert.ok(storefrontsForLanguage('ru', tracked).includes('us'), 'US indexes ru as an additional language');
  assert.ok(storefrontsForLanguage('ru', tracked).includes('ua'));
  assert.ok(!storefrontsForLanguage('ru', tracked).includes('kz'), 'Apple indexes only en-GB in KZ');
  assert.ok(!storefrontsForLanguage('ru', tracked).includes('de'));
  assert.deepEqual(parseKeywordList('visor dicom, dicom viewer\nDICOM viewer;  просмотр   dicom ,,'), { keywords: ['visor dicom', 'dicom viewer', 'просмотр dicom'], duplicates: 1 });
});
