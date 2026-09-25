import { useEffect, useRef, useState } from 'react';

// In dev, all three studios live behind the keywords vite (:5173) via reverse proxy.
// When opened directly on :5190 we still want absolute URLs that work — fall back to :5173.
const TRACKER_ORIGIN =
  typeof window !== 'undefined' && window.location.port === '5190' ? 'http://localhost:5173' : '';

type Item = {
  id: 'aso' | 'shot' | 'vid' | 'asa' | 'inapp';
  label: string;
  hint: string;
  href: string;
  glyph: string;
};

const ITEMS: Item[] = [
  { id: 'aso',  label: 'Keywords',    hint: 'Keywords & rankings', href: `${TRACKER_ORIGIN}/`,        glyph: '◇' },
  { id: 'shot', label: 'Screenshots', hint: 'App Store visuals',   href: `${TRACKER_ORIGIN}/studio/`, glyph: '▤' },
  { id: 'vid',  label: 'Video',       hint: 'Ad video pipeline',   href: `${TRACKER_ORIGIN}/video/`,  glyph: '▶' },
  { id: 'asa',  label: 'Ads',         hint: 'Search Ads ROI',      href: `${TRACKER_ORIGIN}/asa/`,    glyph: '$' },
  { id: 'inapp', label: 'In-App',     hint: 'In-App Events',       href: 'http://localhost:5196/', glyph: '✦' },
];

const COLORS: Record<Item['id'], string> = {
  aso: 'linear-gradient(135deg, #FF8C42, #F25C1F)',
  shot: 'linear-gradient(135deg, #7C3AED, #A78BFA)',
  vid: 'linear-gradient(135deg, #14B8A6, #5EEAD4)',
  asa: 'linear-gradient(135deg, #FFB000, #B87D00)',
  inapp: 'var(--ds-accent)',
};

export function BrandSwitcher({ current = 'vid' as Item['id'] }: { current?: Item['id'] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = ITEMS.find((i) => i.id === current) ?? ITEMS[0];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`ds-btn ds-btn-ghost${open ? ' on' : ''}`}
        style={{ gap: 10, padding: '0 10px 0 6px' }}
      >
        <span style={{
          width: 26, height: 26, borderRadius: 'var(--ds-radius-inner)',
          background: COLORS[active.id],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 12, fontWeight: 700,
          flex: 'none', lineHeight: 1,
        }}>{active.glyph}</span>
        <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: '16px', color: 'var(--ds-text)' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Studio</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ds-muted)' }}>{active.label}</span>
        </span>
        <span className="vid-caret">▾</span>
      </button>

      {open && (
        <div className="ds-pop vid-pop" style={{ minWidth: 240 }}>
          {ITEMS.map((it) => {
            const isActive = it.id === current;
            return (
              <a
                key={it.id}
                href={it.href}
                className={`ds-nav-item${isActive ? ' on' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                style={{ height: 'auto', padding: '8px 10px' }}
              >
                <span style={{
                  width: 26, height: 26, borderRadius: 'var(--ds-radius-inner)',
                  background: COLORS[it.id],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  flex: 'none', lineHeight: 1,
                }}>{it.glyph}</span>
                <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, lineHeight: '18px' }}>{it.label}</span>
                  <span style={{ fontSize: 12, lineHeight: '16px', fontWeight: 400, color: 'var(--ds-muted)' }}>{it.hint}</span>
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
