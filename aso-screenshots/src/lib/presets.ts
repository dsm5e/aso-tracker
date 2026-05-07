/**
 * Style presets for ASO screenshot scaffolds.
 * Each preset = visual identity (background, text style, mockup tilt, breakout shape).
 * Mixed: realistic mini-mockups (with brand-color BG) + abstract (oversized first letter).
 *
 * The scaffold renderer (MockupCanvas, Phase 4) reads these to assemble the 1290×2796 base.
 * AI polish (Phase 5) refines the scaffold, preserving its layout cues.
 */

export type PresetKind = 'real' | 'abstract';

export interface PresetText {
  /** Any web-safe or Google Fonts family — preset author owns this; loader appends to <head> on demand. */
  font: string;
  weight: number;
  color: string;
  uppercase?: boolean;
  align?: 'left' | 'center';
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
  parametric?: 'mountains' | 'dots';
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
}

export interface SampleTextLayout {
  /** Vertical position of headline top — fraction of canvas (0 = top, 1 = bottom). */
  yFraction?: number;
  /** Title font size in canvas px (overrides preset.text default). */
  titlePx?: number;
  /** Subtitle font size in canvas px. */
  subPx?: number;
}

export interface PresetSample {
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
