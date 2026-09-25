import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ASO_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'kw-global-'));
const { loadKeywords, loadKeywordLayers, saveKeywords, updateGlobalKeywords } = await import('./config.js');

test('global keywords: merged into every storefront, new storefronts included', () => {
  saveKeywords('t1', { us: ['dicom'], de: ['dicom betrachter'] });
  updateGlobalKeywords('t1', ['MedScan', 'dicom'], []);
  assert.deepEqual(loadKeywordLayers('t1'), { global: ['MedScan', 'dicom'], local: { us: [], de: ['dicom betrachter'] } });
  assert.deepEqual(loadKeywords('t1'), { us: ['MedScan', 'dicom'], de: ['dicom betrachter', 'MedScan', 'dicom'] });
  // Adding a storefront (client sends the effective map + an empty new list).
  saveKeywords('t1', { ...loadKeywords('t1'), jp: [] });
  assert.deepEqual(loadKeywords('t1').jp, ['MedScan', 'dicom']);
  assert.deepEqual(loadKeywordLayers('t1').global, ['MedScan', 'dicom']);
});

test('removing a global keyword: everywhere → dropped; from some → targeted where it stays', () => {
  saveKeywords('t2', { us: [], de: [], jp: [] });
  updateGlobalKeywords('t2', ['a', 'b'], []);
  const all = loadKeywords('t2');
  // "a" removed from every storefront → gone; "b" removed from jp only → targeted in us/de.
  saveKeywords('t2', Object.fromEntries(Object.entries(all).map(([code, list]) => [code, list.filter((k) => k !== 'a' && !(code === 'jp' && k === 'b'))])));
  assert.deepEqual(loadKeywordLayers('t2'), { global: [], local: { us: ['b'], de: ['b'], jp: [] } });
});

test('updateGlobalKeywords: promote dedupes storefront copies, remove drops everywhere', () => {
  saveKeywords('t3', { us: ['x', 'y'], de: ['X'] });
  updateGlobalKeywords('t3', ['x'], []);
  assert.deepEqual(loadKeywordLayers('t3'), { global: ['x'], local: { us: ['y'], de: [] } });
  updateGlobalKeywords('t3', [], ['x']);
  assert.deepEqual(loadKeywords('t3'), { us: ['y'], de: [] });
});
