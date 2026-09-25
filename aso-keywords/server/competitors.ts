import { db } from './db.js';
import { loadApps } from './config.js';
import { isMedScanCompetitorEvidence } from './medical-intent.js';
import { appleJson } from './itunes.js';

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
  screenshotUrls?: string[];
  version?: string;
  releaseDate?: string;
  currentVersionReleaseDate?: string;
  languages?: string[];
  formattedPrice?: string;
  sellerName?: string;
}

export interface CompetitorSummary {
  bundleId: string;
  name: string;
  dev: string;
  appearances: number;
  localesCount: number;
  avgRank: number;
  top1Count: number;
  top3Count: number;
  bestRank: number;
  lastSeen: string | null;
}

export interface CompetitorRankPoint {
  date: string;
  rank: number | null;
}

export interface CompetitorKeywordRow {
  locale: string;
  keyword: string;
  theirRank: number;
  yourRank: number | null;
  previousRank: number | null;
  snapshotDate: string;
  history: CompetitorRankPoint[];
}

type SearchResult = {
  name?: string;
  id?: string;
  dev?: string;
  pos?: number;
};

type Snapshot = {
  locale: string;
  keyword: string;
  date: string;
  position: number | null;
  top5_json: string;
};

function parseResults(raw: string): SearchResult[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as SearchResult[] : [];
  } catch {
    return [];
  }
}

function resultRank(result: SearchResult, index: number): number {
  return typeof result.pos === 'number' && result.pos > 0 ? result.pos : index + 1;
}

/** Latest successfully stored row for every independent storefront/query pair. */
function latestKeywordRows(appId: string): Snapshot[] {
  return db.prepare(`
    WITH latest_date AS (
      SELECT locale, keyword, MAX(date) AS date
        FROM snapshots
       WHERE app = ? AND top5_json IS NOT NULL
    GROUP BY locale, keyword
    ), latest_id AS (
      SELECT s.locale, s.keyword, MAX(s.id) AS id
        FROM snapshots s
        JOIN latest_date d
          ON d.locale = s.locale
         AND d.keyword = s.keyword
         AND d.date = s.date
       WHERE s.app = ? AND s.top5_json IS NOT NULL
    GROUP BY s.locale, s.keyword
    )
    SELECT s.locale, s.keyword, s.date, s.position, s.top5_json
      FROM snapshots s
      JOIN latest_id l ON l.id = s.id
  `).all(appId, appId) as Snapshot[];
}

/**
 * Competitors visible in the newest available snapshot of each tracked
 * storefront/query pair. This is observed organic search, not private installs.
 */
export function topCompetitors(appId: string, limit = 20): CompetitorSummary[] {
  const rows = latestKeywordRows(appId);
  if (rows.length === 0) return [];

  interface Agg {
    bundleId: string;
    name: string;
    dev: string;
    appearances: number;
    locales: Set<string>;
    rankSum: number;
    top1Count: number;
    top3Count: number;
    bestRank: number;
    lastSeen: string | null;
  }

  const aggregate = new Map<string, Agg>();
  const ownBundles = new Set(loadApps().map((app) => app.bundle.toLowerCase()));

  for (const row of rows) {
    parseResults(row.top5_json).forEach((competitor, index) => {
      if (!competitor.id || ownBundles.has(competitor.id.toLowerCase())) return;
      if (!isMedScanCompetitorEvidence(row.keyword, competitor.name || '', competitor.dev || '')) return;
      const rank = resultRank(competitor, index);
      const current = aggregate.get(competitor.id) ?? {
        bundleId: competitor.id,
        name: competitor.name || competitor.id,
        dev: competitor.dev || '',
        appearances: 0,
        locales: new Set<string>(),
        rankSum: 0,
        top1Count: 0,
        top3Count: 0,
        bestRank: rank,
        lastSeen: null,
      };
      current.appearances += 1;
      current.locales.add(row.locale);
      current.rankSum += rank;
      current.top1Count += rank === 1 ? 1 : 0;
      current.top3Count += rank <= 3 ? 1 : 0;
      current.bestRank = Math.min(current.bestRank, rank);
      current.lastSeen = !current.lastSeen || row.date > current.lastSeen ? row.date : current.lastSeen;
      if (competitor.name) current.name = competitor.name;
      if (competitor.dev) current.dev = competitor.dev;
      aggregate.set(competitor.id, current);
    });
  }

  const result = Array.from(aggregate.values()).map((item) => ({
    bundleId: item.bundleId,
    name: item.name,
    dev: item.dev,
    appearances: item.appearances,
    localesCount: item.locales.size,
    avgRank: +(item.rankSum / item.appearances).toFixed(2),
    top1Count: item.top1Count,
    top3Count: item.top3Count,
    bestRank: item.bestRank,
    lastSeen: item.lastSeen,
  }));

  result.sort((a, b) => b.appearances - a.appearances || a.avgRank - b.avgRank);
  return result.slice(0, Math.max(1, Math.min(limit, 200)));
}

/** Keywords where the competitor is present in the latest observed result set. */
export function competitorKeywords(appId: string, bundleId: string): CompetitorKeywordRow[] {
  const latestRows = latestKeywordRows(appId);
  if (latestRows.length === 0) return [];

  const dailyRows = db.prepare(`
    WITH daily AS (
      SELECT locale, keyword, date, MAX(id) AS id
        FROM snapshots
       WHERE app = ? AND top5_json IS NOT NULL
    GROUP BY locale, keyword, date
    )
    SELECT s.locale, s.keyword, s.date, s.top5_json
      FROM snapshots s
      JOIN daily d ON d.id = s.id
  ORDER BY s.locale, s.keyword, s.date
  `).all(appId) as Array<Pick<Snapshot, 'locale' | 'keyword' | 'date' | 'top5_json'>>;

  const historyByKey = new Map<string, CompetitorRankPoint[]>();
  for (const row of dailyRows) {
    const results = parseResults(row.top5_json);
    const index = results.findIndex((candidate) => candidate.id === bundleId);
    const rank = index < 0 ? null : resultRank(results[index], index);
    const key = `${row.locale}\u0000${row.keyword.toLocaleLowerCase()}`;
    const history = historyByKey.get(key) ?? [];
    history.push({ date: row.date, rank });
    historyByKey.set(key, history);
  }

  const result: CompetitorKeywordRow[] = [];
  for (const row of latestRows) {
    const results = parseResults(row.top5_json);
    const index = results.findIndex((candidate) => candidate.id === bundleId);
    if (index < 0) continue;
    const competitor = results[index];
    if (!isMedScanCompetitorEvidence(row.keyword, competitor.name || '', competitor.dev || '')) continue;
    const key = `${row.locale}\u0000${row.keyword.toLocaleLowerCase()}`;
    const history = (historyByKey.get(key) ?? []).slice(-12);
    result.push({
      locale: row.locale,
      keyword: row.keyword,
      theirRank: resultRank(results[index], index),
      yourRank: row.position ?? null,
      previousRank: history.length > 1 ? history[history.length - 2].rank : null,
      snapshotDate: row.date,
      history,
    });
  }

  result.sort((a, b) => a.theirRank - b.theirRank || a.locale.localeCompare(b.locale) || a.keyword.localeCompare(b.keyword));
  return result;
}

/** Public storefront metadata. Subtitle and hidden keyword field are not exposed. */
export async function competitorInfo(bundleId: string, country = 'us'): Promise<CompetitorInfo | null> {
  const storefront = /^[a-z]{2}$/i.test(country) ? country.toLowerCase() : 'us';
  const query = new URLSearchParams({ bundleId, country: storefront });
  let data: {
    results?: Array<{
      bundleId?: string;
      trackName?: string;
      trackId?: number;
      artistName?: string;
      sellerName?: string;
      primaryGenreName?: string;
      averageUserRating?: number;
      userRatingCount?: number;
      artworkUrl100?: string;
      description?: string;
      trackViewUrl?: string;
      screenshotUrls?: string[];
      ipadScreenshotUrls?: string[];
      version?: string;
      releaseDate?: string;
      currentVersionReleaseDate?: string;
      languageCodesISO2A?: string[];
      formattedPrice?: string;
    }>;
  };
  try {
    data = await appleJson(`https://itunes.apple.com/lookup?${query}`);
  } catch {
    return null;
  }
  const item = data.results?.[0];
  if (!item) return null;
  return {
    bundleId: item.bundleId || bundleId,
    name: item.trackName || '',
    dev: item.artistName || '',
    iTunesId: item.trackId ? String(item.trackId) : undefined,
    category: item.primaryGenreName,
    rating: item.averageUserRating,
    ratingCount: item.userRatingCount,
    iconUrl: item.artworkUrl100,
    description: item.description,
    storeUrl: item.trackViewUrl,
    screenshotUrls: item.screenshotUrls?.length ? item.screenshotUrls : item.ipadScreenshotUrls,
    version: item.version,
    releaseDate: item.releaseDate,
    currentVersionReleaseDate: item.currentVersionReleaseDate,
    languages: item.languageCodesISO2A,
    formattedPrice: item.formattedPrice,
    sellerName: item.sellerName,
  };
}
