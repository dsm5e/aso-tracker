/**
 * Inject one Google Fonts <link> covering everything the picker may render — the
 * curated list plus any preset-bundled fonts not already preloaded statically.
 * Called once at app boot from main.tsx.
 */

import { PRESETS } from './presets';
import { CURATED_FONTS, PRELOADED_FONTS } from './fonts';

const WEIGHTS = '400;500;600;700;800;900';

export function loadPresetFonts(): void {
  if (typeof document === 'undefined') return;

  const fonts = new Set<string>();
  // Curated picker options
  for (const f of CURATED_FONTS) {
    if (!PRELOADED_FONTS.has(f.family)) fonts.add(f.family);
  }
  // Anything a preset uses that escaped the curated set (e.g. exotic imported template)
  for (const p of PRESETS) {
    if (p.text?.font && !PRELOADED_FONTS.has(p.text.font)) fonts.add(p.text.font);
  }
  if (fonts.size === 0) return;

  const families = [...fonts]
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${WEIGHTS}`)
    .join('&');
  const href = `https://fonts.googleapis.com/css2?${families}&display=swap`;

  if (document.querySelector(`link[data-preset-fonts="1"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.presetFonts = '1';
  document.head.appendChild(link);
}
