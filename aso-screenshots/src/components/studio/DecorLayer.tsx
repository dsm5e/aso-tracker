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
