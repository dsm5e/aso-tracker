import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// suggestions.ts opens the SQLite store on import; keep tests off the real one.
process.env.ASO_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'aso-ideas-test-'));
const {
  assessCandidate,
  buildVocabulary,
  estimateGain,
  medScanProfile,
  tokenize,
} = await import('./suggestions.js');

// Titles and developers as they appear in MedScan's saved top-5 (AE/US).
const corpus = [
  { key: '1', title: 'IDV - IMAIOS DICOM Viewer', developer: 'IMAIOS' },
  { key: '2', title: 'DICOM Viewer : MRI CT XRAY & +', developer: 'Abdullah Aguiouaz' },
  { key: '3', title: 'DICOM Viewer : eMma', developer: '株式会社Kompath' },
  { key: '4', title: 'Falcon Mx - DICOM Viewer', developer: 'Falcon Systems' },
  { key: '5', title: 'MedFilm', developer: 'MedFilm LLC' },
  { key: '6', title: 'LumaDICOM: CT & MRI Viewer', developer: 'Luma Imaging' },
  { key: '7', title: 'Radiology CT Viewer', developer: 'Radio Apps' },
  { key: '8', title: 'DICOM File Viewer - MesDICOM', developer: 'Mes Soft' },
  { key: '9', title: 'X-Ray Scanner Body Prank', developer: 'Fun Pranks' },
  { key: '10', title: 'MRI Viewer', developer: 'Viewer Labs' },
];
const vocab = buildVocabulary(corpus);
const profile = medScanProfile(new Set(tokenize('dicom viewer ct viewer mri viewer cbct pacs')));
const assess = (phrase: string) => assessCandidate(phrase, vocab, profile);

test('drops competitor brands, app titles, fragments and off-topic phrases', () => {
  for (const phrase of [
    'imaios dicom viewer',
    'falcon mx',
    'falcon md',
    'medfilm',
    'emma',
    'mri ct xray & +',
    'dicom viewer : emma',
    'x-ray scanner body prank',
    'mri software',
    'birth chart',
    'imaging',
  ]) {
    const result = assess(phrase);
    assert.equal(result.ok, false, `${phrase} should be rejected`);
    assert.ok(!result.ok && result.reason.length > 0);
  }
});

test('keeps generic intent phrases and explains why', () => {
  for (const phrase of ['dicom viewer free', 'ct scan viewer', 'mri viewer', 'x-ray viewer', 'dental cbct viewer', 'visualizador dicom']) {
    const result = assess(phrase);
    assert.equal(result.ok, true, `${phrase} should be kept: ${!result.ok ? result.reason : ''}`);
    if (result.ok) assert.match(result.reason, /без брендов/);
  }
  const dental = assess('dental cbct viewer');
  assert.ok(dental.ok && dental.cluster.id === 'dental');
});

test('expected gain uses only the inputs it has and explains each one', () => {
  const strong = estimateGain({
    autocomplete: { index: 0, total: 10, seed: 'dicom viewer', seeds: 1 },
    seedRank: { rank: 4, seed: 'dicom viewer' },
  });
  assert.equal(strong.level, 'high');
  assert.equal(strong.score, Math.round(100 * 0.9 * 0.85));
  assert.ok(strong.inputs.some((line) => line.includes('«dicom viewer»')));

  const weak = estimateGain({ competitorApps: 1, seedRank: { rank: null, seed: 'pacs' } });
  assert.equal(weak.level, 'low');

  const alreadyTop = estimateGain({
    autocomplete: { index: 0, total: 10, seed: 'dicom', seeds: 1 },
    ourRank: { rank: 2, depth: 200, source: 'сохранённый снимок' },
  });
  assert.ok(alreadyTop.score < strong.score, 'ranking top-3 already leaves little to gain');

  const none = estimateGain({});
  assert.equal(none.score, Math.round(100 * 0.2 * 0.5));
  assert.ok(none.inputs.some((line) => line.includes('данных нет')));
});
