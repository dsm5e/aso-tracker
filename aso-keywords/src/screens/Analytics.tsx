import { useEffect, useState } from 'react';
import { TopBar } from '../design/screen-dashboard.jsx';
import { Flag, RankPill, PositionDelta, AppIcon, Delta } from '../design/primitives.jsx';
import { api, type AppStats, type Mover, type MoversResponse } from '../api';

type Period = 'day' | 'week' | 'month';

interface Props {
  theme: string;
  apps: AppStats[];
  onToggleTheme: () => void;
  onCmdK: () => void;
  onSettings?: () => void;
  onNavigate: (label: string) => void;
}

const PERIOD_LABEL: Record<Period, string> = {
  day: 'vs yesterday',
  week: 'vs 7d ago',
  month: 'vs 30d ago',
};

export default function AnalyticsScreen({ theme, apps, onToggleTheme, onCmdK, onSettings, onNavigate }: Props) {
  const [period, setPeriod] = useState<Period>('week');
  const [appFilter, setAppFilter] = useState<string>(''); // '' = all
  const [data, setData] = useState<MoversResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api.movers(period, appFilter || undefined)
      .then((r) => { if (live) setData(r); })
      .catch((e) => { if (live) setError((e as Error).message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [period, appFilter]);

  const summary = data?.summary;

  return (
    <div className="app" data-theme={theme} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <TopBar theme={theme} onToggleTheme={onToggleTheme} onCmdK={onCmdK} onSettings={onSettings} active="Analytics" onNavigate={onNavigate} />
      <div style={{ padding: '24px 28px 60px', maxWidth: 1280, margin: '0 auto', width: '100%' }}>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, marginBottom: 20, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Analytics</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Movement across all tracked keywords{' '}
              <span style={{ color: 'var(--text-faint)' }}>·</span>{' '}
              {PERIOD_LABEL[period]}
            </p>
          </div>
          <div style={{ flex: 1 }} />

          {/* Period toggle */}
          <SegmentedSwitch
            value={period}
            options={[
              { v: 'day', label: 'Day' },
              { v: 'week', label: 'Week' },
              { v: 'month', label: 'Month' },
            ]}
            onChange={(v) => setPeriod(v as Period)}
          />

          {/* App filter */}
          <select
            value={appFilter}
            onChange={(e) => setAppFilter(e.target.value)}
            className="btn btn-ghost btn-sm"
            style={{
              height: 30, padding: '0 12px', fontSize: 12.5,
              background: 'var(--bg-sunken)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)',
              color: 'var(--text)', minWidth: 140,
            }}
          >
            <option value="">All apps</option>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        {error && <ErrorCard text={error} />}

        {/* Top summary cards */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 24 }}>
            <SummaryCard
              label="Ranked keywords"
              value={summary.totalRanked}
              delta={summary.rankedDelta}
              suffix=""
              hint={`${summary.combos} tracked`}
            />
            <SummaryCard
              label="Top 10"
              value={summary.top10}
              delta={summary.top10Delta}
              suffix=""
            />
            <SummaryCard
              label="Top 50"
              value={summary.top50}
              delta={summary.top50Delta}
              suffix=""
            />
            <SummaryCard
              label="Avg position"
              value={summary.avgPosition ?? '—'}
              delta={summary.avgDelta}
              suffix=""
              hint="lower = better"
            />
          </div>
        )}

        {/* Per-app breakdown table */}
        {data && data.perApp.length > 1 && !appFilter && (
          <div className="card" style={{ marginBottom: 24, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', fontSize: 13, fontWeight: 600 }}>
              By app · {PERIOD_LABEL[period]}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-sunken)', color: 'var(--text-muted)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={th}>App</th>
                  <th style={th}>Ranked</th>
                  <th style={th}>Top 10</th>
                  <th style={th}>Top 50</th>
                  <th style={th}>Avg</th>
                  <th style={th}>Combos</th>
                </tr>
              </thead>
              <tbody>
                {data.perApp.map((a) => {
                  const app = apps.find((x) => x.id === a.id);
                  return (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                      <td style={td}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          {app && <AppIcon bg={app.iconBg} emoji={app.emoji} iconUrl={app.iconUrl} size={20} rounded={6} />}
                          <button onClick={() => setAppFilter(a.id)} className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
                            {a.name}
                          </button>
                        </div>
                      </td>
                      <td style={td}><CellWithDelta value={a.totalRanked} delta={a.rankedDelta} /></td>
                      <td style={td}><CellWithDelta value={a.top10} delta={a.top10Delta} /></td>
                      <td style={td}><CellWithDelta value={a.top50} delta={a.top50Delta} /></td>
                      <td style={td}><CellWithDelta value={a.avgPosition ?? '—'} delta={a.avgDelta} /></td>
                      <td style={{ ...td, color: 'var(--text-muted)' }}>{a.combos}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Two-column movement panels */}
        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <MoversPanel title="🚀 Gainers" subtitle="Biggest rank improvements" rows={data.gainers} apps={apps} kind="gain" />
            <MoversPanel title="📉 Losers" subtitle="Biggest rank drops" rows={data.losers} apps={apps} kind="loss" />
            <MoversPanel title="✨ Newly ranked" subtitle="Started ranking in this period" rows={data.newlyRanked} apps={apps} kind="new" />
            <MoversPanel title="💀 Dropouts" subtitle="Stopped ranking in this period" rows={data.dropouts} apps={apps} kind="drop" />
          </div>
        )}

        {loading && !data && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 16px', textAlign: 'left', fontWeight: 600 };
const td: React.CSSProperties = { padding: '10px 16px', verticalAlign: 'middle' };

function SegmentedSwitch({ value, options, onChange }: { value: string; options: Array<{ v: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <div style={{
      display: 'inline-flex', padding: 2, gap: 1,
      background: 'var(--bg-sunken)',
      borderRadius: 10,
      boxShadow: 'inset 0 0 0 1px var(--border-subtle)',
    }}>
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className="btn btn-sm"
            style={{
              height: 26, padding: '0 14px', fontSize: 12, fontWeight: active ? 600 : 500,
              background: active ? 'var(--bg-raised)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: active ? 'inset 0 0 0 1px var(--border)' : 'none',
              borderRadius: 8,
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

function SummaryCard({ label, value, delta, suffix, hint }: { label: string; value: number | string; delta: number | null | undefined; suffix?: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="hero-num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{value}{suffix}</span>
        {delta != null && <Delta value={delta} />}
      </div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{hint}</div>}
    </div>
  );
}

function CellWithDelta({ value, delta }: { value: number | string; delta: number | null | undefined }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span className="num" style={{ fontWeight: 500 }}>{value}</span>
      {delta != null && <Delta value={delta} />}
    </span>
  );
}

function MoversPanel({ title, subtitle, rows, apps, kind }: { title: string; subtitle: string; rows: Mover[]; apps: AppStats[]; kind: 'gain' | 'loss' | 'new' | 'drop' }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{subtitle}</div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>No movement</div>
      ) : (
        <div>
          {rows.map((r, i) => {
            const app = apps.find((a) => a.id === r.app);
            return (
              <div key={i} style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                {app && <AppIcon bg={app.iconBg} emoji={app.emoji} iconUrl={app.iconUrl} size={16} rounded={5} />}
                <Flag code={r.locale.toUpperCase()} size={12} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                  {r.keyword}
                </span>
                {kind === 'new' ? (
                  <RankPill rank={r.to} />
                ) : kind === 'drop' ? (
                  <span className="num" style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>was #{r.from}</span>
                ) : (
                  <>
                    <span className="num" style={{ color: 'var(--text-faint)', fontSize: 12 }}>#{r.from}</span>
                    <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>→</span>
                    <RankPill rank={r.to} />
                    <PositionDelta fromRank={r.from} toRank={r.to} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ErrorCard({ text }: { text: string }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 20, color: 'var(--neg)', fontSize: 13 }}>
      <strong>Failed to load:</strong> {text}
    </div>
  );
}
