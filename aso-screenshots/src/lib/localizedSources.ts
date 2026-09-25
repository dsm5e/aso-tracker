/**
 * Per-language app screenshots (localized in-app UI) with a fallback chain.
 *
 * Directory convention, relative to `public/uploads/`:
 *   <dir>/<file>          root sources, in the language `rootLang`
 *   <dir>/<lang>/<file>   same capture with the app UI in <lang>
 *
 * A slot keeps pointing at the root file (`…/uploads/<dir>/<file>`). When a
 * store locale is rendered, the locale code maps to an app language and the
 * first language in `<lang> → fallback… ` that has `<file>` wins; reaching
 * `rootLang` (or the end of the chain) keeps the root file.
 *
 * The browser cannot list folders, so `files` is a manifest of what exists —
 * `node cli/import-sources.mjs` copies files and rewrites it (`--scan` only
 * rescans). Explicit `locale.sourceOverrides[slotId]` still beats all of this.
 */
import type { LocaleEntry, Screenshot } from '../state/studio';

export interface LocalizedSources {
  /** Folder under public/uploads holding the root sources, e.g. 'liveaquarium'. */
  dir: string;
  /** Language of the root files. A locale mapped to it uses the root as-is. */
  rootLang?: string;
  /** Manifest: app language → filenames present in uploads/<dir>/<lang>/. */
  files: Record<string, string[]>;
  /** Extra / overriding store-locale → app-language entries. */
  localeMap?: Record<string, string>;
  /** Languages tried after the locale's own one (default ['en']). */
  fallback?: string[];
  /** App language for locales absent from the map (default 'en'). */
  defaultLang?: string;
}

/** App Store Connect locale → app UI language. Unlisted locales → defaultLang. */
export const DEFAULT_LOCALE_TO_LANG: Record<string, string> = {
  'en-US': 'en', 'en-GB': 'en', 'en-AU': 'en', 'en-CA': 'en',
  'de-DE': 'de',
  'fr-FR': 'fr', 'fr-CA': 'fr',
  'es-ES': 'es', 'es-MX': 'es',
  it: 'it',
  'pt-BR': 'pt-BR', 'pt-PT': 'pt-BR',
  'nl-NL': 'nl',
  sv: 'sv',
  da: 'da',
  no: 'nb',
  fi: 'fi',
  ja: 'ja',
  ko: 'ko',
  'zh-Hans': 'zh-Hans',
  'zh-Hant': 'zh-Hant',
  pl: 'pl',
  tr: 'tr',
  ru: 'ru',
};

export function appLangForLocale(code: string, cfg: LocalizedSources): string {
  return cfg.localeMap?.[code] ?? DEFAULT_LOCALE_TO_LANG[code] ?? cfg.defaultLang ?? 'en';
}

/** Rewrite one root-source URL for a locale; returns the input when nothing applies. */
export function resolveLocalizedUrl(
  url: string | null | undefined,
  localeCode: string,
  cfg: LocalizedSources | null | undefined,
): string | null | undefined {
  if (!url || !cfg?.dir) return url;
  const marker = `/uploads/${cfg.dir}/`;
  const at = url.indexOf(marker);
  if (at < 0) return url;
  const file = url.slice(at + marker.length);
  // Only root files (no sub-folder, e.g. decor/…) are localisable.
  if (!file || file.includes('/')) return url;

  const own = appLangForLocale(localeCode, cfg);
  const chain = [own, ...(cfg.fallback ?? ['en'])];
  for (const lang of chain) {
    if (lang === cfg.rootLang) return url;
    if (cfg.files?.[lang]?.includes(file)) {
      return `${url.slice(0, at + marker.length)}${lang}/${file}`;
    }
  }
  return url;
}

/** Slot sources for a locale: explicit per-locale overrides first, then the chain. */
export function localizedSlotSources(
  ss: Screenshot,
  loc: LocaleEntry,
  cfg: LocalizedSources | null | undefined,
): Pick<Screenshot, 'sourceUrl' | 'secondaryUrl'> {
  return {
    sourceUrl: loc.sourceOverrides?.[ss.id]
      ?? (resolveLocalizedUrl(ss.sourceUrl, loc.code, cfg) as Screenshot['sourceUrl']),
    secondaryUrl: loc.secondaryOverrides?.[ss.id]
      ?? (resolveLocalizedUrl(ss.secondaryUrl, loc.code, cfg) as Screenshot['secondaryUrl']),
  };
}
