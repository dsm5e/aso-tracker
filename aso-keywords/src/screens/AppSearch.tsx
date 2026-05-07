import { useEffect, useRef, useState } from 'react';
import { Icon, Badge } from '../design/primitives.jsx';
import { api } from '../api';

interface Result {
  trackId: number;
  trackName?: string;
  bundleId?: string;
  artistName?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  averageUserRating?: number;
  trackViewUrl?: string;
}

interface Props {
  onClose: () => void;
  onTrack: (iTunesId: string) => void;
}

export default function AppSearch({ onClose, onTrack }: Props) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!term.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const data = await api.itunesSearch(term.trim());
        if (ctrl.signal.aborted) return;
        setResults(data);
      } catch (e) {
        if (!ctrl.signal.aborted) setError((e as Error).message || 'Search failed');
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.34)', backdropFilter: 'blur(3px)', zIndex: 80 }} />
      <div
        style={{
          position: 'fixed',
          top: '12vh', left: '50%',
          transform: 'translateX(-50%)',
          width: 620,
          maxHeight: '70vh',
          background: 'var(--bg-raised)',
          borderRadius: 16,
          boxShadow: 'inset 0 0 0 1px var(--border), 0 28px 80px -20px rgba(0,0,0,0.45)',
          zIndex: 90,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="search" size={14} stroke={1.8} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            placeholder="Search App Store by name, bundle id, or iTunes ID…"
            style={{ flex: 1, fontSize: 15, fontWeight: 500, background: 'transparent', border: 0, color: 'var(--text)', outline: 'none' }}
          />
          <span className="kbd">esc</span>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {!term.trim() && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Type to search iTunes — matches by app name, bundle id (<code>com.example</code>), or numeric App ID.
            </div>
          )}
          {term.trim() && loading && results.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Searching…</div>
          )}
          {error && (
            <div style={{ padding: 14, margin: 12, borderRadius: 10, background: '#FFE8E2', color: '#B8270A', fontSize: 12 }}>{error}</div>
          )}
          {!loading && term.trim() && results.length === 0 && !error && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No matches.</div>
          )}
          {results.map((r) => (
            <button
              key={r.trackId}
              onClick={() => onTrack(String(r.trackId))}
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px',
                border: 0, background: 'transparent',
                cursor: 'pointer', textAlign: 'left',
                borderBottom: '1px solid var(--border-subtle)',
                color: 'var(--text)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              {r.artworkUrl100 ? (
                <img src={r.artworkUrl100} width={44} height={44} alt="" style={{ borderRadius: 10, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.08)' }} />
              ) : (
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--bg-sunken)', boxShadow: 'inset 0 0 0 1px var(--border)' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.trackName}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.artistName}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.primaryGenreName && <Badge tone="neutral">{r.primaryGenreName}</Badge>}
                  {r.averageUserRating != null && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>⭐ {r.averageUserRating.toFixed(2)}</span>}
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{r.bundleId}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>· id={r.trackId}</span>
                </div>
              </div>
              <div style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                <Icon name="plus" size={11} /> Track
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
