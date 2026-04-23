import { useEffect, useMemo, useState } from 'react';
import {
  Icon,
  Sparkline,
  Flag,
  RankPill,
  PositionDelta,
  Badge,
  AppIcon,
  Segmented,
} from '../design/primitives.jsx';
import { TopBar } from '../design/screen-dashboard.jsx';
import { api, type AppStats, type RankingRow, type CompetitorSummary, type RelevanceRow } from '../api';
import KeywordsEditor from './KeywordsEditor';

const PAGE_SIZES = [50, 100, 200, 500] as const;
type PageSize = typeof PAGE_SIZES[number] | 'all';

interface Props {
  app: AppStats;
  theme: 'light' | 'dark';
  onBack: () => void;
  onCmdK: () => void;
  onToggleTheme: () => void;
  onNavigate?: (label: string) => void;
  onOpenCompetitor: (bundleId: string) => void;
  onRunSnapshot: (opts?: { locales?: string[] }) => void;
  onDelete: () => void;
}

type Tab = 'rankings' | 'keywords' | 'locales' | 'history';

export default function AppDetailScreen({
  app,
  theme,
  onBack,
  onCmdK,
  onToggleTheme,
  onNavigate,
  onOpenCompetitor,
  onRunSnapshot,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<Tab>('rankings');
  const [locale, setLocale] = useState<string>('ALL');
  const [pageSize, setPageSize] = useState<PageSize>(100);
  const [search, setSearch] = useState('');
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number>(-1);
  const [competitors, setCompetitors] = useState<CompetitorSummary[]>([]);
  const [relevance, setRelevance] = useState<Record<string, RelevanceRow>>({});
  const [relevanceLoading, setRelevanceLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'rankings') return;
    api.rankings(app.id, locale === 'ALL' ? undefined : locale).then(setRankings).catch(() => setRankings([]));
    api.competitors(app.id).then(setCompetitors).catch(() => setCompetitors([]));
    setRelevanceLoading(true);
    api
      .keywordRelevance(app.id, locale === 'ALL' ? undefined : locale)
      .then((rows) => {
        const map: Record<string, RelevanceRow> = {};
        for (const r of rows) map[`${r.locale}|${r.keyword}`] = r;
        setRelevance(map);
      })
      .catch(() => setRelevance({}))
      .finally(() => setRelevanceLoading(false));
    // Also re-fetch whenever the `app` object identity changes (App.tsx refreshes after snapshot)
  }, [app, locale, tab]);

  const filtered = useMemo(() => {
    const needle = search.toLowerCase();
    return search
      ? rankings.filter((r) => r.keyword.toLowerCase().includes(needle) || r.locale.toLowerCase().includes(needle))
      : rankings;
  }, [rankings, search]);

  const pageLimit = pageSize === 'all' ? filtered.length : pageSize;
  const visible = filtered.slice(0, pageLimit);
  const selectedRow = selectedIdx >= 0 ? visible[selectedIdx] : null;

  return (
    <div className="app" data-theme={theme} style={{ width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Keep the same top bar so navigation stays consistent */}
      <TopBar theme={theme} onToggleTheme={onToggleTheme} onCmdK={onCmdK} active="Apps" onNavigate={onNavigate} />

      {/* Header row */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 28px', borderBottom: '1px solid var(--border-subtle)' }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <Icon name="chevron-left" size={13} /> Overview
        </button>
        <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>/</span>
        <AppIcon bg={app.iconBg} emoji={app.emoji} iconUrl={app.iconUrl} size={28} rounded={8} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{app.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{app.bundle} · iTunes {app.iTunesId}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
          <Icon name="clock" size={11} stroke={1.8} /> Last snapshot {app.lastSnapshot ?? '—'}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => onRunSnapshot()}>
          <Icon name="play" size={11} /> Run snapshot
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            if (confirm(`Delete "${app.name}"?\n\nThis permanently removes:\n  • all keyword lists for this app\n  • all snapshot history\n  • the app from your tracking list\n\nThis cannot be undone.`)) {
              onDelete();
            }
          }}
          title="Delete this app and all its data"
          style={{ color: 'var(--neg)' }}
        >
          <Icon name="x" size={11} />
        </button>
      </header>

      <div style={{ flex: 1, padding: '20px 28px 40px' }}>
        {/* Metric strip */}
        <div style={{ background: 'var(--bg-raised)', borderRadius: 20, boxShadow: 'inset 0 0 0 1px var(--border)', display: 'flex', marginBottom: 20, overflow: 'hidden' }}>
          <BigMetric label="Total keywords" value={app.keywords} />
          <BigMetric label="Ranked" value={app.ranked} delta={app.weekDelta.ranked} />
          <BigMetric label="Avg position" value={app.avgPos.toFixed(1)} delta={app.weekDelta.avg} toneInverted />
          <BigMetric label="In Top 10" value={app.top10} delta={app.weekDelta.top10} accent />
        </div>

        {/* Tabs + filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <Segmented
            value={tab}
            onChange={(v: string) => setTab(v as Tab)}
            options={[
              { value: 'rankings', label: 'Rankings', icon: 'list' },
              { value: 'keywords', label: 'Keywords', icon: 'tag' },
              { value: 'locales', label: 'Locales', icon: 'globe' },
              { value: 'history', label: 'History', icon: 'history' },
            ]}
          />
          <div style={{ flex: 1 }} />

          {tab === 'rankings' && (
            <>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-sunken)', borderRadius: 8, padding: '0 10px', height: 28, boxShadow: 'inset 0 0 0 1px var(--border-subtle)', width: 220 }}>
                <Icon name="search" size={12} stroke={1.8} style={{ color: 'var(--text-muted)' }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter keywords…"
                  style={{ flex: 1, fontSize: 13, background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
                />
              </div>
              <LocalePicker value={locale} options={app.locales} onChange={setLocale} />
              {locale !== 'ALL' && (
                <button
                  className="btn btn-sm"
                  onClick={() => onRunSnapshot({ locales: [locale] })}
                  title={`Snapshot ${locale.toUpperCase()} only`}
                >
                  <Icon name="play" size={11} /> Snapshot {locale.toUpperCase()}
                </button>
              )}
              <PageSizePicker value={pageSize} onChange={setPageSize} />
            </>
          )}
        </div>

        {tab === 'rankings' && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <RankingsTable rows={visible} selectedIdx={selectedIdx} onRowClick={(i) => setSelectedIdx(i === selectedIdx ? -1 : i)} onCompetitorClick={onOpenCompetitor} relevance={relevance} relevanceLoading={relevanceLoading} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 4px', fontSize: 12.5, color: 'var(--text-muted)' }}>
                <span>Showing {visible.length} of {filtered.length} keywords {search && <span style={{ color: 'var(--text-faint)' }}>(filtered from {rankings.length})</span>}</span>
              </div>
            </div>
            {selectedRow && (
              <CompetitorDrawer
                row={selectedRow}
                onClose={() => setSelectedIdx(-1)}
                onCompetitorClick={onOpenCompetitor}
                relevance={relevance[`${selectedRow.locale}|${selectedRow.keyword}`]}
                appId={app.id}
                onRefreshed={() => {
                  api.rankings(app.id, locale === 'ALL' ? undefined : locale)
                    .then(setRankings).catch(() => {});
                }}
              />
            )}
          </div>
        )}

        {tab === 'keywords' && (
          <KeywordsEditor
            app={app}
            onRunLocaleSnapshot={(loc) => onRunSnapshot({ locales: [loc] })}
            initialLocale={locale !== 'ALL' ? locale : undefined}
            onLocaleSync={(loc) => setLocale(loc)}
          />
        )}

        {tab === 'locales' && (
          <LocalesGrid appId={app.id} onPick={(loc) => { setLocale(loc); setTab('rankings'); }} />
        )}

        {tab === 'history' && (
          <InfoBanner>
            History view coming soon — run additional snapshots daily to build a richer trend graph.
          </InfoBanner>
        )}

        {tab === 'rankings' && competitors.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div className="label" style={{ marginBottom: 10 }}>Top competitors across your tracked keywords</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {competitors.slice(0, 20).map((c) => (
                <button
                  key={c.bundleId}
                  onClick={() => onOpenCompetitor(c.bundleId)}
                  className="btn btn-sm"
                  style={{
                    background: 'var(--bg-raised)',
                    boxShadow: 'inset 0 0 0 1px var(--border)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    height: 32,
                  }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{c.name}</span>
                  <Badge tone="neutral">{c.appearances}×</Badge>
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>avg #{c.avgRank}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BigMetric({ label, value, delta, accent, toneInverted }: { label: string; value: string | number; delta?: number; accent?: boolean; toneInverted?: boolean }) {
  const deltaPos = delta == null ? null : toneInverted ? delta < 0 : delta > 0;
  return (
    <div style={{ flex: 1, padding: '20px 24px', borderLeft: '1px solid var(--border-subtle)', minWidth: 0 }}>
      <div className="label">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <span className="hero-num" style={{ fontSize: 36, color: accent ? 'var(--accent)' : 'var(--text)' }}>{value}</span>
        {delta != null && delta !== 0 && (
          <span className={`num ${deltaPos ? 'delta-pos' : 'delta-neg'}`} style={{ fontSize: 13, fontWeight: 500 }}>
            {deltaPos ? '↑' : '↓'}{Math.abs(delta)}
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 4 }}>7d</span>
          </span>
        )}
      </div>
    </div>
  );
}

function LocalePicker({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const isFiltered = value !== 'ALL';
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: 'none',
          background: isFiltered ? 'var(--accent-tint)' : 'var(--bg-sunken)',
          color: isFiltered ? 'var(--accent)' : 'var(--text)',
          fontSize: 13,
          fontWeight: isFiltered ? 600 : 500,
          border: 0,
          borderRadius: 8,
          padding: `0 ${isFiltered ? 32 : 28}px 0 12px`,
          height: 28,
          boxShadow: `inset 0 0 0 1px ${isFiltered ? 'var(--accent-tint-2)' : 'var(--border-subtle)'}`,
          cursor: 'pointer',
        }}
      >
        <option value="ALL">All locales</option>
        {options.map((loc) => (
          <option key={loc} value={loc}>{loc.toUpperCase()}</option>
        ))}
      </select>
      {isFiltered ? (
        <button
          onClick={(e) => { e.stopPropagation(); onChange('ALL'); }}
          title="Clear locale filter"
          style={{
            position: 'absolute',
            right: 6, top: '50%', transform: 'translateY(-50%)',
            width: 18, height: 18, borderRadius: 4, padding: 0,
            background: 'transparent', border: 0, cursor: 'pointer',
            color: 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name="x" size={11} stroke={2.2} />
        </button>
      ) : (
        <Icon name="chevron-down" size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
      )}
    </div>
  );
}

function PageSizePicker({ value, onChange }: { value: PageSize; onChange: (v: PageSize) => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === 'all' ? 'all' : (Number(v) as PageSize));
        }}
        style={{
          appearance: 'none',
          background: 'var(--bg-sunken)',
          color: 'var(--text)',
          fontSize: 13,
          fontWeight: 500,
          border: 0,
          borderRadius: 8,
          padding: '0 28px 0 12px',
          height: 28,
          boxShadow: 'inset 0 0 0 1px var(--border-subtle)',
          cursor: 'pointer',
        }}
      >
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}/page</option>)}
        <option value="all">All</option>
      </select>
      <Icon name="chevron-down" size={11} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
    </div>
  );
}

function RankingsTable({ rows, selectedIdx, onRowClick, onCompetitorClick, relevance, relevanceLoading }: { rows: RankingRow[]; selectedIdx: number; onRowClick: (i: number) => void; onCompetitorClick: (bundleId: string) => void; relevance?: Record<string, RelevanceRow>; relevanceLoading?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-raised)', borderRadius: 16, boxShadow: 'inset 0 0 0 1px var(--border)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead>
          <tr style={{ background: 'var(--bg-sunken)' }}>
            <th style={th}>Locale</th>
            <th style={th}>Keyword</th>
            <th style={th}>Today</th>
            <th style={th}>Yesterday</th>
            <th style={th}>7d ago</th>
            <th style={th}>30d ago</th>
            <th style={th}>
              Relevance
              {relevanceLoading && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--text-faint)', textTransform: 'none' }}>loading…</span>}
            </th>
            <th style={th}>Trend</th>
            <th style={{ ...th, width: 32 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const sel = i === selectedIdx;
            return (
              <tr key={`${r.locale}|${r.keyword}`}
                  onClick={() => onRowClick(i)}
                  style={{
                    cursor: 'pointer',
                    background: sel ? 'var(--accent-tint)' : 'transparent',
                    boxShadow: sel ? 'inset 3px 0 0 var(--accent)' : 'none',
                  }}>
                <td style={td}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Flag code={r.locale.toUpperCase()} size={13} />
                    <span className="num" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.locale.toUpperCase()}</span>
                  </span>
                </td>
                <td style={{ ...td, fontWeight: sel ? 600 : 500, color: sel ? 'var(--accent)' : 'var(--text)' }}>{r.keyword}</td>
                <td style={td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><RankPill rank={r.today} /><PositionDelta fromRank={r.yesterday} toRank={r.today} /></span></td>
                <td style={td}><RankPill rank={r.yesterday} /></td>
                <td style={td}><RankPill rank={r.w1} /></td>
                <td style={td}><RankPill rank={r.w4} /></td>
                <td style={td}><RelevancePill row={relevance?.[`${r.locale}|${r.keyword}`]} /></td>
                <td style={td}>
                  {r.trend.length > 1 && <Sparkline data={r.trend.map((p) => p > 0 ? 201 - p : 0)} width={100} height={20} tone={r.today && r.today <= 10 ? 'pos' : 'accent'} />}
                </td>
                <td style={{ ...td, textAlign: 'right', width: 32 }}>
                  <Icon name="chevron-right" size={13} style={{ color: sel ? 'var(--accent)' : 'var(--text-faint)', transform: sel ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td style={{ ...td, textAlign: 'center', color: 'var(--text-muted)', padding: 40 }} colSpan={9}>
              No rankings yet for this locale. Run a snapshot.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', fontSize: 11.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' };
const td: React.CSSProperties = { padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' };

function RelevancePill({ row }: { row?: RelevanceRow }) {
  if (!row) return <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>—</span>;
  if (row.flag === 'unknown') return <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>n/a</span>;
  const bg =
    row.flag === 'match' ? 'rgba(48,200,120,0.15)'
    : row.flag === 'ambiguous' ? 'rgba(230,170,20,0.15)'
    : 'rgba(230,80,80,0.15)';
  const color =
    row.flag === 'match' ? 'var(--pos)'
    : row.flag === 'ambiguous' ? 'var(--warn)'
    : 'var(--neg)';
  const histText = row.genreHistogram
    .map((h) => `${h.count}× ${h.genre}`)
    .join(', ');
  return (
    <span
      title={`${row.relevance}% match — ${histText}`}
      style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 12,
        background: bg, color, fontSize: 12, fontVariantNumeric: 'tabular-nums', fontWeight: 600,
      }}
    >
      {row.relevance}%
    </span>
  );
}

function CompetitorDrawer({ row, onClose, onCompetitorClick, relevance, appId, onRefreshed }: { row: RankingRow; onClose: () => void; onCompetitorClick: (bundleId: string) => void; relevance?: RelevanceRow; appId: string; onRefreshed?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true); setErr(null);
    try {
      await api.refreshKeyword(appId, row.locale, row.keyword);
      onRefreshed?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const askClaude = async () => {
    setLoading(true); setErr(null);
    try {
      const { prompt } = await api.claudePrompt(appId, row.keyword, row.locale);
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div style={{ width: 340, flex: 'none', background: 'var(--bg-raised)', borderRadius: 16, boxShadow: 'inset 0 0 0 1px var(--border)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, alignSelf: 'flex-start', position: 'sticky', top: 80 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="label" style={{ marginBottom: 4 }}>Keyword</div>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{row.keyword}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 12.5, color: 'var(--text-muted)' }}>
            <Flag code={row.locale.toUpperCase()} size={12} /> {row.locale.toUpperCase()} · App Store
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={refreshing} title="Re-run this keyword now">
            <Icon name="refresh" size={12} style={refreshing ? { animation: 'spin 0.8s linear infinite' } : undefined} /> {refreshing ? '…' : 'Refresh'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={12} /></button>
        </div>
      </div>

      <div style={{ background: 'var(--bg-sunken)', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div className="label">Your rank</div>
          <div className="hero-num" style={{ fontSize: 28, color: (row.today ?? 999) <= 10 ? 'var(--pos)' : (row.today ?? 999) <= 50 ? 'var(--neg)' : 'var(--text-muted)' }}>#{row.today ?? '—'}</div>
        </div>
        <PositionDelta fromRank={row.yesterday} toRank={row.today} />
      </div>

      {relevance && relevance.flag !== 'unknown' && (
        <div style={{
          background: 'var(--bg-sunken)', borderRadius: 10, padding: 12,
          boxShadow: relevance.flag === 'mismatch' ? 'inset 0 0 0 1px rgba(230,80,80,0.35)' : 'inset 0 0 0 1px var(--border-subtle)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div className="label">Relevance vs your category ({relevance.ourGenre})</div>
            <RelevancePill row={relevance} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            {relevance.genreHistogram.map((h) => `${h.count}× ${h.genre}`).join(' · ')}
          </div>
          {relevance.flag === 'mismatch' && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
              Top results are a different category. Users searching this keyword may not be looking for your app.
              Low expected install CR, but could still attract niche users.
            </div>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={askClaude}
            disabled={loading}
            style={{ width: '100%' }}
            title="Copy a rich prompt to clipboard — paste into Claude Code to get analysis + asc-mcp apply plan"
          >
            <Icon name={copied ? 'check' : 'play'} size={11} /> {loading ? 'Building prompt…' : copied ? 'Prompt copied — paste in Claude Code' : '🤖 Ask Claude to fix this'}
          </button>
          {err && <div style={{ fontSize: 11.5, color: 'var(--neg)', marginTop: 6 }}>Failed: {err}</div>}
        </div>
      )}

      <div>
        <div className="label" style={{ marginBottom: 8 }}>Top-5 results today · click to profile</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {row.top5.map((c, i) => (
            <button
              key={c.id + i}
              onClick={() => c.id && onCompetitorClick(c.id)}
              disabled={!c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                background: 'transparent',
                border: 0,
                cursor: c.id ? 'pointer' : 'default',
                textAlign: 'left',
                color: 'var(--text)',
              }}
              onMouseEnter={(e) => { if (c.id) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <span className="num" style={{ fontSize: 12, color: 'var(--text-muted)', width: 14, fontWeight: 500 }}>#{c.pos ?? i + 1}</span>
              <span style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--bg-sunken)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                {(c.name || '?').charAt(0).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{c.name || 'unknown'}</div>
                {c.dev && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{c.dev}</div>}
              </div>
              {c.id && <Icon name="arrow-right" size={11} style={{ color: 'var(--text-faint)' }} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LocalesGrid({ appId, onPick }: { appId: string; onPick: (loc: string) => void }) {
  const [stats, setStats] = useState<Array<{ code: string; avg: number | null }>>([]);
  useEffect(() => {
    api.appLocales(appId).then(setStats);
  }, [appId]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
      {stats.map((s) => (
        <button key={s.code} className="btn" onClick={() => onPick(s.code.toLowerCase())}
          style={{
            background: 'var(--bg-raised)',
            boxShadow: 'inset 0 0 0 1px var(--border)',
            padding: '14px 16px',
            height: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            borderRadius: 12,
            cursor: 'pointer',
          }}>
          <Flag code={s.code} size={16} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{s.code}</span>
          <span style={{ flex: 1 }} />
          {s.avg != null ? (
            <span className="num" style={{ fontSize: 13, fontWeight: 600, color: s.avg <= 10 ? 'var(--pos)' : s.avg <= 50 ? 'var(--neg)' : 'var(--text-muted)' }}>#{s.avg}</span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>—</span>
          )}
        </button>
      ))}
    </div>
  );
}

function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-raised)',
      boxShadow: 'inset 0 0 0 1px var(--border)',
      borderRadius: 14,
      padding: 20,
      fontSize: 13,
      color: 'var(--text-muted)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
    }}>
      <Icon name="alert" size={14} style={{ color: 'var(--neg)', marginTop: 2 }} />
      <div>{children}</div>
    </div>
  );
}
