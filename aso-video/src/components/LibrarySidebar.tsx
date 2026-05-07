// Left collapsible sidebar — surfaces the file library (output/*) for the user.
// Auto-polls /api/library every 5s. Sidebar collapsed/expanded state persists
// in localStorage. Clicking a thumb opens the Lightbox.
import { useEffect, useState } from 'react';
import { openLightbox } from './Lightbox';
import { API } from '../store/graphClient';

interface LibItem {
  kind: 'image' | 'video' | 'audio';
  filename: string;
  url: string;
  size_bytes: number;
  mtime: number;
}

interface LibResponse {
  ok: boolean;
  items: LibItem[];
  total_files: number;
  total_bytes: number;
}

type Filter = 'all' | 'image' | 'video' | 'audio';

const STORAGE_KEY = 'aso-video.librarySidebarOpen';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

// Match each file to the node type that produced it (by filename prefix) so
// the thumbnail border colour matches the node colour in the graph editor.
// Mirrors COLORS in nodes/common.tsx.
const NODE_COLORS = {
  captions: '#EC4899',         // captions — pink
  videoGen: '#3B82F6',         // video-gen — blue
  fluxImage: '#F97316',        // image-gen (character) — orange
  tts: '#10B981',              // tts-voice — green
  ref: '#7C3AED',              // reference-image / video — purple
  splitScreen: '#06B6D4',      // split-screen — cyan
  imageOverlay: '#A855F7',     // image-overlay — violet
  endCard: '#B4A0E5',          // end-card — lavender (Dream brand)
  stitch: '#14B8A6',           // stitch — teal
  unknown: '#3a3a3a',
};
function categoryColor(filename: string): string {
  const f = filename.toLowerCase();
  if (f.startsWith('captioned-')) return NODE_COLORS.captions;
  if (f.startsWith('kling-') || f.startsWith('seedance-') || f.startsWith('happy') || f.startsWith('hh-')) {
    return NODE_COLORS.videoGen;
  }
  if (f.startsWith('gpt2-') || f.startsWith('flux-') || f.startsWith('nano-') ||
      f.startsWith('seedream-') || f.startsWith('imagen4-')) {
    return NODE_COLORS.fluxImage;
  }
  if (f.startsWith('voice-') || f.startsWith('tts-') || f.startsWith('voiceover-')) {
    return NODE_COLORS.tts;
  }
  if (f.startsWith('upload-') || f.startsWith('ref-')) return NODE_COLORS.ref;
  if (f.startsWith('splitscreen-')) return NODE_COLORS.splitScreen;
  if (f.startsWith('overlay-')) return NODE_COLORS.imageOverlay;
  if (f.startsWith('endcard-')) return NODE_COLORS.endCard;
  if (f.startsWith('stitch-')) return NODE_COLORS.stitch;
  return NODE_COLORS.unknown;
}

export function LibrarySidebar() {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [items, setItems] = useState<LibItem[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch {}
  }, [open]);

  async function refresh() {
    try {
      const r = await fetch(`${API}/library`);
      if (!r.ok) return;
      const d = (await r.json()) as LibResponse;
      setItems(d.items);
      setTotalBytes(d.total_bytes);
    } catch {}
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const filtered = items.filter((i) => filter === 'all' || i.kind === filter);

  // Collapsed: icon-only column
  if (!open) {
    return (
      <div style={collapsedRail}>
        <button
          onClick={() => setOpen(true)}
          title="Open library"
          style={railBtn}
        >▶</button>
        <div style={{ writingMode: 'vertical-rl', fontSize: 10, color: '#9CA3AF', marginTop: 8, letterSpacing: 1 }}>
          LIBRARY · {items.length}
        </div>
      </div>
    );
  }

  return (
    <div style={panel}>
      <div style={header}>
        <strong style={{ fontSize: 13 }}>Library</strong>
        <div style={{ flex: 1 }} />
        <button onClick={refresh} title="refresh" style={iconBtn}>⟳</button>
        <button onClick={() => setOpen(false)} title="collapse" style={iconBtn}>◀</button>
      </div>
      <div style={tabs}>
        {(['all', 'image', 'video', 'audio'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{ ...tabBtn, ...(filter === f ? tabActive : null) }}
          >
            {f === 'all' ? 'All' : f === 'image' ? 'Images' : f === 'video' ? 'Videos' : 'Audio'}
          </button>
        ))}
      </div>
      <div style={grid}>
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', fontSize: 11, color: '#6B7280' }}>
            no files
          </div>
        )}
        {filtered.map((item) => (
          <Thumb key={item.url} item={item} onDeleted={refresh} />
        ))}
      </div>
      <div style={footer}>
        Total: {items.length} files, {fmtBytes(totalBytes)}
      </div>
    </div>
  );
}

function Thumb({ item, onDeleted }: { item: LibItem; onDeleted: () => void }) {
  const tooltip = `${item.filename}\n${fmtBytes(item.size_bytes)}\n${fmtDate(item.mtime)}`;
  const onClick = () => {
    if (item.kind === 'audio') {
      window.open(item.url, '_blank');
      return;
    }
    openLightbox({ kind: item.kind, src: item.url });
  };
  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${item.filename}"?`)) return;
    try {
      const r = await fetch(`${API}/library?url=${encodeURIComponent(item.url)}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.error ?? `delete failed (${r.status})`);
        return;
      }
      onDeleted();
    } catch (e) {
      alert((e as Error).message);
    }
  }
  const accent = categoryColor(item.filename);
  return (
    <div
      onClick={onClick}
      title={tooltip}
      style={{ ...thumbBox, borderColor: accent, boxShadow: `0 0 0 1px ${accent}66` }}
    >
      <div style={mediaWrap}>
        {item.kind === 'image' && (
          <img src={item.url} alt="" style={thumbMedia} />
        )}
        {item.kind === 'video' && (
          <video src={item.url} muted preload="metadata" style={thumbMedia} />
        )}
        {item.kind === 'audio' && (
          <div style={{ ...thumbMedia, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, background: '#1f1f1f' }}>
            🔊
          </div>
        )}
        <button
          onClick={handleDelete}
          title="delete"
          style={deleteBtn}
        >×</button>
      </div>
      <div style={thumbCaption}>{item.filename}</div>
    </div>
  );
}

const collapsedRail: React.CSSProperties = {
  position: 'absolute', top: 64, left: 0, bottom: 0, width: 40,
  background: 'rgba(15,15,15,0.92)', borderRight: '1px solid #2a2a2a',
  display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8,
  zIndex: 9,
};

const railBtn: React.CSSProperties = {
  background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a',
  borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontSize: 12, width: 28,
};

const panel: React.CSSProperties = {
  position: 'absolute', top: 64, left: 0, bottom: 0, width: 320,
  background: 'rgba(15,15,15,0.96)', borderRight: '1px solid #2a2a2a',
  display: 'flex', flexDirection: 'column',
  zIndex: 9,
  boxShadow: '4px 0 12px rgba(0,0,0,0.4)',
};

const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '10px 12px', borderBottom: '1px solid #2a2a2a',
};

const iconBtn: React.CSSProperties = {
  background: '#171717', color: '#e5e5e5', border: '1px solid #2a2a2a',
  borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12,
};

const tabs: React.CSSProperties = {
  display: 'flex', gap: 4, padding: '8px 10px', borderBottom: '1px solid #1f1f1f',
};

const tabBtn: React.CSSProperties = {
  flex: 1, background: 'transparent', color: '#9CA3AF',
  border: '1px solid #2a2a2a', borderRadius: 4, padding: '4px 6px',
  cursor: 'pointer', fontSize: 11,
};

const tabActive: React.CSSProperties = {
  background: '#3B82F6', color: '#fff', borderColor: '#3B82F6',
};

const grid: React.CSSProperties = {
  flex: 1, overflowY: 'auto', padding: 10,
  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
  alignContent: 'start',
  // Force each row to size itself to its content (the 220px-tall media +
  // caption) instead of being collapsed by the parent grid's auto-rows.
  gridAutoRows: 'min-content',
};

const thumbBox: React.CSSProperties = {
  cursor: 'zoom-in', borderRadius: 6, overflow: 'hidden',
  background: '#0a0a0a',
  // borderColor is overridden per-thumb based on file category.
  borderWidth: 2, borderStyle: 'solid', borderColor: '#2a2a2a',
  display: 'flex', flexDirection: 'column',
};

const mediaWrap: React.CSSProperties = {
  position: 'relative', width: '100%',
  // Use both `height` and `min-height` so flex/grid contexts can't squish.
  height: 220, minHeight: 220, flexShrink: 0,
};

const thumbMedia: React.CSSProperties = {
  position: 'absolute', inset: 0,
  width: '100%', height: '100%', objectFit: 'cover',
  background: '#000', display: 'block',
};

const thumbCaption: React.CSSProperties = {
  fontSize: 10, color: '#9CA3AF', padding: '4px 6px',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

const deleteBtn: React.CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  width: 22, height: 22, borderRadius: 11,
  background: 'rgba(0,0,0,0.7)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.2)',
  cursor: 'pointer', fontSize: 14, lineHeight: '18px', padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const footer: React.CSSProperties = {
  padding: '8px 12px', borderTop: '1px solid #2a2a2a',
  fontSize: 11, color: '#9CA3AF',
};
