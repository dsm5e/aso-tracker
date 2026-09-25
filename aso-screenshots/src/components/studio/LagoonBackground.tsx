import type { LagoonDecor } from '../../lib/presets';

/**
 * Parametric underwater backdrop (`background.parametric: 'lagoon'`): light
 * rays from the surface, soft bubbles and a sand strip. The gradient itself is
 * the preset's `background.css`; this component only adds the layers.
 *
 * Rendered twice per canvas — `part="back"` under the device and
 * `part="front"` above it (a share of bubbles floats in front of the phone,
 * which is what makes the scene read as "underwater" instead of "flat card").
 * Bubble placement is seeded, so a slot renders identically in every locale.
 */
interface Props {
  part: 'back' | 'front';
  width: number;
  seed: number;
  opts?: LagoonDecor;
}

/** Small LCG — deterministic per seed, identical to the reference template. */
function rng(seed: number) {
  let s = Math.abs(Math.floor(seed)) % 233280 || 1;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Stable numeric seed from any string (slot filename / id). */
export function seedFrom(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 100003;
  return h + 3;
}

export function LagoonBackground({ part, width, seed, opts }: Props) {
  const u = width / 100;
  const count = opts?.bubbles ?? 16;
  const frontShare = opts?.frontBubbleShare ?? 0.3;
  const R = rng(seed);
  const bubbles = Array.from({ length: count }, () => {
    const size = (1.2 + R() * 4.5) * u;
    const left = R() * 96;
    const top = 8 + R() * 85;
    const front = R() < frontShare;
    return { size, left, top, front };
  }).filter((b) => (part === 'front' ? b.front : !b.front));

  return (
    <div
      aria-hidden
      data-lagoon={part}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: part === 'front' ? 2 : 0, overflow: 'hidden' }}
    >
      {part === 'back' && (opts?.rays ?? true) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'repeating-linear-gradient(100deg, rgba(255,255,255,0) 0 6%, rgba(255,255,255,.10) 6% 9%)',
            WebkitMaskImage: 'linear-gradient(#000, transparent 60%)',
            maskImage: 'linear-gradient(#000, transparent 60%)',
          }}
        />
      )}
      {bubbles.map((b, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${b.left}%`,
            top: `${b.top}%`,
            width: b.size,
            height: b.size,
            borderRadius: '50%',
            boxSizing: 'border-box',
            border: `${0.35 * u}px solid rgba(255,255,255,.75)`,
            background: 'radial-gradient(circle at 32% 30%, rgba(255,255,255,.85), rgba(255,255,255,.12) 45%, rgba(255,255,255,.04) 70%)',
          }}
        />
      ))}
      {part === 'back' && opts?.sand && (
        <div
          style={{
            position: 'absolute',
            left: '-5%',
            right: '-5%',
            bottom: '-1%',
            height: `${(opts.sandHeight ?? 0.09) * 100}%`,
            background: opts.sand,
            borderRadius: '50% 50% 0 0 / 60% 60% 0 0',
            opacity: 0.95,
          }}
        />
      )}
    </div>
  );
}
