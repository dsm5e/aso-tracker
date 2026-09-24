/**
 * Official Apple product bezels (Apple Design Resources → Product Bezels,
 * https://developer.apple.com/design/resources/#product-bezels).
 *
 * The PNGs live UNMODIFIED in `public/frames/apple/` (only renamed) — the
 * Apple Design Resources licence forbids altering them; see the README there.
 * All geometry below is measured from each PNG's alpha channel
 * (`cli/measure-bezel.py`):
 *   - `body`   — opaque device silhouette, side buttons included
 *   - `screen` — transparent display aperture; pixel-exact to the device's
 *                native screenshot size, so a capture maps 1:1 into it.
 * The aperture corners are rounded by the bezel itself, and the opaque glass
 * around it hides the square corners of the screenshot drawn underneath.
 */
import type { DeviceFrameGeometry } from './deviceProfiles';

export interface BezelRect { x: number; y: number; w: number; h: number }

export interface DeviceBezel {
  device: 'iphone' | 'ipad';
  model: string;
  /** Colour key used in presets / slot overrides, e.g. `deep-blue`. */
  color: string;
  colorLabel: string;
  /** UI swatch for the Inspector. */
  swatch: string;
  /** Path under public/. */
  src: string;
  image: { w: number; h: number };
  body: BezelRect;
  screen: BezelRect;
  /** Corner radius (source px) that clips the screenshot drawn under the
   *  bezel. Must sit BETWEEN the aperture's corner curve (else the backdrop
   *  shows through at the corners) and the body's outer curve (else the
   *  square screenshot corner pokes out of the device) — measured with
   *  `cli/measure-bezel.py`, which prints the valid range. */
  screenClipRadius: number;
  /** The PNG draws the Dynamic Island inside the aperture. */
  hasIsland: boolean;
}

const IPHONE_17_PRO_MAX = {
  device: 'iphone' as const,
  model: 'iPhone 17 Pro Max',
  image: { w: 1470, h: 3000 },
  body: { x: 21, y: 20, w: 1428, h: 2959 },
  screen: { x: 75, y: 66, w: 1320, h: 2868 },
  screenClipRadius: 134, // valid 80…188
  hasIsland: true,
};

const IPAD_PRO_13 = {
  device: 'ipad' as const,
  model: 'iPad Pro 13" (M5)',
  image: { w: 2300, h: 3000 },
  body: { x: 28, y: 30, w: 2249, h: 2936 },
  screen: { x: 118, y: 124, w: 2064, h: 2752 },
  screenClipRadius: 26, // valid 0…52
  hasIsland: false,
};

export const DEVICE_BEZELS: readonly DeviceBezel[] = [
  { ...IPHONE_17_PRO_MAX, color: 'deep-blue', colorLabel: 'Deep Blue', swatch: '#3B4A63',
    src: 'frames/apple/iphone-17-pro-max-deep-blue-portrait.png' },
  { ...IPHONE_17_PRO_MAX, color: 'cosmic-orange', colorLabel: 'Cosmic Orange', swatch: '#D9722F',
    src: 'frames/apple/iphone-17-pro-max-cosmic-orange-portrait.png' },
  { ...IPHONE_17_PRO_MAX, color: 'silver', colorLabel: 'Silver', swatch: '#D8D9DB',
    src: 'frames/apple/iphone-17-pro-max-silver-portrait.png' },
  { ...IPAD_PRO_13, color: 'space-black', colorLabel: 'Space Black', swatch: '#3A3A3C',
    src: 'frames/apple/ipad-pro-13-m5-space-black-portrait.png' },
  { ...IPAD_PRO_13, color: 'silver', colorLabel: 'Silver', swatch: '#D8D9DB',
    src: 'frames/apple/ipad-pro-13-m5-silver-portrait.png' },
];

export const DEFAULT_BEZEL_COLOR: Record<'iphone' | 'ipad', string> = {
  iphone: 'deep-blue',
  ipad: 'space-black',
};

export function bezelsFor(device: 'iphone' | 'ipad'): DeviceBezel[] {
  return DEVICE_BEZELS.filter((b) => b.device === device);
}

export function getBezel(device: 'iphone' | 'ipad', color?: string): DeviceBezel {
  const list = bezelsFor(device);
  return list.find((b) => b.color === color)
    ?? list.find((b) => b.color === DEFAULT_BEZEL_COLOR[device])
    ?? list[0];
}

/**
 * Frame box for an Apple bezel scaled to `outerWidth` (the body width, so the
 * device keeps the footprint the preset was tuned for with the clay frame).
 */
export function bezelFrameGeometry(bezel: DeviceBezel, outerWidth: number): DeviceFrameGeometry {
  const s = outerWidth / bezel.body.w;
  const screen = {
    x: (bezel.screen.x - bezel.body.x) * s,
    y: (bezel.screen.y - bezel.body.y) * s,
    w: bezel.screen.w * s,
    h: bezel.screen.h * s,
  };
  return {
    width: outerWidth,
    height: bezel.body.h * s,
    bezel: screen.x,
    cornerR: bezel.screenClipRadius * s,
    islandW: 0,
    islandH: 0,
    islandTop: 0,
    art: {
      src: bezel.src,
      screen,
      screenClipRadius: bezel.screenClipRadius * s,
      image: {
        x: -bezel.body.x * s,
        y: -bezel.body.y * s,
        w: bezel.image.w * s,
        h: bezel.image.h * s,
      },
      hasIsland: bezel.hasIsland,
    },
  };
}
