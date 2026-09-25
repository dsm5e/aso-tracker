import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { DecorItem } from '../../state/studio';

/**
 * Per-slot decorative overlays: cut-out images (kids, mascot, paper drawings),
 * speech bubbles with live localisable copy, and hand-drawn doodles (arrows,
 * stars, hearts…). Pure data — `Screenshot.decor[]` — so a design survives
 * translation and re-export untouched. Omitted from the AI scaffold capture.
 */

const LAYER_Z: Record<NonNullable<DecorItem['layer']>, number> = {
  back: 0,
  front: 2,
  top: 7,
};

/** Hand-drawn doodle shapes on a 100×100 box, stroked with round caps. */
function doodlePaths(shape: NonNullable<DecorItem['shape']>, color: string): ReactNode {
  const stroke = { stroke: color, strokeWidth: 6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (shape) {
    case 'arrow':
      return (
        <>
          <path d="M8 78 C 26 40, 52 22, 86 30" {...stroke} />
          <path d="M70 16 L 88 30 L 70 44" {...stroke} />
        </>
      );
    case 'arrow-curly':
      return (
        <>
          <path d="M6 84 C 22 50, 52 86, 46 58 C 40 30, 70 26, 88 20" {...stroke} />
          <path d="M72 8 L 90 19 L 76 36" {...stroke} />
        </>
      );
    case 'star':
      return (
        <path
          d="M50 6 L61 37 L94 38 L68 58 L77 90 L50 71 L23 90 L32 58 L6 38 L39 37 Z"
          fill={color}
          stroke={color}
          strokeWidth={5}
          strokeLinejoin="round"
        />
      );
    case 'heart':
      return (
        <path
          d="M50 88 C 18 66, 6 46, 14 28 C 22 10, 44 12, 50 30 C 56 12, 78 10, 86 28 C 94 46, 82 66, 50 88 Z"
          fill={color}
          stroke={color}
          strokeWidth={4}
          strokeLinejoin="round"
        />
      );
    case 'sparkle':
      return <path d="M50 4 Q55 45 96 50 Q55 55 50 96 Q45 55 4 50 Q45 45 50 4 Z" fill={color} />;
    case 'swirl':
      return <path d="M50 50 m-4 0 a4 4 0 1 1 8 0 a10 10 0 1 1 -18 0 a16 16 0 1 1 30 0 a24 24 0 1 1 -44 0 a32 32 0 1 1 60 0" {...stroke} />;
    case 'scribble':
      return <path d="M6 60 C 16 20, 26 90, 36 44 S 56 16, 60 58 S 80 88, 94 36" {...stroke} />;
    case 'burst':
      return (
        <>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M50 22 L50 6" transform={`rotate(${a} 50 50)`} {...stroke} />
          ))}
        </>
      );
    case 'wave':
      return <path d="M4 50 Q 16 30, 28 50 T 52 50 T 76 50 T 98 50" {...stroke} />;
    default:
      return null;
  }
}

function Bubble({ item, fontFamily, u, rtl, lang }: { item: DecorItem; fontFamily: string; u: number; rtl?: boolean; lang?: string }) {
  const bg = item.bg ?? '#FFFFFF';
  const initialPx = item.fontPx ?? 5.2 * u;
  const textRef = useRef<HTMLDivElement>(null);
  // Lines never wrap (translations keep the source's \n); a long localized
  // line shrinks the copy instead of spilling out of the bubble.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const fit = () => {
      let size = initialPx;
      el.style.fontSize = `${size}px`;
      while (el.scrollWidth > el.clientWidth + 1 && size > initialPx * 0.45) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, [item.text, initialPx, fontFamily]);
  const tail = item.tail ?? 'bottom-left';
  const tailSize = 3.2 * u;
  const tailStyle: React.CSSProperties = { position: 'absolute', width: 0, height: 0 };
  if (tail === 'bottom-left' || tail === 'bottom-right' || tail === 'left' || tail === 'right') {
    if (tail.startsWith('bottom')) {
      Object.assign(tailStyle, {
        bottom: -tailSize * 0.9,
        [tail === 'bottom-left' ? 'left' : 'right']: '18%',
        borderLeft: `${tailSize * 0.6}px solid transparent`,
        borderRight: `${tailSize * 0.6}px solid transparent`,
        borderTop: `${tailSize}px solid ${bg}`,
        transform: `skewX(${tail === 'bottom-left' ? 18 : -18}deg)`,
      });
    } else {
      Object.assign(tailStyle, {
        top: '55%',
        [tail]: -tailSize * 0.9,
        borderTop: `${tailSize * 0.6}px solid transparent`,
        borderBottom: `${tailSize * 0.6}px solid transparent`,
        [tail === 'left' ? 'borderRight' : 'borderLeft']: `${tailSize}px solid ${bg}`,
      });
    }
  }
  return (
    <div
      style={{
        position: 'relative',
        // Hug the copy; widthFrac is the maximum width.
        display: 'inline-block',
        maxWidth: '100%',
        boxSizing: 'border-box',
        background: bg,
        color: item.color ?? '#22305E',
        borderRadius: 4 * u,
        padding: `${1.8 * u}px ${3 * u}px`,
        fontFamily: `"${fontFamily}", Inter, sans-serif`,
        fontWeight: 900,
        lineHeight: 1.08,
        textAlign: 'center',
        direction: rtl ? 'rtl' : undefined,
        boxShadow: item.shadow === false ? undefined : `0 ${0.7 * u}px 0 rgba(11,95,168,.55), 0 ${1.6 * u}px ${3.4 * u}px rgba(0,40,100,.28)`,
      }}
    >
      <div ref={textRef} lang={lang} style={{ fontSize: initialPx, whiteSpace: 'pre', lineHeight: 1.18 }}>{item.text}</div>
      {tail !== 'none' && <span style={tailStyle} />}
    </div>
  );
}

/** One laurel branch on a 40×100 box: a curved stem with alternating leaves. */
function LaurelBranch({ color, mirror }: { color: string; mirror?: boolean }) {
  // Stem = cubic bezier; leaves sit along it, angled off the tangent.
  const P = [[30, 97], [6, 78], [4, 30], [27, 3]];
  const at = (t: number) => {
    const m = 1 - t;
    const x = m * m * m * P[0][0] + 3 * m * m * t * P[1][0] + 3 * m * t * t * P[2][0] + t * t * t * P[3][0];
    const y = m * m * m * P[0][1] + 3 * m * m * t * P[1][1] + 3 * m * t * t * P[2][1] + t * t * t * P[3][1];
    const dx = 3 * m * m * (P[1][0] - P[0][0]) + 6 * m * t * (P[2][0] - P[1][0]) + 3 * t * t * (P[3][0] - P[2][0]);
    const dy = 3 * m * m * (P[1][1] - P[0][1]) + 6 * m * t * (P[2][1] - P[1][1]) + 3 * t * t * (P[3][1] - P[2][1]);
    return { x, y, a: (Math.atan2(dy, dx) * 180) / Math.PI };
  };
  const leaves = [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.93];
  return (
    <svg viewBox="0 0 40 100" style={{ display: 'block', height: '100%', width: 'auto', overflow: 'visible', transform: mirror ? 'scaleX(-1)' : undefined }}>
      <path d="M30 97 C 6 78, 4 30, 27 3" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      {leaves.map((t, i) => {
        const p = at(t);
        const side = i % 2 === 0 ? -1 : 1;
        const len = 8.5 - t * 2.5;
        return (
          <ellipse key={i} cx={p.x} cy={p.y} rx={len * 0.42} ry={len}
            transform={`rotate(${p.a + 90 + side * 38} ${p.x} ${p.y}) translate(0 ${-len * 0.9})`}
            fill={color} />
        );
      })}
      <ellipse cx={27} cy={3} rx={3} ry={6.5} transform="rotate(20 27 3) translate(0 -4)" fill={color} />
    </svg>
  );
}

function Laurel({ item, fontFamily, u, rtl, lang }: { item: DecorItem; fontFamily: string; u: number; rtl?: boolean; lang?: string }) {
  const color = item.color ?? '#E9C98B';
  const [figure, ...rest] = (item.text ?? '').split('\n');
  const caption = rest.join(' ');
  const capPx = item.fontPx ?? 3.4 * u;
  const capRef = useRef<HTMLDivElement>(null);
  // The caption stays on one line and shrinks to the space between the
  // branches; below 60% it may wrap to two lines instead.
  useLayoutEffect(() => {
    const el = capRef.current;
    if (!el) return;
    const fit = () => {
      let size = capPx;
      el.style.whiteSpace = 'nowrap';
      el.style.fontSize = `${size}px`;
      while (el.scrollWidth > el.clientWidth + 1 && size > capPx * 0.6) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
      if (el.scrollWidth > el.clientWidth + 1) el.style.whiteSpace = 'normal';
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, [item.text, capPx, fontFamily]);
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'center', height: capPx * 4.4, direction: 'ltr',
      filter: item.shadow === false ? undefined : `drop-shadow(0 ${0.3 * u}px ${1 * u}px rgba(6,6,30,.6))` }}>
      <LaurelBranch color={color} />
      <div lang={lang} style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        alignItems: 'center', textAlign: 'center', color, direction: rtl ? 'rtl' : undefined, padding: `0 ${0.4 * u}px` }}>
        <div style={{ fontFamily: `"${fontFamily}", Inter, sans-serif`, fontWeight: 700, fontSize: capPx * 1.9, lineHeight: 1, whiteSpace: 'nowrap' }}>{figure}</div>
        {caption && (
          <div ref={capRef} style={{ width: '100%', fontFamily: `Inter, "${fontFamily}", sans-serif`, fontWeight: 600, fontSize: capPx,
            lineHeight: 1.12, marginTop: 0.5 * u, letterSpacing: '0.01em' }}>{caption}</div>
        )}
      </div>
      <LaurelBranch color={color} mirror />
    </div>
  );
}

interface Props {
  items: DecorItem[] | undefined;
  layer: NonNullable<DecorItem['layer']>;
  width: number;
  height: number;
  fontFamily: string;
  rtl?: boolean;
  lang?: string;
}

export function DecorLayer({ items, layer, width, height, fontFamily, rtl, lang }: Props) {
  const list = (items ?? []).filter((d) => (d.layer ?? 'front') === layer);
  if (list.length === 0) return null;
  const u = width / 100;
  return (
    <div
      data-capture-omit="decor"
      data-decor-layer={layer}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: LAYER_Z[layer], overflow: 'hidden' }}
    >
      {list.map((d, i) => {
        const w = d.widthFrac * width;
        const transform = `translate(-50%, -50%) rotate(${d.rotate ?? 0}deg)${d.flipX ? ' scaleX(-1)' : ''}`;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: d.xFrac * width,
              top: d.yFrac * height,
              width: w,
              transform,
              opacity: d.opacity ?? 1,
            }}
          >
            {d.kind === 'image' && d.src && (
              <img
                src={d.src}
                alt=""
                draggable={false}
                style={{
                  display: 'block',
                  width: '100%',
                  filter: d.shadow === false ? undefined : `drop-shadow(0 ${1.2 * u}px ${1.6 * u}px rgba(0,40,100,.30))`,
                }}
              />
            )}
            {d.kind === 'bubble' && d.text && (
              // Un-mirror copy when the bubble is flipped.
              <div style={{ transform: d.flipX ? 'scaleX(-1)' : undefined, textAlign: 'center' }}>
                <Bubble item={d} fontFamily={fontFamily} u={u} rtl={rtl} lang={lang} />
              </div>
            )}
            {d.kind === 'laurel' && d.text && (
              <Laurel item={d} fontFamily={fontFamily} u={u} rtl={rtl} lang={lang} />
            )}
            {d.kind === 'doodle' && d.shape && (
              <svg
                viewBox="0 0 100 100"
                width="100%"
                style={{
                  display: 'block',
                  overflow: 'visible',
                  filter: d.shadow ? `drop-shadow(0 ${0.5 * u}px 0 rgba(11,95,168,.55))` : undefined,
                }}
              >
                {doodlePaths(d.shape, d.stroke ?? '#FFFFFF')}
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
