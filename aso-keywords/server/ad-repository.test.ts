import assert from 'node:assert/strict';
import test from 'node:test';
import { AD_REPOSITORY_COUNTRY_BATCH_SIZE, buildAdRepositoryQuery, normalizeAdRepositoryAd } from './ad-repository.js';

test('keeps requests within Apple public repository country limit', () => {
  assert.equal(AD_REPOSITORY_COUNTRY_BATCH_SIZE, 5);
});

test('builds an official repository RSQL query scoped to the app and EU countries', () => {
  assert.equal(
    buildAdRepositoryQuery('1444841062', ['DE', 'FR'], 'LAST_YEAR'),
    'type==APP;id==1444841062;countryOrRegion=in=(DE,FR);datePreset==LAST_YEAR',
  );
});

test('normalizes creative evidence and extracts a confirmed ppid when Apple exposes one', () => {
  const ad = normalizeAdRepositoryAd({
    adId: 'ad-1',
    appId: 42,
    appName: 'DICOM Viewer',
    placement: 'APPSTORE_SEARCH_RESULTS',
    format: 'Icon + Asset Ad',
    countryOrRegion: 'de',
    lastImpressionDate: '2026-08-30 00:00:00.0',
    destination: 'https://apps.apple.com/de/app/id42?ppid=abc-123',
    adAssets: [{ pictureUrl: 'https://example.com/1.png', order: 1, width: 1290, height: 2796 }],
  });
  assert.ok(ad);
  assert.equal(ad.countryOrRegion, 'DE');
  assert.equal(ad.lastImpressionDate, '2026-08-30');
  assert.equal(ad.productPageId, 'abc-123');
  assert.equal(ad.assets.length, 1);
  assert.match(ad.creativeSignature, /^[0-9a-f]{16}$/);
});
