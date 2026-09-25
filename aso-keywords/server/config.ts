import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPS_PATH, KEYWORDS_FILES_DIR, ensureKeywordsHome, migrateLegacyData } from './paths.js';

export interface AppConfig {
  id: string;          // short slug — used as key (dream, paw, nomly…)
  name: string;        // display name
  emoji: string;       // fallback icon when iconUrl is missing
  bundle: string;      // bundle-id prefix used to detect our app in results
  iTunesId: string;    // numeric App Store id
  iconBg?: string;     // css gradient fallback
  iconUrl?: string;    // real App Store artwork URL
  tagline?: string;
  // Live App Store metadata, refreshed by own-app-meta.ts (US storefront, else the first tracked one).
  storeName?: string;
  developer?: string;
  version?: string;
  metaCountry?: string;
  metaUpdatedAt?: string;
}

/** App ids are used in a filesystem filename; never let an HTTP route turn
 * them into a path. Existing projects use short slugs such as `medscan`. */
const APP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function assertSafeAppId(value: unknown): string {
  if (typeof value !== 'string' || !APP_ID_PATTERN.test(value)) {
    throw new Error('app id must be a 1–64 character slug (letters, digits, _ or -)');
  }
  return value;
}

function ensureDirs() {
  migrateLegacyData();
  ensureKeywordsHome();
}

export function loadApps(): AppConfig[] {
  ensureDirs();
  if (!existsSync(APPS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(APPS_PATH, 'utf8')) as AppConfig[];
  } catch {
    return [];
  }
}

export function saveApps(apps: AppConfig[]) {
  ensureDirs();
  writeFileSync(APPS_PATH, JSON.stringify(apps, null, 2));
}

// Keyword storage: `{ "*": [...], "us": [...], "de": [...] }`.
// "*" is the global list — tracked in every storefront of the app, including ones
// added later; storefront lists hold the targeted (localized) keywords only.
// Readers get the effective per-storefront map (global merged in), so snapshots,
// the matrix and the scheduler need no special case.
export const GLOBAL_KEY = '*';
const fold = (keyword: string) => keyword.trim().toLocaleLowerCase();

export interface KeywordLayers { global: string[]; local: Record<string, string[]> }

export function loadKeywordLayers(appId: string): KeywordLayers {
  ensureDirs();
  assertSafeAppId(appId);
  const p = join(KEYWORDS_FILES_DIR, `${appId}.json`);
  if (!existsSync(p)) return { global: [], local: {} };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, string[]>;
    const { [GLOBAL_KEY]: global = [], ...local } = raw;
    return { global, local };
  } catch {
    return { global: [], local: {} };
  }
}

function writeLayers(appId: string, layers: KeywordLayers) {
  ensureDirs();
  assertSafeAppId(appId);
  const out: Record<string, string[]> = {};
  if (layers.global.length) out[GLOBAL_KEY] = layers.global;
  for (const [code, list] of Object.entries(layers.local)) out[code] = list;
  writeFileSync(join(KEYWORDS_FILES_DIR, `${appId}.json`), JSON.stringify(out, null, 2));
}

/** Effective keywords per storefront: the storefront's own list + the global list. */
export function loadKeywords(appId: string): Record<string, string[]> {
  const { global, local } = loadKeywordLayers(appId);
  const out: Record<string, string[]> = {};
  for (const [code, list] of Object.entries(local)) {
    const seen = new Set(list.map(fold));
    out[code] = [...list, ...global.filter((keyword) => !seen.has(fold(keyword)))];
  }
  return out;
}

/**
 * Save an effective map (what loadKeywords returned, edited). A global keyword
 * missing from every existing storefront is dropped from the global list; missing
 * from only some, it becomes targeted in the storefronts that still have it.
 * Storefronts new in this save get the global list, whatever they carry.
 */
export function saveKeywords(appId: string, keywords: Record<string, string[]>) {
  const before = loadKeywordLayers(appId);
  const existing = Object.keys(keywords).filter((code) => code in before.local);
  const has = (code: string, keyword: string) => (keywords[code] ?? []).some((item) => fold(item) === fold(keyword));
  const global = before.global.filter((keyword) => {
    const holders = existing.filter((code) => has(code, keyword)).length;
    return !existing.length || holders === existing.length;
  });
  const isGlobal = new Set(global.map(fold));
  const local: Record<string, string[]> = {};
  // Demoted keywords are no longer global, so they simply stay in the lists that hold them.
  for (const [code, list] of Object.entries(keywords)) local[code] = list.filter((keyword) => !isGlobal.has(fold(keyword)));
  writeLayers(appId, { global, local });
}

/** Add / remove global keywords directly (they apply to every storefront). */
export function updateGlobalKeywords(appId: string, add: string[], remove: string[]): KeywordLayers {
  const layers = loadKeywordLayers(appId);
  const drop = new Set(remove.map(fold));
  const global = layers.global.filter((keyword) => !drop.has(fold(keyword)));
  for (const keyword of add.map((k) => k.trim()).filter(Boolean)) {
    if (!global.some((item) => fold(item) === fold(keyword))) global.push(keyword);
  }
  const isGlobal = new Set(global.map(fold));
  // A keyword promoted to global leaves the storefront lists (no duplicates);
  // a keyword removed from global disappears everywhere.
  const local: Record<string, string[]> = {};
  for (const [code, list] of Object.entries(layers.local)) local[code] = list.filter((keyword) => !isGlobal.has(fold(keyword)) && !drop.has(fold(keyword)));
  const next = { global, local };
  writeLayers(appId, next);
  return next;
}
