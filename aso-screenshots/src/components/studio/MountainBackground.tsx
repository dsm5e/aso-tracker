import type { LayeredPalette } from '../../lib/palette';

interface Props {
  palette: LayeredPalette;
  /** Width of the rendered SVG in canvas px. Default 1290 (single canvas). */
  width?: number;
  height?: number;
  /** When given (in canvas px), shift the panorama horizontally so the same SVG
   *  rendered in adjacent slots stitches as one continuous landscape. */
  panoramaOffsetX?: number;
}

const VIEW_W = 1290;
const VIEW_H = 2796;

/**
 * Sahara-style parametric panorama: gradient sky on top, three mountain ridges,
 * foreground silhouette, ground band. All filled with colors derived from the
 * accent palette, so swapping accent re-tints the whole scene coherently.
 *
 * The path data is hand-crafted to match Sahara's silhouette rhythm — a calm,
 * slowly-ascending range with a few peaks. It's drawn at 2× canvas width and
 * tiled via panoramaOffsetX so adjacent slots get different slices, mimicking
 * ButterKit's panoramic PNG.
 */
export function MountainBackground({ palette, width = VIEW_W, height = VIEW_H, panoramaOffsetX = 0 }: Props) {
  // The horizon sits ~55% down the canvas — sky above, mountain bands below.
  const HORIZON = 0.55;
  // Triple-width viewbox so the panorama looks like a continuous strip when
  // multiple slots render side-by-side; we shift the visible window via x-offset.
  const STRIP_W = VIEW_W * 3;
  // Loop the panorama once we run past the strip width — gives indefinite slots
  // (Sahara has 7) a continuous-looking ridge rather than an empty fallback.
  const wrappedOffsetX = ((panoramaOffsetX % STRIP_W) + STRIP_W) % STRIP_W;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${wrappedOffsetX} 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      style={{ display: 'block', position: 'absolute', inset: 0 }}
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.sky} />
          <stop offset="100%" stopColor={palette.far} stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.far} />
          <stop offset="100%" stopColor={palette.mid} stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.mid} />
          <stop offset="100%" stopColor={palette.near} stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.near} />
          <stop offset="100%" stopColor={palette.ground} />
        </linearGradient>
      </defs>

      {/* Sky */}
      <rect x="0" y="0" width={STRIP_W} height={VIEW_H * HORIZON} fill="url(#sky)" />

      {/* Far mountains — gentle wavy ridge, fills from horizon down to ~75% of canvas */}
      <path
        d={
          // start at left, draw a long wavy line, close at bottom-right
          `M 0 ${VIEW_H * HORIZON}` +
          // soft hills repeating across the strip
          ` C ${STRIP_W * 0.1} ${VIEW_H * (HORIZON - 0.04)},` +
          ` ${STRIP_W * 0.18} ${VIEW_H * (HORIZON + 0.02)},` +
          ` ${STRIP_W * 0.25} ${VIEW_H * (HORIZON - 0.03)}` +
          ` C ${STRIP_W * 0.32} ${VIEW_H * (HORIZON - 0.08)},` +
          ` ${STRIP_W * 0.42} ${VIEW_H * (HORIZON + 0.04)},` +
          ` ${STRIP_W * 0.5} ${VIEW_H * (HORIZON - 0.02)}` +
          ` C ${STRIP_W * 0.6} ${VIEW_H * (HORIZON - 0.07)},` +
          ` ${STRIP_W * 0.72} ${VIEW_H * (HORIZON + 0.03)},` +
          ` ${STRIP_W * 0.82} ${VIEW_H * (HORIZON - 0.05)}` +
          ` C ${STRIP_W * 0.9} ${VIEW_H * (HORIZON - 0.09)},` +
          ` ${STRIP_W * 0.96} ${VIEW_H * (HORIZON + 0.01)},` +
          ` ${STRIP_W} ${VIEW_H * (HORIZON - 0.02)}` +
          ` L ${STRIP_W} ${VIEW_H} L 0 ${VIEW_H} Z`
        }
        fill="url(#far)"
      />

      {/* Mid mountain ridge — taller bumps, fills from ~65% horizon */}
      <path
        d={
          `M 0 ${VIEW_H * 0.66}` +
          ` C ${STRIP_W * 0.08} ${VIEW_H * 0.62},` +
          ` ${STRIP_W * 0.16} ${VIEW_H * 0.7},` +
          ` ${STRIP_W * 0.22} ${VIEW_H * 0.65}` +
          ` C ${STRIP_W * 0.3} ${VIEW_H * 0.58},` +
          ` ${STRIP_W * 0.38} ${VIEW_H * 0.72},` +
          ` ${STRIP_W * 0.46} ${VIEW_H * 0.66}` +
          ` C ${STRIP_W * 0.55} ${VIEW_H * 0.6},` +
          ` ${STRIP_W * 0.64} ${VIEW_H * 0.71},` +
          ` ${STRIP_W * 0.72} ${VIEW_H * 0.64}` +
          ` C ${STRIP_W * 0.82} ${VIEW_H * 0.57},` +
          ` ${STRIP_W * 0.9} ${VIEW_H * 0.7},` +
          ` ${STRIP_W} ${VIEW_H * 0.65}` +
          ` L ${STRIP_W} ${VIEW_H} L 0 ${VIEW_H} Z`
        }
        fill="url(#mid)"
      />

      {/* Near foreground silhouette — chunky waves at bottom 20%, fully covers ground */}
      <path
        d={
          `M 0 ${VIEW_H * 0.82}` +
          ` C ${STRIP_W * 0.08} ${VIEW_H * 0.78},` +
          ` ${STRIP_W * 0.18} ${VIEW_H * 0.86},` +
          ` ${STRIP_W * 0.28} ${VIEW_H * 0.81}` +
          ` C ${STRIP_W * 0.36} ${VIEW_H * 0.75},` +
          ` ${STRIP_W * 0.46} ${VIEW_H * 0.84},` +
          ` ${STRIP_W * 0.56} ${VIEW_H * 0.78}` +
          ` C ${STRIP_W * 0.66} ${VIEW_H * 0.72},` +
          ` ${STRIP_W * 0.76} ${VIEW_H * 0.84},` +
          ` ${STRIP_W * 0.86} ${VIEW_H * 0.79}` +
          ` C ${STRIP_W * 0.94} ${VIEW_H * 0.74},` +
          ` ${STRIP_W * 0.97} ${VIEW_H * 0.83},` +
          ` ${STRIP_W} ${VIEW_H * 0.81}` +
          ` L ${STRIP_W} ${VIEW_H} L 0 ${VIEW_H} Z`
        }
        fill="url(#near)"
      />

      {/* Ground band — solid darkest tone, very bottom */}
      <rect x="0" y={VIEW_H * 0.93} width={STRIP_W} height={VIEW_H * 0.07} fill={palette.ground} />
    </svg>
  );
}
