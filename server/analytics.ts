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
  rankedDelta: number;
  top10: number;
  prevTop10: number;
  top10Delta: number;
  top50: number;
  prevTop50: number;
  top50Delta: number;
  avgPosition: number | null;
  prevAvgPosition: number | null;
  avgDelta: number | null;
  combos: number;
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
      SELECT s.app, s.locale, s.keyword, s.position
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
      p.position AS "from"
    FROM latest l
    LEFT JOIN past p USING (app, locale, keyword)
  `;
  // The same WHERE filter values are bound 3× (anchor / latest / past).
  const fullParams = [...params, ...params, ...params, days];
  return db.prepare(sql).all(...fullParams) as RawRow[];
}

function summarize(rows: RawRow[]): MoversSummary {
  let totalRanked = 0, prevRanked = 0;
  let top10 = 0, prevTop10 = 0;
  let top50 = 0, prevTop50 = 0;
  let sumPos = 0, sumPrev = 0;
  let nPos = 0, nPrev = 0;
  for (const r of rows) {
    if (r.to && r.to > 0) {
      totalRanked++;
      if (r.to <= 10) top10++;
      if (r.to <= 50) top50++;
      sumPos += r.to; nPos++;
    }
    if (r.from && r.from > 0) {
      prevRanked++;
      if (r.from <= 10) prevTop10++;
      if (r.from <= 50) prevTop50++;
      sumPrev += r.from; nPrev++;
    }
  }
  const avgPosition = nPos ? +(sumPos / nPos).toFixed(1) : null;
  const prevAvgPosition = nPrev ? +(sumPrev / nPrev).toFixed(1) : null;
  return {
    totalRanked,
    prevRanked,
    rankedDelta: totalRanked - prevRanked,
    top10,
    prevTop10,
    top10Delta: top10 - prevTop10,
    top50,
    prevTop50,
    top50Delta: top50 - prevTop50,
    avgPosition,
    prevAvgPosition,
    // Lower is better; show as "improvement" — positive number means we got better
    avgDelta:
      avgPosition != null && prevAvgPosition != null
        ? +(prevAvgPosition - avgPosition).toFixed(1)
        : null,
    combos: rows.length,
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
  const newlyRanked = moves
    .filter((m) => m.from == null && m.to != null)
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
