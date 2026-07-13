import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  runSnapshot,
  type AppStats,
  type RankingRow,
  type SnapshotEvent,
  type KeywordSuggestion,
} from './api';
import { APP_STORE_LOCALES } from './appStoreLocales';

type DialogKind = 'keywords' | 'locale' | 'app' | 'error';
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

  const selectedApp = apps.find((app) => app.id === selectedAppID) ?? apps[0];

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

  const refresh = async () => {
    if (!selectedApp || !locale || refreshing) return;
    setRefreshing(true);
    setProgress(null);
    setRowUpdates(Object.fromEntries(
      (keywordMap[locale] ?? []).map((keyword) => [keyword, { status: 'queued' as const }])
    ));
    try {
      await runSnapshot(
        { appIds: [selectedApp.id], locales: [locale], speed: 'medium' },
        (event) => {
          setProgress(event);
          if (!event.keyword || event.locale !== locale) return;
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
              const index = current.findIndex((row) => row.locale === locale && row.keyword === event.keyword);
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
        }
      );
      setRankings(await api.rankings(selectedApp.id, locale));
      await loadApps();
    } finally {
      setRefreshing(false);
    }
  };

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
          <span className="brand-mark">K</span>
          <div>
            <strong>Keywords</strong>
            <span>ASO workspace</span>
          </div>
        </div>

        <div className="sidebar-section-label sidebar-apps-label">Apps</div>
        <div className="app-list">
          {apps.map((app) => (
            <button
              className={`app-item ${selectedApp?.id === app.id ? 'selected' : ''}`}
              key={app.id}
              onClick={() => setSelectedAppID(app.id)}
            >
              <AppIcon app={app} />
              <span className="app-item-copy">
                <strong>{app.name}</strong>
                <small> iPhone · {app.keywords} keywords</small>
              </span>
            </button>
          ))}
        </div>

        <button className="add-app-button" onClick={openAppDialog}>Add App <span>＋</span></button>
      </aside>

      <section className="content">
        <header className="toolbar">
          <button className={`toolbar-refresh ${refreshing ? 'spinning' : ''}`} onClick={refresh} aria-label="Refresh">
            ↻
          </button>
          <div className="toolbar-title">Keywords</div>
          <select className="toolbar-pill locale-select" value={locale} onChange={(event) => setLocale(event.target.value)}>
            {Object.keys(keywordMap).sort().map((code) => (
              <option key={code} value={code}>{localeFlag(code)} {code.toUpperCase()}</option>
            ))}
          </select>
          <button className="toolbar-icon" onClick={openLocaleDialog} aria-label="Add locale">＋</button>

          <span className="toolbar-spacer" />

          {refreshing && (
            <span className="snapshot-status">
              <i /> Updating {progress?.completed ?? 0}/{progress?.total ?? rows.length}
            </span>
          )}
          <button className="button button-primary" onClick={openKeywordsDialog}>Add Keywords <span>＋</span></button>
          <button className="button button-suggestion" onClick={findSuggestions} disabled={suggestionsLoading}>
            {suggestionsLoading ? 'Finding…' : suggestions ? `${suggestions.length} Suggestions` : 'Find Suggestions'} <span>✦</span>
          </button>
          <label className="search-field">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
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
              ) : rows.map(({ keyword, ranking }) => (
                <KeywordRow
                  key={keyword}
                  keyword={keyword}
                  ranking={ranking}
                  onRemove={() => removeKeyword(keyword)}
                  artworks={artworks}
                  updateState={rowUpdates[keyword]}
                  onRefresh={() => refreshOne(keyword)}
                  onOpenCompetitor={setCompetitorBundle}
                />
              ))}
            </tbody>
          </table>
        </div>

        <footer className="statusbar">
          <span>{rows.length} keywords</span>
          <span>{localeFlag(locale)} {locale.toUpperCase()}</span>
          <span className="statusbar-spacer" />
          <span>Top 10: <strong>{rows.filter((row) => (row.ranking?.today ?? 999) <= 10).length}</strong></span>
          <span>Ranked: <strong>{rows.filter((row) => row.ranking?.today != null).length}</strong></span>
        </footer>
      </section>
      {dialog && <InputDialog dialog={dialog} busy={dialogBusy} existingLocales={Object.keys(keywordMap)} onClose={() => setDialog(null)} onSubmit={submitDialog} />}
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
    </main>
  );
}

function KeywordRow({
  keyword,
  ranking,
  onRemove,
  artworks,
  updateState,
  onRefresh,
  onOpenCompetitor,
}: {
  keyword: string;
  ranking?: RankingRow;
  onRemove: () => void;
  artworks: Record<string, string>;
  updateState?: RowUpdateState;
  onRefresh: () => void;
  onOpenCompetitor: (bundleID: string) => void;
}) {
  const dayDelta = delta(ranking?.yesterday ?? null, ranking?.today ?? null);
  const weekDelta = delta(ranking?.w1 ?? null, ranking?.today ?? null);
  const tone = rankTone(ranking?.today ?? null);
  return (
    <tr>
      <td className="keyword-cell">
        <strong>{keyword}</strong>
        {ranking?.today != null && ranking.today <= 10 && <span className="keyword-dot" />}
      </td>
      <td><UpdateStatus state={updateState} timestamp={ranking?.lastUpdated} /></td>
      <td><span className={`rank rank-${tone}`}>{ranking?.today ? `# ${ranking.today}` : '# —'}</span></td>
      <td><Delta value={dayDelta} /></td>
      <td><Delta value={weekDelta} /></td>
      <td><MiniTrend values={ranking?.trend ?? []} /></td>
      <td><TopApps apps={ranking?.top5 ?? []} artworks={artworks} onOpen={onOpenCompetitor} /></td>
      <td>
        <div className="row-actions">
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
      if (!multiline && !isError && !isApp && event.key === 'Enter' && value.trim()) onSubmit(value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isApp, isError, multiline, onClose, onSubmit, value]);

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
        <div className={`dialog-symbol ${isError ? 'dialog-symbol-error' : ''}`}>{isError ? '!' : '+'}</div>
        <h2 id="dialog-title">{dialog.title}</h2>
        <p>{dialog.message}</p>
        {!isError && dialog.kind === 'locale' ? (
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
        ) : !isError && (multiline ? (
          <textarea autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={dialog.placeholder} rows={6} />
        ) : (
          <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={dialog.placeholder} inputMode={dialog.kind === 'app' ? 'numeric' : 'text'} />
        ))}
        <div className="dialog-actions">
          {!isError && <button className="dialog-button dialog-button-secondary" onClick={onClose}>Cancel</button>}
          <button className="dialog-button dialog-button-primary" disabled={busy || (!isError && (!value.trim() || (isApp && !appCanSubmit)))} onClick={() => onSubmit(value)}>
            {busy ? 'Working…' : isError ? 'Done' : dialog.kind === 'keywords' ? 'Add keywords' : dialog.kind === 'locale' ? 'Add locale' : 'Add app'}
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

function SkeletonRow() {
  return (
    <tr className="skeleton-row">
      <td><i /></td><td><i /></td><td><i /></td><td><i /></td><td><i /></td><td><i /></td><td><i /></td><td />
    </tr>
  );
}
