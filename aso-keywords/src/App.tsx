import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Competitors from './screens/Competitors';
import Overview from './screens/Overview';
import AcquisitionFunnel from './screens/AcquisitionFunnel';
import ConnectGate from './components/ConnectGate';
import Experiments from './screens/Experiments';
import { TopFiveArtwork } from './components/KeywordResultsDrawer';
import Icon from './components/Icon';
import Picker from './components/Picker';
import { useDismiss } from './components/useDismiss';
import CountryPalette from './components/CountryPalette';
import CountryMatrix from './screens/CountryMatrix';
import {
  columnSets,
  countriesApi,
  loadRecent,
  pushRecent,
  resolveColumnSet,
  storefrontOf,
  type CountrySetsResponse,
} from './countries';
import { HBars, Legend, SERIES, Sparkline as ChartSparkline, type TipRow } from '../../shared/charts/Charts';
import { StudioSwitcher } from '../../shared/shell/StudioSwitcher';

type TopFiveCandidate = { id: string; tid?: number };

type AppView = 'overview' | 'keywords' | 'competitors' | 'funnel' | 'experiments';
type KeywordView = 'matrix' | 'positions' | 'analytics' | 'ideas';

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
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<SnapshotEvent | null>(null);
  const [artworks, setArtworks] = useState<Record<string, string>>(initialArtworkCache);
  const artworksRef = useRef(artworks);
  const artworkWorkRef = useRef<Promise<void>>(Promise.resolve());
  const artworkInFlightRef = useRef(new Set<string>());
  const artworkNegativeRef = useRef(new Map<string, number>());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [rowUpdates, setRowUpdates] = useState<Record<string, RowUpdateState>>({});
  const [competitorBundle, setCompetitorBundle] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<KeywordSuggestionsResponse | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [updateMenuOpen, setUpdateMenuOpen] = useState(false);
  const updateMenuRef = useRef<HTMLDivElement>(null);
  const closeUpdateMenu = useCallback(() => setUpdateMenuOpen(false), []);
  useDismiss(updateMenuRef, updateMenuOpen, closeUpdateMenu);
  const [relevanceOn, setRelevanceOn] = useState(false);
  const [relevance, setRelevance] = useState<Record<string, RelevanceRow>>({});
  const [snapshotSpeed, setSnapshotSpeed] = useState<SnapshotSpeed>(
    () => (localStorage.getItem('snapshotSpeed') === 'slow' ? 'slow' : 'medium')
  );
  const [view, setView] = useState<AppView>(() => {
    const requested = window.location.hash.slice(1);
    return requested === 'overview' || requested === 'competitors' || requested === 'funnel' || requested === 'experiments' ? requested : 'keywords';
  });
  const [keywordView, setKeywordView] = useState<KeywordView>(() => {
    const requested = window.location.hash.slice(1);
    return requested === 'analytics' || requested === 'ideas' || requested === 'positions' ? requested : 'matrix';
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
  // Country navigation state. The URL carries app / storefront / column set / view
  // (?app=medscan&locale=mx#positions, ?app=medscan&set=fav#matrix) so every view
  // is linkable; user navigation pushes history entries, so back/forward works.
  const [countrySets, setCountrySets] = useState<CountrySetsResponse | null>(null);
  const [matrixSetId, setMatrixSetId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('set'));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recentTick, setRecentTick] = useState(0);
  const [matrixRefreshKey, setMatrixRefreshKey] = useState(0);
  const [cellDetail, setCellDetail] = useState<{ keyword: string; locale: string; ranking?: RankingRow; loading: boolean } | null>(null);
  const pushNextUrl = useRef(false);
  const markNavigation = () => { pushNextUrl.current = true; };

  useEffect(() => {
    const route = view === 'keywords' ? keywordView : view;
    const params = new URLSearchParams(window.location.search);
    if (selectedAppID) params.set('app', selectedAppID); else params.delete('app');
    const matrix = view === 'keywords' && keywordView === 'matrix';
    if (locale && !matrix) params.set('locale', locale); else params.delete('locale');
    if (matrix && matrixSetId) params.set('set', matrixSetId); else params.delete('set');
    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ''}#${route}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) { pushNextUrl.current = false; return; }
    if (pushNextUrl.current) window.history.pushState(null, '', next);
    else window.history.replaceState(null, '', next);
    pushNextUrl.current = false;
  }, [keywordView, view, selectedAppID, locale, matrixSetId]);

  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const route = window.location.hash.slice(1);
      if (route === 'overview' || route === 'competitors' || route === 'funnel' || route === 'experiments') setView(route);
      else {
        setView('keywords');
        setKeywordView(route === 'analytics' || route === 'ideas' || route === 'positions' ? route : 'matrix');
      }
      const app = params.get('app');
      if (app) setSelectedAppID(app);
      const nextLocale = params.get('locale');
      if (nextLocale) setLocale(nextLocale.toLowerCase());
      if (params.has('set')) setMatrixSetId(params.get('set'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
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
      setMatrixRefreshKey((key) => key + 1);
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
    markNavigation();
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

  // --- Country navigation -------------------------------------------------------
  useEffect(() => {
    if (!selectedApp) return;
    let cancelled = false;
    countriesApi.countrySets(selectedApp.id)
      .then((sets) => { if (!cancelled) setCountrySets(sets); })
      .catch(() => { if (!cancelled) setCountrySets(null); });
    return () => { cancelled = true; };
  }, [selectedApp?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recents are a per-viewer convenience (localStorage); recentTick re-reads them.
  const recentStorefronts = useMemo(() => (selectedApp ? loadRecent(selectedApp.id) : []), [selectedApp, recentTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const matrixSets = useMemo(() => columnSets(countrySets, keywordMap), [countrySets, keywordMap]);
  const activeMatrixSet = resolveColumnSet(matrixSets, matrixSetId);
  const trackedStorefronts = useMemo(
    () => Object.keys(keywordMap).sort((a, b) => storefrontOf(a).name.localeCompare(storefrontOf(b).name, 'ru')),
    [keywordMap]
  );
  const [paletteAvg, setPaletteAvg] = useState<Record<string, number | null>>({});
  const paletteStats = useMemo(() => Object.fromEntries(trackedStorefronts.map((code) => [
    code, { keywords: keywordMap[code]?.length ?? 0, avg: paletteAvg[code] ?? null },
  ])), [keywordMap, paletteAvg, trackedStorefronts]);
  useEffect(() => {
    if (!paletteOpen || !selectedApp) return;
    let cancelled = false;
    api.appLocales(selectedApp.id)
      .then((rows) => { if (!cancelled) setPaletteAvg(Object.fromEntries(rows.map((row) => [row.code.toLowerCase(), row.avg]))); })
      .catch(() => { /* averages are decoration */ });
    return () => { cancelled = true; };
  }, [paletteOpen, selectedApp]);

  const isMatrix = view === 'keywords' && keywordView === 'matrix';

  const selectStorefront = useCallback((code: string) => {
    if (!keywordMap[code]) return;
    markNavigation();
    setLocale(code);
    if (selectedApp) { pushRecent(selectedApp.id, code); setRecentTick((tick) => tick + 1); }
    // Storefront-scoped views stay put; the matrix and cross-app views open positions.
    if (view !== 'keywords' && view !== 'competitors') setView('keywords');
    if (view !== 'competitors' && (view !== 'keywords' || keywordView === 'matrix')) setKeywordView('positions');
    setPaletteOpen(false);
  }, [keywordMap, keywordView, selectedApp, view]);

  const openMatrix = useCallback((setId?: string) => {
    markNavigation();
    if (setId) setMatrixSetId(setId);
    setView('keywords');
    setKeywordView('matrix');
    setPaletteOpen(false);
    setMobileNavOpen(false);
  }, []);

  const stepStorefront = useCallback((direction: 1 | -1) => {
    if (!trackedStorefronts.length) return;
    const index = trackedStorefronts.indexOf(locale);
    const next = trackedStorefronts[(index + direction + trackedStorefronts.length) % trackedStorefronts.length];
    selectStorefront(next);
  }, [locale, selectStorefront, trackedStorefronts]);

  const saveCountrySets = async (update: (current: CountrySetsResponse) => { favorites: string[]; sets: CountrySetsResponse['sets'] }) => {
    if (!selectedApp) return;
    const base = countrySets ?? { favorites: [], sets: [], presets: [] };
    const next = update(base);
    setCountrySets({ ...base, ...next });
    try {
      const saved = await countriesApi.saveCountrySets(selectedApp.id, next);
      setCountrySets(saved);
      return saved;
    } catch (error) {
      setCountrySets(base);
      setDialog({ kind: 'error', title: 'Не удалось сохранить наборы стран', message: (error as Error).message });
      return undefined;
    }
  };
  const toggleFavorite = (code: string) => saveCountrySets((current) => ({
    sets: current.sets,
    favorites: current.favorites.includes(code) ? current.favorites.filter((item) => item !== code) : [...current.favorites, code],
  }));
  const saveMatrixSet = async (name: string, locales: string[]) => {
    const before = new Set((countrySets?.sets ?? []).map((set) => set.id));
    const saved = await saveCountrySets((current) => ({ favorites: current.favorites, sets: [...current.sets, { id: '', name, locales }] }));
    const created = saved?.sets.find((set) => !before.has(set.id));
    if (created) { markNavigation(); setMatrixSetId(created.id); }
  };
  const deleteMatrixSet = async (id: string) => {
    await saveCountrySets((current) => ({ favorites: current.favorites, sets: current.sets.filter((set) => set.id !== id) }));
    setMatrixSetId(null);
  };

  const keyRefs = useRef({ selectStorefront, openMatrix, stepStorefront, favorites: countrySets?.favorites ?? [], paletteOpen });
  useEffect(() => {
    keyRefs.current = { selectStorefront, openMatrix, stepStorefront, favorites: (countrySets?.favorites ?? []).filter((code) => keywordMap[code]), paletteOpen };
  });

  // ⌘K — storefront palette; ⌘1…⌘9 — favorites; ⌘0 — «Все страны»; ⌘[ / ⌘] — previous /
  // next storefront. Browsers reserve some ⌘-digits for tabs, so ⌥ / Ctrl + digit work too.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const refs = keyRefs.current;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (refs.paletteOpen) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
      if (digit != null && (mod || event.altKey) && !event.shiftKey) {
        if (digit === '0') { event.preventDefault(); refs.openMatrix(); return; }
        const code = refs.favorites[Number(digit) - 1];
        if (code) { event.preventDefault(); refs.selectStorefront(code); }
        return;
      }
      if (mod && !event.shiftKey && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
        event.preventDefault();
        refs.stepStorefront(event.code === 'BracketLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Matrix cell → keyword drawer for that storefront (rankings of one storefront are small).
  const openCell = useCallback((keyword: string, cellLocale: string) => {
    if (!selectedApp) return;
    setCellDetail({ keyword, locale: cellLocale, loading: true });
    api.rankings(selectedApp.id, cellLocale)
      .then((rows) => {
        const ranking = rows.find((row) => row.keyword.toLocaleLowerCase() === keyword.toLocaleLowerCase());
        if (ranking?.top5?.length) ensureArtworkForTop5(ranking.top5, cellLocale);
        setCellDetail((current) => current && current.keyword === keyword && current.locale === cellLocale ? { ...current, ranking, loading: false } : current);
      })
      .catch(() => setCellDetail((current) => current ? { ...current, loading: false } : current));
  }, [ensureArtworkForTop5, selectedApp]);

  const refreshCell = async () => {
    if (!selectedApp || !cellDetail) return;
    const { keyword, locale: cellLocale } = cellDetail;
    try {
      await api.refreshKeyword(selectedApp.id, cellLocale, keyword);
      openCell(keyword, cellLocale);
      setMatrixRefreshKey((key) => key + 1);
    } catch (error) {
      setDialog({ kind: 'error', title: 'Не удалось обновить ключевое слово', message: (error as Error).message });
    }
  };

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
          <h1>Keywords</h1>
          <p>Добавьте приложение из App Store, чтобы отслеживать позиции по ключевым словам.</p>
          <button className="ds-btn ds-btn-primary" onClick={openAppDialog}>Добавить первое приложение</button>
          {dialog && <InputDialog dialog={dialog} busy={dialogBusy} existingLocales={Object.keys(keywordMap)} onClose={() => setDialog(null)} onSubmit={submitDialog} />}
        </div>
      </main>
    );
  }

  return (
    <div className="workspace">
      <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-titlebar">
          <StudioSwitcher current="keywords" />
        </div>

        <nav className="utility-nav" aria-label="Рабочая область">
          <button className={view === 'overview' ? 'selected' : ''} onClick={() => { markNavigation(); setView('overview'); setMobileNavOpen(false); }}>
            <span className="nav-label">Обзор</span>
          </button>
          <button className={view === 'keywords' ? 'selected' : ''} onClick={() => openKeywordView(view === 'keywords' ? keywordView : 'matrix')}>
            <span className="nav-label">Ключевые слова</span>
          </button>
          <button className={view === 'competitors' ? 'selected' : ''} onClick={() => { markNavigation(); setView('competitors'); setMobileNavOpen(false); }} disabled={!selectedApp}>
            <span className="nav-label">Конкуренты</span>
          </button>
          <button className={view === 'funnel' ? 'selected' : ''} onClick={() => { markNavigation(); setView('funnel'); setMobileNavOpen(false); }} disabled={!selectedApp || !locale}>
            <span className="nav-label">Воронка</span>
          </button>
          <button className={view === 'experiments' ? 'selected' : ''} onClick={() => { markNavigation(); setView('experiments'); setMobileNavOpen(false); }} disabled={!selectedApp}>
            <span className="nav-label">Эксперименты</span>
          </button>
        </nav>

        <div className="rail-spacer" />
        <a className="rail-link" href="/asa/">Ads</a>
        <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        </button>
      </aside>

      {mobileNavOpen && <button className="mobile-nav-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Закрыть навигацию" />}

      <div className="main-shell">
        <header className="context-bar">
          <button className="mobile-nav-toggle" onClick={() => setMobileNavOpen(true)} aria-label="Открыть навигацию">Меню</button>
          {selectedApp && (
            <Picker
              className="app-picker"
              label="Приложение"
              searchPlaceholder="Найти приложение"
              value={selectedApp.id}
              onChange={(id) => { markNavigation(); setSelectedAppID(id); }}
              options={apps.map((app) => ({ value: app.id, label: app.name, lead: <AppIcon app={app} size={20} /> }))}
            />
          )}
          {locale && view !== 'overview' && view !== 'funnel' && view !== 'experiments' && (
            <span className="storefront-step">
              <button
                type="button"
                className="storefront-btn"
                onClick={() => setPaletteOpen(true)}
                aria-haspopup="dialog"
                aria-label={isMatrix ? `Витрина: все страны, набор ${activeMatrixSet?.name ?? ''}` : `Витрина: ${storefrontOf(locale).name}`}
                title="Выбрать витрину (⌘K)"
              >
                {isMatrix ? <>
                  <Icon name="globe" className="sf-globe" />
                  <span className="sf-label">Все страны</span>
                  <span className="sf-code">{activeMatrixSet ? (activeMatrixSet.id === 'all' ? `${activeMatrixSet.locales.length}` : `${activeMatrixSet.name} · ${activeMatrixSet.locales.length}`) : ''}</span>
                </> : <>
                  <span className="sf-flag" aria-hidden="true">{storefrontOf(locale).flag}</span>
                  <span className="sf-label">{storefrontOf(locale).name}</span>
                  <span className="sf-code">{locale.toUpperCase()}</span>
                </>}
                <kbd>⌘K</kbd>
              </button>
              {!isMatrix && trackedStorefronts.length > 1 && <>
                <button type="button" className="ds-icon-btn" onClick={() => stepStorefront(-1)} aria-label="Предыдущая витрина" title="Предыдущая витрина (⌘[)"><Icon name="chevronLeft" /></button>
                <button type="button" className="ds-icon-btn" onClick={() => stepStorefront(1)} aria-label="Следующая витрина" title="Следующая витрина (⌘])"><Icon name="chevronRight" /></button>
              </>}
            </span>
          )}
          <span className="context-freshness" aria-live="polite">
            {freshnessLabel(selectedApp?.lastSnapshot)}
          </span>
          <span className="context-spacer" />
          <button className="ds-btn" onClick={openAppDialog}><Icon name="plus" /> Добавить приложение</button>
        </header>

      {view === 'overview' ? (
        <Overview
          apps={apps}
          localeAvgByApp={localeAvgByApp}
          onOpenApp={(id) => { markNavigation(); setSelectedAppID(id); setKeywordView('matrix'); setView('keywords'); }}
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
              <h1 className="ds-page-title">Ключевые слова</h1>
              <div className="ds-seg page-tabs" role="tablist" aria-label="Раздел ключевых слов">
                {([['matrix', 'Матрица'], ['positions', 'Позиции'], ['ideas', 'Идеи'], ['analytics', 'Динамика']] as const).map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={keywordView === id}
                    disabled={id !== 'positions' && (!selectedApp || (id === 'ideas' && !locale))}
                    onClick={() => openKeywordView(id)}>{label}</button>
                ))}
              </div>
              <p className="ds-page-sub">{keywordView === 'matrix'
                ? 'Позиции каждого ключа во всех странах набора. Клик по ячейке — история и выдача, ⌘K — выбор страны.'
                : keywordView === 'positions'
                ? `Позиции в витрине ${storefrontOf(locale).flag} ${storefrontOf(locale).name}: релевантность и приложения, лидирующие по каждому запросу.`
                : keywordView === 'analytics'
                  ? 'Сравнивайте рост, падение и видимость ключевых слов за выбранный период.'
                  : 'Проверяйте подсказки Apple и запросы конкурентов перед добавлением в отслеживание.'}</p>
            </div>
            {keywordView === 'positions' ? <button className="ds-btn ds-btn-primary" onClick={openKeywordsDialog}>Добавить ключевые слова</button> : null}
          </div>
        {keywordView === 'positions' && <div className="toolbar">
          <div className="split-btn" ref={updateMenuRef}>
            <button className="split-btn-main" onClick={refresh} disabled={refreshing} aria-label="Обновить позиции">
              <Icon name="refresh" className={refreshing ? 'spinning' : ''} /> Обновить
            </button>
            <button className="split-btn-caret" onClick={() => setUpdateMenuOpen((open) => !open)} aria-label="Параметры обновления" aria-haspopup="menu" aria-expanded={updateMenuOpen}>
              <Icon name="chevronDown" />
            </button>
            {updateMenuOpen && (
              <div className="menu update-menu" role="menu">
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
                    {snapshotSpeed === speed && <b><Icon name="check" /></b>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="ds-btn" onClick={openLocaleDialog} aria-label="Добавить регион"><Icon name="plus" /> Регион</button>

          <span className="toolbar-spacer" />

          {refreshing && (
            <span className="snapshot-status">
              <i /> {snapshotStatusText(progress, rows.length)}
              <button className="snapshot-stop" onClick={() => abortSnapshot().catch(() => {})} title="Остановить обновление"><Icon name="stop" size={12} /> Стоп</button>
            </span>
          )}
          <button
            className={`ds-btn relevance-toggle ${relevanceOn ? 'active' : ''}`}
            onClick={() => setRelevanceOn((on) => !on)}
            aria-pressed={relevanceOn}
            title="Показывает, совпадает ли жанр приложений из топ-5 с жанром вашего приложения"
          ><Icon name="target" /> Релевантность</button>
          <label className="search-field">
            <Icon name="search" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск ключевых слов" />
          </label>
        </div>}
        </header>

        {keywordView === 'matrix' ? (
          selectedApp ? (
            <CountryMatrix
              appId={selectedApp.id}
              sets={matrixSets}
              activeSet={activeMatrixSet}
              onSetChange={(id) => { markNavigation(); setMatrixSetId(id); }}
              onSaveSet={saveMatrixSet}
              onDeleteSet={deleteMatrixSet}
              onOpenCell={openCell}
              onOpenStorefront={selectStorefront}
              refreshKey={matrixRefreshKey}
            />
          ) : null
        ) : keywordView === 'positions' ? <>
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
                <th className="keyword-column">Ключевое слово <span className="th-info" title="Поисковый запрос, по которому отслеживается приложение"><Icon name="info" size={14} /></span></th>
                <th>Обновлено</th>
                <th>Позиция <span className="th-info" title="Место приложения в результатах поиска App Store; меньше — лучше"><Icon name="info" size={14} /></span></th>
                <th>24 часа</th>
                <th>7 дней</th>
                <th>Тренд</th>
                <th>Приложения в выдаче <span className="th-info" title="Первые пять приложений в выдаче; нажмите иконку, чтобы открыть карточку конкурента"><Icon name="info" size={14} /></span></th>
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
              <button className="ds-icon-btn" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Предыдущая страница"><Icon name="chevronLeft" /></button>
              {page + 1} / {pageCount}
              <button className="ds-icon-btn" onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1} aria-label="Следующая страница"><Icon name="chevronRight" /></button>
            </span>
          )}
          <select className="ds-select ds-btn-sm page-size" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
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
        selectedApp ? <Competitors app={{ id: selectedApp.id, name: selectedApp.name, iTunesId: selectedApp.iTunesId }} locale={locale} onKeywordsChanged={setKeywordMap} /> : null
      ) : view === 'funnel' ? (
        selectedApp ? <ConnectGate requires={['adapty', 'asc']} title="Воронка"><AcquisitionFunnel app={{ id: selectedApp.id, name: selectedApp.name, iTunesId: selectedApp.iTunesId }} locale={locale} countries={Object.keys(keywordMap)} /></ConnectGate> : null
      ) : (
        selectedApp ? <Experiments app={{ id: selectedApp.id, name: selectedApp.name }} locales={Object.keys(keywordMap)} activeLocale={locale} /> : null
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
      {cellDetail && selectedApp && (
        <KeywordDrawer
          keyword={cellDetail.keyword}
          ranking={cellDetail.ranking}
          locale={cellDetail.locale}
          artworks={artworks}
          ownApp={selectedApp}
          loading={cellDetail.loading}
          onClose={() => setCellDetail(null)}
          onRefresh={() => void refreshCell()}
          onCopyPrompt={async () => {
            const { prompt } = await api.claudePrompt(selectedApp.id, cellDetail.keyword, cellDetail.locale);
            await navigator.clipboard.writeText(prompt);
          }}
          onOpenCompetitor={(bundleID) => { setCellDetail(null); setCompetitorBundle(bundleID); }}
          onOpenStorefront={() => { const target = cellDetail.locale; setCellDetail(null); selectStorefront(target); }}
        />
      )}
      {paletteOpen && selectedApp && (
        <CountryPalette
          current={locale}
          matrixActive={isMatrix}
          stats={paletteStats}
          favorites={countrySets?.favorites ?? []}
          recent={recentStorefronts}
          sets={matrixSets}
          activeSetId={activeMatrixSet?.id}
          onSelect={selectStorefront}
          onSelectMatrix={() => openMatrix()}
          onSelectSet={(id) => openMatrix(id)}
          onToggleFavorite={(code) => void toggleFavorite(code)}
          onAdd={(code) => { setPaletteOpen(false); void commitLocale(code).then(() => { markNavigation(); setView('keywords'); setKeywordView('positions'); }); }}
          onClose={() => setPaletteOpen(false)}
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
      <td>{ranking?.today
        ? <span className={`rank rank-${tone}`}>#{ranking.today}</span>
        : <span className="rank-none" title="Нет в выдаче" aria-label="Нет в выдаче">—</span>}</td>
      <td><Delta value={dayDelta} /></td>
      <td><Delta value={weekDelta} /></td>
      <td><MiniTrend values={ranking?.trend ?? []} /></td>
      <td><TopApps apps={ranking?.top5 ?? []} artworks={artworks} onOpen={onOpenCompetitor} ownApp={ownApp} country={ranking?.locale ?? 'us'} onEnsureArtworks={onEnsureArtworks} /></td>
      <td>
        <div className="row-actions">
          <button className="ds-icon-btn row-action" onClick={onRefresh} title="Обновить это ключевое слово" aria-label={`Обновить ${keyword}`}><Icon name="refresh" /></button>
          <button className="ds-icon-btn row-action row-remove" onClick={onRemove} title="Удалить ключевое слово" aria-label={`Удалить ${keyword}`}><Icon name="close" /></button>
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
  const cleanValues = values.filter((value) => Number.isFinite(value) && value > 0).slice(-16);
  if (cleanValues.length < 2) return <span className="muted-cell">—</span>;
  const start = cleanValues[0];
  const end = cleanValues.at(-1)!;
  // Rank: smaller is better, so a falling number is growth.
  const color = end < start ? 'var(--ds-good)' : end > start ? 'var(--ds-bad)' : 'var(--ds-c1)';
  const labels = cleanValues.map((_, index) => `Снимок ${index + 1} из ${cleanValues.length}`);
  return (
    <div className="position-trend" style={{ width: 104 }} aria-label={`Позиция изменилась с ${start} на ${end}. Меньше значит лучше.`}>
      <ChartSparkline values={cleanValues} labels={labels} color={color} height={30} invert label="Позиция" fmt={(value) => `#${value}`} />
    </div>
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
            {own ? <span className="own-app-check" aria-hidden="true"><Icon name="check" size={10} /></span> : null}
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
          <button className="ds-icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
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
          {info?.storeUrl && <a href={info.storeUrl} target="_blank" rel="noreferrer">Открыть в App Store <Icon name="external" size={14} /></a>}
          <button className="ds-btn ds-btn-primary" onClick={onClose}>Готово</button>
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
        <div className={`dialog-symbol ${isError || isDelete ? 'dialog-symbol-error' : ''}`}>{isError ? '!' : <Icon name={isDelete ? 'close' : 'plus'} size={20} />}</div>
        <h2 id="dialog-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        {isDelete ? null : !isError && dialog.kind === 'locale' ? (
          <div className="locale-picker">
            <label className="dialog-search">
              <Icon name="search" />
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
                  {value === locale.code && <b><Icon name="check" /></b>}
                </button>
              ))}
            </div>
          </div>
        ) : !isError && isApp ? (
          <div className="app-store-picker">
            <label className="dialog-search app-store-search">
              <Icon name="search" />
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
                <b><Icon name="check" /></b>
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
          {!isError && <button className="ds-btn dialog-button" onClick={onClose}>Отмена</button>}
          <button
            className={`ds-btn dialog-button ${isDelete ? 'dialog-button-danger' : 'ds-btn-primary'}`}
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
          <button className="ds-btn" onClick={onReload} disabled={loading} title="Пересобрать идеи заново" aria-label="Обновить идеи"><Icon name="refresh" /> Обновить</button>
        <label className="dialog-search suggestion-search">
          <Icon name="search" />
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
            <div className="suggestions-empty"><span>{error}</span><button className="ds-btn" onClick={onReload}>Повторить</button></div>
          ) : filtered.length === 0 ? (
            <div className="suggestions-empty">Новых общих запросов не нашлось. Apple подсказывает в основном названия приложений — их мы не предлагаем. Добавьте больше исходных ключей или обновите снимок.</div>
          ) : filtered.map((idea) => (
            <button className={selected.has(idea.keyword) ? 'selected' : ''} key={idea.keyword} onClick={() => toggle(idea.keyword)} aria-pressed={selected.has(idea.keyword)}>
              <span className="suggestion-check">{selected.has(idea.keyword) ? <Icon name="check" size={12} /> : null}</span>
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
          <button className="ds-btn ds-btn-primary" disabled={!selected.size || saving} onClick={add}>{saving ? 'Добавляем…' : selected.size ? `Добавить ${selected.size}` : 'Добавить ключевые слова'}</button>
        </footer>
      </section>
  );
}
/** Position history in the keyword drawer. 0 in the trend means «not in results» → a gap. */
function PositionHistory({ values, height = 26 }: { values: number[]; height?: number }) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return <span className="muted-cell">—</span>;
  const labels = clean.map((_, index) => `Снимок ${index + 1} из ${clean.length}`);
  return <ChartSparkline values={clean.map((value) => (value > 0 ? value : null))} labels={labels} height={height} invert label="Позиция" fmt={(value) => `#${value}`} />;
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
  onOpenStorefront,
  loading = false,
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
  /** Matrix drawer: jump to this storefront's positions view. */
  onOpenStorefront?: () => void;
  loading?: boolean;
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
            <p>{localeFlag(locale)} {onOpenStorefront ? `${storefrontOf(locale).name} · ` : ''}{locale.toUpperCase()} · {loading ? 'загрузка…' : `обновлено ${formatRelativeTime(ranking?.lastUpdated).toLowerCase()}`}</p>
            {onOpenStorefront && (
              <button type="button" className="ds-btn ds-btn-sm drawer-open-storefront" onClick={onOpenStorefront}>
                Все ключи {storefrontOf(locale).flag} {locale.toUpperCase()} <Icon name="chevronRight" size={14} />
              </button>
            )}
            {relevance && (
              <div className="competitor-badges">
                <b className={`relevance-chip relevance-${relevance.flag}`} style={{ marginLeft: 0 }}>{RELEVANCE_LABEL[relevance.flag]}</b>
                <b>{relevance.matchCount}/5 того же жанра</b>
              </div>
            )}
          </div>
          <button className="ds-icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
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
              <div className="drawer-trend"><PositionHistory values={ranking!.trend} height={64} /></div>
            </section>
          )}

          <section>
            <div className="sheet-section-title">Топ приложений в выдаче</div>
            {loading ? (
              <p className="sheet-empty">Загружаем выдачу…</p>
            ) : !ranking?.top5?.length ? (
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
          <button className="ds-btn" onClick={copy}>{copied ? 'Скопировано' : 'Скопировать запрос для анализа'}</button>
          <button className="ds-btn" onClick={onRefresh}><Icon name="refresh" /> Обновить ключевое слово</button>
          <button className="ds-btn ds-btn-primary" onClick={onClose}>Готово</button>
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
            <div className="ds-seg" role="group" aria-label="Период">
              {(['day', 'week', 'month'] as const).map((value) => (
                <button key={value} aria-pressed={period === value} className={period === value ? 'on' : ''} onClick={() => setPeriod(value)}>
                  {{ day: 'День', week: 'Неделя', month: 'Месяц' }[value]}
                </button>
              ))}
            </div>
            <Picker
              align="end"
              label="Приложение"
              searchPlaceholder="Найти приложение"
              value={appFilter}
              onChange={setAppFilter}
              options={[{ value: '', label: 'Все приложения' }, ...apps.map((app) => ({ value: app.id, label: app.name, lead: <AppIcon app={app} size={20} /> }))]}
            />
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
  const rows = metrics.flatMap((metric) => {
    const change = metric.current - metric.previous;
    const tip: TipRow[] = [
      [SERIES[0], 'Сейчас', String(metric.current)],
      [SERIES[1], 'Прошлый период', String(metric.previous)],
      [null, 'Изменение', change > 0 ? `+${change}` : String(change)],
    ];
    return [
      { label: metric.label, value: metric.current, color: SERIES[0], tip, tipHead: metric.label },
      { label: '', value: metric.previous, color: SERIES[1], tip, tipHead: metric.label },
    ];
  });
  return (
    <div className="analytics-comparison" aria-label="Сравнение текущего и прошлого периода">
      <header><strong>Изменение видимости</strong><Legend items={[[SERIES[0], 'Сейчас'], [SERIES[1], 'Прошлый период']]} /></header>
      <HBars rows={rows} max={max} labelWidth={110} fmt={(value) => String(value)} />
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
