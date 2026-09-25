/**
 * Style presets for ASO screenshot scaffolds.
 * Each preset = visual identity (background, text style, mockup tilt, breakout shape).
 * Mixed: realistic mini-mockups (with brand-color BG) + abstract (oversized first letter).
 *
 * The scaffold renderer (MockupCanvas, Phase 4) reads these to assemble the 1290×2796 base.
 * AI polish (Phase 5) refines the scaffold, preserving its layout cues.
 */
import type { DeviceFrameStyle } from './deviceProfiles';

export type PresetKind = 'real' | 'abstract';

export interface PresetText {
  /** Any web-safe or Google Fonts family — preset author owns this; loader appends to <head> on demand. */
  font: string;
  weight: number;
  color: string;
  uppercase?: boolean;
  align?: 'left' | 'center' | 'right';
  /**
   * Optional styling knobs — all off by default so existing presets render
   * exactly as before. Length values in shadows may use the `u` unit
   * (1u = 1% of canvas width), e.g. `0 0.9u 0 #0B5FA8`, so one preset scales
   * cleanly between the iPhone and iPad canvases.
   */
  /** CSS text-shadow for the title (hard + soft layers allowed). */
  titleShadow?: string;
  /** CSS text-shadow for the subtitle. */
  subtitleShadow?: string;
  /** Subtitle colour (default: the text colour). Slot overrides still win. */
  subtitleColor?: string;
  /** Subtitle font weight (default 500). */
  subtitleWeight?: number;
  /** Subtitle font family (default: the title font). Locale script fonts
   *  stay in the stack as per-glyph fallback, so CJK / Arabic still render. */
  subtitleFont?: string;
  /** CSS `text-wrap` for title + subtitle, e.g. 'balance' — evens out
   *  two-line headlines instead of leaving an orphan word (default: none). */
  textWrap?: 'balance' | 'pretty';
  /** Title line-height (default 1.02). */
  titleLineHeight?: number;
  /** Title letter-spacing (default -0.02em). */
  titleLetterSpacing?: string;
  /** Gap between title and subtitle in `u` (default: 24 canvas px). */
  subtitleGapU?: number;
  /** Uppercase the subtitle too (default: follows `uppercase`). */
  subtitleUppercase?: boolean;
  /** Never wrap a headline line: every explicit line (\n) is shrunk until it
   *  fits the column width. Long words (СФОТОГРАФИРУЙ) never clip or wrap. */
  fitLines?: boolean;
  /** Horizontal padding of the headline column in `u` (default: 60 canvas px). */
  sidePaddingU?: number;
  /** Default pill styling for slots that carry a pill. */
  pill?: {
    bg?: string;
    fg?: string;
    /** CSS box-shadow, `u` units allowed (e.g. `0 0.6u 0 #C98A00`). */
    shadow?: string;
    weight?: number;
    /** Font size as a fraction of the title px (default 0.22). */
    sizeFrac?: number;
    letterSpacing?: string;
  };
}

/** Decorative layers for the `lagoon` parametric background (underwater kids look). */
export interface LagoonDecor {
  /** Diagonal light rays fading out towards the middle of the canvas. */
  rays?: boolean;
  /** Number of soft bubbles (default 16). */
  bubbles?: number;
  /** Share of bubbles drawn IN FRONT of the device (0..1, default 0.3). */
  frontBubbleShare?: number;
  /** Sand strip colour at the bottom; omit for no sand. */
  sand?: string;
  /** Sand strip height as a fraction of the canvas height (default 0.09). */
  sandHeight?: number;
}

/** Device auto-placement relative to the MEASURED headline block. */
export interface PresetLayout {
  /** `below-headline`: the device hangs right under the rendered headline
   *  (after fit), so short and long titles never leave a gap or overlap. */
  deviceAnchor?: 'below-headline';
  /** Gap between headline bottom and device top, in `u` (1% of canvas width). */
  deviceGapU?: number;
  /** Bottom of the headline safe zone (fraction of height) in anchored mode. */
  headlineMaxFraction?: number;
}

export interface PresetBackground {
  type: 'solid' | 'linear' | 'radial' | 'mesh' | 'abstract-shape' | 'image';
  /** Fallback CSS background value (gradient, solid, etc.) — used when no image. */
  css: string;
  /** Optional bg image (relative to public/, BASE_URL prepended at render time). */
  imageSrc?: string;
  /** Optional iPad-specific bg image; when null, imageSrc is used for both. */
  imageSrcIpad?: string;
  /**
   * Native pixel size of the bg image. When the image is wider than the canvas (1290 px),
   * each sample in the strip will crop its own slice — slot N shows [N×1290 .. (N+1)×1290].
   * Same for iPad's larger canvas. Without these dimensions, the renderer falls back to
   * `cover` (single image stretched per slot).
   */
  imageW?: number;
  imageH?: number;
  /**
   * When set, the bg is rendered as a parametric SVG (sky + mountain layers) tinted by
   * the user's accent color via paletteFromAccent(). Currently only 'mountains' is
   * supported. Overrides imageSrc when present.
   */
  parametric?: 'mountains' | 'dots' | 'lagoon';
  /** Options for `parametric: 'lagoon'`. */
  lagoon?: LagoonDecor;
  /** Optional grain overlay */
  grain?: boolean;
}

export interface DeviceTransform {
  /** 'iphone' | 'ipad' — picks the frame proportions and assets. */
  asset?: 'iphone' | 'ipad';
  /** Horizontal device-center offset from canvas center, in canvas px. */
  offsetX?: number;
  /** Vertical device-center offset from canvas center, in canvas px. */
  offsetY?: number;
  /** In-plane rotation in degrees (positive = clockwise). */
  rotateZ?: number;
  /** Uniform scale, default 1. */
  scale?: number;
  /** Per-device-family overrides (e.g. a different scale on iPad). */
  ipad?: { scale?: number; offsetY?: number };
  /** Clay frame body colour (default dark graphite gradient). */
  bodyColor?: string;
  /** Thin outer rim around the clay frame, e.g. `rgba(255,255,255,.35)`. */
  rimColor?: string;
  /** Replace the default drop shadow (CSS box-shadow, `u` units allowed). */
  shadow?: string;
  /** Default frame style for slots of this preset (slot `deviceFrameStyle` wins). */
  frameStyle?: DeviceFrameStyle;
  /** Apple bezel colour per device family for `frameStyle: 'apple'`
   *  (keys from src/lib/deviceBezels.ts, e.g. `deep-blue`, `space-black`). */
  bezelColor?: { iphone?: string; ipad?: string };
}

export interface SampleTextLayout {
  /** Optional per-frame color and localization-safe lower boundary. */
  color?: string;
  safeBottomFraction?: number;
  /** Vertical position of headline top — fraction of canvas (0 = top, 1 = bottom). */
  yFraction?: number;
  /** Title font size in canvas px (overrides preset.text default). */
  titlePx?: number;
  /** Subtitle font size in canvas px. */
  subPx?: number;
}

export interface PresetSample {
  /** Textless composed artwork; headlines remain editable Studio layers. */
  sourceLayout?: 'device' | 'full-bleed';
  /** Headline shown on this sample screen. */
  verb: string;
  /** Sub-headline / descriptor. */
  descriptor: string;
  /** Optional source PNG inside the device. Falls back to the `app` placeholder. */
  screenSrc?: string;
  /** Per-sample device override (e.g. one tilted phone among non-tilted neighbours). */
  device?: DeviceTransform;
  /** Per-sample text positioning + size, imported from .butterkit text blocks. */
  text?: SampleTextLayout;
  /**
   * If set, all samples sharing this id render the SAME screenshot — used for
   * "one phone across two slots" compositions (e.g. Sahara slots 2-3 cross pair).
   * The first slot in the group is canonical; later slots mirror its sourceUrl.
   */
  groupId?: string;
  /** Per-sample background override (solid CSS color). Falls back to preset.background.css
   *  when not set. Useful for templates with different bg per slot (e.g. Sign PDF). */
  bgColor?: string;
  /** Optional pill / badge text rendered above the headline, e.g. "FREE · NO SIGNUP". */
  pill?: string;
  /** Pill colors — defaults to a pink badge with white text. */
  pillBg?: string;
  pillFg?: string;
}

export interface Preset {
  id: string;
  name: string;
  kind: PresetKind;
  description: string;
  recommendedFor: string;
  background: PresetBackground;
  text: PresetText;
  tiltDeg: number;
  breakout?: 'badge' | 'sticker' | 'paper' | 'glow' | 'none';
  /** When user picks this preset, suggested brand-color anchor (auto-mixed into bg) */
  suggestedAccent?: string;
  /** Specific decoration vibe sent to AI so each preset feels unique */
  decorationsHint: string;
  /** Whether the default background is gradient (so editor shows gradient picker) */
  isGradient: boolean;
  /**
   * Optional per-template hero prompt. When set, hero (`kind:'action'`) slots
   * created on this preset default to using it (interpolated with placeholders
   * like {appName} / {verb} / {themeHint} / {appColor} / {effectiveBackground} /
   * {decorationsHint} / {headlineZone} / {extraPromptBlock}). The user can edit
   * the resolved prompt per-slot in Inspector or toggle it off to fall back to
   * the server's generic builder.
   */
  heroPrompt?: string;
  /**
   * Sample screens shown in the catalog strip — like a 5-screenshot App Store listing,
   * so the user can see the final result rhythm at a glance. Empty = single mock will
   * be inferred from preset text defaults.
   */
  samples?: PresetSample[];
  /** Default device transform applied unless a sample overrides it. */
  device?: DeviceTransform;
  /** Optional layout rules (device anchoring). */
  layout?: PresetLayout;
}

/** Expand the `u` unit (1% of canvas width) inside a CSS length list. */
export function expandU(css: string | undefined, canvasW: number): string | undefined {
  if (!css) return css;
  return css.replace(/(-?\d*\.?\d+)u\b/g, (_m, n) => `${((Number(n) * canvasW) / 100).toFixed(2)}px`);
}

// Templates = layout (device pos + text pos + font defaults) hardcoded per template;
// accent color, text content and inner screenshot mutable per use.
const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'bold-brand-solid',
    name: 'Bold Brand Solid',
    kind: 'real',
    description: 'Plain bold brand-color background, white headline, no tilt. Placeholder while we build new templates.',
    recommendedFor: 'utility / tools',
    background: {
      type: 'solid',
      css: '#3B82F6',
    },
    text: { font: 'Inter', weight: 900, color: '#FFFFFF', uppercase: true, align: 'center' },
    tiltDeg: 0,
    breakout: 'none',
    isGradient: false,
    decorationsHint: 'minimal — keep background absolutely clean, no decorations, no patterns, no particles. Confident utility aesthetic.',
    samples: [
      { verb: 'TRACK',    descriptor: 'EVERY DAY' },
      { verb: 'CAPTURE',  descriptor: 'IN SECONDS' },
      { verb: 'ORGANISE', descriptor: 'WITH EASE' },
      { verb: 'SHARE',    descriptor: 'INSTANTLY' },
      { verb: 'YOUR',     descriptor: 'FAVOURITE' },
    ],
  },
];

// Imported presets from cli/import-butterkit.ts. Vite glob pulls every JSON eagerly so
// the catalog updates as soon as the importer writes a new file.
const imported = import.meta.glob<{ default: Preset }>('./presets/imported/*.json', { eager: true });
const IMPORTED_PRESETS: Preset[] = Object.values(imported).map((m) => m.default);

// Dedupe by id — imported overrides builtin when ids collide (user-edited preset wins).
const _byId = new Map<string, Preset>();
for (const p of BUILTIN_PRESETS) _byId.set(p.id, p);
for (const p of IMPORTED_PRESETS) _byId.set(p.id, p);

export const PRESETS: Preset[] = Array.from(_byId.values());

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
