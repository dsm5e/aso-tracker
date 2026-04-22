import { db } from './db.js';
import { loadApps, loadKeywords } from './config.js';

export interface AppStats {
  id: string;
  name: string;
  emoji: string;
  bundle: string;
  iTunesId: string;
  iconBg?: string;
  iconUrl?: string;
  tagline?: string;
  keywords: number;
  ranked: number;
  avgPos: number;
  top10: number;
  top50: number;
  unranked: number;
  lastSnapshot: string | null;
  locales: string[];
  weekDelta: { top10: number; top50: number; avg: number; ranked: number };
  winners: Array<{ kw: string; delta: number; from: number; to: number }>;
  losers: Array<{ kw: string; delta: number; from: number; to: number }>;
}

export function getAppsWithStats(): AppStats[] {
  const apps = loadApps();
  const out: AppStats[] = [];

  const latestDateStmt = db.prepare(
    `SELECT MAX(date) as d FROM snapshots WHERE app = ?`
  );

  for (const app of apps) {
    const kwMap = loadKeywords(app.id);
    const locales = Object.keys(kwMap).sort();
    const totalKw = Object.values(kwMap).reduce((a, b) => a + b.length, 0);

    const { d: today } = latestDateStmt.get(app.id) as { d: string | null };
    if (!today) {
      out.push({
        id: app.id,
        name: app.name,
        emoji: app.emoji,
        bundle: app.bundle,
        iTunesId: app.iTunesId,
        iconBg: app.iconBg,
        iconUrl: app.iconUrl,
        tagline: app.tagline,
        keywords: totalKw,
        ranked: 0,
        avgPos: 0,
        top10: 0,
        top50: 0,
        unranked: totalKw,
        lastSnapshot: null,
        locales,
        weekDelta: { top10: 0, top50: 0, avg: 0, ranked: 0 },
        winners: [],
        losers: [],
      });
      continue;
    }

    // Latest row per (locale, keyword) across ALL dates — so a partial/broken recent snapshot
    // doesn't zero out stats when older full snapshots exist.
    const rows = db
      .prepare(
        `SELECT s.locale, s.keyword, s.position, s.date
           FROM snapshots s
           JOIN (
             SELECT locale, keyword, MAX(id) AS max_id
               FROM snapshots
              WHERE app = ?
              GROUP BY locale, keyword
           ) lx ON s.id = lx.max_id`
      )
      .all(app.id) as Array<{ locale: string; keyword: string; position: number | null; date: string }>;

    let ranked = 0, top10 = 0, top50 = 0, unranked = 0;
    let sumPos = 0;
    for (const r of rows) {
      if (r.position && r.position > 0) {
        ranked++;
        sumPos += r.position;
        if (r.position <= 10) top10++;
        if (r.position <= 50) top50++;
      } else {
        unranked++;
      }
    }
    const avgPos = ranked ? sumPos / ranked : 0;

    // 7d-ago counts for delta
    const weekAgoDate = new Date(today);
    weekAgoDate.setDate(weekAgoDate.getDate() - 7);
    const weekAgoStr = weekAgoDate.toISOString().slice(0, 10);
    const prevRows = db
      .prepare(
        `SELECT locale, keyword, position FROM snapshots
         WHERE app = ? AND date <= ? AND date >= date(?, '-2 days')
         GROUP BY locale, keyword
         HAVING MAX(id)`
      )
      .all(app.id, weekAgoStr, weekAgoStr) as Array<{ locale: string; keyword: string; position: number | null }>;

    let prevTop10 = 0, prevTop50 = 0, prevRanked = 0, prevSum = 0;
    for (const r of prevRows) {
      if (r.position && r.position > 0) {
        prevRanked++;
        prevSum += r.position;
        if (r.position <= 10) prevTop10++;
        if (r.position <= 50) prevTop50++;
      }
    }
    const prevAvg = prevRanked ? prevSum / prevRanked : 0;

    // Winners / losers: biggest rank improvements / regressions last week
    const weekMoves = db
      .prepare(
        `SELECT locale, keyword, position FROM snapshots
         WHERE app = ? AND (date = ? OR date = ?)
         GROUP BY date, locale, keyword
         HAVING MAX(id)`
      )
      .all(app.id, today, weekAgoStr) as Array<{ locale: string; keyword: string; position: number | null; date?: string }>;

    const byKw = new Map<string, { today?: number; prev?: number }>();
    for (const r of weekMoves) {
      const key = `${r.locale}|${r.keyword}`;
      if (!byKw.has(key)) byKw.set(key, {});
      const slot = byKw.get(key)!;
      if ((r as any).date === today) slot.today = r.position ?? undefined;
      else slot.prev = r.position ?? undefined;
    }
    const movers: Array<{ kw: string; delta: number; from: number; to: number }> = [];
    for (const [key, m] of byKw) {
      if (m.today != null && m.prev != null && m.today !== m.prev) {
        const kw = key.split('|')[1];
        movers.push({ kw, delta: m.prev - m.today, from: m.prev, to: m.today });
      }
    }
    movers.sort((a, b) => b.delta - a.delta);
    const winners = movers.filter((m) => m.delta > 0).slice(0, 3);
    const losers = movers.filter((m) => m.delta < 0).reverse().slice(0, 3);

    out.push({
      id: app.id,
      name: app.name,
      emoji: app.emoji,
      bundle: app.bundle,
      iTunesId: app.iTunesId,
      iconBg: app.iconBg,
      iconUrl: app.iconUrl,
      tagline: app.tagline,
      keywords: totalKw,
      ranked,
      avgPos,
      top10,
      top50,
      unranked,
      lastSnapshot: today,
      locales,
      weekDelta: {
        top10: top10 - prevTop10,
        top50: top50 - prevTop50,
        avg: +(prevAvg - avgPos).toFixed(1),
        ranked: ranked - prevRanked,
      },
      winners,
      losers,
    });
  }

  return out;
}

export interface LocaleAvg { code: string; avg: number | null }

export interface RankingRow {
  locale: string;
  keyword: string;
  today: number | null;
  yesterday: number | null;
  w1: number | null;  // 7 days ago
  w4: number | null;  // 30 days ago
  top5: Array<{ name: string; id: string; dev: string }>;
  trend: number[];     // last 30 snapshots, position (null→0 padding)
}

export function getRankings(appId: string, localeFilter?: string): RankingRow[] {
  const { d: today } = db.prepare(`SELECT MAX(date) as d FROM snapshots WHERE app = ?`).get(appId) as { d: string | null };
  if (!today) return [];

  const params: Array<string | number> = [appId];
  let sql = `
    WITH latest AS (
      SELECT locale, keyword, MAX(id) AS maxid
      FROM snapshots
      WHERE app = ?
      GROUP BY locale, keyword, date
    )
    SELECT s.locale, s.keyword, s.date, s.position, s.top5_json
    FROM snapshots s
    JOIN latest l ON s.id = l.maxid
  `;
  if (localeFilter) {
    sql += ` WHERE s.locale = ?`;
    params.push(localeFilter);
  }
  sql += ` ORDER BY s.locale, s.keyword, s.date DESC`;
  const rows = db.prepare(sql).all(...params) as Array<{ locale: string; keyword: string; date: string; position: number | null; top5_json: string }>;

  const ya = new Date(today); ya.setDate(ya.getDate() - 1); const yaStr = ya.toISOString().slice(0,10);
  const w1 = new Date(today); w1.setDate(w1.getDate() - 7); const w1Str = w1.toISOString().slice(0,10);
  const w4 = new Date(today); w4.setDate(w4.getDate() - 30); const w4Str = w4.toISOString().slice(0,10);

  const bucket = new Map<string, {
    locale: string; keyword: string;
    today: number | null; yesterday: number | null; w1: number | null; w4: number | null;
    top5: Array<{ name: string; id: string; dev: string }>;
    trend: number[];
  }>();

  for (const r of rows) {
    const key = `${r.locale}|${r.keyword}`;
    if (!bucket.has(key)) {
      bucket.set(key, {
        locale: r.locale, keyword: r.keyword,
        today: null, yesterday: null, w1: null, w4: null,
        top5: [], trend: [],
      });
    }
    const b = bucket.get(key)!;
    if (r.date === today && b.today === null) {
      b.today = r.position;
      try { b.top5 = JSON.parse(r.top5_json); } catch { b.top5 = []; }
    }
    if (r.date <= yaStr && b.yesterday === null) b.yesterday = r.position;
    if (r.date <= w1Str && b.w1 === null) b.w1 = r.position;
    if (r.date <= w4Str && b.w4 === null) b.w4 = r.position;
    if (b.trend.length < 30) b.trend.push(r.position ?? 0);
  }

  const out = Array.from(bucket.values()).map((b) => ({
    ...b,
    trend: b.trend.reverse(),
  }));
  // Sort by today rank asc (ranked first, unranked last)
  out.sort((a, b) => (a.today ?? 999) - (b.today ?? 999));
  return out;
}

export function getLocaleStatsByApp(appId: string): LocaleAvg[] {
  const kwMap = loadKeywords(appId);
  const anyData = db.prepare(`SELECT 1 FROM snapshots WHERE app = ? LIMIT 1`).get(appId);
  if (!anyData) return Object.keys(kwMap).map((code) => ({ code: code.toUpperCase(), avg: null }));

  // Latest row per (locale, keyword) across all dates (not just latest date)
  const rows = db
    .prepare(
      `SELECT s.locale, s.position
         FROM snapshots s
         JOIN (
           SELECT locale, keyword, MAX(id) AS max_id
             FROM snapshots
            WHERE app = ?
            GROUP BY locale, keyword
         ) lx ON s.id = lx.max_id`
    )
    .all(appId) as Array<{ locale: string; position: number | null }>;

  const byLocale = new Map<string, number[]>();
  for (const r of rows) {
    const loc = r.locale.toUpperCase();
    if (!byLocale.has(loc)) byLocale.set(loc, []);
    if (r.position && r.position > 0) byLocale.get(loc)!.push(r.position);
  }
  const out: LocaleAvg[] = [];
  for (const code of Object.keys(kwMap)) {
    const arr = byLocale.get(code.toUpperCase()) || [];
    const avg = arr.length ? Math.round(arr.reduce((a, b) => a + b) / arr.length) : null;
    out.push({ code: code.toUpperCase(), avg });
  }
  return out.sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999));
}
