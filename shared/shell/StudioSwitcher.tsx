// Studio product switcher — the one block at the top-left of every product's
// sidebar / top bar. Same markup and CSS everywhere (DESIGN.md tokens only).
// aso-inapp/index.html is static and carries a hand-synced copy of this markup:
// change both together.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './StudioSwitcher.css';

export type StudioProductId = 'keywords' | 'ads' | 'screenshots' | 'video' | 'inapp';

interface StudioProduct {
  id: StudioProductId;
  name: string;
  purpose: string;
  href: string;
  icon: ReactNode;
}

// 16px stroke glyphs drawn in currentColor (white on the product square).
const svg = (children: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const STUDIO_PRODUCTS: StudioProduct[] = [
  { id: 'keywords', name: 'Keywords', purpose: 'Ключи и позиции в App Store', href: '/',
    icon: svg(<><circle cx="7" cy="7" r="4.25" /><path d="M10.2 10.2 13.5 13.5" /></>) },
  { id: 'ads', name: 'Ads', purpose: 'Экономика Apple Search Ads', href: '/asa/',
    icon: svg(<path d="M3 13V9M8 13V3M13 13V6" />) },
  { id: 'screenshots', name: 'Screenshots', purpose: 'Скриншоты для страницы App Store', href: '/studio/',
    icon: svg(<><rect x="4.5" y="2" width="7" height="12" rx="1.6" /><path d="M7 11.5h2" /></>) },
  { id: 'video', name: 'Video', purpose: 'Производство рекламных видео', href: '/video/',
    icon: svg(<path d="M5 3.2v9.6L12.5 8z" />) },
  { id: 'inapp', name: 'In-App', purpose: 'Карточки In-App Events', href: '/inapp/',
    icon: svg(<path d="M8 2.5l1.6 3.4 3.7.4-2.8 2.5.8 3.7L8 10.6l-3.3 1.9.8-3.7-2.8-2.5 3.7-.4z" />) },
];

export function StudioSwitcher({ current }: { current: StudioProductId }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const active = STUDIO_PRODUCTS.find((p) => p.id === current) ?? STUDIO_PRODUCTS[0];

  // The popover is portalled and fixed-positioned so no product container
  // (overflow:hidden shells, scrolling sidebars) can clip it.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  // Arrow keys walk the list; focus lands on the current product when opened by keyboard.
  const onPopKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = Array.from(popRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []);
    const i = rows.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
    rows[next]?.focus();
  };
  const onBtnKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    setOpen(true);
    requestAnimationFrame(() => popRef.current?.querySelector<HTMLAnchorElement>('a[aria-current]')?.focus());
  };

  return (
    <div className="studio-sw">
      <button
        ref={btnRef}
        type="button"
        className={`studio-sw-btn${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${active.name} Studio — переключить продукт`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onBtnKey}
      >
        <span className={`studio-sw-icon studio-sw-icon--${active.id}`}>{active.icon}</span>
        <span className="studio-sw-text">
          <span className="studio-sw-name">{active.name}</span>
          <span className="studio-sw-cap">Studio</span>
        </span>
        <svg className="studio-sw-chev" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          className="ds-pop studio-sw-pop"
          role="menu"
          style={{ top: pos.top, left: pos.left }}
          onKeyDown={onPopKey}
        >
          {STUDIO_PRODUCTS.map((p) => {
            const on = p.id === current;
            return (
              <a
                key={p.id}
                href={p.href}
                role="menuitem"
                className={`studio-sw-row${on ? ' on' : ''}`}
                aria-current={on ? 'page' : undefined}
              >
                <span className={`studio-sw-icon studio-sw-icon--${p.id}`}>{p.icon}</span>
                <span className="studio-sw-text">
                  <span className="studio-sw-name">{p.name}</span>
                  <span className="studio-sw-cap">{p.purpose}</span>
                </span>
              </a>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default StudioSwitcher;
