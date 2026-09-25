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
const WIDTH_STORAGE_KEY = 'aso-video.librarySidebarWidth';
const COLLAPSED_WIDTH = 40;

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
  captions: 'var(--vid-cat-compose)',
  videoGen: 'var(--vid-cat-gen)',
  fluxImage: 'var(--vid-cat-gen)',
  tts: 'var(--vid-cat-gen)',
  ref: 'var(--vid-cat-source)',
  splitScreen: 'var(--vid-cat-compose)',
  imageOverlay: 'var(--vid-cat-compose)',
  endCard: 'var(--vid-cat-compose)',
  stitch: 'var(--vid-cat-compose)',
  unknown: 'var(--ds-border)',
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
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
      return Number.isFinite(saved) && saved >= 240 ? saved : 320;
    } catch { return 320; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch {}
  }, [open]);

  useEffect(() => {
    const actual = open ? width : COLLAPSED_WIDTH;
    document.documentElement.style.setProperty('--aso-library-width', `${actual}px`);
    try { localStorage.setItem(WIDTH_STORAGE_KEY, String(width)); } catch {}
    return () => { document.documentElement.style.removeProperty('--aso-library-width'); };
  }, [open, width]);

  function beginResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const move = (ev: PointerEvent) => setWidth(Math.max(240, Math.min(720, startWidth + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

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
          className="ds-icon-btn"
          onClick={() => setOpen(true)}
          title="Open library"
        >▶</button>
        <div style={{ writingMode: 'vertical-rl', fontSize: 12, fontWeight: 600, color: 'var(--ds-muted)', marginTop: 8 }}>
          Library · {items.length}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...panel, width }}>
      <div style={header}>
        <span className="ds-card-title">Library</span>
        <div style={{ flex: 1 }} />
        <button className="ds-icon-btn" onClick={refresh} title="Refresh">⟳</button>
        <button className="ds-icon-btn" onClick={() => setOpen(false)} title="Collapse">◀</button>
      </div>
      <div className="ds-seg vid-lib-tabs" role="tablist">
        {(['all', 'image', 'video', 'audio'] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'image' ? 'Images' : f === 'video' ? 'Videos' : 'Audio'}
          </button>
        ))}
      </div>
      <div style={grid}>
        {filtered.length === 0 && (
          <div className="ds-note" style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center' }}>
            No files
          </div>
        )}
        {filtered.map((item) => (
          <Thumb key={item.url} item={item} onDeleted={refresh} />
        ))}
      </div>
      <div style={footer}>
        Total: {items.length} files, {fmtBytes(totalBytes)}
      </div>
      <div
        onPointerDown={beginResize}
        title="Drag to resize library"
        style={{
          position: 'absolute', top: 0, right: -4, bottom: 0, width: 8,
          cursor: 'ew-resize', touchAction: 'none', zIndex: 2,
        }}
      />
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
      style={{ ...thumbBox, borderTop: `3px solid ${accent}` }}
    >
      <div style={mediaWrap}>
        {item.kind === 'image' && (
          <img src={item.url} alt="" style={thumbMedia} />
        )}
        {item.kind === 'video' && (
          <video src={item.url} muted preload="metadata" style={thumbMedia} />
        )}
        {item.kind === 'audio' && (
          <div style={{ ...thumbMedia, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, background: 'var(--ds-hover)' }}>
            🔊
          </div>
        )}
        <button
          onClick={handleDelete}
          title="Delete file"
          style={deleteBtn}
        >×</button>
      </div>
      <div style={thumbCaption}>{item.filename}</div>
    </div>
  );
}

const collapsedRail: React.CSSProperties = {
  position: 'absolute', top: 80, left: 0, bottom: 0, width: 40,
  background: 'var(--ds-panel)', borderRight: '1px solid var(--ds-border)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8,
  zIndex: 9,
};

const panel: React.CSSProperties = {
  position: 'absolute', top: 80, left: 0, bottom: 0, width: 320,
  background: 'var(--ds-panel)', borderRight: '1px solid var(--ds-border)',
  display: 'flex', flexDirection: 'column',
  zIndex: 9,
  boxShadow: 'var(--ds-shadow)',
};

const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '8px 8px 8px 16px', borderBottom: '1px solid var(--ds-hairline)',
};

const grid: React.CSSProperties = {
  flex: 1, overflowY: 'auto', padding: '4px 10px 10px',
  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
  alignContent: 'start',
  // Force each row to size itself to its content (the 220px-tall media +
  // caption) instead of being collapsed by the parent grid's auto-rows.
  gridAutoRows: 'min-content',
};

// Thumbs are small cards: no outline, DS shadow, category shown as a 3px top rule
// (same language as node cards on the canvas).
const thumbBox: React.CSSProperties = {
  cursor: 'zoom-in', borderRadius: 'var(--ds-radius-card)', overflow: 'hidden',
  background: 'var(--ds-panel)', boxShadow: 'var(--ds-shadow)',
  borderTop: '3px solid var(--ds-border)',
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
  fontSize: 12, color: 'var(--ds-muted)', padding: '6px 8px',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};

// Sits on top of arbitrary media, so it keeps a dark scrim instead of DS tokens.
const deleteBtn: React.CSSProperties = {
  position: 'absolute', top: 6, right: 6,
  width: 24, height: 24, borderRadius: 'var(--ds-radius-inner)',
  background: 'rgba(0,0,0,0.6)', color: '#fff', border: 0,
  cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const footer: React.CSSProperties = {
  padding: '10px 16px', borderTop: '1px solid var(--ds-hairline)',
  fontSize: 12, color: 'var(--ds-muted)',
};
