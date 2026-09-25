import { db } from './db.js';
import { loadApps } from './config.js';

export type Period = 'day' | 'week' | 'month';

const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };

export interface Move {
  app: string;
  appName: string;
  locale: string;
  keyword: string;
  from: number | null;
  to: number | null;
  delta: number;
}

export interface MoversSummary {
  totalRanked: number;
  prevRanked: number;
  rankedDelta: number | null;
  top10: number;
  prevTop10: number;
  top10Delta: number | null;
  top50: number;
  prevTop50: number;
  top50Delta: number | null;
  avgPosition: number | null;
  prevAvgPosition: number | null;
  avgDelta: number | null;
  combos: number;
  /** Combos that have a snapshot at or before the period start — the only ones deltas are computed on. */
  baselineCombos: number;
  /** Latest snapshot date used as the baseline (≤ anchor − period), null when none. */
  baseDate: string | null;
  /** Current counts over the baseline combos only — what the deltas compare against `prev*`. */
  onBase: { ranked: number; top10: number; top50: number };
}

export interface MoversResponse {
  period: Period;
  days: number;
  scope: { appId?: string; locale?: string };
  summary: MoversSummary;
  perApp: Array<{ id: string; name: string } & MoversSummary>;
  gainers: Move[];
  losers: Move[];
  newlyRanked: Move[];
  dropouts: Move[];
}

interface RawRow {
  app: string;
  locale: string;
  keyword: string;
  to: number | null;
  from: number | null;
  /** 1 when a baseline snapshot exists (its position may still be null = not ranked). */
  hasPast: number;
  pastDate: string | null;
}

/**
 * Pull every (app, locale, keyword) combo that has at least one snapshot,
 * with both the latest position and the latest position as of N days ago.
 * Self-joins with two CTEs to keep this single-query.
 */
function fetchMatrix(appId: string | undefined, locale: string | undefined, days: number): RawRow[] {
  const params: Array<string | number> = [];
  let where = '1=1';
  if (appId) { where += ' AND app = ?'; params.push(appId); }
  if (locale) { where += ' AND locale = ?'; params.push(locale); }

  // ANCHOR = today's date in app data — we use MAX(date) globally to handle weekends/no-snapshot gaps
  const sql = `
    WITH anchor AS (
      SELECT MAX(date) AS today FROM snapshots WHERE ${where}
    ),
    latest AS (
      SELECT s.app, s.locale, s.keyword, s.position
      FROM snapshots s
      JOIN (
        SELECT app, locale, keyword, MAX(id) AS mid
        FROM snapshots
        WHERE ${where}
        GROUP BY app, locale, keyword
      ) lx ON s.id = lx.mid
    ),
    past AS (
      SELECT s.app, s.locale, s.keyword, s.position, s.date
      FROM snapshots s
      JOIN (
        SELECT app, locale, keyword, MAX(id) AS mid
        FROM snapshots
        WHERE ${where} AND date <= date((SELECT today FROM anchor), '-' || ? || ' days')
        GROUP BY app, locale, keyword
      ) lx ON s.id = lx.mid
    )
    SELECT
      l.app, l.locale, l.keyword,
      l.position AS "to",
      p.position AS "from",
      CASE WHEN p.date IS NULL THEN 0 ELSE 1 END AS "hasPast",
      p.date AS "pastDate"
    FROM latest l
    LEFT JOIN past p USING (app, locale, keyword)
  `;
  // The same WHERE filter values are bound 3× (anchor / latest / past).
  const fullParams = [...params, ...params, ...params, days];
  return db.prepare(sql).all(...fullParams) as RawRow[];
}

function summarize(rows: RawRow[]): MoversSummary {
  const count = (list: RawRow[], pick: (r: RawRow) => number | null) => {
    let ranked = 0, top10 = 0, top50 = 0, sum = 0;
    for (const r of list) {
      const v = pick(r);
      if (!v || v <= 0) continue;
      ranked++; sum += v;
      if (v <= 10) top10++;
      if (v <= 50) top50++;
    }
    return { ranked, top10, top50, avg: ranked ? +(sum / ranked).toFixed(1) : null };
  };
  // Headline = the current state of every combo. Deltas compare like with like:
  // only combos that already had a snapshot at the period start — otherwise a
  // keyword first tracked this week would count as «+1 in the top-10».
  const now = count(rows, (r) => r.to);
  const based = rows.filter((r) => r.hasPast);
  const nowOnBase = count(based, (r) => r.to);
  const prev = count(based, (r) => r.from);
  const hasBase = based.length > 0;
  const baseDate = based.reduce<string | null>((max, r) => (r.pastDate && (!max || r.pastDate > max) ? r.pastDate : max), null);
  return {
    totalRanked: now.ranked,
    prevRanked: prev.ranked,
    rankedDelta: hasBase ? nowOnBase.ranked - prev.ranked : null,
    top10: now.top10,
    prevTop10: prev.top10,
    top10Delta: hasBase ? nowOnBase.top10 - prev.top10 : null,
    top50: now.top50,
    prevTop50: prev.top50,
    top50Delta: hasBase ? nowOnBase.top50 - prev.top50 : null,
    avgPosition: now.avg,
    prevAvgPosition: prev.avg,
    // Lower is better; positive = improvement. Same combo set on both sides.
    avgDelta: nowOnBase.avg != null && prev.avg != null ? +(prev.avg - nowOnBase.avg).toFixed(1) : null,
    combos: rows.length,
    baselineCombos: based.length,
    baseDate,
    onBase: { ranked: nowOnBase.ranked, top10: nowOnBase.top10, top50: nowOnBase.top50 },
  };
}

export function getMovers(opts: { appId?: string; locale?: string; period: Period; limit?: number }): MoversResponse {
  const days = PERIOD_DAYS[opts.period];
  const limit = opts.limit ?? 15;
  const rows = fetchMatrix(opts.appId, opts.locale, days);

  const apps = loadApps();
  const nameById = new Map(apps.map((a) => [a.id, a.name] as const));

  // Compute deltas. Treat unranked as position 999 for math, but track separately.
  const moves: Move[] = rows.map((r) => {
    const toRank = r.to && r.to > 0 ? r.to : null;
    const fromRank = r.from && r.from > 0 ? r.from : null;
    const fromVal = fromRank ?? 999;
    const toVal = toRank ?? 999;
    return {
      app: r.app,
      appName: nameById.get(r.app) ?? r.app,
      locale: r.locale,
      keyword: r.keyword,
      from: fromRank,
      to: toRank,
      delta: fromVal - toVal, // positive = improvement
    };
  });

  // Gainers/losers: both endpoints must be ranked (real movement, not "first ever rank").
  const realMoves = moves.filter((m) => m.from != null && m.to != null && m.delta !== 0);
  const gainers = realMoves
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, limit);
  const losers = realMoves
    .filter((m) => m.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, limit);

  // Newly ranked: didn't rank before, now ranks
  const hasPast = new Set(rows.filter((r) => r.hasPast).map((r) => `${r.app}|${r.locale}|${r.keyword}`));
  const newlyRanked = moves
    .filter((m) => m.from == null && m.to != null && hasPast.has(`${m.app}|${m.locale}|${m.keyword}`))
    .sort((a, b) => (a.to ?? 999) - (b.to ?? 999))
    .slice(0, limit);

  // Dropouts: ranked before, doesn't rank now
  const dropouts = moves
    .filter((m) => m.from != null && m.to == null)
    .sort((a, b) => (a.from ?? 999) - (b.from ?? 999))
    .slice(0, limit);

  // Per-app breakdown
  const byApp = new Map<string, RawRow[]>();
  for (const r of rows) {
    if (!byApp.has(r.app)) byApp.set(r.app, []);
    byApp.get(r.app)!.push(r);
  }
  const perApp = Array.from(byApp.entries())
    .map(([id, arr]) => ({
      id,
      name: nameById.get(id) ?? id,
      ...summarize(arr),
    }))
    .sort((a, b) => b.combos - a.combos);

  return {
    period: opts.period,
    days,
    scope: { appId: opts.appId, locale: opts.locale },
    summary: summarize(rows),
    perApp,
    gainers,
    losers,
    newlyRanked,
    dropouts,
  };
}
