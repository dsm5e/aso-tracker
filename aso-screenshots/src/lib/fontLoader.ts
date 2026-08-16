/**
 * Load every font the picker may render — the curated list plus any
 * preset-bundled family not already preloaded statically. Called once at app
 * boot from main.tsx.
 *
 * The CSS is FETCHED and injected as an inline <style>, not linked. A <link>
 * to fonts.googleapis.com produces a cross-origin stylesheet, and
 * `document.styleSheets[i].cssRules` on it throws SecurityError. html-to-image
 * walks exactly that list to build `fontEmbedCSS` for the export, so with a
 * <link> the @font-face rules never make it into the rendered SVG: the export
 * silently fell back to a system serif with different metrics, and headlines
 * that fit on screen came out clipped (#export-fonts 2026-08-12).
 * An inline <style> is same-origin, so its rules are readable and get embedded.
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

  if (document.querySelector('style[data-preset-fonts="1"]')) return;

  // Placeholder first so a slow network doesn't leave the picker fontless, and
  // so repeat calls short-circuit on the marker above.
  const style = document.createElement('style');
  style.dataset.presetFonts = '1';
  document.head.appendChild(style);

  void fetch(href)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`fonts: HTTP ${r.status}`))))
    .then((css) => {
      style.textContent = css;
    })
    .catch((err) => {
      // Fall back to the linked stylesheet: the editor still shows the right
      // fonts, only the export loses them — better than no fonts at all.
      console.warn('[fonts] inline load failed, falling back to <link>', err);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.presetFonts = 'fallback';
      document.head.appendChild(link);
    });
}
