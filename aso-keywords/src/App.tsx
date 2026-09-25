import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  api,
  runSnapshot,
  getSnapshotState,
  subscribeToSnapshot,
  abortSnapshot,
  SPEED_PRESETS,
  type AppStats,
  type RankingRow,
  type SnapshotEvent,
  type SnapshotSpeed,
  type KeywordIdea,
  type KeywordSuggestionsResponse,
  type RelevanceRow,
  type MoversResponse,
  type Mover,
  type LocaleAvg,
} from './api';
import { APP_STORE_LOCALES } from './appStoreLocales';
import TrafficIntelligence from './screens/TrafficIntelligence';
import Competitors from './screens/Competitors';
import DecisionMatrix from './screens/DecisionMatrix';
import Overview from './screens/Overview';
import AcquisitionFunnel from './screens/AcquisitionFunnel';
import ConnectGate from './components/ConnectGate';
import Experiments from './screens/Experiments';
import { TopFiveArtwork } from './components/KeywordResultsDrawer';

type TopFiveCandidate = { id: string; tid?: number };
type SharedTopFiveStatus = 'loading' | 'ready' | 'empty' | 'error';

function sharedTopFiveKey(appId: string, country: string, keyword: string) {
  return `${appId}:${country.toLocaleLowerCase()}:${keyword.toLocaleLowerCase()}`;
}

type AppView = 'overview' | 'keywords' | 'traffic' | 'competitors' | 'matrix' | 'funnel' | 'experiments';
type KeywordView = 'positions' | 'analytics' | 'ideas';

type DialogKind = 'keywords' | 'locale' | 'app' | 'error' | 'delete-app';
type DialogState = {
  kind: DialogKind;
  title: string;
  message: string;
  placeholder?: string;
  value?: string;
};

type RowUpdateState = {
  status: 'queued' | 'updating' | 'retrying' | 'done' | 'error';
  attempt?: number;
  maxAttempts?: number;
};

type AppStoreSearchResult = {
  trackId: number;
  trackName?: string;
  bundleId?: string;
  artistName?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  averageUserRating?: number;
};

const ARTWORK_SESSION_KEY = 'aso-keywords.artworks.v1';

// Sibling ASO Studio tools, reverse-proxied under the same origin in dev
// (see vite.config.ts) and by the hub in production.
const STUDIO_LINKS = [
  { id: 'aso', label: 'Ключевые слова', hint: 'Позиции и идеи', href: '/' },
  { id: 'shot', label: 'Скриншоты', hint: 'Визуалы App Store', href: '/studio/' },
  { id: 'vid', label: 'Видео', hint: 'Подготовка рекламных видео', href: '/video/' },
  { id: 'asa', label: 'Apple Ads', hint: 'Окупаемость рекламы', href: '/asa/' },
];

function initialArtworkCache(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(ARTWORK_SESSION_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function localeFlag(locale: string) {
  const country = locale.split('-')[0].toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) return '🌐';
  return String.fromCodePoint(...[...country.toUpperCase()].map((letter) => letter.charCodeAt(0) + 127397));
}

type OwnAppIdentity = Pick<AppStats, 'bundle' | 'iTunesId' | 'iconUrl' | 'name'>;

function isOwnAppResult(app: { id?: string; tid?: number }, ownApp?: OwnAppIdentity) {
  if (!ownApp) return false;
  const ownTid = Number(ownApp.iTunesId);
  if (Number.isFinite(ownTid) && app.tid === ownTid) return true;
  const bundle = app.id?.toLocaleLowerCase() ?? '';
  const ownBundle = ownApp.bundle.toLocaleLowerCase();
  return Boolean(ownBundle && (bundle === ownBundle || bundle.startsWith(ownBundle)));
}

function delta(from: number | null, to: number | null) {
  if (from == null || to == null) return null;
  return from - to;
}

function snapshotStatusText(progress: SnapshotEvent | null, fallbackTotal: number | string) {
  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? fallbackTotal;
  if (progress?.type === 'throttle') {
    return `Пауза из-за лимита Apple · ${progress.cooldownSec ?? 60} с · ${completed}/${total}`;
  }
  if (progress?.type === 'retry') {
    const attempt = progress.attempt && progress.maxAttempts
      ? ` · попытка ${progress.attempt}/${progress.maxAttempts}`
      : '';
    return `Повтор: ${progress.keyword ?? 'запрос'}${attempt} · ${completed}/${total}`;
  }
  if (progress?.type === 'keyword-start' && progress.keyword) {
    return `Запрашиваем: ${progress.keyword} · ${completed}/${total}`;
  }
  return `Обновление ${completed}/${total}`;
}

function rankTone(rank: number | null) {
  if (rank == null) return 'muted';
  if (rank <= 10) return 'positive';
  if (rank <= 50) return 'warning';
  return 'negative';
}

function freshnessLabel(value: string | null | undefined) {
  if (!value) return 'Снимков пока нет';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Снимок доступен';
  return `Синхронизировано ${new Intl.DateTimeFormat('ru-RU', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)}`;
}

function AppIcon({ app, size = 42 }: { app: AppStats; size?: number }) {
  if (app.iconUrl) {
    return <img className="app-icon" src={app.iconUrl} alt="" style={{ width: size, height: size }} />;
  }
  return (
    <span className="app-icon app-icon-fallback" style={{ width: size, height: size, background: app.iconBg }}>
      {app.emoji || 'A'}
    </span>
  );
}

export default function App() {
  const [apps, setApps] = useState<AppStats[]>([]);
  const [selectedAppID, setSelectedAppID] = useState('');
  const [keywordMap, setKeywordMap] = useState<Record<string, string[]>>({});
  const [locale, setLocale] = useState('');
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  const [sharedTopFive, setSharedTopFive] = useState<Record<string, RankingRow>>({});
  const sharedTopFiveRef = useRef(sharedTopFive);
  const [sharedTopFiveStatus, setSharedTopFiveStatus] = useState<Record<string, SharedTopFiveStatus>>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<SnapshotEvent | null>(null);
  const [artworks, setArtworks] = useState<Record<string, string>>(initialArtworkCache);
  const artworksRef = useRef(artworks);
  const artworkWorkRef = useRef<Promise<void>>(Promise.resolve());
  const artworkInFlightRef = useRef(new Set<string>());
  const artworkNegativeRef = useRef(new Map<string, number>());
  const topFiveWorkRef = useRef<Promise<void>>(Promise.resolve());
  const topFiveInFlightRef = useRef(new Set<string>());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [rowUpdates, setRowUpdates] = useState<Record<string, RowUpdateState>>({});
  const [competitorBundle, setCompetitorBundle] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<KeywordSuggestionsResponse | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [studioMenuOpen, setStudioMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [updateMenuOpen, setUpdateMenuOpen] = useState(false);
  const [relevanceOn, setRelevanceOn] = useState(false);
  const [relevance, setRelevance] = useState<Record<string, RelevanceRow>>({});
  const [snapshotSpeed, setSnapshotSpeed] = useState<SnapshotSpeed>(
    () => (localStorage.getItem('snapshotSpeed') === 'slow' ? 'slow' : 'medium')
  );
  const [view, setView] = useState<AppView>(() => {
    const requested = window.location.hash.slice(1);
    return requested === 'overview' || requested === 'traffic' || requested === 'competitors' || requested === 'matrix' || requested === 'funnel' ? requested : 'keywords';
  });
  const [keywordView, setKeywordView] = useState<KeywordView>(() => {
    const requested = window.location.hash.slice(1);
    return requested === 'analytics' || requested === 'ideas' ? requested : 'positions';
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => {
      const requested = new URLSearchParams(window.location.search).get('theme');
      if (requested === 'dark' || requested === 'light') return requested;
      return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    }
  );
  const [pageSize, setPageSize] = useState<number>(() => Number(localStorage.getItem('pageSize')) || 0); // 0 = all
  const [page, setPage] = useState(0);
  const [detailKeyword, setDetailKeyword] = useState<string | null>(null);
  const [localeAvgByApp, setLocaleAvgByApp] = useState<Record<string, LocaleAvg[]>>({});

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);
  useEffect(() => {
    const route = view === 'keywords' ? keywordView : view;
    if (window.location.hash !== `#${route}`) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${route}`);
    }
  }, [keywordView, view]);
  useEffect(() => { localStorage.setItem('pageSize', String(pageSize)); }, [pageSize]);
  useEffect(() => { setPage(0); }, [locale, query, pageSize, selectedAppID]);

  const selectedApp = apps.find((app) => app.id === selectedAppID) ?? apps[0];

  useEffect(() => { artworksRef.current = artworks; }, [artworks]);

  const ensureArtworkForTop5 = useCallback((candidates: TopFiveCandidate[], country: string) => {
    const ids = [...new Set(candidates.map((candidate) => candidate.tid).filter((id): id is number => id != null))];
    const bundles = [...new Set(candidates.filter((candidate) => candidate.tid == null).map((candidate) => candidate.id).filter(Boolean))];
    const keys = [...ids.map(String), ...bundles];
    const now = Date.now();
    const missing = keys.filter((key) => {
      const scoped = `${country}:${key}`;
      const negativeUntil = artworkNegativeRef.current.get(scoped) ?? 0;
      return !artworksRef.current[key] && negativeUntil <= now && !artworkInFlightRef.current.has(scoped);
    });
    if (!missing.length) return;
    missing.forEach((key) => artworkInFlightRef.current.add(`${country}:${key}`));
    const requestedIds = ids.filter((id) => missing.includes(String(id)));
    const requestedBundles = bundles.filter((bundle) => missing.includes(bundle));
    artworkWorkRef.current = artworkWorkRef.current.catch(() => undefined).then(async () => {
      try {
        const incoming = await api.artworks(requestedIds, requestedBundles, country);
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        missing.filter((key) => !incoming[key]).forEach((key) => artworkNegativeRef.current.set(`${country}:${key}`, expiresAt));
        setArtworks((current) => {
          const next = { ...current, ...incoming };
          artworksRef.current = next;
          try { sessionStorage.setItem(ARTWORK_SESSION_KEY, JSON.stringify(next)); } catch { /* non-critical cache */ }
          return next;
        });
      } catch { /* A stable empty slot is preferable to an invented icon. */ }
      finally { missing.forEach((key) => artworkInFlightRef.current.delete(`${country}:${key}`)); }
    });
  }, []);

  useEffect(() => {
    if (!selectedApp) return;
    setSharedTopFive((current) => {
      const next = { ...current };
      for (const row of rankings) next[sharedTopFiveKey(selectedApp.id, row.locale, row.keyword)] = row;
      sharedTopFiveRef.current = next;
      return next;
    });
  }, [rankings, selectedApp]);

  const resolveTopFive = useCallback((appId: string, iTunesId: string, country: string, keyword: string) => {
    const key = sharedTopFiveKey(appId, country, keyword);
    if (sharedTopFiveRef.current[key] || topFiveInFlightRef.current.has(key)) return;
    topFiveInFlightRef.current.add(key);
    setSharedTopFiveStatus((current) => ({ ...current, [key]: 'loading' }));
    topFiveWorkRef.current = topFiveWorkRef.current.catch(() => undefined).then(async () => {
      const makeFallback = async () => {
        const results = await api.itunesSearch(keyword, country.toLocaleLowerCase());
        return {
          locale: country.toLocaleLowerCase(), keyword, today: null, yesterday: null, w1: null, w4: null, trend: [], lastUpdated: Date.now(),
          top5: results.slice(0, 5).map((result, index) => ({ id: result.bundleId ?? String(result.trackId), name: result.trackName ?? result.bundleId ?? `Приложение ${index + 1}`, dev: result.artistName ?? '', tid: result.trackId, pos: index + 1 })),
        } satisfies RankingRow;
      };
      try {
        const cached = await api.cachedTopFiveBatch({ appId: Number(iTunesId), locales: [country.toLocaleLowerCase()], terms: [keyword], limit: 1 });
        const item = cached.items[0];
        const ranking: RankingRow = item ? {
          locale: item.locale, keyword: item.term, today: item.yourRank, yesterday: null, w1: null, w4: null, trend: [], lastUpdated: item.observedAt ? new Date(item.observedAt).getTime() : null,
          top5: item.apps.map((candidate) => {
            const numericId = Number(candidate.iTunesId);
            return { id: candidate.bundleId ?? String(candidate.iTunesId ?? candidate.name), name: candidate.name, dev: candidate.developer ?? '', tid: Number.isSafeInteger(numericId) && numericId > 0 ? numericId : undefined, pos: candidate.rank };
          }),
        } : await makeFallback();
        setSharedTopFive((current) => {
          const next = { ...current, [key]: ranking };
          sharedTopFiveRef.current = next;
          return next;
        });
        setSharedTopFiveStatus((current) => ({ ...current, [key]: ranking.top5.length ? 'ready' : 'empty' }));
        if (ranking.top5.length) ensureArtworkForTop5(ranking.top5, country.toLocaleLowerCase());
      } catch {
        try {
          const ranking = await makeFallback();
          setSharedTopFive((current) => {
            const next = { ...current, [key]: ranking };
            sharedTopFiveRef.current = next;
            return next;
          });
          setSharedTopFiveStatus((current) => ({ ...current, [key]: ranking.top5.length ? 'ready' : 'empty' }));
          if (ranking.top5.length) ensureArtworkForTop5(ranking.top5, country.toLocaleLowerCase());
        } catch {
          setSharedTopFiveStatus((current) => ({ ...current, [key]: 'error' }));
        }
      } finally { topFiveInFlightRef.current.delete(key); }
    });
  }, [ensureArtworkForTop5]);

  // Refs so the long-lived snapshot event stream always sees the current
  // app/locale without resubscribing on every selection change.
  const localeRef = useRef(locale);
  useEffect(() => { localeRef.current = locale; }, [locale]);
  const selectedAppRef = useRef(selectedApp);
  useEffect(() => { selectedAppRef.current = selectedApp; }, [selectedApp]);

  useEffect(() => { localStorage.setItem('snapshotSpeed', snapshotSpeed); }, [snapshotSpeed]);

  const loadApps = useCallback(async () => {
    const result = await api.apps();
    setApps(result);
    setSelectedAppID((current) => {
      if (current) return current;
      const requested = new URLSearchParams(window.location.search).get('app');
      return result.some((app) => app.id === requested) ? requested! : result[0]?.id || '';
    });
  }, []);

  useEffect(() => {
    loadApps().catch(console.error).finally(() => setLoading(false));
  }, [loadApps]);

  useEffect(() => {
    if (!selectedApp) return;
    setLoading(true);
    setRankings([]);
    api.keywords(selectedApp.id)
      .then((keywords) => {
        setKeywordMap(keywords);
        const locales = Object.keys(keywords).sort();
        setLocale((current) => {
          if (current && keywords[current]) return current;
          const requested = new URLSearchParams(window.location.search).get('locale')?.toLowerCase();
          return requested && keywords[requested] ? requested : locales[0] ?? '';
        });
      })
      .finally(() => setLoading(false));
  }, [selectedApp]);

  useEffect(() => {
    if (!selectedApp || !locale) return;
    let cancelled = false;
    let firstLoad = true;
    setLoading(true);
    const loadRankings = () => api.rankings(selectedApp.id, locale)
      .then((rows) => { if (!cancelled) setRankings(rows); })
      .catch((error) => { if (!cancelled) console.error(error); })
      .finally(() => {
        if (!cancelled && firstLoad) setLoading(false);
        firstLoad = false;
      });
    void loadRankings();
    const timer = window.setInterval(() => { void loadRankings(); }, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadRankings();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [selectedApp, locale]);

  const rankingByKeyword = useMemo(
    () => new Map(rankings.map((row) => [row.keyword.toLocaleLowerCase(), row])),
    [rankings]
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (keywordMap[locale] ?? [])
      .filter((keyword) => !needle || keyword.toLocaleLowerCase().includes(needle))
      .map((keyword) => ({ keyword, ranking: rankingByKeyword.get(keyword.toLocaleLowerCase()) }));
  }, [keywordMap, locale, query, rankingByKeyword]);

  const positionSummary = useMemo(() => {
    const ranked = rows.filter((row) => row.ranking?.today != null);
    const top10 = ranked.filter((row) => (row.ranking?.today ?? 999) <= 10).length;
    const average = ranked.length
      ? ranked.reduce((sum, row) => sum + (row.ranking?.today ?? 0), 0) / ranked.length
      : null;
    const improved = rows.filter((row) => {
      const change = delta(row.ranking?.yesterday ?? null, row.ranking?.today ?? null);
      return change != null && change > 0;
    }).length;
    return { total: rows.length, ranked: ranked.length, top10, average, improved };
  }, [rows]);

  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const pagedRows = useMemo(
    () => (pageSize > 0 ? rows.slice(page * pageSize, (page + 1) * pageSize) : rows),
    [rows, page, pageSize]
  );

  const saveKeywords = async (next: Record<string, string[]>) => {
    if (!selectedApp) return;
    setKeywordMap(next);
    await api.saveKeywords(selectedApp.id, next);
    await loadApps();
  };

  const commitKeywords = async (value: string) => {
    if (!selectedApp || !locale || !value.trim()) return;
    const additions = value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    const current = keywordMap[locale] ?? [];
    const next = { ...keywordMap, [locale]: Array.from(new Set([...current, ...additions])) };
    await saveKeywords(next);
  };

  const removeKeyword = async (keyword: string) => {
    const current = keywordMap[locale] ?? [];
    await saveKeywords({ ...keywordMap, [locale]: current.filter((item) => item !== keyword) });
  };

  const commitLocale = async (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || keywordMap[normalized]) return;
    const next = { ...keywordMap, [normalized]: [] };
    await saveKeywords(next);
    setLocale(normalized);
  };

  const applySnapshotEvent = useCallback((event: SnapshotEvent) => {
    setProgress(event);
    if (event.type === 'done' || event.type === 'abort') {
      setRefreshing(false);
      setRowUpdates({});
      const app = selectedAppRef.current;
      const currentLocale = localeRef.current;
      if (app && currentLocale) {
        api.rankings(app.id, currentLocale).then(setRankings).catch(() => {});
      }
      loadApps().catch(() => {});
      return;
    }
    if (!event.keyword || event.locale !== localeRef.current) return;
    if (event.type === 'keyword-start') {
      setRowUpdates((current) => ({
        ...current,
        [event.keyword!]: {
          status: 'updating',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
        },
      }));
    }
    if (event.type === 'retry') {
      setRowUpdates((current) => ({
        ...current,
        [event.keyword!]: {
          status: 'retrying',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
        },
      }));
    }
    if (event.type === 'keyword') {
      setRankings((current) => {
        const index = current.findIndex((row) => row.locale === localeRef.current && row.keyword === event.keyword);
        if (index < 0) return current;
        const next = current.slice();
        const previous = next[index];
        next[index] = {
          ...previous,
          today: event.position ?? null,
          top5: event.top5 ?? previous.top5,
          trend: [...previous.trend, event.position ?? 0].slice(-30),
        };
        return next;
      });
      setRowUpdates((current) => ({
        ...current,
        [event.keyword!]: { status: event.error ? 'error' : 'done' },
      }));
    }
  }, [loadApps]);

  // A snapshot is a server-side singleton that survives page reloads. On mount,
  // reattach to any run started in a previous session so progress keeps flowing.
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    getSnapshotState()
      .then((state) => {
        if (!state.running) {
          setRefreshing(false);
          setRowUpdates({});
          if (state.finalEvent) setProgress(state.finalEvent);
          return;
        }
        setRefreshing(true);
        if (state.lastProgress) setProgress(state.lastProgress);
        unsubscribe = subscribeToSnapshot(applySnapshotEvent);
      })
      .catch(() => { /* server not up yet; the manual refresh path still works */ });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [applySnapshotEvent]);

  const changeSpeed = (speed: SnapshotSpeed) => {
    setSnapshotSpeed(speed);
    if (refreshing) {
      const preset = SPEED_PRESETS[speed];
      api.setSnapshotSpeed(preset.sleepMs, preset.workers).catch(() => { /* run may have just ended */ });
    }
  };

  const startSnapshot = async (scope: 'locale' | 'app' | 'all') => {
    if (!selectedApp || !locale || refreshing) return;
    setUpdateMenuOpen(false);
    setRefreshing(true);
    setProgress(null);
    setRowUpdates(scope === 'locale'
      ? Object.fromEntries((keywordMap[locale] ?? []).map((keyword) => [keyword, { status: 'queued' as const }]))
      : {});
    const scopeOpts = scope === 'locale'
      ? { appIds: [selectedApp.id], locales: [locale] }
      : scope === 'app'
        ? { appIds: [selectedApp.id] }
        : {};
    try {
      await runSnapshot({ ...scopeOpts, speed: snapshotSpeed }, applySnapshotEvent);
    } finally {
      setRefreshing(false);
    }
  };

  const refresh = () => startSnapshot('locale');

  const refreshOne = async (keyword: string) => {
    if (!selectedApp || !locale) return;
    setRowUpdates((current) => ({ ...current, [keyword]: { status: 'updating', attempt: 1, maxAttempts: 3 } }));
    try {
      const result = await api.refreshKeyword(selectedApp.id, locale, keyword);
      setRankings((current) => {
        const index = current.findIndex((row) => row.locale === locale && row.keyword === keyword);
        if (index < 0) return current;
        const next = current.slice();
        const previous = next[index];
        next[index] = {
          ...previous,
          today: result.position,
          top5: result.top5,
          trend: [...previous.trend, result.position ?? 0].slice(-30),
        };
        return next;
      });
      setRowUpdates((current) => ({ ...current, [keyword]: { status: 'done' } }));
    } catch (error) {
      setRowUpdates((current) => ({ ...current, [keyword]: { status: 'error' } }));
      setDialog({ kind: 'error', title: 'Не удалось обновить ключевое слово', message: (error as Error).message });
    }
  };

  const commitApp = async (id: string) => {
    if (!id.trim()) return;
    try {
      const lookup = await api.itunesLookup(id.trim(), 'us') as {
        trackName?: string; bundleId?: string; artworkUrl100?: string; trackId?: number;
      };
      if (!lookup) throw new Error('Приложение не найдено в выбранной витрине.');
      const name = lookup.trackName ?? `App ${id.trim()}`;
      const created = await api.addApp({
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name,
        bundle: lookup.bundleId ?? '',
        iTunesId: String(lookup.trackId ?? id.trim()),
        iconUrl: lookup.artworkUrl100,
        emoji: '✨',
      }) as { id?: string };
      await loadApps();
      if (created.id) setSelectedAppID(created.id);
    } catch (error) {
      setDialog({
        kind: 'error',
        title: 'Не удалось добавить приложение',
        message: (error as Error).message,
      });
    }
  };

  const submitDialog = async (value: string) => {
    if (!dialog || dialog.kind === 'error') {
      setDialog(null);
      return;
    }
    setDialogBusy(true);
    try {
      if (dialog.kind === 'keywords') await commitKeywords(value);
      if (dialog.kind === 'locale') await commitLocale(value);
      if (dialog.kind === 'app') await commitApp(value);
      if (dialog.kind === 'delete-app') await confirmDeleteApp(value);
      setDialog(null);
    } finally {
      setDialogBusy(false);
    }
  };

  const openKeywordsDialog = () => setDialog({
    kind: 'keywords',
    title: 'Добавить ключевые слова',
    message: `Добавьте ключевые слова для ${locale.toUpperCase()}. Разделяйте фразы запятой или новой строкой.`,
    placeholder: 'habit tracker\ndaily habits\nroutine planner',
  });

  const openLocaleDialog = () => setDialog({
    kind: 'locale',
    title: 'Добавить регион',
    message: 'Выберите код витрины App Store.',
    placeholder: 'us',
  });

  const openAppDialog = () => setDialog({
    kind: 'app',
    title: 'Добавить приложение',
    message: 'Найдите приложение по названию, bundle ID или вставьте числовой App Store ID.',
    placeholder: 'Найти приложение или ввести App Store ID',
  });

  const findSuggestions = async (refresh = false) => {
    if (!selectedApp || !locale || suggestionsLoading) return;
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
      setSuggestions(await api.suggestions(selectedApp.id, locale, refresh));
    } catch (error) {
      setSuggestionsError((error as Error).message);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const openKeywordView = (next: KeywordView) => {
    setView('keywords');
    setKeywordView(next);
    setMobileNavOpen(false);
  };

  useEffect(() => {
    if (view === 'keywords' && keywordView === 'ideas' && !suggestions && !suggestionsLoading && selectedApp && locale) {
      void findSuggestions();
    }
  }, [keywordView, locale, selectedAppID, view]);

  useEffect(() => {
    setSuggestions(null);
    setSuggestionsError(null);
  }, [locale, selectedAppID]);

  // Per-locale averages for the Overview grid, one request per app, cached.
  useEffect(() => {
    if (view !== 'overview' || !apps.length) return;
    let cancelled = false;
    Promise.all(apps.map(async (app) => [app.id, await api.appLocales(app.id).catch(() => [])] as const))
      .then((pairs) => { if (!cancelled) setLocaleAvgByApp(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [view, apps]);

  // ⌘K opens the App Store search dialog from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDialog({
          kind: 'app',
          title: 'Добавить приложение',
          message: 'Найдите приложение по названию, bundle ID или вставьте числовой App Store ID.',
          placeholder: 'Найти приложение или ввести App Store ID',
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const requestDeleteApp = (app: AppStats) => setDialog({
    kind: 'delete-app',
    title: `Удалить «${app.name}»?`,
    message: 'Будут навсегда удалены списки ключевых слов, история снимков и само приложение из отслеживания. Отменить действие нельзя.',
    value: app.id,
  });

  const confirmDeleteApp = async (id: string) => {
    await api.deleteApp(id);
    setSelectedAppID('');
    setDetailKeyword(null);
    await loadApps();
  };

  // Relevance mode: classify each keyword by whether its top-5 apps share our
  // genre (match / ambiguous / mismatch). Loaded lazily when toggled on.
  useEffect(() => {
    if (!relevanceOn || !selectedApp || !locale) return;
    let cancelled = false;
    api.keywordRelevance(selectedApp.id, locale)
      .then((rows) => {
        if (cancelled) return;
        setRelevance(Object.fromEntries(rows.map((row) => [`${row.locale}|${row.keyword.toLocaleLowerCase()}`, row])));
      })
      .catch(() => { /* relevance is best-effort */ });
    return () => { cancelled = true; };
  }, [relevanceOn, selectedApp, locale]);

  const copyClaudePrompt = async (keyword: string) => {
    if (!selectedApp || !locale) return;
    const { prompt } = await api.claudePrompt(selectedApp.id, keyword, locale);
    await navigator.clipboard.writeText(prompt);
  };

  const addSelectedSuggestions = async (selected: string[]) => {
    const current = keywordMap[locale] ?? [];
    await saveKeywords({ ...keywordMap, [locale]: Array.from(new Set([...current, ...selected])) });
    setSuggestions(null);
    setKeywordView('positions');
  };

  if (!loading && apps.length === 0) {
    return (
      <main className="empty-screen">
        <div className="empty-card">
          <div className="brand-mark">K</div>
          <h1>ASO Keywords</h1>
          <p>Добавьте приложение из App Store, чтобы отслеживать позиции по ключевым словам.</p>
          <button className="button button-primary" onClick={openAppDialog}>Добавить первое приложение</button>
          {dialog && <InputDialog dialog={dialog} busy={dialogBusy} existingLocales={Object.keys(keywordMap)} onClose={() => setDialog(null)} onSubmit={submitDialog} />}
        </div>
      </main>
    );
  }

  return (
    <div className="workspace">
      <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-titlebar">
          <button className="brand-mark brand-button" onClick={() => setStudioMenuOpen((open) => !open)} aria-label="Переключить инструмент студии">K</button>
          <div className="brand-copy">
            <strong>ASO Studio</strong>
            <span>Аналитика ключевых слов</span>
          </div>
          {studioMenuOpen && (
            <div className="menu studio-menu" onMouseLeave={() => setStudioMenuOpen(false)}>
              <div className="menu-label">ASO Studio</div>
              {STUDIO_LINKS.map((link) => (
                <a key={link.id} href={link.href} className={link.id === 'aso' ? 'active' : ''}>
                  <strong>{link.label}</strong>
                  <small>{link.hint}</small>
                  {link.id === 'aso' && <b>✓</b>}
                </a>
              ))}
            </div>
          )}
        </div>

        <nav className="utility-nav" aria-label="Рабочая область">
          <button className={view === 'overview' ? 'selected' : ''} onClick={() => { setView('overview'); setMobileNavOpen(false); }}>
            <span className="nav-label">Обзор</span>
          </button>
          <button className={view === 'keywords' ? 'selected' : ''} onClick={() => openKeywordView(view === 'keywords' ? keywordView : 'positions')}>
            <span className="nav-label">Ключевые слова</span>
          </button>
          <button className={view === 'competitors' ? 'selected' : ''} onClick={() => { setView('competitors'); setMobileNavOpen(false); }} disabled={!selectedApp}>
            <span className="nav-label">Конкуренты</span>
          </button>
          <button className={view === 'funnel' ? 'selected' : ''} onClick={() => { setView('funnel'); setMobileNavOpen(false); }} disabled={!selectedApp || !locale}>
            <span className="nav-label">Воронка</span>
          </button>
          <button className={view === 'experiments' ? 'selected' : ''} onClick={() => { setView('experiments'); setMobileNavOpen(false); }} disabled={!selectedApp}>
            <span className="nav-label">Эксперименты</span>
          </button>
          {/* Apple Ads screens stay here until they move into the Apple Ads product. */}
          <div className="sidebar-section-label nav-group-label">Apple Ads</div>
          <button className={view === 'matrix' ? 'selected' : ''} onClick={() => { setView('matrix'); setMobileNavOpen(false); }} disabled={!selectedApp || !locale}>
            <span className="nav-label">Матрица решений</span>
          </button>
          <button className={view === 'traffic' ? 'selected' : ''} onClick={() => { setView('traffic'); setMobileNavOpen(false); }}>
            <span className="nav-label">Аналитика трафика</span>
          </button>
        </nav>

        <div className="rail-spacer" />
        <a className="rail-link" href="/asa/">Apple Ads</a>
        <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        </button>
      </aside>

      {mobileNavOpen && <button className="mobile-nav-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Закрыть навигацию" />}

      <div className="main-shell">
        <header className="context-bar">
          <button className="mobile-nav-toggle" onClick={() => setMobileNavOpen(true)} aria-label="Открыть навигацию">Меню</button>
          {selectedApp && (
            <label className="app-context-control">
              <AppIcon app={selectedApp} size={24} />
              <span className="sr-only">Приложение</span>
              <select value={selectedApp.id} onChange={(event) => setSelectedAppID(event.target.value)} aria-label="Выбранное приложение">
                {apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
              </select>
            </label>
          )}
          {locale && view !== 'overview' && view !== 'funnel' && view !== 'matrix' && view !== 'traffic' && view !== 'experiments' && (
            <label className="context-control">
              <span className="sr-only">Витрина</span>
              <select value={locale} onChange={(event) => setLocale(event.target.value)} aria-label="Витрина">
                {Object.keys(keywordMap).sort().map((code) => (
                  <option key={code} value={code}>{localeFlag(code)} {code.toUpperCase()}</option>
                ))}
              </select>
            </label>
          )}
          <span className="context-freshness" aria-live="polite">
            {freshnessLabel(selectedApp?.lastSnapshot)}
          </span>
          <span className="context-spacer" />
          <button className="context-action" onClick={openAppDialog}>Добавить приложение</button>
        </header>

      {view === 'overview' ? (
        <Overview
          apps={apps}
          localeAvgByApp={localeAvgByApp}
          onOpenApp={(id) => { setSelectedAppID(id); setKeywordView('positions'); setView('keywords'); }}
          onDeleteApp={requestDeleteApp}
          onRunAll={() => startSnapshot('all')}
          refreshing={refreshing}
          progress={progress}
        />
      ) : view === 'keywords' ? (
      <section className="content">
        <header className="view-header">
          <div className="page-title-row">
            <div>
              <h1>Ключевые слова</h1>
              <div className="segmented page-tabs" role="tablist" aria-label="Раздел ключевых слов">
                {([['positions', 'Позиции'], ['ideas', 'Идеи'], ['analytics', 'Динамика']] as const).map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={keywordView === id} className={keywordView === id ? 'selected' : ''}
                    disabled={id !== 'positions' && (!selectedApp || (id === 'ideas' && !locale))}
                    onClick={() => openKeywordView(id)}>{label}</button>
                ))}
              </div>
              <p>{keywordView === 'positions'
                ? 'Отслеживайте позиции, релевантность и приложения, лидирующие по каждому запросу.'
                : keywordView === 'analytics'
                  ? 'Сравнивайте рост, падение и видимость ключевых слов за выбранный период.'
                  : 'Проверяйте подсказки Apple и запросы конкурентов перед добавлением в отслеживание.'}</p>
            </div>
            {keywordView === 'positions' ? <button className="button button-primary" onClick={openKeywordsDialog}>Добавить ключевые слова</button> : null}
          </div>
        {keywordView === 'positions' && <div className="toolbar">
          <div className="update-cluster">
            <button className="toolbar-labeled" onClick={refresh} disabled={refreshing} aria-label="Обновить позиции">
              <span className={refreshing ? 'spinning' : ''}>↻</span> Обновить
            </button>
            <button className="toolbar-caret" onClick={() => setUpdateMenuOpen((open) => !open)} aria-label="Параметры снимка">▾</button>
            {updateMenuOpen && (
              <div className="menu update-menu" onMouseLeave={() => setUpdateMenuOpen(false)}>
                <div className="menu-label">Область обновления позиций</div>
                <button onClick={() => startSnapshot('locale')} disabled={refreshing}><strong>Этот регион ({locale.toUpperCase()})</strong><small>только ключевые слова текущего региона</small></button>
                <button onClick={() => startSnapshot('app')} disabled={refreshing}><strong>Всё приложение ({selectedApp?.name})</strong><small>все регионы этого приложения</small></button>
                <button onClick={() => startSnapshot('all')} disabled={refreshing}><strong>Все приложения</strong><small>каждое приложение и каждый регион</small></button>
                <div className="menu-separator" />
                <div className="menu-label">Скорость обновления</div>
                {(Object.keys(SPEED_PRESETS) as SnapshotSpeed[]).map((speed) => (
                  <button key={speed} onClick={() => changeSpeed(speed)}>
                    <strong>{SPEED_PRESETS[speed].label}</strong>
                    <small>{SPEED_PRESETS[speed].note}</small>
                    {snapshotSpeed === speed && <b>✓</b>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="toolbar-labeled" onClick={openLocaleDialog} aria-label="Добавить регион">＋ Регион</button>

          <span className="toolbar-spacer" />

          {refreshing && (
            <span className="snapshot-status">
              <i /> {snapshotStatusText(progress, rows.length)}
              <button className="snapshot-stop" onClick={() => abortSnapshot().catch(() => {})} title="Остановить обновление">■ Стоп</button>
            </span>
          )}
          <button
            className={`toolbar-labeled relevance-toggle ${relevanceOn ? 'active' : ''}`}
            onClick={() => setRelevanceOn((on) => !on)}
            title="Показывает, совпадает ли жанр приложений из топ-5 с жанром вашего приложения"
          >◎ Релевантность</button>
          <label className="search-field">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск ключевых слов" />
          </label>
        </div>}
        </header>

        {keywordView === 'positions' ? <>
        <section className="rankings-summary" aria-label="Сводка позиций">
          <div><span>Отслеживается</span><strong>{positionSummary.total}</strong><small>ключевых слов</small></div>
          <div><span>В выдаче</span><strong>{positionSummary.ranked}</strong><small>из {positionSummary.total}</small></div>
          <div><span>В топ-10</span><strong>{positionSummary.top10}</strong><small>Рост за сутки: {positionSummary.improved}</small></div>
          <div><span>Средняя позиция</span><strong>{positionSummary.average == null ? 'Нет данных' : `#${positionSummary.average.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`}</strong><small>по найденным ключам</small></div>
        </section>
        <div className="table-wrap rankings-table-wrap">
          <table className="keyword-table">
            <thead>
              <tr>
                <th className="keyword-column">Ключевое слово <span title="Поисковый запрос, по которому отслеживается приложение">ⓘ</span></th>
                <th>Обновлено</th>
                <th>Позиция <span title="Место приложения в результатах поиска App Store; меньше — лучше">ⓘ</span></th>
                <th>24 часа</th>
                <th>7 дней</th>
                <th>Тренд</th>
                <th>Приложения в выдаче <span title="Первые пять приложений в выдаче; нажмите иконку, чтобы открыть карточку конкурента">ⓘ</span></th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 14 }).map((_, index) => <SkeletonRow key={index} />)
              ) : rows.length === 0 ? (
                <tr><td colSpan={8}><div className="table-empty">В этом регионе пока нет ключевых слов.</div></td></tr>
              ) : pagedRows.map(({ keyword, ranking }) => (
                <KeywordRow
                  key={keyword}
                  keyword={keyword}
                  ranking={ranking}
                  onRemove={() => removeKeyword(keyword)}
                  artworks={artworks}
                  onEnsureArtworks={ensureArtworkForTop5}
                  updateState={rowUpdates[keyword]}
                  onRefresh={() => refreshOne(keyword)}
                  onOpenCompetitor={setCompetitorBundle}
                  onOpenDetail={() => setDetailKeyword(keyword)}
                  relevance={relevanceOn ? relevance[`${locale}|${keyword.toLocaleLowerCase()}`] : undefined}
                  ownApp={selectedApp}
                />
              ))}
            </tbody>
          </table>
        </div>

        <footer className="statusbar">
          <span>{rows.length} ключевых слов</span>
          <span>{localeFlag(locale)} {locale.toUpperCase()}</span>
          {pageSize > 0 && pageCount > 1 && (
            <span className="pager">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>‹</button>
              {page + 1} / {pageCount}
              <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}>›</button>
            </span>
          )}
          <select className="page-size" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={0}>Все строки</option>
            <option value={25}>25 / стр.</option>
            <option value={50}>50 / стр.</option>
            <option value={100}>100 / стр.</option>
          </select>
          <span className="statusbar-spacer" />
          <span>Последний снимок: <strong>{freshnessLabel(selectedApp?.lastSnapshot)}</strong></span>
        </footer>
        </> : keywordView === 'ideas' ? (
          <SuggestionsPanel
            locale={locale}
            data={suggestions}
            loading={suggestionsLoading}
            error={suggestionsError}
            onReload={() => void findSuggestions(true)}
            onAdd={addSelectedSuggestions}
          />
        ) : (
          <AnalyticsPanel apps={apps} initialApp={selectedApp?.id ?? ''} />
        )}
      </section>
      ) : view === 'competitors' ? (
        selectedApp ? <Competitors app={{ id: selectedApp.id, name: selectedApp.name, iTunesId: selectedApp.iTunesId }} locale={locale} /> : null
      ) : view === 'matrix' ? (
        selectedApp ? <ConnectGate requires={['asa']} title="Матрица решений"><DecisionMatrix app={{ id: selectedApp.id, name: selectedApp.name, iTunesId: selectedApp.iTunesId, bundle: selectedApp.bundle, iconUrl: selectedApp.iconUrl }} locale={locale} artworks={artworks} sharedTopFive={sharedTopFive} sharedTopFiveStatus={sharedTopFiveStatus} onResolveTopFive={resolveTopFive} onEnsureArtworks={ensureArtworkForTop5} /></ConnectGate> : null
      ) : view === 'funnel' ? (
        selectedApp ? <ConnectGate requires={['adapty', 'asc']} title="Воронка"><AcquisitionFunnel app={{ id: selectedApp.id, name: selectedApp.name, iTunesId: selectedApp.iTunesId }} locale={locale} countries={Object.keys(keywordMap)} /></ConnectGate> : null
      ) : view === 'experiments' ? (
        selectedApp ? <Experiments app={{ id: selectedApp.id, name: selectedApp.name }} locales={Object.keys(keywordMap)} activeLocale={locale} /> : null
      ) : (
        selectedApp ? (
          <ConnectGate requires={['asa']} title="Аналитика трафика">
          <TrafficIntelligence
            className="content"
            app={{ id: selectedApp.id, name: selectedApp.name, iTunesId: selectedApp.iTunesId, bundle: selectedApp.bundle, iconUrl: selectedApp.iconUrl }}
            locale={locale}
            rankings={rankings}
            artworks={artworks}
            sharedTopFive={sharedTopFive}
            sharedTopFiveStatus={sharedTopFiveStatus}
            onResolveTopFive={resolveTopFive}
            onEnsureArtworks={ensureArtworkForTop5}
            onOpenCompetitor={(bundleID) => setCompetitorBundle(bundleID)}
          />
          </ConnectGate>
        ) : null
      )}
      </div>
      {dialog && <InputDialog dialog={dialog} busy={dialogBusy} existingLocales={Object.keys(keywordMap)} onClose={() => setDialog(null)} onSubmit={submitDialog} />}
      {detailKeyword && selectedApp && (
        <KeywordDrawer
          keyword={detailKeyword}
          ranking={rankingByKeyword.get(detailKeyword.toLocaleLowerCase())}
          relevance={relevance[`${locale}|${detailKeyword.toLocaleLowerCase()}`]}
          locale={locale}
          artworks={artworks}
          ownApp={selectedApp}
          onClose={() => setDetailKeyword(null)}
          onRefresh={() => refreshOne(detailKeyword)}
          onCopyPrompt={() => copyClaudePrompt(detailKeyword)}
          onOpenCompetitor={(bundleID) => { setDetailKeyword(null); setCompetitorBundle(bundleID); }}
        />
      )}
      {competitorBundle && selectedApp && (
        <CompetitorDetail
          appID={selectedApp.id}
          bundleID={competitorBundle}
          country={locale || 'us'}
          onClose={() => setCompetitorBundle(null)}
        />
      )}
    </div>
  );
}

const RELEVANCE_LABEL: Record<RelevanceRow['flag'], string> = {
  match: 'Релевантно',
  ambiguous: 'Смешанно',
  mismatch: 'Не по жанру',
  unknown: '?',
};

function KeywordRow({
  keyword,
  ranking,
  onRemove,
  artworks,
  updateState,
  onRefresh,
  onOpenCompetitor,
  onOpenDetail,
  onEnsureArtworks,
  relevance,
  ownApp,
}: {
  keyword: string;
  ranking?: RankingRow;
  onRemove: () => void;
  artworks: Record<string, string>;
  updateState?: RowUpdateState;
  onRefresh: () => void;
  onOpenCompetitor: (bundleID: string) => void;
  onOpenDetail: () => void;
  onEnsureArtworks: (candidates: TopFiveCandidate[], country: string) => void;
  relevance?: RelevanceRow;
  ownApp?: OwnAppIdentity;
}) {
  const dayDelta = delta(ranking?.yesterday ?? null, ranking?.today ?? null);
  const weekDelta = delta(ranking?.w1 ?? null, ranking?.today ?? null);
  const tone = rankTone(ranking?.today ?? null);

  return (
    <tr>
      <td className="keyword-cell">
        <button className="keyword-open" type="button" onClick={onOpenDetail} aria-label={`Открыть аналитику ключевого слова ${keyword}`}>
        <strong>{keyword}</strong>
        {ranking?.today != null && ranking.today <= 10 && <span className="keyword-dot" />}
        {relevance && (
          <span
            className={`relevance-chip relevance-${relevance.flag}`}
            title={`Совпадение жанра в топ-5: ${relevance.matchCount}/5 · ${relevance.genreHistogram.map((g) => `${g.genre} ×${g.count}`).join(', ')}`}
          >
            {RELEVANCE_LABEL[relevance.flag]}
          </span>
        )}
        </button>
      </td>
      <td><UpdateStatus state={updateState} timestamp={ranking?.lastUpdated} /></td>
      <td><span className={`rank rank-${tone}`}>{ranking?.today ? `#${ranking.today}` : 'Нет в выдаче'}</span></td>
      <td><Delta value={dayDelta} /></td>
      <td><Delta value={weekDelta} /></td>
      <td><MiniTrend values={ranking?.trend ?? []} /></td>
      <td><TopApps apps={ranking?.top5 ?? []} artworks={artworks} onOpen={onOpenCompetitor} ownApp={ownApp} country={ranking?.locale ?? 'us'} onEnsureArtworks={onEnsureArtworks} /></td>
      <td>
        <div className="row-actions">
          <button className="row-action row-refresh" onClick={onRefresh} title="Обновить это ключевое слово" aria-label={`Обновить ${keyword}`}>↻</button>
          <button className="row-action row-remove" onClick={onRemove} title="Удалить ключевое слово" aria-label={`Удалить ${keyword}`}>×</button>
        </div>
      </td>
    </tr>
  );
}

function UpdateStatus({ state, timestamp }: { state?: RowUpdateState; timestamp?: number | null }) {
  if (!state) return <span className="muted-cell">{formatRelativeTime(timestamp)}</span>;
  if (state.status === 'queued') return <span className="update-status update-queued"><i /> В очереди</span>;
  if (state.status === 'updating') return <span className="update-status update-running"><i /> Обновление</span>;
  if (state.status === 'retrying') return (
    <span className="update-status update-retry"><i /> Повтор {state.attempt}/{state.maxAttempts}</span>
  );
  if (state.status === 'error') return <span className="update-status update-error"><i /> Ошибка</span>;
  return <span className="update-status update-done"><i /> Только что</span>;
}

function formatRelativeTime(timestamp?: number | null) {
  if (!timestamp) return 'Не обновлялось';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Только что';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн. назад`;
}

function Delta({ value }: { value: number | null }) {
  if (value == null || value === 0) return <span className="delta delta-flat">—</span>;
  return <span className={`delta ${value > 0 ? 'delta-up' : 'delta-down'}`}>{value > 0 ? '↑' : '↓'} {Math.abs(value)}</span>;
}

function MiniTrend({ values }: { values: number[] }) {
  const titleId = useId();
  const cleanValues = values.filter((value) => Number.isFinite(value) && value > 0).slice(-16);
  if (cleanValues.length < 2) return <span className="muted-cell">—</span>;
  const width = 104;
  const height = 30;
  const inset = 3;
  const min = Math.min(...cleanValues);
  const max = Math.max(...cleanValues);
  const range = max - min || 1;
  const points = cleanValues.map((value, index) => ({
    x: inset + index * ((width - inset * 2) / (cleanValues.length - 1)),
    y: inset + ((value - min) / range) * (height - inset * 2),
  }));
  const line = points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const dx = point.x - previous.x;
    return `${path} C ${previous.x + dx * .45},${previous.y} ${point.x - dx * .45},${point.y} ${point.x},${point.y}`;
  }, `M ${points[0].x},${points[0].y}`);
  const area = `${line} L ${points.at(-1)!.x},${height - 1} L ${points[0].x},${height - 1} Z`;
  const start = cleanValues[0];
  const end = cleanValues.at(-1)!;
  const tone = end < start ? 'positive' : end > start ? 'negative' : 'neutral';
  const label = `Позиция изменилась с ${start} на ${end}. Меньше значит лучше.`;
  return (
    <svg className={`position-trend position-trend-${tone}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
      <title id={titleId}>{label}</title>
      <path className="position-trend-area" d={area} />
      <path className="position-trend-line" d={line} />
      <circle className="position-trend-end" cx={points.at(-1)!.x} cy={points.at(-1)!.y} r="2" />
    </svg>
  );
}

function TopApps({ apps, artworks, onOpen, ownApp, country, onEnsureArtworks }: {
  apps: Array<{ name: string; id: string; dev: string; tid?: number; pos?: number }>;
  artworks: Record<string, string>;
  onOpen: (bundleID: string) => void;
  ownApp?: OwnAppIdentity;
  country: string;
  onEnsureArtworks: (candidates: TopFiveCandidate[], country: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const ensureRef = useRef(onEnsureArtworks);
  useEffect(() => { ensureRef.current = onEnsureArtworks; }, [onEnsureArtworks]);
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const load = () => ensureRef.current(apps, country);
    if (typeof IntersectionObserver === 'undefined') { load(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { load(); observer.disconnect(); }
    }, { rootMargin: '240px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [apps, country]);
  if (!apps.length) return <span className="muted-cell">Нет данных</span>;
  return (
    <div className="top-apps" ref={rootRef}>
      {apps.slice(0, 5).map((app, index) => {
        const own = isOwnAppResult(app, ownApp);
        const artwork = (own ? ownApp?.iconUrl : undefined) ?? (app.tid ? artworks[String(app.tid)] : undefined) ?? artworks[app.id];
        const position = app.pos ?? index + 1;
        return (
          <button
            type="button"
            className={`competitor-button ${own ? 'own-app' : ''}`}
            key={`${app.id}-${index}`}
            title={`#${position} ${app.name}${own ? ' · Наше приложение' : ''}`}
            aria-label={`Позиция ${position}: ${app.name}${own ? ', наше приложение' : ''}`}
            onClick={own ? undefined : () => onOpen(app.id)}
          >
            <TopFiveArtwork url={artwork} label={`Иконка ${app.name}`} fallback={app.name} className="competitor-icon" />
            {own ? <span className="own-app-check" aria-hidden="true">✓</span> : null}
          </button>
        );
      })}
      {apps.length > 5 && <small>+{apps.length - 5}</small>}
    </div>
  );
}

function CompetitorDetail({
  appID,
  bundleID,
  country,
  onClose,
}: {
  appID: string;
  bundleID: string;
  country: string;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.competitorInfo>> | null>(null);
  const [pricing, setPricing] = useState<Awaited<ReturnType<typeof api.competitorPricing>> | null>(null);
  const [reviews, setReviews] = useState<Awaited<ReturnType<typeof api.competitorReviews>> | null>(null);
  const [keywords, setKeywords] = useState<Awaited<ReturnType<typeof api.competitorKeywords>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.competitorInfo(bundleID),
      api.competitorKeywords(appID, bundleID).catch(() => []),
    ]).then(async ([metadata, keywordRows]) => {
      if (cancelled) return;
      setInfo(metadata);
      setKeywords(keywordRows);
      if (metadata?.iTunesId) {
        const [priceData, reviewData] = await Promise.all([
          api.competitorPricing(metadata.iTunesId, country).catch(() => null),
          api.competitorReviews(metadata.iTunesId, country).catch(() => null),
        ]);
        if (!cancelled) {
          setPricing(priceData);
          setReviews(reviewData);
        }
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [appID, bundleID, country]);

  return (
    <div className="competitor-backdrop" onMouseDown={onClose}>
      <aside className="competitor-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <header className="competitor-header">
          {info?.iconUrl ? <img src={info.iconUrl} alt="" /> : <span>{(info?.name || bundleID).slice(0, 1)}</span>}
          <div>
            <h2>{loading ? 'Загрузка…' : info?.name || bundleID}</h2>
            <p>{info?.dev || bundleID}</p>
            <div className="competitor-badges">
              {info?.category && <b>{info.category}</b>}
              {info?.rating != null && <b>★ {info.rating.toFixed(1)} · {(info.ratingCount ?? 0).toLocaleString()}</b>}
            </div>
          </div>
          <button onClick={onClose}>×</button>
        </header>

        <div className="competitor-content">
          {info?.screenshotUrls && info.screenshotUrls.length > 0 && (
            <section>
              <div className="sheet-section-title">Скриншоты</div>
              <div className="screenshot-strip">
                {info.screenshotUrls.map((url) => <img key={url} src={url} alt="Скриншот App Store" />)}
              </div>
            </section>
          )}

          <div className="competitor-stats">
            <div><strong>{keywords.length}</strong><span>общих ключевых слов</span></div>
            <div><strong>{new Set(keywords.map((row) => row.locale)).size}</strong><span>регионов</span></div>
            <div><strong>{keywords.length ? (keywords.reduce((sum, row) => sum + row.theirRank, 0) / keywords.length).toFixed(1) : '—'}</strong><span>средняя позиция</span></div>
          </div>

          {info?.description && (
            <section>
              <div className="sheet-section-title">О приложении</div>
              <p className="competitor-description">{info.description}</p>
            </section>
          )}

          <section>
            <div className="sheet-section-title">Подписки и покупки · {country.toUpperCase()}</div>
            {!pricing || pricing.subscriptions.length + pricing.iap.length === 0 ? (
              <p className="sheet-empty">В этой витрине нет доступных продуктов.</p>
            ) : (
              <div className="product-list">
                {[...pricing.subscriptions, ...pricing.iap].map((product, index) => (
                  <div key={`${product.name}-${index}`}><span><strong>{product.name}</strong><small>{product.subtitle || product.duration || product.kind}</small></span><b>{product.price}</b></div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="sheet-section-title">Свежие отзывы · {country.toUpperCase()}</div>
            {!reviews || reviews.reviews.length === 0 ? <p className="sheet-empty">В этой витрине нет свежих отзывов.</p> : (
              <div className="review-list">
                {reviews.reviews.slice(0, 6).map((review) => (
                  <article key={review.id}><div><strong>{review.title || 'Отзыв'}</strong><span>{'★'.repeat(review.rating)}</span></div><p>{review.content}</p><small>{review.author}{review.version ? ` · v${review.version}` : ''}</small></article>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="competitor-footer">
          {info?.storeUrl && <a href={info.storeUrl} target="_blank" rel="noreferrer">Открыть в App Store ↗</a>}
          <button onClick={onClose}>Готово</button>
        </footer>
      </aside>
    </div>
  );
}

function InputDialog({
  dialog,
  busy,
  existingLocales,
  onClose,
  onSubmit,
}: {
  dialog: DialogState;
  busy: boolean;
  existingLocales: string[];
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(dialog.value ?? '');
  const [localeSearch, setLocaleSearch] = useState('');
  const [appResults, setAppResults] = useState<AppStoreSearchResult[]>([]);
  const [appSearching, setAppSearching] = useState(false);
  const [appSearchError, setAppSearchError] = useState('');
  const [selectedAppResult, setSelectedAppResult] = useState<AppStoreSearchResult | null>(null);
  const isError = dialog.kind === 'error';
  const isDelete = dialog.kind === 'delete-app';
  const multiline = dialog.kind === 'keywords';
  const isApp = dialog.kind === 'app';
  const localeOptions = useMemo(() => {
    const needle = localeSearch.trim().toLocaleLowerCase();
    const existing = new Set(existingLocales);
    const available = APP_STORE_LOCALES.filter((locale) => !existing.has(locale.code));
    if (!needle) return available;
    return available.filter((locale) =>
      locale.code.includes(needle) || locale.name.toLocaleLowerCase().includes(needle)
    );
  }, [existingLocales, localeSearch]);

  useEffect(() => {
    if (!isApp) return;
    const term = value.trim();
    if (selectedAppResult && String(selectedAppResult.trackId) === term) {
      setAppResults([]);
      setAppSearching(false);
      return;
    }
    if (term.length < 2) {
      setAppResults([]);
      setAppSearchError('');
      setAppSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setAppSearching(true);
      setAppSearchError('');
      try {
        const results = await api.itunesSearch(term, 'us', controller.signal);
        setAppResults(results.slice(0, 8));
        if (!results.length) setAppSearchError('В App Store США приложения не найдены.');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setAppSearchError('Поиск временно недоступен.');
      } finally {
        if (!controller.signal.aborted) setAppSearching(false);
      }
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isApp, selectedAppResult, value]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (!multiline && !isError && !isApp && !isDelete && event.key === 'Enter' && value.trim()) onSubmit(value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isApp, isDelete, isError, multiline, onClose, onSubmit, value]);

  const selectApp = (result: AppStoreSearchResult) => {
    setSelectedAppResult(result);
    setValue(String(result.trackId));
    setAppResults([]);
    setAppSearchError('');
  };

  const appCanSubmit = /^\d+$/.test(value.trim());

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className={`dialog-symbol ${isError || isDelete ? 'dialog-symbol-error' : ''}`}>{isError ? '!' : isDelete ? '×' : '+'}</div>
        <h2 id="dialog-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        {isDelete ? null : !isError && dialog.kind === 'locale' ? (
          <div className="locale-picker">
            <label className="dialog-search">
              <span>⌕</span>
            <input autoFocus value={localeSearch} onChange={(event) => setLocaleSearch(event.target.value)} placeholder="Найти страну или код" />
            </label>
            <div className="locale-options">
              {localeOptions.map((locale) => (
                <button
                  className={value === locale.code ? 'selected' : ''}
                  key={locale.code}
                  onClick={() => setValue(locale.code)}
                >
                  <span className="locale-option-flag">{localeFlag(locale.code)}</span>
                  <span>{locale.name}</span>
                  <small>{locale.code.toUpperCase()}</small>
                  {value === locale.code && <b>✓</b>}
                </button>
              ))}
            </div>
          </div>
        ) : !isError && isApp ? (
          <div className="app-store-picker">
            <label className="dialog-search app-store-search">
              <span>⌕</span>
              <input
                autoFocus
                value={selectedAppResult ? selectedAppResult.trackName ?? value : value}
                onChange={(event) => {
                  setSelectedAppResult(null);
                  setValue(event.target.value);
                }}
                placeholder={dialog.placeholder}
              />
              {appSearching && <i className="search-spinner" aria-label="Searching" />}
            </label>
            {selectedAppResult ? (
              <button className="app-search-result selected" onClick={() => { setSelectedAppResult(null); setValue(''); }}>
                {selectedAppResult.artworkUrl100 ? <img src={selectedAppResult.artworkUrl100} alt="" /> : <span className="app-result-fallback">{(selectedAppResult.trackName || 'A')[0]}</span>}
                <span><strong>{selectedAppResult.trackName}</strong><small>{selectedAppResult.artistName} · {selectedAppResult.bundleId}</small></span>
                <b>✓</b>
              </button>
            ) : (
              <div className="app-search-results">
                {appResults.map((result) => (
                  <button className="app-search-result" key={result.trackId} onClick={() => selectApp(result)}>
                    {result.artworkUrl100 ? <img src={result.artworkUrl100} alt="" /> : <span className="app-result-fallback">{(result.trackName || 'A')[0]}</span>}
                    <span><strong>{result.trackName}</strong><small>{result.artistName}{result.primaryGenreName ? ` · ${result.primaryGenreName}` : ''}</small></span>
                    {result.averageUserRating != null && <em>★ {result.averageUserRating.toFixed(1)}</em>}
                  </button>
                ))}
                {appSearchError && <div className="app-search-empty">{appSearchError}</div>}
                {!value.trim() && <div className="app-search-empty">Начните вводить, чтобы искать в App Store США.</div>}
              </div>
            )}
          </div>
        ) : !isError && !isDelete && (multiline ? (
          <textarea autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={dialog.placeholder} rows={6} />
        ) : (
          <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={dialog.placeholder} inputMode={dialog.kind === 'app' ? 'numeric' : 'text'} />
        ))}
        <div className="dialog-actions">
          {!isError && <button className="dialog-button dialog-button-secondary" onClick={onClose}>Отмена</button>}
          <button
            className={`dialog-button ${isDelete ? 'dialog-button-danger' : 'dialog-button-primary'}`}
            disabled={busy || (!isError && (!value.trim() || (isApp && !appCanSubmit)))}
            onClick={() => onSubmit(value)}
          >
            {busy ? 'Выполняется…' : isError ? 'Готово' : isDelete ? 'Удалить приложение' : dialog.kind === 'keywords' ? 'Добавить ключевые слова' : dialog.kind === 'locale' ? 'Добавить регион' : 'Добавить приложение'}
          </button>
        </div>
      </section>
    </div>
  );
}

const IDEA_LEVEL_LABEL: Record<KeywordIdea['level'], string> = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };

function asaSignalLabel(state: KeywordSuggestionsResponse['signals']['asaPopularity']) {
  if (state === 'ok') return 'Популярность Apple Ads: есть для части фраз';
  if (state === 'no-data') return 'Популярность Apple Ads: Apple не отдала данные по этим фразам';
  return 'Популярность Apple Ads: сервис недоступен — оценка без неё';
}

function SuggestionsPanel({
  locale,
  data,
  loading,
  error,
  onReload,
  onAdd,
}: {
  locale: string;
  data: KeywordSuggestionsResponse | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onAdd: (keywords: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [cluster, setCluster] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const ideas = data?.ideas ?? [];
  const clusters = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const idea of ideas) {
      const entry = counts.get(idea.cluster.id) ?? { label: idea.cluster.label, count: 0 };
      entry.count++;
      counts.set(idea.cluster.id, entry);
    }
    return Array.from(counts, ([id, entry]) => ({ id, ...entry })).sort((a, b) => b.count - a.count);
  }, [ideas]);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = ideas.filter((idea) =>
    (cluster === 'all' || idea.cluster.id === cluster) && idea.keyword.toLocaleLowerCase().includes(needle)
  );

  const toggle = (keyword: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  };

  const add = async () => {
    if (!selected.size) return;
    setSaving(true);
    try { await onAdd(Array.from(selected)); } finally { setSaving(false); }
  };

  return (
      <section className="suggestions-page" aria-labelledby="suggestions-title">
        <h2 id="suggestions-title" className="sr-only">Идеи ключевых слов</h2>
        <div className="page-commandbar">
          <span className="page-scope">{localeFlag(locale)} {locale.toUpperCase()} · подсказки Apple, названия конкурентов из топ-5 и Apple Ads · бренды отфильтрованы</span>
          <button className="toolbar-labeled" onClick={onReload} disabled={loading} title="Пересобрать идеи заново" aria-label="Обновить идеи">↻ Обновить</button>
        <label className="dialog-search suggestion-search">
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск идей" />
        </label>
        </div>
        {data && ideas.length > 0 && (
          <div className="idea-filters" role="group" aria-label="Тема">
            <button type="button" className={cluster === 'all' ? 'active' : ''} onClick={() => setCluster('all')}>Все <span>{ideas.length}</span></button>
            {clusters.map((item) => (
              <button type="button" key={item.id} className={cluster === item.id ? 'active' : ''} onClick={() => setCluster(item.id)}>{item.label} <span>{item.count}</span></button>
            ))}
            <small>{asaSignalLabel(data.signals.asaPopularity)}</small>
          </div>
        )}
        <div className="suggestion-list">
          <div className="suggestion-table-head" role="row">
            <span aria-label="Выбор" />
            <span>Ключевое слово <button type="button" className="traffic-info-button" data-tooltip="Фраза, которой ещё нет в отслеживаемых ключах этой страны. Показываются только общие запросы категории: названия конкурентов, разработчиков, обрывки названий и фразы другого интента отфильтрованы (список внизу)." aria-label="Как читать колонку «Ключевое слово»">?</button></span>
            <span>Откуда <button type="button" className="traffic-info-button" data-tooltip="Конкретное доказательство: при вводе какого вашего ключа Apple подсказала фразу и на каком месте, в названиях скольких конкурентов из топ-5 и по каким ключам она встречается, рекомендовала ли её Apple Ads." aria-label="Как читать колонку «Откуда»">?</button></span>
            <span>Ожидаемый эффект <button type="button" className="traffic-info-button" data-tooltip={data?.formula ?? 'Оценка = спрос × шанс × 100.'} aria-label="Как считается ожидаемый эффект">?</button></span>
          </div>
          {loading ? (
            <div className="suggestions-empty">Ищем релевантные идеи…</div>
          ) : error ? (
            <div className="suggestions-empty"><span>{error}</span><button className="dialog-button dialog-button-secondary" onClick={onReload}>Повторить</button></div>
          ) : filtered.length === 0 ? (
            <div className="suggestions-empty">Новых общих запросов не нашлось. Apple подсказывает в основном названия приложений — их мы не предлагаем. Добавьте больше исходных ключей или обновите снимок.</div>
          ) : filtered.map((idea) => (
            <button className={selected.has(idea.keyword) ? 'selected' : ''} key={idea.keyword} onClick={() => toggle(idea.keyword)} aria-pressed={selected.has(idea.keyword)}>
              <span className="suggestion-check">{selected.has(idea.keyword) ? '✓' : ''}</span>
              <span className="suggestion-copy"><strong>{idea.keyword}</strong><small title={idea.reason}>{idea.reason}</small></span>
              <span className="idea-origin">
                {idea.origin.map((line) => <small key={line} title={line}>{line}</small>)}
              </span>
              <span className={`idea-gain gain-${idea.level}`} title={idea.inputs.join('\n')}>
                <span className="idea-gain-head"><em>{IDEA_LEVEL_LABEL[idea.level]}</em><b>{idea.score}</b></span>
                <i><em style={{ width: `${Math.max(2, Math.min(100, idea.score))}%` }} /></i>
                <small>спрос {idea.demand.toFixed(2)} × шанс {idea.chance.toFixed(2)} · оценка</small>
              </span>
            </button>
          ))}
          {!loading && data && data.rejected.length > 0 && (
            <details className="idea-rejected">
              <summary>Отфильтровано: {data.rejected.length} — бренды, названия приложений, обрывки и другой интент{data.trackedSkipped ? ` · уже отслеживаются: ${data.trackedSkipped}` : ''}</summary>
              <ul>
                {data.rejected.map((item) => <li key={item.keyword}><b>{item.keyword}</b><span>{item.reason}</span></li>)}
              </ul>
            </details>
          )}
        </div>
        <footer>
          <span>Выбрано: {selected.size}</span>
          <button className="dialog-button dialog-button-primary" disabled={!selected.size || saving} onClick={add}>{saving ? 'Добавляем…' : `Добавить ключевые слова: ${selected.size || ''}`}</button>
        </footer>
      </section>
  );
}
function Sparkline({ values, width = 120, height = 26 }: { values: number[]; width?: number; height?: number }) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return <span className="muted-cell">—</span>;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const points = clean.map((value, index) => {
    const x = index * (width / (clean.length - 1));
    const y = 3 + (1 - (value - min) / range) * (height - 6);
    return `${x},${y}`;
  }).join(' ');
  return <svg className="mini-trend sparkline" viewBox={`0 0 ${width} ${height}`}><polyline points={points} /></svg>;
}

function KeywordDrawer({
  keyword,
  ranking,
  relevance,
  locale,
  artworks,
  ownApp,
  onClose,
  onRefresh,
  onCopyPrompt,
  onOpenCompetitor,
}: {
  keyword: string;
  ranking?: RankingRow;
  relevance?: RelevanceRow;
  locale: string;
  artworks: Record<string, string>;
  ownApp?: OwnAppIdentity;
  onClose: () => void;
  onRefresh: () => void;
  onCopyPrompt: () => Promise<void>;
  onOpenCompetitor: (bundleID: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const dayDelta = delta(ranking?.yesterday ?? null, ranking?.today ?? null);
  const weekDelta = delta(ranking?.w1 ?? null, ranking?.today ?? null);
  const monthDelta = delta(ranking?.w4 ?? null, ranking?.today ?? null);

  const copy = async () => {
    try {
      await onCopyPrompt();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard denied */ }
  };

  return (
    <div className="competitor-backdrop" onMouseDown={onClose}>
      <aside className="competitor-sheet keyword-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header className="competitor-header">
          <span className={`drawer-rank rank rank-${rankTone(ranking?.today ?? null)}`}>{ranking?.today ? `#${ranking.today}` : '—'}</span>
          <div>
            <h2>{keyword}</h2>
            <p>{localeFlag(locale)} {locale.toUpperCase()} · обновлено {formatRelativeTime(ranking?.lastUpdated).toLowerCase()}</p>
            {relevance && (
              <div className="competitor-badges">
                <b className={`relevance-chip relevance-${relevance.flag}`} style={{ marginLeft: 0 }}>{RELEVANCE_LABEL[relevance.flag]}</b>
                <b>{relevance.matchCount}/5 того же жанра</b>
              </div>
            )}
          </div>
          <button onClick={onClose}>×</button>
        </header>

        <div className="competitor-content">
          <div className="competitor-stats">
            <div><strong><Delta value={dayDelta} /></strong><span>24 часа</span></div>
            <div><strong><Delta value={weekDelta} /></strong><span>7 дней</span></div>
            <div><strong><Delta value={monthDelta} /></strong><span>30 дней</span></div>
          </div>

          {(ranking?.trend?.length ?? 0) >= 2 && (
            <section>
              <div className="sheet-section-title">Динамика позиции</div>
              <div className="drawer-trend"><Sparkline values={ranking!.trend} width={380} height={64} /></div>
            </section>
          )}

          <section>
            <div className="sheet-section-title">Топ приложений в выдаче</div>
            {!ranking?.top5?.length ? (
              <p className="sheet-empty">Данных снимка пока нет. Запустите обновление для этого ключевого слова.</p>
            ) : (
              <div className="drawer-top5">
                {ranking.top5.map((app, index) => {
                  const own = isOwnAppResult(app, ownApp);
                  const artwork = (own ? ownApp?.iconUrl : undefined) ?? (app.tid ? artworks[String(app.tid)] : undefined) ?? artworks[app.id];
                  const genre = relevance?.top5?.find((r) => (r.bundleId ?? r.id) === app.id)?.genre;
                  return (
                    <button
                      type="button"
                      className={own ? 'own-app-row' : ''}
                      key={`${app.id}-${index}`}
                      onClick={own ? undefined : () => onOpenCompetitor(app.id)}
                    >
                      <b>#{app.pos ?? index + 1}</b>
                      {artwork ? <img src={artwork} alt="" /> : <span className="competitor-icon">{app.name.trim().slice(0, 1).toUpperCase()}</span>}
                      <span><strong>{app.name}{own ? <em>Наше приложение</em> : null}</strong><small>{app.dev}{genre ? ` · ${genre}` : ''}</small></span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {relevance && relevance.genreHistogram.length > 0 && (
            <section>
              <div className="sheet-section-title">Жанры в топ-5</div>
              <div className="drawer-genres">
                {relevance.genreHistogram.map((genre) => (
                  <span key={genre.genre}>{genre.genre} <b>×{genre.count}</b></span>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="competitor-footer">
          <button onClick={copy}>{copied ? 'Скопировано' : 'Скопировать запрос для анализа'}</button>
          <button onClick={onRefresh}>↻ Обновить ключевое слово</button>
          <button onClick={onClose}>Готово</button>
        </footer>
      </aside>
    </div>
  );
}

const PERIOD_LABEL: Record<'day' | 'week' | 'month', string> = {
  day: 'сравнение со вчера',
  week: 'сравнение с 7 днями назад',
  month: 'сравнение с 30 днями назад',
};

function AnalyticsPanel({
  apps,
  initialApp,
}: {
  apps: AppStats[];
  initialApp: string;
}) {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
  const [appFilter, setAppFilter] = useState(initialApp);
  const [data, setData] = useState<MoversResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.movers(period, appFilter || undefined)
      .then((response) => { if (!cancelled) setData(response); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, appFilter]);

  const summary = data?.summary;

  return (
      <section className="analytics-page" aria-labelledby="analytics-title">
        <h2 id="analytics-title" className="sr-only">Динамика позиций</h2>
        <div className="page-commandbar">
          <span className="page-scope">Отслеживаемые ключевые слова · {PERIOD_LABEL[period]} · все регионы</span>
          <div className="analytics-controls">
            <div className="segmented">
              {(['day', 'week', 'month'] as const).map((value) => (
                <button key={value} className={period === value ? 'selected' : ''} onClick={() => setPeriod(value)}>
                  {{ day: 'День', week: 'Неделя', month: 'Месяц' }[value]}
                </button>
              ))}
            </div>
            <select value={appFilter} onChange={(event) => setAppFilter(event.target.value)}>
              <option value="">Все приложения</option>
              {apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
            </select>
          </div>
        </div>

        {error ? (
          <div className="analytics-empty">{error}</div>
        ) : loading || !data ? (
          <div className="analytics-empty">Загрузка…</div>
        ) : (
          <div className="analytics-content">
            {summary && (
              <>
              <div className="analytics-summary">
                <div><strong>{summary.totalRanked}</strong><span>в выдаче</span><Delta value={summary.rankedDelta} /></div>
                <div><strong>{summary.top10}</strong><span>топ-10</span><Delta value={summary.top10Delta} /></div>
                <div><strong>{summary.top50}</strong><span>топ-50</span><Delta value={summary.top50Delta} /></div>
                <div>
                  <strong>{summary.avgPosition != null ? `#${summary.avgPosition.toFixed(0)}` : '—'}</strong>
                  <span>ср. позиция</span>
                  <Delta value={summary.avgDelta != null ? Math.round(summary.avgDelta) : null} />
                </div>
              </div>
              <AnalyticsComparison summary={summary} />
              </>
            )}
            <div className="movers-grid">
              <MoversList title="Рост" tone="positive" movers={data.gainers} />
              <MoversList title="Падение" tone="negative" movers={data.losers} />
              <MoversList title="Новые в выдаче" tone="positive" movers={data.newlyRanked} />
              <MoversList title="Вышли из выдачи" tone="negative" movers={data.dropouts} />
            </div>
          </div>
        )}
      </section>
  );
}

function AnalyticsComparison({ summary }: { summary: MoversResponse['summary'] }) {
  const metrics = [
    { label: 'В выдаче', current: summary.totalRanked, previous: summary.prevRanked },
    { label: 'Топ-50', current: summary.top50, previous: summary.prevTop50 },
    { label: 'Топ-10', current: summary.top10, previous: summary.prevTop10 },
  ];
  const max = Math.max(1, ...metrics.flatMap((metric) => [metric.current, metric.previous]));
  return (
    <div className="analytics-comparison" aria-label="Сравнение текущего и прошлого периода">
      <header><strong>Изменение видимости</strong><span><i /> Сейчас <i /> Прошлый период</span></header>
      {metrics.map((metric) => (
        <div key={metric.label}>
          <span>{metric.label}</span>
          <div><i style={{ width: `${(metric.current / max) * 100}%` }} /><i style={{ width: `${(metric.previous / max) * 100}%` }} /></div>
          <b>{metric.current}</b>
        </div>
      ))}
    </div>
  );
}

function MoversList({ title, tone, movers }: { title: string; tone: 'positive' | 'negative'; movers: Mover[] }) {
  return (
    <section className="movers-list">
      <div className="sheet-section-title">{title}</div>
      {movers.length === 0 ? (
        <p className="sheet-empty">За этот период данных нет.</p>
      ) : (
        <div className="movers-rows">
          {movers.slice(0, 12).map((mover) => (
            <div key={`${mover.app}-${mover.locale}-${mover.keyword}`}>
              <span className="mover-keyword">
                <strong>{mover.keyword}</strong>
                <small>{mover.appName} · {localeFlag(mover.locale)} {mover.locale.toUpperCase()}</small>
              </span>
              <span className="mover-shift">{mover.from != null ? `#${mover.from}` : '—'} → {mover.to != null ? `#${mover.to}` : '—'}</span>
              <b className={`mover-delta mover-${tone}`}>{mover.delta > 0 ? `+${mover.delta}` : mover.delta}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SkeletonRow() {
  return (
    <tr className="skeleton-row">
      <td><i /></td><td><i /></td><td><i /></td><td><i /></td><td><i /></td><td><i /></td><td><i /></td><td />
    </tr>
  );
}
