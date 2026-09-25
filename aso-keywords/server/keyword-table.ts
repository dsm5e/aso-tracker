import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { KEYWORDS_FILES_DIR, ensureKeywordsHome } from './paths.js';
import { assertSafeAppId } from './config.js';

/**
 * Single-storefront positions table: rank history (Δ1д, Δ7д, 30-day trend,
 * entered/dropped), total results, tags and notes. Pure helpers + an explicit
 * Database argument (like matrix.ts) so tests run on an in-memory store.
 *
 * Position semantics follow the matrix: a number = rank, 0 = snapshot taken but
 * not in results, null = no snapshot for that day.
 */

// --- Tags and notes -------------------------------------------------------------

/** Tags are per keyword across the app (a «brand» keyword is brand everywhere);
 * notes are per keyword × storefront («+12 after the MX title change»). */
export interface KeywordTags {
  tags: Record<string, string[]>;
  notes: Record<string, Record<string, string>>;
}

export const tagKey = (keyword: string) => keyword.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const cleanTag = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 32) : '');

export function sanitizeTags(input: unknown): KeywordTags {
  const body = (input && typeof input === 'object' ? input : {}) as Partial<KeywordTags>;
  const tags: Record<string, string[]> = {};
  for (const [keyword, list] of Object.entries(body.tags && typeof body.tags === 'object' ? body.tags : {})) {
    const values = [...new Set((Array.isArray(list) ? list : []).map(cleanTag).filter(Boolean))].slice(0, 12);
    const key = tagKey(keyword);
    if (key && values.length) tags[key] = values;
  }
  const notes: Record<string, Record<string, string>> = {};
  for (const [storefront, map] of Object.entries(body.notes && typeof body.notes === 'object' ? body.notes : {})) {
    if (!/^[a-z]{2}$/.test(storefront) || !map || typeof map !== 'object') continue;
    for (const [keyword, note] of Object.entries(map)) {
      const text = typeof note === 'string' ? note.trim().slice(0, 500) : '';
      const key = tagKey(keyword);
      if (!key || !text) continue;
      (notes[storefront] ??= {})[key] = text;
    }
  }
  return { tags, notes };
}

/** Add and/or remove tags on many keywords at once. */
export function applyTagChange(current: KeywordTags, keywords: string[], add: string[], remove: string[]): KeywordTags {
  const next: KeywordTags = { tags: { ...current.tags }, notes: current.notes };
  const adding = add.map(cleanTag).filter(Boolean);
  const removing = new Set(remove.map(cleanTag).filter(Boolean).map((tag) => tag.toLocaleLowerCase()));
  for (const keyword of keywords) {
    const key = tagKey(keyword);
    if (!key) continue;
    const merged = [...(next.tags[key] ?? []).filter((tag) => !removing.has(tag.toLocaleLowerCase()))];
    for (const tag of adding) if (!merged.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) merged.push(tag);
    if (merged.length) next.tags[key] = merged.slice(0, 12); else delete next.tags[key];
  }
  return next;
}

export function setNote(current: KeywordTags, storefront: string, keyword: string, note: string): KeywordTags {
  const key = tagKey(keyword);
  const notes = { ...current.notes, [storefront]: { ...(current.notes[storefront] ?? {}) } };
  const text = note.trim().slice(0, 500);
  if (text) notes[storefront][key] = text; else delete notes[storefront][key];
  if (!Object.keys(notes[storefront]).length) delete notes[storefront];
  return { tags: current.tags, notes };
}

/** Every tag in use, most used first — the palette of the «Тег…» action. */
export function tagPalette(tags: KeywordTags): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const list of Object.values(tags.tags)) {
    for (const tag of list) {
      const key = tag.toLocaleLowerCase();
      const entry = counts.get(key) ?? { tag, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** files/<app>.tags.json, next to the keyword list (app ids never contain dots). */
function tagsPath(appId: string) {
  assertSafeAppId(appId);
  return join(KEYWORDS_FILES_DIR, `${appId}.tags.json`);
}

export function loadTags(appId: string): KeywordTags {
  const path = tagsPath(appId);
  if (!existsSync(path)) return { tags: {}, notes: {} };
  try {
    return sanitizeTags(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { tags: {}, notes: {} };
  }
}

export function saveTags(appId: string, tags: KeywordTags) {
  ensureKeywordsHome();
  const path = tagsPath(appId);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(sanitizeTags(tags), null, 2));
  renameSync(tmp, path);
}

// --- Bulk keyword × storefront edits --------------------------------------------

export interface KeywordPair { keyword: string; storefront: string }

/** Add / remove keyword × storefront pairs; case-insensitive, first spelling kept. */
export function applyPairs(map: Record<string, string[]>, add: KeywordPair[], remove: KeywordPair[]): { map: Record<string, string[]>; added: number; removed: number; existing: number } {
  const next: Record<string, string[]> = Object.fromEntries(Object.entries(map).map(([code, list]) => [code, [...list]]));
  let added = 0, removed = 0, existing = 0;
  for (const pair of remove) {
    const list = next[pair.storefront];
    if (!list) continue;
    const key = tagKey(pair.keyword);
    const kept = list.filter((keyword) => tagKey(keyword) !== key);
    removed += list.length - kept.length;
    next[pair.storefront] = kept;
  }
  for (const pair of add) {
    const keyword = pair.keyword.trim().replace(/\s+/g, ' ');
    if (!keyword || !/^[a-z]{2}$/.test(pair.storefront)) continue;
    const list = (next[pair.storefront] ??= []);
    if (list.some((item) => tagKey(item) === tagKey(keyword))) { existing++; continue; }
    list.push(keyword);
    added++;
  }
  return { map: next, added, removed, existing };
}

// --- Rank history ---------------------------------------------------------------

export interface KeywordHistory {
  keyword: string;
  /** Latest snapshot rank: number, 0 = not in results, null = never checked. */
  current: number | null;
  latestDate: string | null;
  /** Rank on the latest snapshot ≥1 / ≥7 days before the latest one. */
  prev1: number | null;
  prev7: number | null;
  /** Ranked now, out of results (0) ≥7 days ago — or the reverse. */
  entered7: boolean;
  dropped7: boolean;
  /** Total App Store results on the latest snapshot. */
  total: number | null;
  /** One value per calendar day for the last 30 days ending at the storefront's latest date. */
  trend: Array<number | null>;
}

const DAY = 86_400_000;
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export function keywordHistory(database: Database.Database, appId: string, storefront: string, keywords: string[]): { latestDate: string | null; trendDates: string[]; rows: Map<string, KeywordHistory> } {
  const latest = (database.prepare('SELECT MAX(date) AS d FROM snapshots WHERE app = ? AND locale = ?').get(appId, storefront) as { d: string | null }).d;
  const rows = new Map<string, KeywordHistory>();
  const trendDates = latest ? Array.from({ length: 30 }, (_, index) => shiftDate(latest, index - 29)) : [];
  const since = latest ? shiftDate(latest, -45) : '0000-00-00';
  // Latest row per keyword per day (a day can be re-checked), last 45 days.
  const snapshots = database.prepare(`
    SELECT s.keyword, s.date, s.position, s.total
      FROM snapshots s
      JOIN (SELECT keyword, date, MAX(id) AS id FROM snapshots
             WHERE app = ? AND locale = ? AND date >= ? AND error IS NULL
          GROUP BY keyword, date) d ON d.id = s.id
     ORDER BY s.date DESC
  `).all(appId, storefront, since) as Array<{ keyword: string; date: string; position: number | null; total: number | null }>;
  const byKeyword = new Map<string, Array<{ date: string; position: number; total: number | null }>>();
  for (const row of snapshots) {
    const key = tagKey(row.keyword);
    const list = byKeyword.get(key) ?? [];
    list.push({ date: row.date, position: row.position ?? 0, total: row.total });
    byKeyword.set(key, list);
  }
  for (const keyword of keywords) {
    const history = byKeyword.get(tagKey(keyword)) ?? []; // newest first
    const head = history[0];
    const at = (days: number) => (head ? history.find((row) => row.date <= shiftDate(head.date, -days))?.position ?? null : null);
    const prev1 = at(1);
    const prev7 = at(7);
    const current = head ? head.position : null;
    const byDate = new Map(history.map((row) => [row.date, row.position]));
    rows.set(tagKey(keyword), {
      keyword,
      current,
      latestDate: head?.date ?? null,
      prev1,
      prev7,
      entered7: current != null && current > 0 && prev7 === 0,
      dropped7: current === 0 && prev7 != null && prev7 > 0,
      total: head?.total ?? null,
      trend: trendDates.map((date) => byDate.get(date) ?? null),
    });
  }
  return { latestDate: latest, trendDates, rows };
}
