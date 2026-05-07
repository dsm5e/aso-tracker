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
  setSnapshotSpeed: (sleepMs: number, workers: number) =>
    fetch('/api/snapshot/speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sleepMs, workers }),
    }).then((r) => j<{ ok: true; runtime: { sleepMs: number; workers: number } }>(r)),
  movers: (period: 'day' | 'week' | 'month', appId?: string, locale?: string) => {
    const qs = new URLSearchParams({ period });
    if (appId) qs.set('app', appId);
    if (locale) qs.set('locale', locale);
    return fetch(`/api/analytics/movers?${qs}`).then((r) => j<MoversResponse>(r));
  },
};

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

export interface Mover {
  app: string;
  appName: string;
  locale: string;
  keyword: string;
  from: number | null;
  to: number | null;
  delta: number;
}

export interface MoversResponse {
  period: 'day' | 'week' | 'month';
  days: number;
  scope: { appId?: string; locale?: string };
  summary: MoversSummary;
  perApp: Array<{ id: string; name: string } & MoversSummary>;
  gainers: Mover[];
  losers: Mover[];
  newlyRanked: Mover[];
  dropouts: Mover[];
}

export interface SnapshotEvent {
  type: 'start' | 'locale' | 'keyword' | 'done' | 'abort' | 'throttle' | 'speed';
  total?: number;
  completed?: number;
  locale?: string;
  keyword?: string;
  position?: number | null;
  error?: string;
  reason?: string;
  /** For 'throttle' / 'speed' events */
  sleepMs?: number;
  workers?: number;
  cooldownSec?: number;
  source?: 'auto' | 'user';
}

export type SnapshotSpeed = 'medium' | 'slow';

export const SPEED_PRESETS: Record<SnapshotSpeed, { workers: number; sleepMs: number; label: string; note: string }> = {
  medium: { workers: 2, sleepMs: 500, label: 'Medium', note: 'Balanced — default' },
  slow:   { workers: 1, sleepMs: 1000, label: 'Slow',  note: 'Safe — never rate-limits' },
};

export interface SnapshotPublicState {
  running: boolean;
  startedAt: number | null;
  endedAt: number | null;
  cancelled: boolean;
  options: { appIds?: string[]; locales?: string[]; total: number } | null;
  lastProgress: SnapshotEvent | null;
  finalEvent: SnapshotEvent | null;
}

/** Cold-fetch the server's current snapshot status. Used by the global
 *  capsule to decide whether to render on app mount, and by SnapshotPanel
 *  to sync UI when the user lands mid-run. */
export async function getSnapshotState(): Promise<SnapshotPublicState> {
  const r = await fetch('/api/snapshot/state');
  return j<SnapshotPublicState>(r);
}

/** Abort the in-flight snapshot, if any. Server-side cancellation flag — the
 *  worker exits at the next chunk boundary. */
export async function abortSnapshot(): Promise<void> {
  await fetch('/api/snapshot/abort', { method: 'POST' });
}

/** Subscribe to the in-flight snapshot's event stream WITHOUT starting one.
 *  Server replays buffered events so a late subscriber sees the full history.
 *  Returns a cleanup callback that closes the connection. */
export function subscribeToSnapshot(onEvent: (e: SnapshotEvent) => void): () => void {
  const es = new EventSource('/api/snapshot/stream');
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as SnapshotEvent);
    } catch {
      // ignore malformed
    }
  };
  return () => es.close();
}

export async function runSnapshot(
  opts: { appIds?: string[]; locales?: string[]; speed?: SnapshotSpeed; skipExisting?: boolean },
  onEvent: (e: SnapshotEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  // Two-phase: POST /api/snapshot to KICK OFF the singleton background run,
  // then subscribe to /stream for live events. The run survives client
  // disconnect — closing the EventSource doesn't abort the snapshot.
  const preset = SPEED_PRESETS[opts.speed ?? 'medium'];
  const startRes = await fetch('/api/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appIds: opts.appIds,
      locales: opts.locales,
      workers: preset.workers,
      sleepMs: preset.sleepMs,
      skipExisting: !!opts.skipExisting,
    }),
  });
  if (!startRes.ok && startRes.status !== 409) {
    onEvent({ type: 'abort', reason: `Server ${startRes.status} ${startRes.statusText}` });
    return;
  }
  // 409 = already running → just subscribe and tail. Otherwise we just kicked it off.

  return new Promise<void>((resolve) => {
    const es = new EventSource('/api/snapshot/stream');
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      es.close();
      resolve();
    };
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as SnapshotEvent;
        onEvent(ev);
        if (ev.type === 'done' || ev.type === 'abort') cleanup();
      } catch {
        // ignore malformed
      }
    };
    es.onerror = () => {
      // Browser auto-reconnects; only treat as terminal if the run is gone.
    };
    if (signal) {
      signal.addEventListener('abort', () => {
        // Client cancellation — request server-side abort, then unhook stream.
        void abortSnapshot();
        onEvent({ type: 'abort', reason: 'Cancelled by user' });
        cleanup();
      });
    }
  });
}

/** Legacy POST-stream variant removed — runSnapshot now uses the singleton
 *  /api/snapshot + /api/snapshot/stream pair so the run survives client
 *  navigation. */
