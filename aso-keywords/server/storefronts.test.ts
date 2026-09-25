import assert from 'node:assert/strict';
import test from 'node:test';
import { STOREFRONTS, builtInPresets, searchStorefronts, storefrontOf, storefrontsIndexing } from './storefronts.js';
import { sanitizeCountrySets } from './country-sets.js';

const codes = (query: string) => searchStorefronts(query).map((match) => match.storefront.code);

test('storefront table encodes Apple indexing rules', () => {
  assert.equal(STOREFRONTS.length, 175);
  assert.equal(new Set(STOREFRONTS.map((s) => s.code)).size, STOREFRONTS.length, 'unique alpha-2 codes');
  assert.deepEqual(storefrontOf('us').locales, ['en-US', 'ar-SA', 'zh-Hans', 'zh-Hant', 'fr-FR', 'ko', 'pt-BR', 'ru', 'es-MX', 'vi']);
  assert.deepEqual(storefrontOf('CA').locales, ['en-CA', 'fr-CA']);
  assert.deepEqual(storefrontOf('ch').locales, ['de-DE', 'en-GB', 'fr-FR', 'it']);
  assert.deepEqual(storefrontOf('be').locales, ['en-GB', 'nl-NL', 'fr-FR']);
  assert.deepEqual(storefrontOf('es').locales, ['es-ES', 'ca', 'en-GB']);
  assert.deepEqual(storefrontOf('lu').locales, ['en-GB', 'fr-FR', 'de-DE']);
  assert.equal(storefrontOf('in').locales.length, 12, 'en-GB + 11 Indic languages');
  assert.equal(storefrontOf('mx').flag, '🇲🇽');
  assert.equal(storefrontOf('mx').name, 'Мексика');
});

test('search: «es» finds Spain by ISO, Mexico by default es-MX and the US by additional es-MX', () => {
  const result = codes('es');
  assert.equal(result[0], 'es');
  const mx = result.indexOf('mx'), us = result.indexOf('us'), ee = result.indexOf('ee');
  assert.ok(mx > 0 && us > mx, 'MX (default language) above US (additional language)');
  assert.ok(ee === -1 || ee > us, 'a name prefix («Estonia») never beats a language code match');
  assert.equal(searchStorefronts('es').find((m) => m.storefront.code === 'us')!.reason, 'lang-secondary');
});

test('search: Russian and English names, ISO-3, diacritics, language names', () => {
  assert.equal(codes('мекс')[0], 'mx');
  assert.equal(codes('germ')[0], 'de');
  assert.equal(codes('DEU')[0], 'de');
  assert.equal(codes('turkiye')[0], 'tr', 'diacritics folded: Türkiye');
  assert.deepEqual(codes('ru').slice(0, 1), ['ru']);
  assert.ok(codes('ru').includes('ua') && codes('ru').includes('us'), 'ru indexed in UA and US');
  assert.ok(codes('русск').includes('us'), 'language name in Russian');
  assert.deepEqual(codes(''), STOREFRONTS.map((s) => s.code), 'empty query keeps order');
  assert.deepEqual(codes('zzzz'), []);
});

test('indexing helper and presets', () => {
  const spanish = storefrontsIndexing('es').map((s) => s.code);
  for (const code of ['mx', 'es', 'us', 'ar', 'uy']) assert.ok(spanish.includes(code), code);
  assert.ok(!spanish.includes('gb'));
  const presets = builtInPresets(['us', 'mx', 'ar', 'gb', 'ua', 'de']);
  const byId = Object.fromEntries(presets.map((preset) => [preset.id, preset.locales]));
  assert.deepEqual(byId['preset:en'], ['gb', 'ua', 'us']);
  assert.deepEqual(byId['preset:latam'], ['ar', 'mx']);
  assert.deepEqual(byId['preset:ru'], ['ua', 'us']);
});

test('country sets are sanitized before they reach disk', () => {
  const clean = sanitizeCountrySets({
    favorites: ['US', 'mx', 'mx', '../etc', 7],
    sets: [
      { name: '  LatAm  ', locales: ['MX', 'ar', 'bad!'] },
      { name: 'LatAm', locales: ['cl'] },
      { name: '', locales: ['us'] },
      { name: 'Empty', locales: [] },
    ],
  });
  assert.deepEqual(clean.favorites, ['us', 'mx']);
  assert.deepEqual(clean.sets.map((set) => [set.id, set.name, set.locales]), [
    ['set:latam', 'LatAm', ['mx', 'ar']],
    ['set:latam-2', 'LatAm', ['cl']],
  ]);
  assert.deepEqual(sanitizeCountrySets(null), { favorites: [], sets: [] });
});

test('every storefront has an App Store storefront id, all distinct', async () => {
  const { storefrontId } = await import('./storefront-ids.js');
  const missing = STOREFRONTS.filter((s) => storefrontId(s.code) == null).map((s) => s.code);
  assert.deepEqual(missing, []);
  const ids = STOREFRONTS.map((s) => storefrontId(s.code));
  assert.equal(new Set(ids).size, ids.length, 'unique storefront ids');
  assert.equal(storefrontId('ma'), 143620);
  assert.equal(storefrontId('iq'), 143617);
});
