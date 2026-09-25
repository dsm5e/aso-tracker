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

export function loadKeywords(appId: string): Record<string, string[]> {
  ensureDirs();
  assertSafeAppId(appId);
  const p = join(KEYWORDS_FILES_DIR, `${appId}.json`);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, string[]>;
  } catch {
    return {};
  }
}

export function saveKeywords(appId: string, keywords: Record<string, string[]>) {
  ensureDirs();
  assertSafeAppId(appId);
  writeFileSync(join(KEYWORDS_FILES_DIR, `${appId}.json`), JSON.stringify(keywords, null, 2));
}
