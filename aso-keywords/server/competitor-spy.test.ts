import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// competitor-spy.ts opens the SQLite store on import; keep tests off the real one.
process.env.ASO_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'aso-spy-test-'));
const {
  appStrength,
  candidatePhrases,
  chance,
  classifyGap,
  compareByOpportunity,
  containsPhrase,
  difficulty,
  opportunity,
  presence,
  rankSaturation,
} = await import('./competitor-spy.js');

test('presence respects result-set depth', () => {
  assert.equal(presence({ rank: 3, depth: 5 }, 10), 'in');
  assert.equal(presence({ rank: 12, depth: 200 }, 10), 'out');
  assert.equal(presence({ rank: null, depth: 200 }, 10), 'out');
  // Absent from a top-5 snapshot says nothing about places 6–10.
  assert.equal(presence({ rank: null, depth: 5 }, 10), 'unknown');
  assert.equal(presence(null, 10), 'unknown');
});

test('gap classification: only theirs / shared / only ours / none', () => {
  assert.deepEqual(classifyGap({ rank: 1, depth: 200 }, { rank: null, depth: 200 }, 10), { gap: 'theirs', uncertain: false });
  assert.deepEqual(classifyGap({ rank: 2, depth: 15 }, { rank: 7, depth: 200 }, 10), { gap: 'shared', uncertain: false });
  assert.deepEqual(classifyGap({ rank: null, depth: 200 }, { rank: 4, depth: 200 }, 10), { gap: 'ours', uncertain: false });
  assert.deepEqual(classifyGap({ rank: 40, depth: 200 }, { rank: 55, depth: 200 }, 10), { gap: 'none', uncertain: false });
  // Their rank beyond the limit → ours only.
  assert.deepEqual(classifyGap({ rank: 25, depth: 200 }, { rank: 3, depth: 200 }, 10), { gap: 'ours', uncertain: false });
  // Wider limit turns it into a shared keyword.
  assert.equal(classifyGap({ rank: 25, depth: 200 }, { rank: 3, depth: 200 }, 30).gap, 'shared');
  // Our side unknown beyond a shallow set → flagged.
  assert.deepEqual(classifyGap({ rank: 1, depth: 5 }, { rank: null, depth: 5 }, 10), { gap: 'theirs', uncertain: true });
  assert.deepEqual(classifyGap({ rank: null, depth: 5 }, { rank: 2, depth: 200 }, 10), { gap: 'ours', uncertain: true });
});

test('app strength follows the spec weights', () => {
  assert.equal(appStrength({ ratings: 999_999, exactInTitle: true, updatedDaysAgo: 10 }), 1);
  assert.equal(appStrength({ ratings: 0, exactInTitle: false, updatedDaysAgo: 400 }), 0);
  // Unknown ratings and update date count as neutral halves.
  assert.equal(appStrength({ ratings: null, exactInTitle: false, updatedDaysAgo: null }), 0.6 * 0.5 + 0.15 * 0.5);
  assert.ok(Math.abs(appStrength({ ratings: 999, exactInTitle: false, updatedDaysAgo: 10 }) - (0.6 * 3 / 6 + 0.15)) < 1e-9);
});

test('difficulty weights the top positions and refuses thin evidence', () => {
  const strong = { ratings: 100_000, exactInTitle: true, updatedDaysAgo: 5 };
  const weak = { ratings: 0, exactInTitle: false, updatedDaysAgo: 500 };
  assert.equal(difficulty([weak, { ...weak, ratings: null }, { ...weak, ratings: null }]), null);
  const strongFirst = difficulty([strong, strong, weak, weak, weak])!;
  const strongLast = difficulty([weak, weak, weak, strong, strong])!;
  assert.ok(strongFirst > strongLast, `${strongFirst} > ${strongLast}`);
  assert.equal(difficulty(Array(10).fill(strong)), Math.round(100 * appStrength(strong)));
});

test('chance is a logistic of D − A', () => {
  assert.equal(chance(50, 50), 50);
  assert.ok(chance(80, 30)! < 5);
  assert.ok(chance(20, 70)! > 95);
  assert.equal(chance(null, 40), null);
});

test('opportunity = Pop × C/100 × (1 − R)', () => {
  assert.equal(rankSaturation(2), 1);
  assert.equal(rankSaturation(8), 0.5);
  assert.equal(rankSaturation(40), 0);
  assert.equal(rankSaturation(null), 0);
  assert.equal(opportunity(60, 50, null), 30);
  assert.equal(opportunity(60, 50, 7), 15);
  assert.equal(opportunity(60, 50, 1), 0);
  // Popularity 5 is a real low value, not "no data".
  assert.equal(opportunity(5, 100, null), 5);
  assert.equal(opportunity(null, 90, null), null);
  // Unknown chance is assumed 50.
  assert.equal(opportunity(40, null, null), 20);
});

test('sorting puts known Opportunity first, then the chance proxy', () => {
  const base = { theirRank: 1, ourRank: null, chance: 50, opportunity: null } as const;
  const rows = [
    { ...base, keyword: 'no-pop-high-chance', chance: 90 },
    { ...base, keyword: 'low', opportunity: 3 },
    { ...base, keyword: 'high', opportunity: 30 },
    { ...base, keyword: 'no-pop-top3', chance: 99, ourRank: 2 },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted = [...rows].sort(compareByOpportunity as any).map((row) => row.keyword);
  assert.deepEqual(sorted, ['high', 'low', 'no-pop-high-chance', 'no-pop-top3']);
});

test('title phrase matching is word-bounded', () => {
  assert.ok(containsPhrase('IDV - IMAIOS DICOM Viewer', 'dicom viewer'));
  assert.ok(!containsPhrase('IDV - IMAIOS DICOM Viewer', 'viewer dicom'));
  assert.ok(!containsPhrase('DICOM Viewers', 'dicom viewer'));
  assert.ok(!containsPhrase(null, 'dicom'));
});

test('candidate phrases come from title/subtitle, brand last', () => {
  const phrases = candidatePhrases('IDV - IMAIOS DICOM Viewer', 'Read CT & MRI scans', 'IMAIOS');
  assert.ok(phrases.includes('dicom viewer'));
  assert.ok(phrases.includes('mri scans'));
  assert.ok(phrases.indexOf('dicom viewer') < phrases.indexOf('imaios dicom'));
  // Separators split segments: no phrase crosses "-" or "&".
  assert.ok(!phrases.includes('idv imaios'));
  assert.ok(!phrases.includes('ct mri'));
});
