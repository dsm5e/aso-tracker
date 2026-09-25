import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEYWORDS_FILES_DIR, ensureKeywordsHome } from './paths.js';
import { assertSafeAppId } from './config.js';
import type { CountrySet, CountrySets, CountrySetsResponse } from './countries-types.js';

/** Per-app country sets: favourite storefronts and named column sets for the matrix. */

export type { CountrySet, CountrySets, CountrySetsResponse };

export const COUNTRY_CODE = /^[a-z]{2}$/;

/** Stored next to the keyword list: files/<app>.countries.json (app ids never contain dots). */
function setsPath(appId: string) {
  assertSafeAppId(appId);
  return join(KEYWORDS_FILES_DIR, `${appId}.countries.json`);
}

export function sanitizeCountrySets(input: unknown): CountrySets {
  const body = (input && typeof input === 'object' ? input : {}) as Partial<CountrySets>;
  const codes = (value: unknown) => [...new Set((Array.isArray(value) ? value : [])
    .filter((code): code is string => typeof code === 'string')
    .map((code) => code.trim().toLowerCase())
    .filter((code) => COUNTRY_CODE.test(code)))];
  const favorites = codes(body.favorites).slice(0, 50);
  const sets: CountrySet[] = [];
  const ids = new Set<string>();
  for (const raw of Array.isArray(body.sets) ? body.sets : []) {
    if (!raw || typeof raw !== 'object') continue;
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
    const locales = codes(raw.locales);
    if (!name || !locales.length) continue;
    let id = typeof raw.id === 'string' && /^set:[a-z0-9-]{1,48}$/.test(raw.id) ? raw.id : `set:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom'}`;
    while (ids.has(id)) id = `${id}-2`;
    ids.add(id);
    sets.push({ id, name, locales });
    if (sets.length >= 30) break;
  }
  return { favorites, sets };
}

export function loadCountrySets(appId: string): CountrySets {
  const path = setsPath(appId);
  if (!existsSync(path)) return { favorites: [], sets: [] };
  try {
    return sanitizeCountrySets(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { favorites: [], sets: [] };
  }
}

export function saveCountrySets(appId: string, sets: CountrySets) {
  ensureKeywordsHome();
  const path = setsPath(appId);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(sets, null, 2));
  renameSync(tmp, path);
}
