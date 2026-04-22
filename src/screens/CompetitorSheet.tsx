import { useEffect, useMemo, useState } from 'react';
import { Icon, Flag, RankPill, Badge } from '../design/primitives.jsx';
import { api, type CompetitorInfo, type CompetitorKeywordRow } from '../api';

interface Props {
  appId: string;
  bundleId: string;
  onClose: () => void;
  /** Called when user clicks "Track this app" — parent opens AppAdder prefilled */
  onTrack?: (iTunesId: string) => void;
}

export default function CompetitorSheet({ appId, bundleId, onClose, onTrack }: Props) {
  const [info, setInfo] = useState<CompetitorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [keywords, setKeywords] = useState<CompetitorKeywordRow[]>([]);
  const [copied, setCopied] = useState(false);
  const [kwFilter, setKwFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    Promise.all([
      api.competitorInfo(bundleId).catch(() => null),
      api.competitorKeywords(appId, bundleId).catch(() => []),
    ]).then(([i, k]) => {
      if (cancelled) return;
      setInfo(i);
      setKeywords(k);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [appId, bundleId]);

  const filtered = useMemo(() => {
    const q = kwFilter.toLowerCase();
    return q ? keywords.filter((r) => r.keyword.toLowerCase().includes(q) || r.locale.toLowerCase().includes(q)) : keywords;
  }, [keywords, kwFilter]);

  // Stats
  const stats = useMemo(() => {
    const locales = new Set<string>();
    let sumRank = 0;
    let beatUs = 0;
    for (const r of keywords) {
      locales.add(r.locale);
      sumRank += r.theirRank;
      if (r.yourRank == null || r.theirRank < r.yourRank) beatUs++;
    }
    return {
      keywords: keywords.length,
      locales: locales.size,
      avgRank: keywords.length ? (sumRank / keywords.length).toFixed(2) : '—',
      beatUs,
    };
  }, [keywords]);

  const copyITunesId = () => {
    if (!info?.iTunesId) return;
    navigator.clipboard.writeText(info.iTunesId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.34)', backdropFilter: 'blur(3px)', zIndex: 60 }} />
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 520,
          background: 'var(--bg-raised)',
          boxShadow: 'inset 1px 0 0 var(--border), -20px 0 40px -20px rgba(0,0,0,0.22)',
          display: 'flex', flexDirection: 'column', zIndex: 70,
        }}
      >
        {/* Header */}
        <header style={{ padding: 16, borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          {info?.iconUrl ? (
            <img src={info.iconUrl} alt="" width={56} height={56} style={{ borderRadius: 13, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: 13, background: 'var(--bg-sunken)', boxShadow: 'inset 0 0 0 1px var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: 'var(--text-muted)' }}>
              {(info?.name || bundleId).charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {loading ? 'Loading…' : info?.name || bundleId}
            </div>
            {info?.dev && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{info.dev}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
              {info?.category && <Badge tone="neutral">{info.category}</Badge>}
              {info?.rating != null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text-muted)' }}>
                  ⭐ <span className="num">{info.rating.toFixed(2)}</span>
                  {info.ratingCount != null && <span style={{ color: 'var(--text-faint)' }}>({info.ratingCount.toLocaleString()})</span>}
                </span>
              )}
              <span style={{ fontSize: 10.5, color: 'var(--text-faint)', fontFamily: '"JetBrains Mono", monospace' }}>{bundleId}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={13} /></button>
        </header>

        {/* Actions */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {info?.iTunesId && onTrack && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onTrack(info.iTunesId!)}
              title="Add this app to your tracking list"
            >
              <Icon name="plus" size={11} /> Track this app
            </button>
          )}
          {info?.storeUrl && (
            <a href={info.storeUrl} target="_blank" rel="noreferrer" className="btn btn-sm">
              <Icon name="arrow-right" size={11} /> Open in App Store
            </a>
          )}
          {info?.iTunesId && (
            <button className="btn btn-sm" onClick={copyITunesId}>
              <Icon name={copied ? 'check' : 'download'} size={11} /> {copied ? 'Copied!' : `Copy App ID (${info.iTunesId})`}
            </button>
          )}
        </div>

        {/* Stats strip */}
        <div style={{ display: 'flex', padding: 16, gap: 12, borderBottom: '1px solid var(--border-subtle)' }}>
          <Stat label="Seen in" value={stats.keywords} sub="of your keywords" />
          <Stat label="Across" value={stats.locales} sub="locales" />
          <Stat label="Avg rank" value={stats.avgRank} accent />
          <Stat label="Beats you" value={stats.beatUs} sub={`of ${stats.keywords}`} tone={stats.beatUs > stats.keywords / 2 ? 'neg' : 'pos'} />
        </div>

        {/* Filter */}
        <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="label" style={{ flex: 1 }}>Keywords where they rank in top-5</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-sunken)', borderRadius: 8, padding: '0 10px', height: 28, boxShadow: 'inset 0 0 0 1px var(--border-subtle)', width: 200 }}>
            <Icon name="search" size={11} stroke={1.8} style={{ color: 'var(--text-muted)' }} />
            <input
              value={kwFilter}
              onChange={(e) => setKwFilter(e.target.value)}
              placeholder="Filter…"
              style={{ flex: 1, fontSize: 12, background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
            />
          </div>
        </div>

        {/* Keyword list */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              {keywords.length === 0 ? 'This app isn’t in top-5 for any of your tracked keywords yet.' : 'No keywords match the filter.'}
            </div>
          )}
          {filtered.map((r, i) => {
            const beatsUs = r.yourRank == null || r.theirRank < r.yourRank;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', fontSize: 12.5 }}>
                <Flag code={r.locale.toUpperCase()} size={13} />
                <span className="num" style={{ fontSize: 10.5, color: 'var(--text-muted)', width: 28, fontWeight: 500 }}>{r.locale.toUpperCase()}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{r.keyword}</span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>them</span>
                  <RankPill rank={r.theirRank} />
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 8 }}>you</span>
                  <RankPill rank={r.yourRank} />
                  {beatsUs && <span title="They rank better than you here" style={{ color: 'var(--neg)', fontSize: 11, fontWeight: 600 }}>↑</span>}
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value, sub, accent, tone }: { label: string; value: string | number; sub?: string; accent?: boolean; tone?: 'pos' | 'neg' }) {
  const color = accent ? 'var(--accent)' : tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : 'var(--text)';
  return (
    <div style={{ flex: 1, padding: 12, background: 'var(--bg-sunken)', borderRadius: 10, boxShadow: 'inset 0 0 0 1px var(--border-subtle)', minWidth: 0 }}>
      <div className="label" style={{ fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div className="hero-num" style={{ fontSize: 20, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
