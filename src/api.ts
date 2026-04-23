// Thin fetch wrapper for our Express API.
// Vite dev server proxies /api/* to http://localhost:5174.

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

export interface LocaleAvg {
  code: string;
  avg: number | null;
}

const j = async <T>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
};

export interface RankingRow {
  locale: string;
  keyword: string;
  today: number | null;
  yesterday: number | null;
  w1: number | null;
  w4: number | null;
  top5: Array<{ name: string; id: string; dev: string; tid?: number; pos?: number }>;
  trend: number[];
}

export interface CompetitorSummary {
  bundleId: string;
  name: string;
  dev: string;
  appearances: number;
  localesCount: number;
  avgRank: number;
}

export interface CompetitorKeywordRow {
  locale: string;
  keyword: string;
  theirRank: number;
  yourRank: number | null;
}

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

export interface PricingProduct {
  name: string;
  subtitle?: string;
  price: string;
  duration?: string;
  kind: 'subscription' | 'iap';
}

export interface PricingInfo {
  iTunesId: string;
  country: string;
  subscriptions: PricingProduct[];
  iap: PricingProduct[];
  fetchedAt: number;
}

export interface Review {
  id: string;
  rating: number;
  title: string;
  content: string;
  author: string;
  version?: string;
  date?: string;
}

export interface ReviewsPayload {
  iTunesId: string;
  country: string;
  totalCount: number;
  avgRating: number | null;
  reviews: Review[];
  fetchedAt: number;
}

export interface RelevanceRow {
  locale: string;
  keyword: string;
  ourPosition: number | null;
  ourGenre: string;
  top5: Array<{ name: string; bundleId?: string; id?: string; dev: string; genre?: string }>;
  genreHistogram: Array<{ genre: string; count: number }>;
  matchCount: number;
  relevance: number;
  flag: 'match' | 'ambiguous' | 'mismatch' | 'unknown';
}

export const api = {
  apps: () => fetch('/api/apps').then((r) => j<AppStats[]>(r)),
  appLocales: (id: string) =>
    fetch(`/api/apps/${id}/locales`).then((r) => j<LocaleAvg[]>(r)),
  rankings: (id: string, locale?: string) =>
    fetch(`/api/apps/${id}/rankings${locale ? `?locale=${locale}` : ''}`).then((r) => j<RankingRow[]>(r)),
  competitors: (id: string) =>
    fetch(`/api/apps/${id}/competitors`).then((r) => j<CompetitorSummary[]>(r)),
  competitorInfo: (bundleId: string) =>
    fetch(`/api/competitors/info?bundleId=${encodeURIComponent(bundleId)}`).then((r) => j<CompetitorInfo>(r)),
  competitorKeywords: (appId: string, bundleId: string) =>
    fetch(`/api/competitors/keywords?app=${appId}&bundleId=${encodeURIComponent(bundleId)}`).then((r) => j<CompetitorKeywordRow[]>(r)),
  competitorPricing: (iTunesId: string, country = 'us') =>
    fetch(`/api/competitors/pricing?id=${iTunesId}&country=${country}`).then((r) => j<PricingInfo>(r)),
  competitorReviews: (iTunesId: string, country = 'us') =>
    fetch(`/api/competitors/reviews?id=${iTunesId}&country=${country}`).then((r) => j<ReviewsPayload>(r)),
  keywordRelevance: (appId: string, locale?: string) =>
    fetch(`/api/apps/${appId}/keyword-relevance${locale ? `?locale=${locale}` : ''}`).then((r) => j<RelevanceRow[]>(r)),
  refreshKeyword: (appId: string, locale: string, keyword: string) =>
    fetch(`/api/apps/${appId}/refresh-keyword`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale, keyword }),
    }).then((r) => j<{ ok: true; position: number | null; top5: Array<{ name: string; id: string; dev: string; tid?: number; pos?: number }> }>(r)),
  claudePrompt: (appId: string, keyword: string, locale: string) =>
    fetch(`/api/apps/${appId}/claude-prompt?keyword=${encodeURIComponent(keyword)}&locale=${locale}`).then((r) => j<{ prompt: string }>(r)),
  addApp: (app: Partial<AppStats>) =>
    fetch('/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(app),
    }).then((r) => j(r)),
  deleteApp: (id: string) =>
    fetch(`/api/apps/${id}`, { method: 'DELETE' }).then((r) => j(r)),
  keywords: (id: string) =>
    fetch(`/api/apps/${id}/keywords`).then((r) => j<Record<string, string[]>>(r)),
  saveKeywords: (id: string, keywords: Record<string, string[]>) =>
    fetch(`/api/apps/${id}/keywords`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(keywords),
    }).then((r) => j(r)),
  itunesLookup: (iTunesId: string, country = 'us') =>
    fetch(`/api/itunes/lookup?id=${iTunesId}&country=${country}`).then((r) => j(r)),
  itunesSearch: (term: string, country = 'us') =>
    fetch(`/api/itunes/search?term=${encodeURIComponent(term)}&country=${country}`).then((r) => j<Array<{
      trackId: number;
      trackName?: string;
      bundleId?: string;
      artistName?: string;
      primaryGenreName?: string;
      artworkUrl100?: string;
      averageUserRating?: number;
      trackViewUrl?: string;
    }>>(r)),
};

export interface SnapshotEvent {
  type: 'start' | 'locale' | 'keyword' | 'done' | 'abort';
  total?: number;
  completed?: number;
  locale?: string;
  keyword?: string;
  position?: number | null;
  error?: string;
  reason?: string;
}

export type SnapshotSpeed = 'fast' | 'medium' | 'slow';

export const SPEED_PRESETS: Record<SnapshotSpeed, { workers: number; sleepMs: number; label: string; note: string }> = {
  fast:   { workers: 4, sleepMs: 200, label: 'Fast',   note: 'Aggressive — risk of rate limit' },
  medium: { workers: 2, sleepMs: 500, label: 'Medium', note: 'Balanced — default' },
  slow:   { workers: 1, sleepMs: 1000, label: 'Slow',  note: 'Safe — never rate-limits' },
};

export async function runSnapshot(
  opts: { appIds?: string[]; locales?: string[]; speed?: SnapshotSpeed; skipExisting?: boolean },
  onEvent: (e: SnapshotEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    const preset = SPEED_PRESETS[opts.speed ?? 'medium'];
    res = await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appIds: opts.appIds,
        locales: opts.locales,
        workers: preset.workers,
        sleepMs: preset.sleepMs,
        skipExisting: !!opts.skipExisting,
      }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      onEvent({ type: 'abort', reason: 'Cancelled by user' });
      return;
    }
    onEvent({ type: 'abort', reason: `Network error: ${(e as Error).message}` });
    return;
  }
  if (!res.ok) {
    onEvent({ type: 'abort', reason: `Server ${res.status} ${res.statusText}` });
    return;
  }
  if (!res.body) {
    onEvent({ type: 'abort', reason: 'No stream body' });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let gotFinal = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const chunk of parts) {
        const line = chunk.trim();
        if (!line.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim()) as SnapshotEvent;
          if (ev.type === 'done' || ev.type === 'abort') gotFinal = true;
          onEvent(ev);
        } catch {
          // ignore bad frame
        }
      }
    }
    // Stream closed normally. If we never got a done/abort — inject one so UI shows a clear state.
    if (!gotFinal) {
      onEvent({ type: 'abort', reason: 'Connection closed unexpectedly (server may have restarted). Use Resume to continue.' });
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      onEvent({ type: 'abort', reason: 'Cancelled by user' });
      return;
    }
    onEvent({ type: 'abort', reason: `Stream error: ${(e as Error).message}` });
  }
}
