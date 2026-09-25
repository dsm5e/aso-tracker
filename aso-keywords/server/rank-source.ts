// Rank source settings and the App Store vs iTunes dual measurement.
//
// - `snapshot-settings.json` (next to apps.json): `{ rankSource }`, default 'appstore'.
// - `rank-source-probe.json` (next to apps.json): a fixed set of 20
//   (app, locale, keyword) pairs that every snapshot measures with BOTH sources
//   for 14 days, stored in `rank_source_probes`, compared by
//   GET /api/rank-source/compare.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.js';
import { loadApps, loadKeywords } from './config.js';
import { KEYWORDS_HOME, ensureKeywordsHome } from './paths.js';
import { positionFromRank, searchRanked, type RankSource } from './itunes.js';
import type { GatePriority } from './host-gate.js';

export type { RankSource };

const SETTINGS_PATH = join(KEYWORDS_HOME, 'snapshot-settings.json');
export const PROBE_PATH = join(KEYWORDS_HOME, 'rank-source-probe.json');
const PROBE_DAYS = 14;

export interface SnapshotSettings {
  rankSource: RankSource;
}

export function isRankSource(v: unknown): v is RankSource {
  return v === 'appstore' || v === 'itunes';
}

export function loadSnapshotSettings(): SnapshotSettings {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Partial<SnapshotSettings>;
    return { rankSource: isRankSource(raw.rankSource) ? raw.rankSource : 'appstore' };
  } catch {
    return { rankSource: 'appstore' };
  }
}

export function saveSnapshotSettings(patch: Partial<SnapshotSettings>): SnapshotSettings {
  const next = { ...loadSnapshotSettings(), ...patch };
  ensureKeywordsHome();
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}

export const otherSource = (s: RankSource): RankSource => (s === 'appstore' ? 'itunes' : 'appstore');

// --- Probe set ----------------------------------------------------------------

export interface ProbePair { app: string; locale: string; keyword: string }
export interface ProbeSet { createdAt: string; days: number; pairs: ProbePair[] }

/** Up to `n` tracked keywords, the ones we rank best for first (comparable positions). */
function pickPairs(app: string, locale: string, n: number): ProbePair[] {
  const list = (loadKeywords(app)[locale] ?? []).map((k) => k.trim()).filter(Boolean);
  const ranks = new Map<string, number>();
  const rows = db.prepare(`
    SELECT s.keyword, s.position FROM snapshots s
      JOIN (SELECT keyword, MAX(id) AS id FROM snapshots WHERE app = ? AND locale = ? AND error IS NULL GROUP BY keyword) l
        ON l.id = s.id
  `).all(app, locale) as Array<{ keyword: string; position: number | null }>;
  for (const r of rows) if (r.position != null) ranks.set(r.keyword, r.position);
  return list
    .map((keyword, i) => ({ keyword, i, rank: ranks.get(keyword) ?? 10_000 }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, n)
    .map(({ keyword }) => ({ app, locale, keyword }));
}

/** 10 US + 10 non-US pairs from MedScan (AE) and Elara (DE), created once. */
export function seedProbeSet(): ProbeSet {
  const ids = new Set(loadApps().map((a) => a.id));
  const plan: Array<[string, string, number]> = [
    ['medscan', 'us', 5], ['elara', 'us', 5],
    ['medscan', 'ae', 5], ['elara', 'de', 5],
  ];
  const pairs = plan.filter(([app]) => ids.has(app)).flatMap(([app, locale, n]) => pickPairs(app, locale, n));
  return { createdAt: new Date().toISOString().slice(0, 10), days: PROBE_DAYS, pairs };
}

export function loadProbeSet(): ProbeSet {
  if (existsSync(PROBE_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(PROBE_PATH, 'utf8')) as ProbeSet;
      if (Array.isArray(raw.pairs)) return raw;
    } catch { /* re-seed below */ }
  }
  const seeded = seedProbeSet();
  ensureKeywordsHome();
  writeFileSync(PROBE_PATH, JSON.stringify(seeded, null, 2));
  return seeded;
}

export function probeActive(set: ProbeSet, date = new Date().toISOString().slice(0, 10)): boolean {
  const start = Date.parse(`${set.createdAt}T00:00:00Z`);
  const now = Date.parse(`${date}T00:00:00Z`);
  return now >= start && now < start + set.days * 86_400_000;
}

const pairKey = (p: ProbePair) => `${p.app}|${p.locale}|${p.keyword.toLowerCase()}`;

/** Returns a matcher for probe pairs, or null when the 14-day window is over. */
export function activeProbeMatcher(): ((p: ProbePair) => boolean) | null {
  const set = loadProbeSet();
  if (!probeActive(set)) return null;
  const keys = new Set(set.pairs.map(pairKey));
  return (p) => keys.has(pairKey(p));
}

export interface ProbeRow extends ProbePair {
  date: string;
  source: RankSource;
  position: number | null;
  total: number;
  ms?: number;
  error?: string;
}

export function insertProbe(r: ProbeRow) {
  db.prepare(`
    INSERT INTO rank_source_probes (date, app, locale, keyword, source, position, total, ms, error)
    VALUES (@date, @app, @locale, @keyword, @source, @position, @total, @ms, @error)
  `).run({ ...r, ms: r.ms ?? null, error: r.error ?? null });
}

/** Measure one pair with one source and store it in rank_source_probes. */
export async function measureProbe(
  pair: ProbePair,
  source: RankSource,
  opts: { priority?: GatePriority; signal?: AbortSignal; date?: string } = {}
): Promise<ProbeRow> {
  const app = loadApps().find((a) => a.id === pair.app);
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  if (!app) throw new Error(`unknown app ${pair.app}`);
  try {
    const res = await searchRanked(source, pair.locale, pair.keyword, { priority: opts.priority ?? 'tail', signal: opts.signal });
    const { position, total } = positionFromRank(res, app);
    // A fallback answer is an iTunes measurement whatever was asked for.
    const row: ProbeRow = { ...pair, date, source: res.source, position, total, ms: res.ms };
    insertProbe(row);
    return row;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const row: ProbeRow = { ...pair, date, source, position: null, total: 0, error: (e as Error).message };
    insertProbe(row);
    return row;
  }
}

/** Record the whole probe set once with both sources (skips pairs done today). */
export async function recordProbeSet(opts: { signal?: AbortSignal } = {}) {
  const set = loadProbeSet();
  const date = new Date().toISOString().slice(0, 10);
  const done = new Set(
    (db.prepare(`SELECT app, locale, keyword, source FROM rank_source_probes WHERE date = ? AND error IS NULL`).all(date) as Array<ProbePair & { source: string }>)
      .map((r) => `${pairKey(r)}|${r.source}`)
  );
  const rows: ProbeRow[] = [];
  for (const pair of set.pairs) {
    for (const source of ['appstore', 'itunes'] as RankSource[]) {
      if (done.has(`${pairKey(pair)}|${source}`)) continue;
      rows.push(await measureProbe(pair, source, { signal: opts.signal, date }));
    }
  }
  return { measured: rows.length, rows };
}

// --- Comparison -----------------------------------------------------------------

export interface ComparePoint { date: string; appstore: number | null; itunes: number | null }
export interface CompareSummary {
  /** Day × pair observations where both sources answered. */
  observations: number;
  /** Both ranked our app at the same position (or both unranked). */
  samePositionPct: number | null;
  /** Mean |appstore − itunes| where both ranked us. */
  meanAbsDiff: number | null;
  bothRanked: number;
  onlyAppstore: number;
  onlyItunes: number;
  /** Mean (appstore − itunes); positive = the App Store puts us lower than iTunes says. */
  meanSignedDiff: number | null;
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function summarizeComparison(points: ComparePoint[]): CompareSummary {
  let same = 0, both = 0, onlyA = 0, onlyI = 0, absSum = 0, signedSum = 0;
  for (const p of points) {
    if (p.appstore === p.itunes) same++;
    if (p.appstore != null && p.itunes != null) {
      both++;
      absSum += Math.abs(p.appstore - p.itunes);
      signedSum += p.appstore - p.itunes;
    } else if (p.appstore != null) onlyA++;
    else if (p.itunes != null) onlyI++;
  }
  const n = points.length;
  return {
    observations: n,
    samePositionPct: n ? round((100 * same) / n) : null,
    meanAbsDiff: both ? round(absSum / both) : null,
    meanSignedDiff: both ? round(signedSum / both) : null,
    bothRanked: both,
    onlyAppstore: onlyA,
    onlyItunes: onlyI,
  };
}

export function compareRankSources() {
  const set = loadProbeSet();
  const rows = db.prepare(`
    SELECT p.app, p.locale, p.keyword, p.date, p.source, p.position
      FROM rank_source_probes p
      JOIN (SELECT app, locale, keyword, date, source, MAX(id) AS id FROM rank_source_probes
             WHERE error IS NULL GROUP BY app, locale, keyword, date, source) l ON l.id = p.id
     ORDER BY p.date
  `).all() as Array<ProbePair & { date: string; source: RankSource; position: number | null }>;

  const byPair = new Map<string, Map<string, { appstore?: number | null; itunes?: number | null }>>();
  for (const r of rows) {
    const k = pairKey(r);
    if (!byPair.has(k)) byPair.set(k, new Map());
    const days = byPair.get(k)!;
    if (!days.has(r.date)) days.set(r.date, {});
    days.get(r.date)![r.source] = r.position;
  }

  const all: ComparePoint[] = [];
  const pairs = set.pairs.map((pair) => {
    const days = byPair.get(pairKey(pair)) ?? new Map();
    const series: ComparePoint[] = [];
    for (const [date, v] of days) {
      const point = { date, appstore: v.appstore ?? null, itunes: v.itunes ?? null };
      series.push(point);
      if (v.appstore !== undefined && v.itunes !== undefined) all.push(point);
    }
    const complete = series.filter((p) => days.get(p.date)!.appstore !== undefined && days.get(p.date)!.itunes !== undefined);
    return { ...pair, series, summary: summarizeComparison(complete) };
  });

  return {
    probe: { createdAt: set.createdAt, days: set.days, active: probeActive(set), size: set.pairs.length, file: PROBE_PATH },
    summary: summarizeComparison(all),
    pairs,
  };
}
