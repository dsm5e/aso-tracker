import { useEffect, useRef, useState } from 'react';

// In dev, all three studios live behind the keywords vite (:5173) via reverse proxy.
// When opened directly on :5190 we still want absolute URLs that work — fall back to :5173.
const TRACKER_ORIGIN =
  typeof window !== 'undefined' && window.location.port === '5190' ? 'http://localhost:5173' : '';

type Item = {
  id: 'aso' | 'shot' | 'vid';
  label: string;
  hint: string;
  href: string;
  glyph: string;
};

const ITEMS: Item[] = [
  { id: 'aso',  label: 'ASO',         hint: 'Keywords & rankings', href: `${TRACKER_ORIGIN}/`,        glyph: '◇' },
  { id: 'shot', label: 'Screenshots', hint: 'App Store visuals',   href: `${TRACKER_ORIGIN}/studio/`, glyph: '▤' },
  { id: 'vid',  label: 'Video',       hint: 'Ad video pipeline',   href: `${TRACKER_ORIGIN}/video/`,  glyph: '▶' },
];

const COLORS: Record<Item['id'], string> = {
  aso: 'linear-gradient(135deg, #FF8C42, #F25C1F)',
  shot: 'linear-gradient(135deg, #7C3AED, #A78BFA)',
  vid: 'linear-gradient(135deg, #14B8A6, #5EEAD4)',
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
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          padding: '4px 10px 4px 4px', height: 32,
          background: open ? '#1f1f1f' : 'transparent',
          border: 0, borderRadius: 8, cursor: 'pointer',
          color: '#e5e5e5',
        }}
      >
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: COLORS[active.id],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 12, fontWeight: 700,
          flex: 'none', lineHeight: 1,
        }}>{active.glyph}</span>
        <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.15 }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '-0.01em' }}>ASO Studio</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>{active.label}</span>
        </span>
        <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 2 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          minWidth: 220, padding: 6,
          background: '#171717',
          borderRadius: 10,
          border: '1px solid #2a2a2a',
          boxShadow: '0 18px 40px -12px rgba(0,0,0,0.6)',
          zIndex: 1000,
        }}>
          {ITEMS.map((it) => {
            const isActive = it.id === current;
            return (
              <a
                key={it.id}
                href={it.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 6,
                  textDecoration: 'none',
                  background: isActive ? '#1f1f1f' : 'transparent',
                  color: '#e5e5e5',
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = '#1f1f1f'; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 6,
                  background: COLORS[it.id],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  flex: 'none', lineHeight: 1,
                }}>{it.glyph}</span>
                <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{it.label}</span>
                  <span style={{ fontSize: 10.5, opacity: 0.6 }}>{it.hint}</span>
                </span>
                {isActive && <span style={{ fontSize: 10, color: '#10B981' }}>●</span>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
