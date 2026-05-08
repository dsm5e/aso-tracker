// In-node "pick from history" — opens a small popover with a grid of recently
// rendered files of the requested kind (image / video). Click a thumbnail and
// the parent node accepts the URL as its output (skipping a fresh generation).
//
// Used in FluxImageNode (kind=image) and VideoGenNode (kind=video) so the
// operator can re-use a previous render — e.g. "I generated 4 variants in a
// row, this older one was the keeper".
import { useEffect, useRef, useState } from 'react';
import { API } from '../store/graphClient';

interface LibItem {
  kind: 'image' | 'video' | 'audio';
  filename: string;
  url: string;
  size_bytes: number;
  mtime: number;
}

interface Props {
  kind: 'image' | 'video';
  onPick: (url: string) => void;
}

export function HistoryPicker({ kind, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LibItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`${API}/library`)
      .then((r) => r.json())
      .then((j) => {
        const arr: LibItem[] = (j.items ?? []).filter((it: LibItem) => it.kind === kind);
        arr.sort((a, b) => b.mtime - a.mtime);
        setItems(arr);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, kind]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="nodrag" style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Pick a previously rendered ${kind} from output/`}
        style={{
          background: '#171717',
          color: '#e5e5e5',
          border: '1px solid #2a2a2a',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 11,
          cursor: 'pointer',
          width: '100%',
        }}
      >📂 Pick from history</button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          background: '#0e0e0e',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          padding: 6,
          zIndex: 100,
          maxHeight: 360,
          overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        }}>
          {loading && <div style={{ padding: 12, fontSize: 11, color: '#9ca3af' }}>Loading…</div>}
          {!loading && items.length === 0 && (
            <div style={{ padding: 12, fontSize: 11, color: '#9ca3af' }}>No {kind}s in output yet.</div>
          )}
          {!loading && items.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
              {items.slice(0, 40).map((it) => (
                <button
                  key={it.url}
                  type="button"
                  onClick={() => { onPick(it.url); setOpen(false); }}
                  title={`${it.filename}\n${new Date(it.mtime).toLocaleString()}`}
                  style={{
                    background: '#171717',
                    border: '1px solid #2a2a2a',
                    borderRadius: 6,
                    padding: 0,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    aspectRatio: '9 / 16',
                    position: 'relative',
                  }}
                >
                  {it.kind === 'image' ? (
                    <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <video src={it.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  )}
                  <div style={{
                    position: 'absolute',
                    inset: 'auto 0 0 0',
                    padding: '3px 4px',
                    fontSize: 9,
                    color: '#e5e5e5',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
                    textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{relTime(it.mtime)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function relTime(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
