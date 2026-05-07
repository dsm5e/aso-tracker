import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Settings, ChevronDown, Check, Sparkles } from 'lucide-react';
import { Button } from './components/shared/Button';
import { Topbar } from './components/shared/Topbar';
import { SettingsModal } from './components/SettingsModal';
import { KeyMissingDialog } from './components/KeyMissingDialog';
import { useStudio } from './state/studio';
import { useKeyGate } from './state/keyGate';

const STEPS = [
  { value: '/setup', label: 'Setup', n: 1 },
  { value: '/catalog', label: 'Style', n: 2 },
  { value: '/editor', label: 'Editor', n: 3 },
  { value: '/polish', label: 'AI Polish', n: 4 },
  { value: '/locales', label: 'Locales', n: 5 },
  { value: '/export', label: 'Export', n: 6 },
];

interface SwitcherItem {
  id: 'aso' | 'shot' | 'vid';
  label: string;
  hint: string;
  href: string;
  glyph: string;
  disabled?: boolean;
}

// In dev the canonical unified origin is the Tracker's vite (:5173); it
// reverse-proxies /studio/* to Studio's vite (:5180). When the user opens
// Studio directly on :5180/studio/, an origin-relative '/' wouldn't reach
// Tracker — so we hardcode the absolute :5173 URL for that case in dev.
const TRACKER_ORIGIN =
  typeof window !== 'undefined' && window.location.port === '5180'
    ? 'http://localhost:5173'
    : '';

const SWITCHER_ITEMS: SwitcherItem[] = [
  { id: 'aso',  label: 'ASO',         hint: 'Keywords & rankings', href: `${TRACKER_ORIGIN}/`,         glyph: '◇' },
  { id: 'shot', label: 'Screenshots', hint: 'App Store visuals',   href: `${TRACKER_ORIGIN}/studio/`,  glyph: '▤' },
  { id: 'vid',  label: 'Video',       hint: 'Ad video pipeline',   href: `${TRACKER_ORIGIN}/video/`,   glyph: '▶' },
];

function BrandSwitcher({ current }: { current: 'aso' | 'shot' | 'vid' }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setRect(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 6, left: r.left });

    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const active = SWITCHER_ITEMS.find((i) => i.id === current) ?? SWITCHER_ITEMS[0];
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          padding: '4px 8px 4px 4px', height: 36,
          background: open ? 'var(--bg-2)' : 'transparent',
          border: 0, borderRadius: 9, cursor: 'pointer',
          color: 'var(--fg-0)',
        }}
      >
        <span className="logo" style={{ width: 26, height: 26, fontSize: 12 }}>A</span>
        <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.15 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>ASO Studio</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>{active.label}</span>
        </span>
        <ChevronDown size={12} style={{ color: 'var(--fg-2)', marginLeft: 2 }} />
      </button>

      {/* position:fixed escapes the .app-shell overflow:hidden that would clip an absolute dropdown */}
      {open && rect && (
        <div ref={menuRef} style={{
          position: 'fixed', top: rect.top, left: rect.left,
          minWidth: 240, padding: 6,
          background: 'var(--bg-1)',
          borderRadius: 12,
          boxShadow: 'inset 0 0 0 1px var(--line-1), 0 18px 40px -12px rgba(0,0,0,0.35)',
          zIndex: 1000,
        }}>
          {SWITCHER_ITEMS.map((it) => {
            const isActive = it.id === current;
            const disabled = it.disabled;
            return (
              <a key={it.id} href={disabled ? undefined : it.href}
                 onClick={(e) => { if (disabled) e.preventDefault(); }}
                 style={{
                   display: 'flex', alignItems: 'center', gap: 10,
                   padding: '8px 10px', borderRadius: 8,
                   textDecoration: 'none',
                   background: isActive ? 'var(--bg-2)' : 'transparent',
                   color: 'var(--fg-0)',
                   opacity: disabled ? 0.5 : 1,
                   cursor: disabled ? 'not-allowed' : 'pointer',
                 }}
                 onMouseEnter={(e) => { if (!isActive && !disabled) (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-2)'; }}
                 onMouseLeave={(e) => { if (!isActive && !disabled) (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: 6,
                  background: it.id === 'aso'
                    ? 'linear-gradient(135deg, #FF8C42, #F25C1F)'
                    : it.id === 'shot'
                    ? 'linear-gradient(135deg, #7C3AED, #A78BFA)'
                    : 'linear-gradient(135deg, #14B8A6, #5EEAD4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  flex: 'none',
                  lineHeight: 1,
                }}>{it.glyph}</span>
                <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{it.label}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--fg-2)' }}>{it.hint}</span>
                </span>
                {isActive && <Check size={12} style={{ color: 'var(--accent)' }} />}
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Tiny pill in the topbar — running cost of all gpt-image-2 calls in this project.
 *  Click → reset (with confirm). */
function SpendCounter() {
  const aiSpent = useStudio((s) => s.aiSpent);
  const aiCallCount = useStudio((s) => s.aiCallCount);
  const reset = useStudio((s) => s.resetAiSpent);
  const onClick = () => {
    if (aiSpent === 0) return;
    if (confirm(`Reset AI-spend counter? Current: $${aiSpent.toFixed(2)} across ${aiCallCount} renders.`)) reset();
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={`AI spend: $${aiSpent.toFixed(4)} across ${aiCallCount} renders. Click to reset.`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', height: 24,
        borderRadius: 'var(--r-pill)',
        background: aiSpent > 0 ? 'var(--bg-2)' : 'transparent',
        border: '1px solid var(--line-1)',
        color: 'var(--fg-1)',
        fontSize: 11, fontWeight: 500,
        cursor: aiSpent > 0 ? 'pointer' : 'default',
      }}
    >
      <Sparkles size={11} style={{ color: 'var(--ai)' }} />
      <span className="tabular">${aiSpent.toFixed(2)}</span>
      <span style={{ color: 'var(--fg-3)', fontSize: 10 }}>· {aiCallCount}</span>
    </button>
  );
}

export function AppShell() {
  const nav = useNavigate();
  const loc = useLocation();
  const activeStep = STEPS.find((s) => loc.pathname.startsWith(s.value)) ?? STEPS[0];
  const settingsOpen = useKeyGate((s) => s.settingsOpen);
  const openSettings = useKeyGate((s) => s.openSettings);
  const closeSettings = useKeyGate((s) => s.closeSettings);

  return (
    <div className="app-shell">
      <KeyMissingDialog />
      <SettingsModal open={settingsOpen} onClose={closeSettings} />
      <Topbar
        brand={<BrandSwitcher current="shot" />}
        steps={STEPS.map((s) => {
          // Sequential gate: free to step backward, only one step forward at a time.
          // Anything farther than current + 1 is disabled to avoid jumping into a
          // page that depends on data from the skipped step (e.g. Editor without
          // a picked Style → blank canvas).
          const isActive = activeStep.value === s.value;
          const reachable = s.n <= activeStep.n + 1;
          return (
            <div
              key={s.value}
              className={`step ${isActive ? 'active' : ''}${reachable ? '' : ' disabled'}`}
              onClick={() => { if (reachable) nav(s.value); }}
              title={!reachable ? 'Complete the previous step first' : undefined}
              style={!reachable ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
              aria-disabled={!reachable}
            >
              <span className="num">{s.n}</span>
              <span className="step-label">{s.label}</span>
            </div>
          );
        })}
        actions={
          <>
            <SpendCounter />
            <Button variant="ghost" size="icon" aria-label="Settings" onClick={openSettings}>
              <Settings size={14} />
            </Button>
          </>
        }
      />

      <div style={{ overflow: 'auto' }}>
        <Outlet />
      </div>
    </div>
  );
}
