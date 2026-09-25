// SQLite caches shared by the rank pipeline and the competitor spy:
//
// - `app_meta_cache(id, cc, json, fetched_at)` — iTunes lookup items per
//   storefront (24 h; a miss is stored as 'null' for 1 h), filled by
//   `lookupBatch` in chunks of ≤150 ids.
// - `serp_cache(cc, term, source, ids_json, fetched_at)` — the full ordered
//   adamId list of one search (~250 deep from the App Store), written by every
//   `searchAppStore` call (snapshots, spy checks, UI refreshes) and read by the
//   spy. One row per (cc, term): the latest list wins, except that an iTunes
//   list never replaces a fresh App Store one.
//
// itunes.ts imports this module lazily so its pure helpers stay DB-free.

import { db } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS app_meta_cache (
    id         TEXT NOT NULL,
    cc         TEXT NOT NULL,
    json       TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (id, cc)
  );
  CREATE TABLE IF NOT EXISTS serp_cache (
    cc         TEXT NOT NULL,
    term       TEXT NOT NULL,
    source     TEXT NOT NULL,
    ids_json   TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (cc, term)
  );
`);

export const META_TTL_MS = 24 * 60 * 60_000;
export const META_MISS_TTL_MS = 60 * 60_000;
export const SERP_TTL_MS = 12 * 60 * 60_000;

/** Lookup item as cached (heavy text/screenshot fields stripped). */
export interface AppMetaRecord {
  trackId: number;
  bundleId?: string;
  trackName?: string;
  artistName?: string;
  sellerName?: string;
  primaryGenreName?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  artworkUrl60?: string;
  artworkUrl100?: string;
  artworkUrl512?: string;
  trackViewUrl?: string;
  currentVersionReleaseDate?: string;
  releaseDate?: string;
  version?: string;
  formattedPrice?: string;
  price?: number;
}

const KEEP: Array<keyof AppMetaRecord> = [
  'trackId', 'bundleId', 'trackName', 'artistName', 'sellerName', 'primaryGenreName', 'averageUserRating',
  'userRatingCount', 'artworkUrl60', 'artworkUrl100', 'artworkUrl512', 'trackViewUrl', 'currentVersionReleaseDate',
  'releaseDate', 'version', 'formattedPrice', 'price',
];

export function slimLookupItem(item: Record<string, unknown>): AppMetaRecord {
  const out: Record<string, unknown> = {};
  for (const key of KEEP) if (item[key] !== undefined) out[key] = item[key];
  return out as unknown as AppMetaRecord;
}

/** Cached lookups for `ids` in `cc`: record, or null for a cached miss. Stale rows are left out. */
export function readAppMeta(cc: string, ids: string[], now = Date.now()): Map<string, AppMetaRecord | null> {
  const out = new Map<string, AppMetaRecord | null>();
  const stmt = db.prepare('SELECT id, json, fetched_at FROM app_meta_cache WHERE cc = ? AND id IN (SELECT value FROM json_each(?))');
  for (let i = 0; i < ids.length; i += 500) {
    const rows = stmt.all(cc, JSON.stringify(ids.slice(i, i + 500))) as Array<{ id: string; json: string; fetched_at: number }>;
    for (const row of rows) {
      const value = safeParse<AppMetaRecord | null>(row.json, null);
      const ttl = value ? META_TTL_MS : META_MISS_TTL_MS;
      if (now - row.fetched_at < ttl) out.set(row.id, value);
    }
  }
  return out;
}

export function writeAppMeta(cc: string, entries: Array<[string, AppMetaRecord | null]>, now = Date.now()) {
  if (!entries.length) return;
  const stmt = db.prepare(`
    INSERT INTO app_meta_cache (id, cc, json, fetched_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id, cc) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at
  `);
  db.transaction(() => {
    for (const [id, value] of entries) stmt.run(id, cc, JSON.stringify(value), now);
  })();
}

export interface SerpRow { cc: string; term: string; source: string; ids: string[]; fetchedAt: number }

export function writeSerp(cc: string, term: string, source: string, ids: string[], now = Date.now()) {
  db.prepare(`
    INSERT INTO serp_cache (cc, term, source, ids_json, fetched_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cc, term) DO UPDATE SET source = excluded.source, ids_json = excluded.ids_json, fetched_at = excluded.fetched_at
     WHERE excluded.source = 'appstore' OR serp_cache.source <> 'appstore' OR excluded.fetched_at - serp_cache.fetched_at >= ?
  `).run(cc, term, source, JSON.stringify(ids), now, SERP_TTL_MS);
}

export function readSerp(cc: string, term: string): SerpRow | null {
  const row = db.prepare('SELECT cc, term, source, ids_json, fetched_at FROM serp_cache WHERE cc = ? AND term = ?').get(cc, term) as
    { cc: string; term: string; source: string; ids_json: string; fetched_at: number } | undefined;
  return row ? { cc: row.cc, term: row.term, source: row.source, ids: safeParse<string[]>(row.ids_json, []), fetchedAt: row.fetched_at } : null;
}

export function serpsForCountry(cc: string): SerpRow[] {
  const rows = db.prepare('SELECT cc, term, source, ids_json, fetched_at FROM serp_cache WHERE cc = ?').all(cc) as
    Array<{ cc: string; term: string; source: string; ids_json: string; fetched_at: number }>;
  return rows.map((row) => ({ cc: row.cc, term: row.term, source: row.source, ids: safeParse<string[]>(row.ids_json, []), fetchedAt: row.fetched_at }));
}

function safeParse<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
