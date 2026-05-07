import { db } from './db.js';
import { lookupItunes } from './itunes.js';
import { loadApps } from './config.js';

export interface CompetitorInfo {
  bundleId: string;
  name: string;
  dev: string;
  iTunesId?: string;
  category?: string;
  rating?: number;
  ratingCount?: number;
  iconUrl?: string;
  description?: string;
  storeUrl?: string;
}

export interface CompetitorSummary {
  bundleId: string;
  name: string;
  dev: string;
  appearances: number;        // how many (locale,keyword) tuples
  localesCount: number;       // distinct locales
  avgRank: number;            // avg rank in top5 across all appearances
}

export interface CompetitorKeywordRow {
  locale: string;
  keyword: string;
  theirRank: number;
  yourRank: number | null;
}

/**
 * Top competitors across all snapshots for one of our tracked apps.
 * Groups by bundleId, counts appearances in top-5, computes avg rank.
 */
export function topCompetitors(appId: string, limit = 20): CompetitorSummary[] {
  // Most recent snapshot date with data for this app
  const { d: latestDate } = db
    .prepare(`SELECT MAX(date) AS d FROM snapshots WHERE app = ?`)
    .get(appId) as { d: string | null };
  if (!latestDate) return [];

  // Pull only latest-per-(locale,keyword) rows on that date
  const rows = db
    .prepare(
      `SELECT locale, keyword, top5_json
         FROM snapshots
        WHERE app = ? AND date = ?
     GROUP BY locale, keyword
       HAVING MAX(id)`
    )
    .all(appId, latestDate) as Array<{ locale: string; keyword: string; top5_json: string }>;

  interface Agg {
    bundleId: string;
    name: string;
    dev: string;
    appearances: number;
    locales: Set<string>;
    rankSum: number;
  }
  const agg = new Map<string, Agg>();
  const ownBundles = loadApps().map((a) => a.bundle.toLowerCase());

  for (const r of rows) {
    let list: Array<{ name: string; id: string; dev: string }> = [];
    try {
      list = JSON.parse(r.top5_json);
    } catch {
      continue;
    }
    list.forEach((c, idx) => {
      if (!c.id) return;
      const key = c.id;
      const lower = key.toLowerCase();
      if (ownBundles.some((b) => lower === b || lower.startsWith(b))) return;
      const existing = agg.get(key) ?? {
        bundleId: key,
        name: c.name,
        dev: c.dev,
        appearances: 0,
        locales: new Set<string>(),
        rankSum: 0,
      };
      existing.appearances++;
      existing.locales.add(r.locale);
      existing.rankSum += idx + 1;
      if (c.name) existing.name = c.name;
      if (c.dev) existing.dev = c.dev;
      agg.set(key, existing);
    });
  }

  const out: CompetitorSummary[] = [];
  for (const v of agg.values()) {
    out.push({
      bundleId: v.bundleId,
      name: v.name,
      dev: v.dev,
      appearances: v.appearances,
      localesCount: v.locales.size,
      avgRank: +(v.rankSum / v.appearances).toFixed(2),
    });
  }

  // Primary sort by appearances DESC; tiebreak by avgRank ASC (lower rank = better).
  out.sort((a, b) => b.appearances - a.appearances || a.avgRank - b.avgRank);
  return out.slice(0, limit);
}

/**
 * All keywords where this competitor is in top-5 of our snapshots (latest per key).
 * Joined with our own rank for the same keyword/locale.
 */
export function competitorKeywords(
  appId: string,
  bundleId: string
): CompetitorKeywordRow[] {
  const { d: latestDate } = db
    .prepare(`SELECT MAX(date) AS d FROM snapshots WHERE app = ?`)
    .get(appId) as { d: string | null };
  if (!latestDate) return [];

  const rows = db
    .prepare(
      `SELECT locale, keyword, position, top5_json
         FROM snapshots
        WHERE app = ? AND date = ?
     GROUP BY locale, keyword
       HAVING MAX(id)`
    )
    .all(appId, latestDate) as Array<{
      locale: string;
      keyword: string;
      position: number | null;
      top5_json: string;
    }>;

  const out: CompetitorKeywordRow[] = [];
  for (const r of rows) {
    let list: Array<{ name: string; id: string; dev: string }> = [];
    try {
      list = JSON.parse(r.top5_json);
    } catch {
      continue;
    }
    const idx = list.findIndex((c) => c.id === bundleId);
    if (idx === -1) continue;
    out.push({
      locale: r.locale,
      keyword: r.keyword,
      theirRank: idx + 1,
      yourRank: r.position ?? null,
    });
  }

  // sort by their rank asc
  out.sort((a, b) => a.theirRank - b.theirRank);
  return out;
}

/**
 * Fetch competitor metadata from iTunes lookup. Tries bundleId first.
 */
export async function competitorInfo(bundleId: string): Promise<CompetitorInfo | null> {
  const res = await fetch(
    `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}`,
    { signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: Array<{
      bundleId?: string;
      trackName?: string;
      trackId?: number;
      artistName?: string;
      primaryGenreName?: string;
      averageUserRating?: number;
      userRatingCount?: number;
      artworkUrl100?: string;
      description?: string;
      trackViewUrl?: string;
    }>;
  };
  const r = data.results?.[0];
  if (!r) return null;
  return {
    bundleId: r.bundleId || bundleId,
    name: r.trackName || '',
    dev: r.artistName || '',
    iTunesId: r.trackId ? String(r.trackId) : undefined,
    category: r.primaryGenreName,
    rating: r.averageUserRating,
    ratingCount: r.userRatingCount,
    iconUrl: r.artworkUrl100,
    description: r.description,
    storeUrl: r.trackViewUrl,
  };
}

// Load our own bundles so we can exclude ourselves from competitor lists.
export async function loadOwnBundles(): Promise<string[]> {
  const { loadApps } = await import('./config.js');
  return loadApps().map((a) => a.bundle);
}
