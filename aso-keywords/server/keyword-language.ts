/**
 * Script + language guess for a pasted keyword, so bulk add can preselect the
 * storefronts that index that language (storefronts.ts). Pure — the client
 * imports it directly.
 *
 * Script is exact (Unicode ranges). Language inside a script is a heuristic:
 * letters unique to a language, then a small word list; Latin without any
 * marker defaults to English — the language indexed in almost every storefront.
 */
import { STOREFRONTS, languageOf, storefrontsIndexing, type Storefront } from './storefronts.js';

export type Script = 'latin' | 'cyrillic' | 'cjk' | 'hangul' | 'kana' | 'arabic' | 'hebrew' | 'greek' | 'thai' | 'devanagari' | 'other';

export interface KeywordLanguage {
  script: Script;
  /** ISO 639-1 */
  lang: string;
  /** How sure the guess is: letters unique to the language / a known word / script default. */
  confidence: 'script' | 'letters' | 'words' | 'default';
}

export const SCRIPT_LABEL: Record<Script, string> = {
  latin: 'латиница', cyrillic: 'кириллица', cjk: 'иероглифы', hangul: 'хангыль', kana: 'кана', arabic: 'арабское письмо',
  hebrew: 'иврит', greek: 'греческий', thai: 'тайский', devanagari: 'деванагари', other: 'другое',
};

export const LANGUAGE_LABEL: Record<string, string> = {
  en: 'английский', es: 'испанский', pt: 'португальский', fr: 'французский', de: 'немецкий', it: 'итальянский',
  nl: 'нидерландский', sv: 'шведский', da: 'датский', no: 'норвежский', fi: 'финский', pl: 'польский', cs: 'чешский',
  sk: 'словацкий', hu: 'венгерский', ro: 'румынский', hr: 'хорватский', tr: 'турецкий', vi: 'вьетнамский', id: 'индонезийский',
  ms: 'малайский', ca: 'каталанский', ru: 'русский', uk: 'украинский', kk: 'казахский', ja: 'японский', ko: 'корейский',
  zh: 'китайский', ar: 'арабский', he: 'иврит', el: 'греческий', th: 'тайский', hi: 'хинди',
};

const SCRIPT_RANGES: Array<[Script, RegExp]> = [
  ['hangul', /[ᄀ-ᇿ㄰-㆏가-힯]/],
  ['kana', /[぀-ヿㇰ-ㇿ]/],
  ['cjk', /[㐀-䶿一-鿿豈-﫿]/],
  ['arabic', /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/],
  ['hebrew', /[֐-׿]/],
  ['greek', /[Ͱ-Ͽ]/],
  ['thai', /[฀-๿]/],
  ['devanagari', /[ऀ-ॿ]/],
  ['cyrillic', /[Ѐ-ӿ]/],
  ['latin', /[a-zA-ZÀ-ɏ]/],
];

// Letters that (among App Store languages) point to one language.
const LETTERS: Array<[string, RegExp]> = [
  ['es', /[ñ¿¡]/], ['pt', /[ãõ]/], ['de', /[ß]/], ['tr', /[ğşı]/], ['pl', /[ąęłńśźż]/], ['cs', /[ěřůť]/],
  ['ro', /[ăâîșț]/], ['hu', /[őű]/], ['vi', /[ơưđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/], ['fr', /[œèêëùûÿ]/],
  ['de', /[äöü]/], ['sv', /[å]/], ['da', /[æø]/], ['ca', /l·l/], ['es', /[áíóú]/], ['pt', /[çâêô]/], ['it', /[àìò]/],
];

// Short, distinctive words of typical App Store queries.
const WORDS: Record<string, string[]> = {
  es: ['de', 'del', 'para', 'el', 'la', 'los', 'las', 'con', 'gratis', 'visor', 'aplicacion', 'aplicación', 'imagen', 'imagenes', 'medico', 'médico', 'radiografia', 'radiografía', 'resonancia', 'tomografia', 'tomografía', 'ecografia', 'visualizador', 'lector', 'dental', 'salud', 'embarazo', 'sueño', 'sueños'],
  pt: ['de', 'do', 'da', 'dos', 'das', 'para', 'com', 'grátis', 'gratis', 'visualizador', 'exame', 'exames', 'imagem', 'imagens', 'ressonancia', 'ressonância', 'tomografia', 'raio', 'saude', 'saúde', 'gravidez', 'sonhos'],
  fr: ['de', 'du', 'des', 'le', 'la', 'les', 'pour', 'avec', 'gratuit', 'visionneuse', 'lecteur', 'imagerie', 'médical', 'medical', 'radiologie', 'irm', 'scanner', 'grossesse', 'rêves', 'santé'],
  de: ['der', 'die', 'das', 'für', 'fur', 'mit', 'und', 'kostenlos', 'betrachter', 'bilder', 'röntgen', 'rontgen', 'mrt', 'schwangerschaft', 'träume', 'arzt', 'medizin'],
  it: ['di', 'del', 'della', 'per', 'con', 'gratis', 'visualizzatore', 'immagini', 'medico', 'radiografia', 'risonanza', 'gravidanza', 'sogni'],
  nl: ['van', 'voor', 'met', 'het', 'een', 'gratis', 'beelden', 'zwangerschap', 'dromen'],
  sv: ['för', 'och', 'med', 'gratis', 'bilder', 'graviditet', 'drömmar'],
  tr: ['ve', 'için', 'icin', 'ücretsiz', 'ucretsiz', 'görüntüleyici', 'goruntuleyici', 'hamilelik', 'rüya'],
  id: ['dan', 'untuk', 'dengan', 'gratis', 'aplikasi', 'kehamilan', 'mimpi'],
  pl: ['dla', 'darmowy', 'przeglądarka', 'ciąża', 'sny'],
};

// Cyrillic: letters unique to Ukrainian / Kazakh; the rest is Russian.
const CYRILLIC_LETTERS: Array<[string, RegExp]> = [['uk', /[іїєґ]/], ['kk', /[әғқңөұүһ]/]];

export function detectScript(text: string): Script {
  const counts = new Map<Script, number>();
  for (const ch of text) {
    for (const [script, re] of SCRIPT_RANGES) {
      if (re.test(ch)) { counts.set(script, (counts.get(script) ?? 0) + 1); break; }
    }
  }
  // Kana wins over Han (Japanese mixes both); Han alone is Chinese.
  if (counts.get('kana')) return 'kana';
  let best: Script = 'other', max = 0;
  for (const [script, n] of counts) if (n > max) { best = script; max = n; }
  return best;
}

export function detectLanguage(keyword: string): KeywordLanguage {
  const text = keyword.normalize('NFC').toLocaleLowerCase().trim();
  const script = detectScript(text);
  switch (script) {
    case 'kana': return { script, lang: 'ja', confidence: 'script' };
    case 'hangul': return { script, lang: 'ko', confidence: 'script' };
    case 'cjk': return { script, lang: 'zh', confidence: 'script' };
    case 'arabic': return { script, lang: 'ar', confidence: 'script' };
    case 'hebrew': return { script, lang: 'he', confidence: 'script' };
    case 'greek': return { script, lang: 'el', confidence: 'script' };
    case 'thai': return { script, lang: 'th', confidence: 'script' };
    case 'devanagari': return { script, lang: 'hi', confidence: 'script' };
    case 'cyrillic': {
      for (const [lang, re] of CYRILLIC_LETTERS) if (re.test(text)) return { script, lang, confidence: 'letters' };
      return { script, lang: 'ru', confidence: 'default' };
    }
    case 'latin': {
      for (const [lang, re] of LETTERS) if (re.test(text)) return { script, lang, confidence: 'letters' };
      const words = text.split(/[\s\-–—,./]+/).filter(Boolean);
      let best = '', score = 0;
      for (const [lang, list] of Object.entries(WORDS)) {
        const hits = words.filter((word) => list.includes(word)).length;
        if (hits > score) { best = lang; score = hits; }
      }
      if (best) return { script, lang: best, confidence: 'words' };
      return { script, lang: 'en', confidence: 'default' };
    }
    default: return { script, lang: 'en', confidence: 'default' };
  }
}

/** Storefronts (among `candidates`) that index the keyword's language. */
export function storefrontsForLanguage(lang: string, candidates: string[]): string[] {
  const allowed = new Set(candidates.map((code) => code.toLowerCase()));
  const list: Storefront[] = STOREFRONTS.filter((storefront) => allowed.has(storefront.code));
  return storefrontsIndexing(lang, list).map((storefront) => storefront.code);
}

/** Is the storefront's default (first) locale in this language? */
export function isPrimaryLanguage(lang: string, storefront: Storefront): boolean {
  return storefront.locales.length > 0 && languageOf(storefront.locales[0]) === lang;
}

/** Split a pasted list (comma / newline / semicolon / tab) and dedupe case-insensitively, keeping first spelling. */
export function parseKeywordList(raw: string): { keywords: string[]; duplicates: number } {
  const seen = new Set<string>();
  const keywords: string[] = [];
  let duplicates = 0;
  for (const part of raw.split(/[\n,;\t]+/)) {
    const keyword = part.trim().replace(/\s+/g, ' ');
    if (!keyword) continue;
    const key = keyword.toLocaleLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    keywords.push(keyword);
  }
  return { keywords, duplicates };
}
