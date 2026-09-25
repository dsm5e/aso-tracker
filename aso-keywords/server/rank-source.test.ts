import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMzSearch, positionFromRank } from './itunes.js';
import { storeFrontHeader, storefrontCountry } from './storefront-ids.js';
import { summarizeComparison } from './rank-source.js';

const mzPayload = {
  pageData: {
    bubbles: [
      { name: 'software', results: [{ id: '111', type: 0 }, { id: '222' }, { id: '333' }, { id: '444' }, { id: '555' }, { id: '666' }] },
    ],
  },
  storePlatformData: {
    'native-search-lockup': {
      results: {
        111: { id: '111', name: 'Alpha', artistName: 'A Inc', bundleId: 'com.a', genreNames: ['Lifestyle'], userRating: { value: 4.5, ratingCount: 10 } },
        222: { id: '222', name: 'Beta', artistName: 'B Inc', bundleId: 'com.b' },
        333: { id: '333', name: 'Ours', artistName: 'Nomly', bundleId: 'space.nomly.elara' },
      },
    },
  },
};

test('parseMzSearch reads ordered ids and lockups', () => {
  const parsed = parseMzSearch(mzPayload)!;
  assert.deepEqual(parsed.ids, ['111', '222', '333', '444', '555', '666']);
  assert.deepEqual(parsed.lockups.get('111'), { name: 'Alpha', developer: 'A Inc', rating: 4.5, ratingCount: 10, genre: 'Lifestyle', bundleId: 'com.a' });
});

test('parseMzSearch returns null when the schema changed', () => {
  assert.equal(parseMzSearch({ storePlatformData: {} }), null);
  assert.equal(parseMzSearch({ pageData: { bubbles: [{ name: 'editorial', results: [] }] } }), null);
  assert.equal(parseMzSearch(null), null);
});

test('positionFromRank matches by App Store id first, bundle as fallback', () => {
  const parsed = parseMzSearch(mzPayload)!;
  assert.equal(positionFromRank(parsed, { iTunesId: '555', bundle: 'space.nomly.elara' }).position, 5);
  assert.equal(positionFromRank(parsed, { iTunesId: '999', bundle: 'space.nomly' }).position, 3);
  assert.equal(positionFromRank(parsed, { iTunesId: '999', bundle: 'org.none' }).position, null);
  const { top5, total } = positionFromRank(parsed, { iTunesId: '333' });
  assert.equal(total, 6);
  assert.deepEqual(top5[0], { name: 'Alpha', id: 'com.a', dev: 'A Inc', tid: 111, pos: 1 });
  assert.equal(top5.length, 5);
  assert.equal(top5[4].tid, 555);
});

test('storefront header has no language suffix', () => {
  assert.equal(storeFrontHeader('ae'), '143481,29');
  assert.equal(storeFrontHeader('us'), '143441,29');
  assert.equal(storeFrontHeader('in-hi'), '143467,29');
  assert.equal(storefrontCountry('es-ca'), 'es');
  assert.equal(storeFrontHeader('xx'), null);
});

test('summarizeComparison: same-position share and mean abs diff', () => {
  const s = summarizeComparison([
    { date: 'd1', appstore: 10, itunes: 10 },
    { date: 'd1', appstore: 37, itunes: 10 },
    { date: 'd1', appstore: null, itunes: null },
    { date: 'd1', appstore: null, itunes: 50 },
  ]);
  assert.equal(s.observations, 4);
  assert.equal(s.samePositionPct, 50);
  assert.equal(s.bothRanked, 2);
  assert.equal(s.meanAbsDiff, 13.5);
  assert.equal(s.meanSignedDiff, 13.5);
  assert.equal(s.onlyItunes, 1);
  assert.equal(summarizeComparison([]).samePositionPct, null);
});
