import { useEffect, useRef, useState } from 'react';
import { useHighlight } from '../state/highlight';

/**
 * Floating "agent cursor". Whenever an agent edit flashes a slot (useHighlight
 * — set by the bridge / SSE diff), a pointer glides to that element on screen,
 * shows a click ripple and a "Claude" label, then fades. Lets the user literally
 * watch where each of my actions lands. Purely decorative: position:fixed,
 * pointer-events:none, never intercepts input.
 *
 * Anchors: any element with `data-agent-target="<id>"`. When several match the
 * same id, the big editor canvas (`data-agent-canvas`) wins over the sidebar row.
 */
function cssEscape(s: string): string {
  const fn = (window as unknown as { CSS?: { escape?: (v: string) => string } }).CSS?.escape;
  return fn ? fn(s) : s.replace(/["\\]/g, '\\$&');
}

export function AgentCursor() {
  const ids = useHighlight((s) => s.ids);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [clicking, setClicking] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (ids.size === 0) return;
    const id = Array.from(ids)[0];
    const matches = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-agent-target="${cssEscape(id)}"]`),
    ).filter((el) => el.offsetParent !== null); // visible only
    if (matches.length === 0) return;
    const target = matches.find((el) => el.hasAttribute('data-agent-canvas')) ?? matches[0];
    const r = target.getBoundingClientRect();
    // Land the arrow tip a bit inside the element so it "points" at the content.
    const x = r.left + Math.min(r.width * 0.5, 130);
    const y = r.top + Math.min(r.height * 0.35, 90);
    setPos({ x, y });
    setClicking(false);
    const t1 = setTimeout(() => setClicking(true), 400);
    const t2 = setTimeout(() => setClicking(false), 760);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPos(null), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [ids]);

  if (!pos) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        zIndex: 99999,
        pointerEvents: 'none',
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        transition: 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {clicking && (
        <div
          style={{
            position: 'absolute',
            left: -16,
            top: -16,
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'var(--ai, #a78bfa)',
            opacity: 0.35,
            animation: 'agent-click 0.42s ease-out',
          }}
        />
      )}
      <svg width="26" height="30" viewBox="0 0 26 30" style={{ filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.45))' }}>
        <path
          d="M3 2 L3 24 L9 18 L13 27 L17 25 L13 16 L21 16 Z"
          fill="#ffffff"
          stroke="var(--ai, #a78bfa)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 22,
          top: 13,
          background: 'var(--ai, #a78bfa)',
          color: '#fff',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.02em',
          padding: '2px 8px',
          borderRadius: 999,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        Claude
      </div>
    </div>
  );
}
