import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CONFIG_DIR = resolve(process.cwd(), 'config');
const APPS_PATH = join(CONFIG_DIR, 'apps.json');
const KEYWORDS_DIR = join(CONFIG_DIR, 'keywords');

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

function ensureDirs() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(KEYWORDS_DIR)) mkdirSync(KEYWORDS_DIR, { recursive: true });
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
  const p = join(KEYWORDS_DIR, `${appId}.json`);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, string[]>;
  } catch {
    return {};
  }
}

export function saveKeywords(appId: string, keywords: Record<string, string[]>) {
  ensureDirs();
  writeFileSync(join(KEYWORDS_DIR, `${appId}.json`), JSON.stringify(keywords, null, 2));
}

export function loadAllKeywords(): Record<string, Record<string, string[]>> {
  ensureDirs();
  const out: Record<string, Record<string, string[]>> = {};
  if (!existsSync(KEYWORDS_DIR)) return out;
  for (const f of readdirSync(KEYWORDS_DIR)) {
    if (!f.endsWith('.json') || f.endsWith('.example.json')) continue;
    const id = f.replace(/\.json$/, '');
    out[id] = loadKeywords(id);
  }
  return out;
}
