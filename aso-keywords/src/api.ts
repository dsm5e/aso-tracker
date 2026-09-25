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
  weekDelta: { top10: number | null; top50: number | null; avg: number | null; ranked: number | null };
  winners: Array<{ kw: string; delta: number; from: number; to: number }>;
  losers: Array<{ kw: string; delta: number; from: number; to: number }>;
  history: { top10: number[]; top50: number[]; unranked: number[]; avg: number[] };
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
  lastUpdated: number | null;
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

export interface AdRepositoryAsset {
  videoUrl: string | null;
  pictureUrl: string | null;
  order: number | null;
  height: number | null;
  width: number | null;
  orientation: string | null;
}

export interface AdRepositoryAd {
  adId: string;
  appId: string;
  appName: string;
  developerName: string;
  legalName: string;
  placement: string;
  format: string;
  subFormat: string | null;
  countryOrRegion: string;
  firstImpressionDate: string | null;
  lastImpressionDate: string | null;
  defaultLanguageTag: string | null;
  defaultPreviewDevice: string | null;
  subtitle: string | null;
  primaryCategory: string | null;
  iconPictureUrl: string | null;
  promotionalText: string | null;
  inAppPurchases: boolean | null;
  audienceRefinement: { ageTarget: boolean; genderTarget: boolean; locationTarget: boolean; customerTypeTarget: boolean };
  assets: AdRepositoryAsset[];
  localeVariationCount: number;
  creativeSignature: string;
  productPageId: string | null;
}

export interface AdRepositoryPayload {
  appId: string;
  source: string;
  sourceUrl: string;
  official: true;
  scope: 'EU';
  datePreset: 'LAST_90_DAYS' | 'LAST_180_DAYS' | 'LAST_YEAR';
  dataStartDate: string | null;
  dataEndDate: string | null;
  fetchedAt: string;
  cacheStatus: 'fresh' | 'refreshed' | 'partial' | 'stale-fallback';
  coverageCountries: string[];
  ads: AdRepositoryAd[];
  summary: { adCount: number; countryCount: number; placementCount: number; creativeVariantCount: number; confirmedCppCount: number };
  partialErrors: Array<{ countries: string[]; message: string }>;
  limitations: string[];
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

export interface DataQualitySource {
  id: string;
  name: string;
  status: 'ok' | 'stale' | 'missing' | 'error';
  updatedAt?: string | null;
  window?: string;
  coverage?: number | null;
  kind: 'fact' | 'model';
  message: string;
}

export interface DataQualityPayload {
  generatedAt: string;
  sources: DataQualitySource[];
}

/** Public App Store fields preserved as an append-only observation. */
export interface MetadataSnapshot {
  id: string;
  appId: string;
  locale: string;
  observedAt: string;
  version?: string | null;
  title?: string | null;
  subtitle?: string | null;
  keywords?: string | null;
  description?: string | null;
  source: 'public_app_store' | 'manual_asc_export';
  sourceUrl?: string | null;
}

export interface MetadataHistoryPayload {
  capability: { publicFields: string[]; unavailablePublicFields: string[]; limitations: string[] };
  latest: MetadataSnapshot | null;
  history: MetadataSnapshot[];
}

export type AsoExperimentStatus = 'draft' | 'scheduled' | 'running' | 'completed';

export interface AsoExperimentEvent {
  id: number;
  action: 'created' | 'updated' | 'archived';
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AsoMetadataChange {
  field: string;
  before: string | null;
  after: string | null;
  locale?: string;
}

/**
 * An ASO experiment never edits a historical App Store observation. It only
 * references the before/after windows that should be compared.
 */
export interface AsoExperiment {
  id: number;
  appId: string;
  name: string;
  hypothesis: string | null;
  status: AsoExperimentStatus;
  locales: string[];
  metadataChanges: AsoMetadataChange[];
  notes: string | null;
  beforeStart: string | null;
  beforeEnd: string | null;
  afterStart: string | null;
  afterEnd: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  events: AsoExperimentEvent[];
}

export type AsoExperimentInput = Omit<AsoExperiment, 'id' | 'appId' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'events'>;

export interface PaidResultObservation {
  appId?: string | null;
  bundleId?: string | null;
  name: string;
  rank: number;
  placement: string;
  clickUrl?: string | null;
  productPageId?: string | null;
  cppEvidence: 'confirmed' | 'not_confirmed';
}

export interface PaidObservation {
  id: string;
  appId: string;
  locale: string;
  keyword: string;
  observedAt: string;
  source: 'manual_app_store_observation' | 'authorized_partner_export';
  evidenceUrl?: string | null;
  paidResults: PaidResultObservation[];
  notes?: string | null;
}

export interface PaidObservationsPayload {
  capability: { available: boolean; reason: string; sourceScope: string[] };
  observations: PaidObservation[];
  summary: {
    observationCount: number;
    observedPaidAppearanceRate: number | null;
    latestObservedAt: string | null;
    confirmedCppIds: string[];
  };
}

export interface CachedTopFiveApp {
  name: string;
  bundleId?: string | null;
  iTunesId?: string | null;
  developer?: string | null;
  rank: number;
  iconUrl?: string | null;
  isOwn?: boolean;
}

export interface CachedTopFiveItem {
  locale: string;
  term: string;
  observedAt: string | null;
  freshness: 'latest-successful-snapshot';
  error: null;
  yourRank: number | null;
  total: number | null;
  apps: CachedTopFiveApp[];
}

export interface CachedTopFiveBatchPayload {
  source: 'cached-aso-snapshots';
  liveRefresh: false;
  appId: number;
  slug: string | null;
  generatedAt: string | null;
  items: CachedTopFiveItem[];
  missing: Array<{ locale: string; term: string; reason: 'no_cached_snapshot' | string }>;
  nextCursor?: string | null;
  page: { limit: number; returned: number };
  limitations: string[];
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

export type IdeaSource = 'apple_autocomplete' | 'competitor_title' | 'asa_suggestion';

export interface KeywordIdea {
  keyword: string;
  source: IdeaSource;
  sources: IdeaSource[];
  /** Plain-Russian evidence lines: seed query, competitor titles, Apple Ads. */
  origin: string[];
  /** Why the phrase passed the relevance filter. */
  reason: string;
  cluster: { id: string; label: string };
  /** Expected-effect estimate 0–100 = demand × chance × 100. */
  score: number;
  level: 'high' | 'medium' | 'low';
  demand: number;
  chance: number;
  inputs: string[];
}

export interface KeywordSuggestionsResponse {
  locale: string;
  generatedAt: string;
  formula: string;
  signals: {
    appleAutocomplete: 'ok' | 'empty';
    asaPopularity: 'ok' | 'no-data' | 'unavailable';
    competitorApps: number;
  };
  ideas: KeywordIdea[];
  rejected: Array<{ keyword: string; reason: string }>;
  trackedSkipped: number;
}

export const api = {
  apps: () => fetch('/api/apps').then((r) => j<AppStats[]>(r)),
  appLocales: (id: string) =>
    fetch(`/api/apps/${id}/locales`).then((r) => j<LocaleAvg[]>(r)),
  rankings: (id: string, locale?: string) =>
    fetch(`/api/apps/${id}/rankings${locale ? `?locale=${locale}` : ''}`, { cache: 'no-store' }).then((r) => j<RankingRow[]>(r)),
  competitors: (id: string, limit = 100) =>
    fetch(`/api/apps/${id}/competitors?limit=${limit}`).then((r) => j<CompetitorSummary[]>(r)),
  competitorInfo: (bundleId: string, country = 'us') =>
    fetch(`/api/competitors/info?bundleId=${encodeURIComponent(bundleId)}&country=${encodeURIComponent(country)}`).then((r) => j<CompetitorInfo | null>(r)),
  competitorAds: (iTunesId: string, datePreset: AdRepositoryPayload['datePreset'] = 'LAST_YEAR') =>
    fetch(`/api/competitors/ads?id=${encodeURIComponent(iTunesId)}&datePreset=${datePreset}`).then((r) => j<AdRepositoryPayload>(r)),
  competitorKeywords: (appId: string, bundleId: string) =>
    fetch(`/api/competitors/keywords?app=${appId}&bundleId=${encodeURIComponent(bundleId)}`).then((r) => j<CompetitorKeywordRow[]>(r)),
  competitorPricing: (iTunesId: string, country = 'us') =>
    fetch(`/api/competitors/pricing?id=${iTunesId}&country=${country}`).then((r) => j<PricingInfo>(r)),
  competitorReviews: (iTunesId: string, country = 'us') =>
    fetch(`/api/competitors/reviews?id=${iTunesId}&country=${country}`).then((r) => j<ReviewsPayload>(r)),
  paidObservations: (appId: string, options: { locale?: string; keyword?: string; competitorId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.locale) params.set('locale', options.locale);
    if (options.keyword) params.set('keyword', options.keyword);
    if (options.competitorId) params.set('competitorId', options.competitorId);
    if (options.limit != null) params.set('limit', String(options.limit));
    const suffix = params.size ? `?${params}` : '';
    return fetch(`/api/apps/${encodeURIComponent(appId)}/paid-observations${suffix}`).then((r) => j<PaidObservationsPayload>(r));
  },
  cachedTopFiveBatch: (input: { appId: number; locales: string[]; terms: string[]; limit?: number }, signal?: AbortSignal) =>
    fetch('/asa-api/aso/rankings/top5-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(input),
    }).then((r) => j<CachedTopFiveBatchPayload>(r)),
  metadataHistory: (appId: string, locale?: string, limit = 100) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (locale) params.set('locale', locale);
    return fetch(`/api/apps/${encodeURIComponent(appId)}/metadata-history?${params}`).then((r) => j<MetadataHistoryPayload>(r));
  },
  addMetadataSnapshot: (appId: string, snapshot: Omit<MetadataSnapshot, 'id' | 'appId'>) =>
    fetch(`/api/apps/${encodeURIComponent(appId)}/metadata-snapshots`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot),
    }).then((r) => j<{ snapshot: MetadataSnapshot }>(r)),
  captureMetadataSnapshot: (appId: string, locale: string, refresh = false) =>
    fetch(`/api/apps/${encodeURIComponent(appId)}/metadata-snapshots/capture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale, refresh }),
    }).then((r) => j<{ snapshot: MetadataSnapshot | null; cacheStatus: 'fresh' | 'refreshed' | 'unchanged' | 'stale-fallback'; error: string | null }>(r)),
  asoExperiments: (appId: string) =>
    fetch(`/api/apps/${encodeURIComponent(appId)}/aso-experiments?includeArchived=1`).then((r) => j<{ experiments: AsoExperiment[] }>(r)),
  createAsoExperiment: (appId: string, experiment: AsoExperimentInput) =>
    fetch(`/api/apps/${encodeURIComponent(appId)}/aso-experiments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(experiment),
    }).then((r) => j<{ experiment: AsoExperiment }>(r)),
  updateAsoExperiment: (appId: string, experimentId: number, patch: Partial<AsoExperimentInput>) =>
    fetch(`/api/apps/${encodeURIComponent(appId)}/aso-experiments/${encodeURIComponent(experimentId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }).then((r) => j<{ experiment: AsoExperiment }>(r)),
  archiveAsoExperiment: (appId: string, experimentId: number) =>
    fetch(`/api/apps/${encodeURIComponent(appId)}/aso-experiments/${encodeURIComponent(experimentId)}`, { method: 'DELETE' }).then((r) => j<{ experiment: AsoExperiment; archived: true }>(r)),
  dataQuality: (iTunesId: string, country?: string) => {
    const params = new URLSearchParams({ app_id: iTunesId });
    if (country) params.set('country', country);
    return fetch(`/asa-api/data-quality?${params}`).then((r) => j<DataQualityPayload>(r));
  },
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
  suggestions: (id: string, locale: string, refresh = false) =>
    fetch(`/api/apps/${id}/suggestions?locale=${encodeURIComponent(locale)}${refresh ? '&refresh=1' : ''}`)
      .then((r) => j<KeywordSuggestionsResponse>(r)),
  itunesLookup: (iTunesId: string, country = 'us') =>
    fetch(`/api/itunes/lookup?id=${iTunesId}&country=${country}`).then((r) => j(r)),
  artworks: (ids: number[], bundles: string[], country = 'us') =>
    ids.length === 0 && bundles.length === 0
      ? Promise.resolve({} as Record<string, string>)
      : fetch('/api/itunes/artworks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, bundles, country }),
        })
          .then((r) => j<Record<string, string>>(r)),
  itunesSearch: (term: string, country = 'us', signal?: AbortSignal) =>
    fetch(`/api/itunes/search?term=${encodeURIComponent(term)}&country=${country}`, { signal }).then((r) => j<Array<{
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
  snapshotSettings: () =>
    fetch('/api/snapshot/settings').then((r) => j<SnapshotSettings>(r)),
  schedule: () =>
    fetch('/api/schedule?brief=1').then((r) => j<ScheduleSummary>(r)),
  movers: (period: 'day' | 'week' | 'month', appId?: string, locale?: string) => {
    const qs = new URLSearchParams({ period });
    if (appId) qs.set('app', appId);
    if (locale) qs.set('locale', locale);
    return fetch(`/api/analytics/movers?${qs}`).then((r) => j<MoversResponse>(r));
  },
};

/** GET /api/schedule — nightly delta refresh (server/scheduler.ts). */
export interface ScheduleRunInfo {
  trigger: 'nightly' | 'run-now';
  startedAt: number;
  endedAt: number | null;
  planned: number;
  completed: number;
  errors: number;
  status: 'running' | 'ok' | 'aborted' | 'failed';
  reason?: string;
}
export interface ScheduleSummary {
  config: { enabled: boolean; hour: number };
  nextRunAt: number | null;
  running: ScheduleRunInfo | null;
  lastRun: ScheduleRunInfo | null;
  tiers: { total: number; daily: number; weekly: number };
  nextPlan: { date: string; total: number; daily: number; weekly: number; overdue: number; requests: number };
  todayPlan: { date: string; total: number; byApp: Record<string, number> };
  estimate: { ratePerMin: number; lanes: number; minutes: number };
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
  baselineCombos: number;
  baseDate: string | null;
  onBase: { ranked: number; top10: number; top50: number };
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

export type RankSource = 'appstore' | 'itunes';

/** Per-host request budget (server/host-gate.ts). */
export interface HostGateStatus {
  host: 'search.itunes.apple.com' | 'itunes.apple.com' | 'apps.apple.com';
  ratePerMin: number;
  capPerMin: number | null;
  effectivePerMin: number;
  queued: { interactive: number; top: number; tail: number };
  inFlight: number;
  pausedUntil: number | null;
  counters: { ok: number; limited: number; errors: number; coalesced: number };
  consecutiveOk: number;
}

export interface SnapshotSettings {
  rankSource: RankSource;
  gates: HostGateStatus[];
}

export interface SnapshotEvent {
  type: 'start' | 'locale' | 'keyword-start' | 'keyword' | 'retry' | 'done' | 'abort' | 'throttle' | 'speed';
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
  attempt?: number;
  maxAttempts?: number;
  top5?: Array<{ name: string; id: string; dev: string; tid?: number; pos?: number }>;
  rankSource?: RankSource;
  ms?: number;
  gate?: HostGateStatus;
}

export type SnapshotSpeed = 'medium' | 'slow';

export const SPEED_PRESETS: Record<SnapshotSpeed, { workers: number; sleepMs: number; label: string; note: string }> = {
  medium: { workers: 1, sleepMs: 3250, label: 'Обычная', note: 'Адаптивно: 24–40 запросов в минуту' },
  slow:   { workers: 1, sleepMs: 5000, label: 'Бережная', note: 'Не больше 12 в минуту — для больших обновлений' },
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
  let closed = false;
  let checkingState = false;

  const close = () => {
    if (closed) return;
    closed = true;
    es.close();
    if (statePoll) clearInterval(statePoll);
  };

  const deliver = (event: SnapshotEvent) => {
    if (closed) return;
    onEvent(event);
    if (event.type === 'done' || event.type === 'abort') close();
  };

  // EventSource automatically reconnects after an API restart. The replacement
  // process has no in-memory snapshot state, so no terminal SSE event can ever
  // arrive. Reconcile with the cold state endpoint to avoid a permanent 0/N UI.
  const reconcile = async () => {
    if (closed || checkingState) return;
    checkingState = true;
    try {
      const state = await getSnapshotState();
      if (!state.running) {
        deliver(state.finalEvent ?? {
          type: 'abort',
          reason: 'Обновление прервано перезапуском сервера. Запустите его ещё раз.',
        });
      }
    } catch {
      // The API may only be temporarily unavailable; keep trying while SSE reconnects.
    } finally {
      checkingState = false;
    }
  };

  const statePoll = setInterval(() => { void reconcile(); }, 5000);

  es.onmessage = (m) => {
    try {
      deliver(JSON.parse(m.data) as SnapshotEvent);
    } catch {
      // ignore malformed
    }
  };
  es.onerror = () => { void reconcile(); };
  return close;
}

export async function runSnapshot(
  opts: { appIds?: string[]; locales?: string[]; speed?: SnapshotSpeed; skipExisting?: boolean; delta?: boolean },
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
      delta: !!opts.delta,
    }),
  });
  if (!startRes.ok && startRes.status !== 409) {
    onEvent({ type: 'abort', reason: `Server ${startRes.status} ${startRes.statusText}` });
    return;
  }
  // 409 = already running → just subscribe and tail. Otherwise we just kicked it off.

  return new Promise<void>((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    let abortHandler: (() => void) | undefined;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      resolve();
    };
    unsubscribe = subscribeToSnapshot((ev) => {
      onEvent(ev);
      if (ev.type === 'done' || ev.type === 'abort') cleanup();
    });
    if (signal) {
      abortHandler = () => {
        // Client cancellation — request server-side abort, then unhook stream.
        void abortSnapshot();
        onEvent({ type: 'abort', reason: 'Отменено пользователем' });
        cleanup();
      };
      if (signal.aborted) abortHandler();
      else signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
}

/** Legacy POST-stream variant removed — runSnapshot now uses the singleton
 *  /api/snapshot + /api/snapshot/stream pair so the run survives client
 *  navigation. */
