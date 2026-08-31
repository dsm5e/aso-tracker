/**
 * Full App Store Connect localization catalogue, tiered for indie strategy:
 *  - Tier 1: must-have core markets (high revenue + organic discovery).
 *  - Tier 2: secondary major markets — clear ROI when you've finished Tier 1.
 *  - Tier 3: long-tail / opportunistic; nice-to-have, low effort once the
 *           translation pipeline is in place.
 *
 * Codes match Apple's localization codes (some collapsed: e.g. Apple has
 * en-US/GB/AU/CA — we keep those distinct because metadata differs per store).
 *
 * Flags are emoji for instant scanability; `rtl` flips text direction;
 * `font` is the optional script-specific web font (CJK / Arabic / etc.).
 */

export type LocaleTier = 1 | 2 | 3;

export interface LocaleSpec {
  code: string;
  name: string;
  flag: string;
  tier: LocaleTier;
  rtl?: boolean;
  /** Suggested web font (Google Fonts). The renderer falls back to the preset
   *  font when this is missing. */
  font?: string;
}

// Regional duplicates (en-US/GB/AU/CA, es-ES/MX, fr-FR/CA) collapsed into
// canonical language codes — the screenshot text is identical for those, and
// the ASC metadata distinction belongs to a future per-store tagging step.
// PT-BR / PT-PT and zh-Hans / zh-Hant stay split because the translations
// genuinely diverge.
export const CURATED_LOCALES: LocaleSpec[] = [
  // ── Tier 1 — global launch core ────────────────────────────────────────
  { code: 'en-US',  name: 'English (U.S.)',         flag: '🇺🇸', tier: 1 },
  { code: 'en-GB',  name: 'English (U.K.)',         flag: '🇬🇧', tier: 1 },
  { code: 'en-AU',  name: 'English (Australia)',    flag: '🇦🇺', tier: 1 },
  { code: 'en-CA',  name: 'English (Canada)',       flag: '🇨🇦', tier: 1 },
  { code: 'es-ES',  name: 'Spanish (Spain)',        flag: '🇪🇸', tier: 1 },
  { code: 'es-MX',  name: 'Spanish (Mexico)',       flag: '🇲🇽', tier: 1 },
  { code: 'de-DE',  name: 'German',                 flag: '🇩🇪', tier: 1 },
  { code: 'fr-FR',  name: 'French',                 flag: '🇫🇷', tier: 1 },
  { code: 'fr-CA',  name: 'French (Canada)',        flag: '🇨🇦', tier: 1 },
  { code: 'it',     name: 'Italian',                flag: '🇮🇹', tier: 1 },
  { code: 'pt-BR',  name: 'Portuguese (Brazil)',    flag: '🇧🇷', tier: 1 },
  { code: 'ru',     name: 'Russian',                flag: '🇷🇺', tier: 1 },
  { code: 'ja',     name: 'Japanese',               flag: '🇯🇵', tier: 1, font: 'Noto Sans JP' },
  { code: 'ko',     name: 'Korean',                 flag: '🇰🇷', tier: 1, font: 'Noto Sans KR' },
  { code: 'zh-Hans',name: 'Chinese (Simplified)',   flag: '🇨🇳', tier: 1, font: 'Noto Sans SC' },

  // ── Tier 2 — major secondary markets ───────────────────────────────────
  { code: 'nl-NL',  name: 'Dutch',                  flag: '🇳🇱', tier: 2 },
  { code: 'pl',     name: 'Polish',                 flag: '🇵🇱', tier: 2 },
  { code: 'tr',     name: 'Turkish',                flag: '🇹🇷', tier: 2 },
  { code: 'ar-SA',  name: 'Arabic',                 flag: '🇸🇦', tier: 2, rtl: true,  font: 'Noto Sans Arabic' },
  { code: 'zh-Hant',name: 'Chinese (Traditional)',  flag: '🇹🇼', tier: 2, font: 'Noto Sans TC' },
  { code: 'pt-PT',  name: 'Portuguese (Portugal)',  flag: '🇵🇹', tier: 2 },
  { code: 'sv',     name: 'Swedish',                flag: '🇸🇪', tier: 2 },
  { code: 'da',     name: 'Danish',                 flag: '🇩🇰', tier: 2 },
  { code: 'no',     name: 'Norwegian',              flag: '🇳🇴', tier: 2 },
  { code: 'fi',     name: 'Finnish',                flag: '🇫🇮', tier: 2 },
  { code: 'th',     name: 'Thai',                   flag: '🇹🇭', tier: 2, font: 'Noto Sans Thai' },
  { code: 'vi',     name: 'Vietnamese',             flag: '🇻🇳', tier: 2 },
  { code: 'id',     name: 'Indonesian',             flag: '🇮🇩', tier: 2 },

  // ── Tier 3 — long-tail / opportunistic ─────────────────────────────────
  { code: 'el',     name: 'Greek',                  flag: '🇬🇷', tier: 3 },
  { code: 'he',     name: 'Hebrew',                 flag: '🇮🇱', tier: 3, rtl: true,  font: 'Noto Sans Hebrew' },
  { code: 'hi',     name: 'Hindi',                  flag: '🇮🇳', tier: 3, font: 'Noto Sans Devanagari' },
  { code: 'hu',     name: 'Hungarian',              flag: '🇭🇺', tier: 3 },
  { code: 'cs',     name: 'Czech',                  flag: '🇨🇿', tier: 3 },
  { code: 'sk',     name: 'Slovak',                 flag: '🇸🇰', tier: 3 },
  { code: 'ro',     name: 'Romanian',               flag: '🇷🇴', tier: 3 },
  { code: 'hr',     name: 'Croatian',               flag: '🇭🇷', tier: 3 },
  { code: 'uk',     name: 'Ukrainian',              flag: '🇺🇦', tier: 3 },
  { code: 'ms',     name: 'Malay',                  flag: '🇲🇾', tier: 3 },
  { code: 'ca',     name: 'Catalan',                flag: '🇦🇩', tier: 3 },
];

/** Legacy short codes used by older saved projects → current Apple codes. */
const LOCALE_ALIASES: Record<string, string> = {
  en: 'en-US', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', nl: 'nl-NL', ar: 'ar-SA',
};

export function findLocaleSpec(code: string): LocaleSpec | undefined {
  const want = (LOCALE_ALIASES[code] ?? code).toLowerCase();
  return CURATED_LOCALES.find((l) => l.code.toLowerCase() === want);
}
