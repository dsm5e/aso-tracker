import { existsSync, mkdirSync, renameSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Where private user data lives. Defaults to ~/.aso-studio (shared with the
 * Screenshots app's state.json). Override with ASO_STUDIO_HOME env var.
 *
 * Layout:
 *   ~/.aso-studio/
 *     state.json              (Screenshots editor state — managed by aso-screenshots)
 *     keys.json               (API keys — managed by aso-screenshots)
 *     keywords/apps.json      (app list)
 *     keywords/<app>.json     (per-app keyword lists)
 *     keywords/rankings.db    (snapshot history)
 */
export const STUDIO_HOME = process.env.ASO_STUDIO_HOME
  ? resolve(process.env.ASO_STUDIO_HOME)
  : join(homedir(), '.aso-studio');

export const KEYWORDS_HOME = join(STUDIO_HOME, 'keywords');
export const APPS_PATH = join(KEYWORDS_HOME, 'apps.json');
export const KEYWORDS_FILES_DIR = join(KEYWORDS_HOME, 'files');
export const DB_PATH = join(KEYWORDS_HOME, 'rankings.db');

export function ensureKeywordsHome(): void {
  if (!existsSync(STUDIO_HOME)) mkdirSync(STUDIO_HOME, { recursive: true });
  if (!existsSync(KEYWORDS_HOME)) mkdirSync(KEYWORDS_HOME, { recursive: true });
  if (!existsSync(KEYWORDS_FILES_DIR)) mkdirSync(KEYWORDS_FILES_DIR, { recursive: true });
}

let migrationDone = false;

/**
 * One-shot migration from the old in-repo location (./config/, ./data/) to
 * ~/.aso-studio/keywords/. Idempotent. Runs lazily on first path resolution.
 */
export function migrateLegacyData(): void {
  if (migrationDone) return;
  migrationDone = true;

  ensureKeywordsHome();

  const cwd = process.cwd();
  const legacyConfigDir = join(cwd, 'config');
  const legacyKeywordsDir = join(legacyConfigDir, 'keywords');
  const legacyAppsPath = join(legacyConfigDir, 'apps.json');
  const legacyDbPath = join(cwd, 'data', 'rankings.db');

  // Move apps.json
  if (existsSync(legacyAppsPath) && !existsSync(APPS_PATH)) {
    try { renameSync(legacyAppsPath, APPS_PATH); }
    catch { copyFileSync(legacyAppsPath, APPS_PATH); }
  }

  // Move per-app keyword files (skip *.example.json — those stay with the repo)
  if (existsSync(legacyKeywordsDir)) {
    for (const f of readdirSync(legacyKeywordsDir)) {
      if (!f.endsWith('.json') || f.endsWith('.example.json')) continue;
      const src = join(legacyKeywordsDir, f);
      const dst = join(KEYWORDS_FILES_DIR, f);
      if (existsSync(dst)) continue;
      try {
        if (statSync(src).isFile()) {
          try { renameSync(src, dst); }
          catch { copyFileSync(src, dst); }
        }
      } catch {/* ignore */}
    }
  }

  // Move SQLite DB (and its journal if present)
  if (existsSync(legacyDbPath) && !existsSync(DB_PATH)) {
    try { renameSync(legacyDbPath, DB_PATH); }
    catch { copyFileSync(legacyDbPath, DB_PATH); }
    const journal = legacyDbPath + '-journal';
    if (existsSync(journal)) {
      const dstJournal = DB_PATH + '-journal';
      try { renameSync(journal, dstJournal); } catch {/* ignore */}
    }
  }
}
