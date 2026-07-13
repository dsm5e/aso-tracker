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
  type KeywordSuggestion,
  type RelevanceRow,
  type MoversResponse,
  type Mover,
  type LocaleAvg,
  type CompetitorSummary,
} from './api';
import { APP_STORE_LOCALES } from './appStoreLocales';

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

const FLAG: Record<string, string> = {
  us: '🇺🇸', gb: '🇬🇧', ca: '🇨🇦', au: '🇦🇺', de: '🇩🇪', fr: '🇫🇷',
  es: '🇪🇸', it: '🇮🇹', br: '🇧🇷', mx: '🇲🇽', jp: '🇯🇵', kr: '🇰🇷',
  cn: '🇨🇳', ru: '🇷🇺', tr: '🇹🇷', pl: '🇵🇱', nl: '🇳🇱', se: '🇸🇪',
  no: '🇳🇴', dk: '🇩🇰', fi: '🇫🇮', in: '🇮🇳', id: '🇮🇩', th: '🇹🇭',
};

const ARTWORK_SESSION_KEY = 'aso-keywords.artworks.v1';

// Sibling ASO Studio tools, reverse-proxied under the same origin in dev
// (see vite.config.ts) and by the hub in production.
const STUDIO_LINKS = [
  { id: 'aso', label: 'Keywords', hint: 'Rankings & suggestions', href: '/' },
  { id: 'shot', label: 'Screenshots', hint: 'App Store visuals', href: '/studio/' },
  { id: 'vid', label: 'Video', hint: 'Ad video pipeline', href: '/video/' },
  { id: 'asa', label: 'ASA Ads', hint: 'Search Ads ROI', href: '/asa/' },
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
  return FLAG[country] ?? '🌐';
}

function delta(from: number | null, to: number | null) {
  if (from == null || to == null) return null;
  return from - to;
}

function rankTone(rank: number | null) {
  if (rank == null) return 'muted';
  if (rank <= 10) return 'positive';
  if (rank <= 50) return 'warning';
  return 'negative';
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
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [rowUpdates, setRowUpdates] = useState<Record<string, RowUpdateState>>({});
  const [competitorBundle, setCompetitorBundle] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<KeywordSuggestion[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [studioMenuOpen, setStudioMenuOpen] = useState(false);
  const [updateMenuOpen, setUpdateMenuOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [relevanceOn, setRelevanceOn] = useState(false);
  const [relevance, setRelevance] = useState<Record<string, RelevanceRow>>({});
  const [snapshotSpeed, setSnapshotSpeed] = useState<SnapshotSpeed>(
    () => (localStorage.getItem('snapshotSpeed') === 'slow' ? 'slow' : 'medium')
  );
  const [view, setView] = useState<'overview' | 'keywords'>('keywords');
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light')
  );
  const [pageSize, setPageSize] = useState<number>(() => Number(localStorage.getItem('pageSize')) || 0); // 0 = all
  const [page, setPage] = useState(0);
  const [detailKeyword, setDetailKeyword] = useState<string | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<CompetitorSummary[]>([]);
  const [localeAvgByApp, setLocaleAvgByApp] = useState<Record<string, LocaleAvg[]>>({});

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);
  useEffect(() => { localStorage.setItem('pageSize', String(pageSize)); }, [pageSize]);
  useEffect(() => { setPage(0); }, [locale, query, pageSize, selectedAppID]);

  const selectedApp = apps.find((app) => app.id === selectedAppID) ?? apps[0];

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
    setSelectedAppID((current) => current || result[0]?.id || '');
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
        setLocale((current) => current && keywords[current] ? current : locales[0] ?? '');
      })
      .finally(() => setLoading(false));
  }, [selectedApp]);

  useEffect(() => {
    if (!selectedApp || !locale) return;
    let cancelled = false;
    setLoading(true);
    api.rankings(selectedApp.id, locale)
      .then((rows) => { if (!cancelled) setRankings(rows); })
      .catch((error) => { if (!cancelled) console.error(error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedApp, locale]);

  useEffect(() => {
    const ids = Array.from(new Set(
      rankings.flatMap((row) => row.top5.map((app) => app.tid).filter((id): id is number => id != null))
    ));
    const bundles = Array.from(new Set(
      rankings.flatMap((row) => row.top5.map((app) => app.id).filter(Boolean))
    ));
    if (!ids.length && !bundles.length) return;
    let cancelled = false;
    api.artworks(ids, bundles, locale || 'us')
      .then((incoming) => {
        if (cancelled) return;
        setArtworks((current) => {
          const next = { ...current, ...incoming };
          try { sessionStorage.setItem(ARTWORK_SESSION_KEY, JSON.stringify(next)); } catch { /* non-critical cache */ }
          return next;
        });
      })
      .catch(() => { /* keep previously resolved artwork */ });
    return () => { cancelled = true; };
  }, [rankings, locale]);

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
        if (!state.running) return;
        setRefreshing(true);
        if (state.lastProgress) setProgress(state.lastProgress);
        unsubscribe = subscribeToSnapshot(applySnapshotEvent);
      })
      .catch(() => { /* server not up yet — the manual refresh path still works */ });
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
      setDialog({ kind: 'error', title: 'Keyword update failed', message: (error as Error).message });
    }
  };

  const commitApp = async (id: string) => {
    if (!id.trim()) return;
    try {
      const lookup = await api.itunesLookup(id.trim(), 'us') as {
        trackName?: string; bundleId?: string; artworkUrl100?: string; trackId?: number;
      };
      if (!lookup) throw new Error('App was not found in the selected storefront.');
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
        title: 'Could not add app',
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
    title: 'Add keywords',
    message: `Add keywords to ${locale.toUpperCase()}. Use a new line or comma between phrases.`,
    placeholder: 'habit tracker\ndaily habits\nroutine planner',
  });

  const openLocaleDialog = () => setDialog({
    kind: 'locale',
    title: 'Add locale',
    message: 'Enter an App Store storefront code.',
    placeholder: 'us',
  });

  const openAppDialog = () => setDialog({
    kind: 'app',
    title: 'Add app',
    message: 'Search the App Store by name, bundle ID, or paste a numeric App Store ID.',
    placeholder: 'Search apps or enter App Store ID',
  });

  const findSuggestions = async () => {
    if (!selectedApp || !locale || suggestionsLoading) return;
    setSuggestionsLoading(true);
    try {
      setSuggestions(await api.suggestions(selectedApp.id, locale));
    } catch (error) {
      setDialog({ kind: 'error', title: 'Suggestions unavailable', message: (error as Error).message });
    } finally {
      setSuggestionsLoading(false);
    }
  };

  // Top competitors across all tracked keywords of the selected app.
  useEffect(() => {
    if (!selectedApp) return;
    let cancelled = false;
    setCompetitorSummary([]);
    api.competitors(selectedApp.id)
      .then((rows) => { if (!cancelled) setCompetitorSummary(rows); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedApp]);

  // Per-locale averages for the Overview grid — one request per app, cached.
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
          title: 'Add app',
          message: 'Search the App Store by name, bundle ID, or paste a numeric App Store ID.',
          placeholder: 'Search apps or enter App Store ID',
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const requestDeleteApp = (app: AppStats) => setDialog({
    kind: 'delete-app',
    title: `Delete “${app.name}”?`,
    message: 'This permanently removes all keyword lists, snapshot history, and the app itself from tracking. This cannot be undone.',
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
  };

  if (!loading && apps.length === 0) {
    return (
      <main className="empty-screen">
        <div className="empty-card">
          <div className="brand-mark">K</div>
          <h1>ASO Keywords</h1>
          <p>Add an App Store app to start tracking keyword positions.</p>
          <button className="button button-primary" onClick={openAppDialog}>Add first app</button>
          {dialog && <InputDialog dialog={dialog} busy={dialogBusy} existingLocales={Object.keys(keywordMap)} onClose={() => setDialog(null)} onSubmit={submitDialog} />}
        </div>
      </main>
    );
  }

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="sidebar-titlebar">
          <button className="brand-mark brand-button" onClick={() => setStudioMenuOpen((open) => !open)} aria-label="Switch studio">K</button>
          <div>
            <strong>Keywords</strong>
            <span>ASO workspace</span>
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

        <nav className="utility-nav">
          <button className={view === 'overview' ? 'selected' : ''} onClick={() => setView('overview')}>
            <span>▦</span> Overview
          </button>
          <button className={view === 'keywords' ? 'selected' : ''} onClick={() => setView('keywords')}>
            <span>≣</span> Keywords
          </button>
        </nav>

        <div className="sidebar-section-label sidebar-apps-label">Apps</div>
        <div className="app-list">
          {apps.map((app) => (
            <div className={`app-item ${view === 'keywords' && selectedApp?.id === app.id ? 'selected' : ''}`} key={app.id}>
              <button className="app-item-main" onClick={() => { setSelectedAppID(app.id); setView('keywords'); }}>
                <AppIcon app={app} />
                <span className="app-item-copy">
                  <strong>{app.name}</strong>
                  <small> iPhone · {app.keywords} keywords</small>
                </span>
              </button>
              <button className="app-item-delete" title={`Delete ${app.name}`} onClick={() => requestDeleteApp(app)}>×</button>
            </div>
          ))}
        </div>

        <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀︎ Light mode' : '☾ Dark mode'}
        </button>
        <button className="add-app-button" onClick={openAppDialog}>Add App <span>＋</span></button>
      </aside>

      {view === 'overview' ? (
        <OverviewScreen
          apps={apps}
          localeAvgByApp={localeAvgByApp}
          onOpenApp={(id) => { setSelectedAppID(id); setView('keywords'); }}
          onDeleteApp={requestDeleteApp}
          onRunAll={() => startSnapshot('all')}
          refreshing={refreshing}
          progress={progress}
        />
      ) : (
      <section className="content">
        <header className="toolbar">
          <div className="update-cluster">
            <button className="toolbar-labeled" onClick={refresh} disabled={refreshing} aria-label="Update rankings">
              <span className={refreshing ? 'spinning' : ''}>↻</span> Update
            </button>
            <button className="toolbar-caret" onClick={() => setUpdateMenuOpen((open) => !open)} aria-label="Snapshot options">▾</button>
            {updateMenuOpen && (
              <div className="menu update-menu" onMouseLeave={() => setUpdateMenuOpen(false)}>
                <div className="menu-label">Update rankings — what to check</div>
                <button onClick={() => startSnapshot('locale')} disabled={refreshing}><strong>This locale ({locale.toUpperCase()})</strong><small>keywords of the current locale only</small></button>
                <button onClick={() => startSnapshot('app')} disabled={refreshing}><strong>Whole app ({selectedApp?.name})</strong><small>every locale of this app</small></button>
                <button onClick={() => startSnapshot('all')} disabled={refreshing}><strong>All apps</strong><small>every app, every locale</small></button>
                <div className="menu-separator" />
                <div className="menu-label">Update speed</div>
                {(Object.keys(SPEED_PRESETS) as SnapshotSpeed[]).map((speed) => (
                  <button key={speed} onClick={() => changeSpeed(speed)}>
                    <strong>{SPEED_PRESETS[speed].label}</strong>
                    <small>{SPEED_PRESETS[speed].note}</small>
                    {snapshotSpeed === speed && <b>✓</b>}
                  </button>
                ))}
                {refreshing && (
                  <>
                    <div className="menu-separator" />
                    <button className="menu-danger" onClick={() => { abortSnapshot().catch(() => {}); setUpdateMenuOpen(false); }}>
                      <strong>Stop update</strong><small>finishes the current keyword and exits</small>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="toolbar-title">Keywords</div>
          <select className="toolbar-pill locale-select" value={locale} onChange={(event) => setLocale(event.target.value)}>
            {Object.keys(keywordMap).sort().map((code) => (
              <option key={code} value={code}>{localeFlag(code)} {code.toUpperCase()}</option>
            ))}
          </select>
          <button className="toolbar-labeled" onClick={openLocaleDialog} aria-label="Add locale">＋ Locale</button>

          <span className="toolbar-spacer" />

          {refreshing && (
            <span className="snapshot-status">
              <i /> Updating {progress?.completed ?? 0}/{progress?.total ?? rows.length}
              <button className="snapshot-stop" onClick={() => abortSnapshot().catch(() => {})} title="Stop update">■ Stop</button>
            </span>
          )}
          <button
            className={`toolbar-labeled relevance-toggle ${relevanceOn ? 'active' : ''}`}
            onClick={() => setRelevanceOn((on) => !on)}
            title="Show whether each keyword's top-5 apps match your genre"
          >◎ Relevance</button>
          <button className="toolbar-labeled" onClick={() => setAnalyticsOpen(true)} title="Position movement across all keywords">∿ Analytics</button>
          <button className="button button-primary" onClick={openKeywordsDialog}>Add Keywords <span>＋</span></button>
          <button className="button button-suggestion" onClick={findSuggestions} disabled={suggestionsLoading}>
            {suggestionsLoading ? 'Finding…' : suggestions ? `${suggestions.length} Suggestions` : 'Find Suggestions'} <span>✦</span>
          </button>
          <label className="search-field">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search keywords" />
          </label>
        </header>

        <div className="table-wrap">
          <table className="keyword-table">
            <thead>
              <tr>
                <th className="keyword-column">Keyword <span>ⓘ</span></th>
                <th>Last update</th>
                <th>Position <span>ⓘ</span></th>
                <th>24 hours</th>
                <th>7 days</th>
                <th>Trend</th>
                <th>Apps in ranking <span>ⓘ</span></th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 14 }).map((_, index) => <SkeletonRow key={index} />)
              ) : rows.length === 0 ? (
                <tr><td colSpan={8}><div className="table-empty">No keywords in this locale yet.</div></td></tr>
              ) : pagedRows.map(({ keyword, ranking }) => (
                <KeywordRow
                  key={keyword}
                  keyword={keyword}
                  ranking={ranking}
                  onRemove={() => removeKeyword(keyword)}
                  artworks={artworks}
                  updateState={rowUpdates[keyword]}
                  onRefresh={() => refreshOne(keyword)}
                  onOpenCompetitor={setCompetitorBundle}
                  onOpenDetail={() => setDetailKeyword(keyword)}
                  relevance={relevanceOn ? relevance[`${locale}|${keyword.toLocaleLowerCase()}`] : undefined}
                  onCopyPrompt={() => copyClaudePrompt(keyword)}
                />
              ))}
            </tbody>
          </table>

          {competitorSummary.length > 0 && (
            <div className="competitor-strip">
              <div className="sidebar-section-label">Top competitors across your tracked keywords</div>
              <div className="competitor-strip-chips">
                {competitorSummary.slice(0, 20).map((competitor) => (
                  <button key={competitor.bundleId} onClick={() => setCompetitorBundle(competitor.bundleId)}>
                    <strong>{competitor.name}</strong>
                    <span>{competitor.appearances}×</span>
                    <small>avg #{competitor.avgRank}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="statusbar">
          <span>{rows.length} keywords</span>
          <span>{localeFlag(locale)} {locale.toUpperCase()}</span>
          {pageSize > 0 && pageCount > 1 && (
            <span className="pager">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>‹</button>
              {page + 1} / {pageCount}
              <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}>›</button>
            </span>
          )}
          <select className="page-size" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={0}>All rows</option>
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
          <span className="statusbar-spacer" />
          <span>Top 10: <strong>{rows.filter((row) => (row.ranking?.today ?? 999) <= 10).length}</strong></span>
          <span>Ranked: <strong>{rows.filter((row) => row.ranking?.today != null).length}</strong></span>
        </footer>
      </section>
      )}
      {dialog && <InputDialog dialog={dialog} busy={dialogBusy} existingLocales={Object.keys(keywordMap)} onClose={() => setDialog(null)} onSubmit={submitDialog} />}
      {detailKeyword && selectedApp && (
        <KeywordDrawer
          keyword={detailKeyword}
          ranking={rankingByKeyword.get(detailKeyword.toLocaleLowerCase())}
          relevance={relevance[`${locale}|${detailKeyword.toLocaleLowerCase()}`]}
          locale={locale}
          artworks={artworks}
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
      {suggestions && (
        <SuggestionsDialog
          locale={locale}
          suggestions={suggestions}
          onClose={() => setSuggestions(null)}
          onAdd={addSelectedSuggestions}
        />
      )}
      {analyticsOpen && (
        <AnalyticsDialog
          apps={apps}
          initialApp={selectedApp?.id ?? ''}
          onClose={() => setAnalyticsOpen(false)}
        />
      )}
    </main>
  );
}

const RELEVANCE_LABEL: Record<RelevanceRow['flag'], string> = {
  match: 'Relevant',
  ambiguous: 'Mixed',
  mismatch: 'Off-genre',
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
  relevance,
  onCopyPrompt,
}: {
  keyword: string;
  ranking?: RankingRow;
  onRemove: () => void;
  artworks: Record<string, string>;
  updateState?: RowUpdateState;
  onRefresh: () => void;
  onOpenCompetitor: (bundleID: string) => void;
  onOpenDetail: () => void;
  relevance?: RelevanceRow;
  onCopyPrompt: () => Promise<void>;
}) {
  const [promptState, setPromptState] = useState<'idle' | 'copying' | 'copied'>('idle');
  const dayDelta = delta(ranking?.yesterday ?? null, ranking?.today ?? null);
  const weekDelta = delta(ranking?.w1 ?? null, ranking?.today ?? null);
  const tone = rankTone(ranking?.today ?? null);

  const copyPrompt = async () => {
    if (promptState !== 'idle') return;
    setPromptState('copying');
    try {
      await onCopyPrompt();
      setPromptState('copied');
      window.setTimeout(() => setPromptState('idle'), 1500);
    } catch {
      setPromptState('idle');
    }
  };

  return (
    <tr>
      <td className="keyword-cell" onClick={onOpenDetail} style={{ cursor: 'pointer' }}>
        <strong>{keyword}</strong>
        {ranking?.today != null && ranking.today <= 10 && <span className="keyword-dot" />}
        {relevance && (
          <span
            className={`relevance-chip relevance-${relevance.flag}`}
            title={`Top-5 genre match: ${relevance.matchCount}/5 · ${relevance.genreHistogram.map((g) => `${g.genre} ×${g.count}`).join(', ')}`}
          >
            {RELEVANCE_LABEL[relevance.flag]}
          </span>
        )}
      </td>
      <td><UpdateStatus state={updateState} timestamp={ranking?.lastUpdated} /></td>
      <td><span className={`rank rank-${tone}`}>{ranking?.today ? `# ${ranking.today}` : '# —'}</span></td>
      <td><Delta value={dayDelta} /></td>
      <td><Delta value={weekDelta} /></td>
      <td><MiniTrend values={ranking?.trend ?? []} /></td>
      <td><TopApps apps={ranking?.top5 ?? []} artworks={artworks} onOpen={onOpenCompetitor} /></td>
      <td>
        <div className="row-actions">
          <button className="row-action row-prompt" onClick={copyPrompt} title="Copy Claude research prompt for this keyword">
            {promptState === 'copied' ? '✓' : '✦'}
          </button>
          <button className="row-action row-refresh" onClick={onRefresh} title="Update this keyword">↻</button>
          <button className="row-action row-remove" onClick={onRemove} title="Remove keyword">×</button>
        </div>
      </td>
    </tr>
  );
}

function UpdateStatus({ state, timestamp }: { state?: RowUpdateState; timestamp?: number | null }) {
  if (!state) return <span className="muted-cell">{formatRelativeTime(timestamp)}</span>;
  if (state.status === 'queued') return <span className="update-status update-queued"><i /> Queued</span>;
  if (state.status === 'updating') return <span className="update-status update-running"><i /> Updating</span>;
  if (state.status === 'retrying') return (
    <span className="update-status update-retry"><i /> Retry {state.attempt}/{state.maxAttempts}</span>
  );
  if (state.status === 'error') return <span className="update-status update-error"><i /> Failed</span>;
  return <span className="update-status update-done"><i /> Just now</span>;
}

function formatRelativeTime(timestamp?: number | null) {
  if (!timestamp) return 'Not updated';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function Delta({ value }: { value: number | null }) {
  if (value == null || value === 0) return <span className="delta delta-flat">—</span>;
  return <span className={`delta ${value > 0 ? 'delta-up' : 'delta-down'}`}>{value > 0 ? '↑' : '↓'} {Math.abs(value)}</span>;
}

function MiniTrend({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="muted-cell">—</span>;
  const width = 76;
  const height = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = index * (width / (values.length - 1));
    const y = 3 + ((value - min) / range) * (height - 6);
    return `${x},${y}`;
  }).join(' ');
  return <svg className="mini-trend" viewBox={`0 0 ${width} ${height}`}><polyline points={points} /></svg>;
}

function TopApps({ apps, artworks, onOpen }: {
  apps: Array<{ name: string; id: string; dev: string; tid?: number }>;
  artworks: Record<string, string>;
  onOpen: (bundleID: string) => void;
}) {
  if (!apps.length) return <span className="muted-cell">No data</span>;
  return (
    <div className="top-apps">
      {apps.slice(0, 5).map((app, index) => {
        const artwork = (app.tid ? artworks[String(app.tid)] : undefined) ?? artworks[app.id];
        return (
          <button className="competitor-button" key={`${app.id}-${index}`} title={`${index + 1}. ${app.name}`} onClick={() => onOpen(app.id)}>
            {artwork ? (
              <ArtworkIcon url={artwork} fallback={app.name.trim().slice(0, 1).toUpperCase()} />
            ) : (
              <span className="competitor-icon">{app.name.trim().slice(0, 1).toUpperCase()}</span>
            )}
          </button>
        );
      })}
      {apps.length > 5 && <small>+{apps.length - 5}</small>}
    </div>
  );
}

function ArtworkIcon({ url, fallback }: { url: string; fallback: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    const image = new Image();
    image.onload = () => setLoaded(true);
    image.onerror = () => setFailed(true);
    image.src = url;
    if (image.complete && image.naturalWidth > 0) setLoaded(true);
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [url]);

  return (
    <span className="competitor-icon artwork-shell">
      <span className="artwork-fallback">{fallback}</span>
      {!failed && <img className={loaded ? 'loaded' : ''} src={url} alt="" />}
    </span>
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
            <h2>{loading ? 'Loading…' : info?.name || bundleID}</h2>
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
              <div className="sheet-section-title">Screenshots</div>
              <div className="screenshot-strip">
                {info.screenshotUrls.map((url) => <img key={url} src={url} alt="App Store screenshot" />)}
              </div>
            </section>
          )}

          <div className="competitor-stats">
            <div><strong>{keywords.length}</strong><span>shared keywords</span></div>
            <div><strong>{new Set(keywords.map((row) => row.locale)).size}</strong><span>locales</span></div>
            <div><strong>{keywords.length ? (keywords.reduce((sum, row) => sum + row.theirRank, 0) / keywords.length).toFixed(1) : '—'}</strong><span>average rank</span></div>
          </div>

          {info?.description && (
            <section>
              <div className="sheet-section-title">About</div>
              <p className="competitor-description">{info.description}</p>
            </section>
          )}

          <section>
            <div className="sheet-section-title">Subscriptions & purchases · {country.toUpperCase()}</div>
            {!pricing || pricing.subscriptions.length + pricing.iap.length === 0 ? (
              <p className="sheet-empty">No products are visible in this storefront.</p>
            ) : (
              <div className="product-list">
                {[...pricing.subscriptions, ...pricing.iap].map((product, index) => (
                  <div key={`${product.name}-${index}`}><span><strong>{product.name}</strong><small>{product.subtitle || product.duration || product.kind}</small></span><b>{product.price}</b></div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="sheet-section-title">Recent reviews · {country.toUpperCase()}</div>
            {!reviews || reviews.reviews.length === 0 ? <p className="sheet-empty">No recent reviews in this storefront.</p> : (
              <div className="review-list">
                {reviews.reviews.slice(0, 6).map((review) => (
                  <article key={review.id}><div><strong>{review.title || 'Review'}</strong><span>{'★'.repeat(review.rating)}</span></div><p>{review.content}</p><small>{review.author}{review.version ? ` · v${review.version}` : ''}</small></article>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="competitor-footer">
          {info?.storeUrl && <a href={info.storeUrl} target="_blank" rel="noreferrer">Open in App Store ↗</a>}
          <button onClick={onClose}>Done</button>
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
        if (!results.length) setAppSearchError('No apps found in the US App Store.');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setAppSearchError('Search is temporarily unavailable.');
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
              <input autoFocus value={localeSearch} onChange={(event) => setLocaleSearch(event.target.value)} placeholder="Search country or code" />
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
                {!value.trim() && <div className="app-search-empty">Start typing to search the US App Store.</div>}
              </div>
            )}
          </div>
        ) : !isError && !isDelete && (multiline ? (
          <textarea autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={dialog.placeholder} rows={6} />
        ) : (
          <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={dialog.placeholder} inputMode={dialog.kind === 'app' ? 'numeric' : 'text'} />
        ))}
        <div className="dialog-actions">
          {!isError && <button className="dialog-button dialog-button-secondary" onClick={onClose}>Cancel</button>}
          <button
            className={`dialog-button ${isDelete ? 'dialog-button-danger' : 'dialog-button-primary'}`}
            disabled={busy || (!isError && (!value.trim() || (isApp && !appCanSubmit)))}
            onClick={() => onSubmit(value)}
          >
            {busy ? 'Working…' : isError ? 'Done' : isDelete ? 'Delete app' : dialog.kind === 'keywords' ? 'Add keywords' : dialog.kind === 'locale' ? 'Add locale' : 'Add app'}
          </button>
        </div>
      </section>
    </div>
  );
}

function SuggestionsDialog({
  locale,
  suggestions,
  onClose,
  onAdd,
}: {
  locale: string;
  suggestions: KeywordSuggestion[];
  onClose: () => void;
  onAdd: (keywords: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const filtered = suggestions.filter((suggestion) =>
    suggestion.keyword.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
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
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="suggestions-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="dialog-symbol suggestion-symbol">✦</div>
          <div>
            <h2>Keyword suggestions</h2>
            <p>{localeFlag(locale)} {locale.toUpperCase()} · Apple discovery and top-ranking competitors</p>
          </div>
          <button onClick={onClose}>×</button>
        </header>
        <label className="dialog-search suggestion-search">
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search suggestions" />
        </label>
        <div className="suggestion-list">
          {filtered.length === 0 ? (
            <div className="suggestions-empty">No new suggestions found. Add more seed keywords or run a fresh snapshot first.</div>
          ) : filtered.map((suggestion) => (
            <button className={selected.has(suggestion.keyword) ? 'selected' : ''} key={suggestion.keyword} onClick={() => toggle(suggestion.keyword)}>
              <span className="suggestion-check">{selected.has(suggestion.keyword) ? '✓' : ''}</span>
              <span className="suggestion-copy"><strong>{suggestion.keyword}</strong><small>{suggestion.evidence}</small></span>
              <span className={`suggestion-source source-${suggestion.source}`}>{suggestion.source === 'apple_autocomplete' ? 'Apple' : 'Competitor'}</span>
              <b>{suggestion.score}</b>
            </button>
          ))}
        </div>
        <footer>
          <span>{selected.size} selected</span>
          <button className="dialog-button dialog-button-secondary" onClick={onClose}>Cancel</button>
          <button className="dialog-button dialog-button-primary" disabled={!selected.size || saving} onClick={add}>{saving ? 'Adding…' : `Add ${selected.size || ''} keywords`}</button>
        </footer>
      </section>
    </div>
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

function OverviewScreen({
  apps,
  localeAvgByApp,
  onOpenApp,
  onDeleteApp,
  onRunAll,
  refreshing,
  progress,
}: {
  apps: AppStats[];
  localeAvgByApp: Record<string, LocaleAvg[]>;
  onOpenApp: (id: string) => void;
  onDeleteApp: (app: AppStats) => void;
  onRunAll: () => void;
  refreshing: boolean;
  progress: SnapshotEvent | null;
}) {
  return (
    <section className="content">
      <header className="toolbar">
        <div className="toolbar-title">Overview</div>
        <span className="toolbar-spacer" />
        {refreshing && (
          <span className="snapshot-status">
            <i /> Updating {progress?.completed ?? 0}/{progress?.total ?? '…'}
          </span>
        )}
        <button className="button button-primary" onClick={onRunAll} disabled={refreshing}>
          {refreshing ? 'Updating rankings…' : 'Update all rankings'} <span>↻</span>
        </button>
      </header>

      <div className="overview-wrap">
        <div className="overview-grid">
          {apps.map((app) => {
            const locales = localeAvgByApp[app.id] ?? [];
            return (
              <article className="overview-card" key={app.id}>
                <header onClick={() => onOpenApp(app.id)}>
                  <AppIcon app={app} size={46} />
                  <div>
                    <strong>{app.name}</strong>
                    <small>{app.keywords} keywords · {app.locales.length} locales</small>
                  </div>
                  <button className="overview-delete" title={`Delete ${app.name}`} onClick={(event) => { event.stopPropagation(); onDeleteApp(app); }}>×</button>
                </header>

                <div className="overview-metrics" onClick={() => onOpenApp(app.id)}>
                  <div><strong>{app.avgPos ? `#${Math.round(app.avgPos)}` : '—'}</strong><span>avg pos</span><Delta value={app.weekDelta?.avg ? Math.round(app.weekDelta.avg) : null} /></div>
                  <div><strong>{app.top10}</strong><span>top 10</span><Delta value={app.weekDelta?.top10 || null} /></div>
                  <div><strong>{app.top50}</strong><span>top 50</span><Delta value={app.weekDelta?.top50 || null} /></div>
                </div>

                <div className="overview-spark" onClick={() => onOpenApp(app.id)}>
                  <Sparkline values={app.history?.top10 ?? []} />
                  <small>top-10 keywords over snapshots</small>
                </div>

                {locales.length > 0 && (
                  <div className="overview-locales">
                    {locales.slice(0, 10).map((entry) => (
                      <span key={entry.code} title={`${entry.code.toUpperCase()} — avg ${entry.avg != null ? `#${Math.round(entry.avg)}` : 'unranked'}`}>
                        {localeFlag(entry.code)} {entry.avg != null ? `#${Math.round(entry.avg)}` : '—'}
                      </span>
                    ))}
                    {locales.length > 10 && <span>+{locales.length - 10}</span>}
                  </div>
                )}

                {(app.winners?.length > 0 || app.losers?.length > 0) && (
                  <div className="overview-movers">
                    {app.winners?.slice(0, 2).map((mover) => (
                      <div key={`w-${mover.kw}`}><b className="mover-positive">↑{mover.delta}</b> {mover.kw} <small>#{mover.from} → #{mover.to}</small></div>
                    ))}
                    {app.losers?.slice(0, 2).map((mover) => (
                      <div key={`l-${mover.kw}`}><b className="mover-negative">↓{Math.abs(mover.delta)}</b> {mover.kw} <small>#{mover.from} → #{mover.to}</small></div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function KeywordDrawer({
  keyword,
  ranking,
  relevance,
  locale,
  artworks,
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
            <p>{localeFlag(locale)} {locale.toUpperCase()} · updated {formatRelativeTime(ranking?.lastUpdated).toLowerCase()}</p>
            {relevance && (
              <div className="competitor-badges">
                <b className={`relevance-chip relevance-${relevance.flag}`} style={{ marginLeft: 0 }}>{RELEVANCE_LABEL[relevance.flag]}</b>
                <b>{relevance.matchCount}/5 same genre</b>
              </div>
            )}
          </div>
          <button onClick={onClose}>×</button>
        </header>

        <div className="competitor-content">
          <div className="competitor-stats">
            <div><strong><Delta value={dayDelta} /></strong><span>24 hours</span></div>
            <div><strong><Delta value={weekDelta} /></strong><span>7 days</span></div>
            <div><strong><Delta value={monthDelta} /></strong><span>30 days</span></div>
          </div>

          {(ranking?.trend?.length ?? 0) >= 2 && (
            <section>
              <div className="sheet-section-title">Position trend</div>
              <div className="drawer-trend"><Sparkline values={ranking!.trend} width={380} height={64} /></div>
            </section>
          )}

          <section>
            <div className="sheet-section-title">Top apps in this ranking</div>
            {!ranking?.top5?.length ? (
              <p className="sheet-empty">No snapshot data yet — run an update for this keyword.</p>
            ) : (
              <div className="drawer-top5">
                {ranking.top5.map((app, index) => {
                  const artwork = (app.tid ? artworks[String(app.tid)] : undefined) ?? artworks[app.id];
                  const genre = relevance?.top5?.find((r) => (r.bundleId ?? r.id) === app.id)?.genre;
                  return (
                    <button key={`${app.id}-${index}`} onClick={() => onOpenCompetitor(app.id)}>
                      <b>#{app.pos ?? index + 1}</b>
                      {artwork ? <img src={artwork} alt="" /> : <span className="competitor-icon">{app.name.trim().slice(0, 1).toUpperCase()}</span>}
                      <span><strong>{app.name}</strong><small>{app.dev}{genre ? ` · ${genre}` : ''}</small></span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {relevance && relevance.genreHistogram.length > 0 && (
            <section>
              <div className="sheet-section-title">Genres in top 5</div>
              <div className="drawer-genres">
                {relevance.genreHistogram.map((genre) => (
                  <span key={genre.genre}>{genre.genre} <b>×{genre.count}</b></span>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="competitor-footer">
          <button onClick={copy}>{copied ? '✓ Copied' : '✦ Copy Claude prompt'}</button>
          <button onClick={onRefresh}>↻ Update keyword</button>
          <button onClick={onClose}>Done</button>
        </footer>
      </aside>
    </div>
  );
}

const PERIOD_LABEL: Record<'day' | 'week' | 'month', string> = {
  day: 'vs yesterday',
  week: 'vs 7 days ago',
  month: 'vs 30 days ago',
};

function AnalyticsDialog({
  apps,
  initialApp,
  onClose,
}: {
  apps: AppStats[];
  initialApp: string;
  onClose: () => void;
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
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="analytics-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="dialog-symbol analytics-symbol">∿</div>
          <div>
            <h2>Analytics</h2>
            <p>Movement across tracked keywords · {PERIOD_LABEL[period]}</p>
          </div>
          <div className="analytics-controls">
            <div className="segmented">
              {(['day', 'week', 'month'] as const).map((value) => (
                <button key={value} className={period === value ? 'selected' : ''} onClick={() => setPeriod(value)}>
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
            <select value={appFilter} onChange={(event) => setAppFilter(event.target.value)}>
              <option value="">All apps</option>
              {apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
            </select>
          </div>
          <button className="analytics-close" onClick={onClose}>×</button>
        </header>

        {error ? (
          <div className="analytics-empty">{error}</div>
        ) : loading || !data ? (
          <div className="analytics-empty">Loading…</div>
        ) : (
          <div className="analytics-content">
            {summary && (
              <div className="analytics-summary">
                <div><strong>{summary.totalRanked}</strong><span>ranked</span><Delta value={summary.rankedDelta} /></div>
                <div><strong>{summary.top10}</strong><span>top 10</span><Delta value={summary.top10Delta} /></div>
                <div><strong>{summary.top50}</strong><span>top 50</span><Delta value={summary.top50Delta} /></div>
                <div>
                  <strong>{summary.avgPosition != null ? `#${summary.avgPosition.toFixed(0)}` : '—'}</strong>
                  <span>avg position</span>
                  <Delta value={summary.avgDelta != null ? Math.round(summary.avgDelta) : null} />
                </div>
              </div>
            )}
            <div className="movers-grid">
              <MoversList title="Gainers" tone="positive" movers={data.gainers} />
              <MoversList title="Losers" tone="negative" movers={data.losers} />
              <MoversList title="Newly ranked" tone="positive" movers={data.newlyRanked} />
              <MoversList title="Dropouts" tone="negative" movers={data.dropouts} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MoversList({ title, tone, movers }: { title: string; tone: 'positive' | 'negative'; movers: Mover[] }) {
  return (
    <section className="movers-list">
      <div className="sheet-section-title">{title}</div>
      {movers.length === 0 ? (
        <p className="sheet-empty">Nothing here for this period.</p>
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
