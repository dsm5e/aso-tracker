/**
 * Curated Google Fonts available in the editor's font picker.
 * Add any new family here and it will (a) appear in the dropdown and (b) be loaded
 * on app boot via fontLoader.ts.
 *
 * Pick families that are App-Store-screenshot-friendly: bold display weights,
 * good headline rhythm, varied vibes (sans / serif / display / condensed).
 */

export type FontCategory = 'sans' | 'serif' | 'display' | 'mono';

export interface CuratedFont {
  family: string;
  category: FontCategory;
}

export const CURATED_FONTS: CuratedFont[] = [
  // Sans
  { family: 'Inter',             category: 'sans' },
  { family: 'Manrope',           category: 'sans' },
  { family: 'Space Grotesk',     category: 'sans' },
  { family: 'IBM Plex Sans',     category: 'sans' },
  { family: 'Plus Jakarta Sans', category: 'sans' },
  { family: 'Outfit',            category: 'sans' },
  { family: 'Poppins',           category: 'sans' },
  { family: 'Montserrat',        category: 'sans' },
  { family: 'Roboto',            category: 'sans' },
  { family: 'Open Sans',         category: 'sans' },
  { family: 'Jost',              category: 'sans' },
  { family: 'Urbanist',          category: 'sans' },
  { family: 'DM Sans',           category: 'sans' },
  // Serif
  { family: 'Fraunces',          category: 'serif' },
  { family: 'Playfair Display',  category: 'serif' },
  { family: 'DM Serif Display',  category: 'serif' },
  { family: 'Crimson Pro',       category: 'serif' },
  // Display / condensed (great for short bold App Store headlines)
  { family: 'Bebas Neue',        category: 'display' },
  { family: 'Anton',             category: 'display' },
  { family: 'Archivo Black',     category: 'display' },
  { family: 'Oswald',            category: 'display' },
  // Mono (rarely used for headlines but useful for code-heavy app pitches)
  { family: 'JetBrains Mono',    category: 'mono' },
];

/** Static list of font families already preloaded in index.html. */
export const PRELOADED_FONTS = new Set([
  'Inter', 'JetBrains Mono', 'Fraunces', 'Space Grotesk',
  'DM Serif Display', 'Manrope', 'IBM Plex Sans',
]);
