/**
 * Build a multi-layer palette from a single accent hex by holding the hue stable
 * and varying lightness/saturation per layer. The 5 layers map to a sky → ground
 * panorama: pale top, two mountain bands, foreground silhouette, ground.
 *
 * Sahara's PNG was painted with this exact gradient — pale sand sky, ochre far
 * mountains, brown mid-band, darker brown ground. We derive the same shape
 * generatively so the user can drop any accent (blue, green, pink) and get a
 * coherent Sahara-style scene tinted to that hue.
 */

export type LayeredPalette = {
  sky: string;
  far: string;
  mid: string;
  near: string;
  ground: string;
};

interface HSL { h: number; s: number; l: number }

function hexToHsl(hex: string): HSL {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})/i);
  if (!m) return { h: 30, s: 0.45, l: 0.55 }; // fallback (Sahara-ish warm)
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  if (max !== min) {
    const d = max - min;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l };
}

function hslToHex({ h, s, l }: HSL): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)        [r, g, b] = [c, x, 0];
  else if (h < 120)  [r, g, b] = [x, c, 0];
  else if (h < 180)  [r, g, b] = [0, c, x];
  else if (h < 240)  [r, g, b] = [0, x, c];
  else if (h < 300)  [r, g, b] = [x, 0, c];
  else               [r, g, b] = [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

/** Per-layer L targets + saturation MULTIPLIERS (relative to accent's own S).
 *  Layered profile: pale top → mid mountains → dark ground. Multipliers >1 boost
 *  saturation slightly per layer for visual depth, <1 mute it. The accent's
 *  own saturation is the upper bound — a desaturated beige stays beige, not
 *  pumped into vibrant coral. */
const LAYER_PROFILE = {
  sky:    { l: 0.83, sMul: 0.85, hueShift: -3 },  // very pale top
  far:    { l: 0.58, sMul: 1.00, hueShift: -2 },
  mid:    { l: 0.40, sMul: 1.05, hueShift:  0 },
  near:   { l: 0.27, sMul: 1.05, hueShift:  2 },
  ground: { l: 0.16, sMul: 1.00, hueShift:  4 },  // deepest band
} as const;

/** Per-slot pastel hue offsets — deterministic variation around the accent so
 *  the 4 dotted backgrounds feel like one family, not 4 random tints. */
const DOTS_HUE_OFFSETS = [0, 25, -15, 35, -25, 50, -40] as const;

/** Build a pale dotted-bg colour from the project accent + the slot's position
 *  in the template. Lightness fixed at 0.94 (very pale), saturation capped at
 *  0.20 — the bg is always a soft pastel regardless of how vivid the accent
 *  is. Hue rotates by sampleIndex so slots feel distinct without jumping
 *  around the colour wheel. */
export function deriveDotsBg(accentHex: string, sampleIndex = 0): string {
  const base = hexToHsl(accentHex);
  const dh = DOTS_HUE_OFFSETS[sampleIndex % DOTS_HUE_OFFSETS.length];
  return hslToHex({
    h: (base.h + dh + 360) % 360,
    s: Math.min(0.20, base.s * 0.6 + 0.05),
    l: 0.94,
  });
}

export function paletteFromAccent(accentHex: string): LayeredPalette {
  const base = hexToHsl(accentHex);
  // Use accent's own saturation as the anchor. Achromatic accents (greys,
  // beiges) → muted palette. Vibrant accents → vibrant palette. Per-layer
  // sMul nudges +/- around it for depth without forcing saturation up to a
  // hardcoded high value (the previous bug — beige → coral).
  const out = {} as LayeredPalette;
  for (const key of ['sky', 'far', 'mid', 'near', 'ground'] as const) {
    const p = LAYER_PROFILE[key];
    out[key] = hslToHex({
      h: (base.h + p.hueShift + 360) % 360,
      s: Math.max(0, Math.min(1, base.s * p.sMul)),
      l: p.l,
    });
  }
  return out;
}
