// Client for the Keywords product's API (tracked apps, rankings, iTunes lookups).
// Ads' own /api points at the Apple Ads server, so the keywords server is reached
// through an explicit prefix: /keywords-api/* → :5174/api/*. Both the umbrella
// proxy (:5173) and Ads' standalone dev server (:5193) route this prefix.
const KEYWORDS_API = "/keywords-api";

export interface RankingRow {
  locale: string;
  keyword: string;
  today: number | null;
  yesterday: number | null;
  w1: number | null;
  w4: number | null;
  top5: Array<{ name: string; id: string; dev: string; tid?: number; pos?: number }>;
  trend: number[];
  lastUpdated: number | null;
}

/** Subset of the keywords app record the moved screens need. */
export interface KeywordsApp {
  id: string;
  name: string;
  bundle: string;
  iTunesId: string;
  iconUrl?: string;
  locales: string[];
}

export interface ItunesSearchResult {
  trackId: number;
  trackName?: string;
  bundleId?: string;
  artistName?: string;
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

export function keywordsApiUrl(path: string): string {
  return `${KEYWORDS_API}${path}`;
}

export const keywordsApi = {
  apps: () => fetch(keywordsApiUrl("/apps")).then((r) => json<KeywordsApp[]>(r)),
  keywords: (appId: string) =>
    fetch(keywordsApiUrl(`/apps/${encodeURIComponent(appId)}/keywords`)).then((r) => json<Record<string, string[]>>(r)),
  rankings: (appId: string, locale?: string, signal?: AbortSignal) =>
    fetch(keywordsApiUrl(`/apps/${encodeURIComponent(appId)}/rankings${locale ? `?locale=${encodeURIComponent(locale)}` : ""}`), { cache: "no-store", signal })
      .then((r) => json<RankingRow[]>(r)),
  artworks: (ids: number[], bundles: string[], country = "us") =>
    ids.length === 0 && bundles.length === 0
      ? Promise.resolve({} as Record<string, string>)
      : fetch(keywordsApiUrl("/itunes/artworks"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, bundles, country }),
        }).then((r) => json<Record<string, string>>(r)),
  itunesSearch: (term: string, country = "us", signal?: AbortSignal) =>
    fetch(keywordsApiUrl(`/itunes/search?term=${encodeURIComponent(term)}&country=${country}`), { signal })
      .then((r) => json<ItunesSearchResult[]>(r)),
};
