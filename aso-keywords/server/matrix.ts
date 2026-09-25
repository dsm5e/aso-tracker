import type Database from 'better-sqlite3';

import type { MatrixCell, MatrixLocaleStats, MatrixResponse } from './countries-types.js';

export type { MatrixCell, MatrixLocaleStats, MatrixResponse };

/** Keyword × storefront matrix — cell encoding is documented in countries-types.ts. */

/** Latest facts for one (storefront, keyword) pair. */
interface PairSummary {
  date: string;
  pos: number;
  prev1: number | null;
  prev7: number | null;
}

/**
 * Partial covering index for the matrix scan: every column the scan reads is in
 * the index (rowid included), failed fetches are excluded, and the index order is
 * exactly the grouping order — no temp B-tree, no table lookups.
 */
export const MATRIX_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ix_snapshots_matrix
  ON snapshots(app, locale, keyword, date, position) WHERE error IS NULL`;

/**
 * The one SQL: the app's good snapshots in (locale, keyword, date) order straight
 * off ix_snapshots_matrix. A single linear pass in JS then keeps, per pair, the
 * last row of each day (a day can be re-run — the highest id wins), and reads the
 * current position (last day), the Δ1d baseline (previous snapshot day) and the
 * Δ7d baseline (newest day at least 7 days before the last one).
 * Failed fetches (error IS NOT NULL) are not «not ranked» and never count.
 */
export const MATRIX_SQL = `
  SELECT locale, keyword, date, position, id
    FROM snapshots INDEXED BY ix_snapshots_matrix
   WHERE app = ? AND error IS NULL
   ORDER BY locale, keyword, date`;

const shiftDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

function summarize(database: Database.Database, appId: string): Map<string, PairSummary> {
  database.exec(MATRIX_INDEX_SQL);
  const out = new Map<string, PairSummary>();
  const cutoffs = new Map<string, string>();
  let pairKey = '';
  let dates: string[] = [];
  let positions: number[] = [];
  let ids: number[] = [];
  const flush = () => {
    const n = dates.length;
    if (!n) return;
    const last = dates[n - 1];
    let cutoff = cutoffs.get(last);
    if (!cutoff) { cutoff = shiftDays(last, -7); cutoffs.set(last, cutoff); }
    let prev7: number | null = null;
    for (let i = n - 2; i >= 0; i--) if (dates[i] <= cutoff) { prev7 = positions[i]; break; }
    // Spellings differing only in case sort apart; keep the pair's newest facts.
    const existing = out.get(pairKey);
    if (existing && existing.date > last) return;
    out.set(pairKey, { date: last, pos: positions[n - 1], prev1: n > 1 ? positions[n - 2] : null, prev7 });
  };
  const rows = database.prepare(MATRIX_SQL).raw().iterate(appId) as IterableIterator<[string, string, string, number | null, number]>;
  let rawLocale = '';
  let rawKeyword = '';
  for (const [locale, keyword, date, position, id] of rows) {
    // Rows arrive grouped by pair; build the normalized key only when the pair changes.
    if (keyword !== rawKeyword || locale !== rawLocale) {
      rawLocale = locale; rawKeyword = keyword;
      const key = `${locale.toLowerCase()}\u0000${keyword.toLocaleLowerCase()}`;
      if (key !== pairKey) { flush(); pairKey = key; dates = []; positions = []; ids = []; }
    }
    const pos = position != null && position > 0 ? position : 0;
    const n = dates.length;
    if (n && dates[n - 1] === date) {
      if (id > ids[n - 1]) { positions[n - 1] = pos; ids[n - 1] = id; }
    } else {
      dates.push(date); positions.push(pos); ids.push(id);
    }
  }
  flush();
  return out;
}

// Per-app summary cache. The version is cheap to read (MAX(id) is a rowid seek,
// COUNT(*) walks the smallest index) and changes on every insert and delete, so a
// running snapshot invalidates it and an idle tracker serves the matrix from memory.
const caches = new WeakMap<Database.Database, Map<string, { version: string; summary: Map<string, PairSummary> }>>();

function summaryFor(database: Database.Database, appId: string): { summary: Map<string, PairSummary>; cached: boolean } {
  const { v } = database.prepare(`SELECT ifnull(MAX(id), 0) || ':' || COUNT(*) AS v FROM snapshots`).get() as { v: string };
  let cache = caches.get(database);
  if (!cache) { cache = new Map(); caches.set(database, cache); }
  const hit = cache.get(appId);
  if (hit && hit.version === v) return { summary: hit.summary, cached: true };
  const summary = summarize(database, appId);
  cache.set(appId, { version: v, summary });
  return { summary, cached: false };
}

export function clearMatrixCache(database: Database.Database) {
  caches.delete(database);
}

export function computeMatrix(
  database: Database.Database,
  appId: string,
  keywordMap: Record<string, string[]>,
  requested?: string[],
): MatrixResponse {
  const started = performance.now();
  const listFor = (locale: string) => keywordMap[locale] ?? keywordMap[locale.toUpperCase()] ?? [];
  const available = Object.keys(keywordMap).map((code) => code.toLowerCase());
  const locales = requested?.length
    ? [...new Set(requested.map((code) => code.trim().toLowerCase()))].filter((code) => available.includes(code))
    : [...available].sort();

  // Union of tracked keywords across the selected storefronts, case-insensitive,
  // first spelling wins; sorted for a stable index.
  const spelling = new Map<string, string>();
  for (const locale of locales) {
    for (const keyword of listFor(locale)) {
      const key = keyword.trim().toLocaleLowerCase();
      if (key && !spelling.has(key)) spelling.set(key, keyword.trim());
    }
  }
  const keys = [...spelling.keys()].sort((a, b) => a.localeCompare(b));
  const keywordIndex = new Map(keys.map((key, index) => [key, index]));

  const { summary, cached } = locales.length ? summaryFor(database, appId) : { summary: new Map<string, PairSummary>(), cached: false };

  const dates: string[] = [];
  const dateIndex = new Map<string, number>();
  const cells: Record<string, MatrixCell[]> = {};
  const stats: Record<string, MatrixLocaleStats> = {};
  let latestDate: string | null = null;

  for (const locale of locales) {
    const list: MatrixCell[] = [];
    let ranked = 0, top10 = 0, sum = 0;
    const seen = new Set<number>();
    for (const keyword of listFor(locale)) {
      const key = keyword.trim().toLocaleLowerCase();
      const index = keywordIndex.get(key);
      if (index == null || seen.has(index)) continue;
      seen.add(index);
      const pair = summary.get(`${locale}\u0000${key}`);
      if (!pair) { list.push([index, null, null, null, -1]); continue; }
      let di = dateIndex.get(pair.date);
      if (di == null) { di = dates.length; dates.push(pair.date); dateIndex.set(pair.date, di); }
      if (!latestDate || pair.date > latestDate) latestDate = pair.date;
      if (pair.pos > 0) { ranked++; sum += pair.pos; if (pair.pos <= 10) top10++; }
      list.push([index, pair.pos, pair.prev1, pair.prev7, di]);
    }
    list.sort((a, b) => a[0] - b[0]);
    cells[locale] = list;
    stats[locale] = { tracked: list.length, ranked, top10, avg: ranked ? +(sum / ranked).toFixed(1) : null };
  }

  return {
    app: appId,
    locales,
    keywords: keys.map((key) => spelling.get(key)!),
    dates,
    cells,
    stats,
    latestDate,
    ms: +(performance.now() - started).toFixed(1),
    cached,
  };
}
