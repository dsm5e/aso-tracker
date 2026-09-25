import { db } from './db.js';
import { loadApps, loadKeywords, type AppConfig } from './config.js';
import {
  MEDSCAN_KNOWN_BRANDS,
  hasMedScanMedicalIntent,
  hasMedScanViewerContext,
  isMedScanCompetitorEvidence,
  isMedScanOffTopic,
  medScanCluster,
} from './medical-intent.js';

// Keyword ideas = candidate phrases that are (1) generic intent queries, not
// somebody's brand, (2) explained by concrete evidence and (3) ranked by an
// explicit, reproducible estimate of the expected effect. Nothing here is a
// search volume: every number is labelled with where it came from.

export type IdeaSource = 'apple_autocomplete' | 'competitor_title' | 'asa_suggestion';
export type GainLevel = 'high' | 'medium' | 'low';

export interface KeywordIdea {
  keyword: string;
  /** Primary source (strongest evidence). */
  source: IdeaSource;
  sources: IdeaSource[];
  /** Plain-Russian lines: where the phrase came from (seed / evidence). */
  origin: string[];
  /** Why the phrase passed the relevance filter. */
  reason: string;
  cluster: { id: string; label: string };
  /** Expected-effect estimate 0–100 (demand × chance). */
  score: number;
  level: GainLevel;
  demand: number;
  chance: number;
  /** Every input that went into demand/chance, in plain Russian. */
  inputs: string[];
}

export interface RejectedIdea {
  keyword: string;
  reason: string;
}

export interface KeywordSuggestionsResponse {
  locale: string;
  generatedAt: string;
  formula: string;
  signals: {
    appleAutocomplete: 'ok' | 'empty';
    asaPopularity: 'ok' | 'no-data' | 'unavailable';
    competitorApps: number;
  };
  ideas: KeywordIdea[];
  rejected: RejectedIdea[];
  trackedSkipped: number;
}

export const GAIN_FORMULA = [
  'Ожидаемый эффект = спрос × шанс × 100 (оценка, не объём трафика).',
  'Спрос — среднее доступных сигналов: популярность Apple Ads (0.2 + 0.8·(p−5)/25), позиция в подсказках Apple (1-я = 0.9, 10-я = 0.4), число конкурентов с фразой в названии (0.2 + 0.12·n, максимум 0.8).',
  'Шанс — среднее доступных сигналов: наша позиция по самой фразе (топ-3 = 0.25, топ-10 = 0.7, ниже = 0.9), наша позиция по исходному ключу (топ-10 = 0.85, топ-30 = 0.65, топ-100 = 0.45, нет = 0.3), медиана оценок топ-5 (<50 = 0.95, <500 = 0.75, <5000 = 0.5, больше = 0.3), фраза = точное название чужого приложения (0.4). Нет данных — 0.5.',
  'Высокий ≥ 40, средний ≥ 20, иначе низкий.',
].join('\n');

// --- Text helpers ----------------------------------------------------------

export function normalized(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  return Array.from(normalized(value).matchAll(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu), (m) => m[0]);
}

/** Words that describe an app type / modifier in any category. */
const MODIFIERS = new Set([
  'app', 'apps', 'free', 'pro', 'plus', 'lite', 'hd', 'online', 'offline', 'best', 'new',
  'the', 'and', 'for', 'with', 'your', 'my', 'of', 'on', 'in', 'to', 'a', 'an', 'mobile',
  'iphone', 'ipad', 'ios', 'mac', 'easy', 'simple', 'fast', 'quick', 'premium', 'official',
  'de', 'la', 'el', 'para', 'di', 'per', 'und', 'für', 'et', 'pour', 'le', 'les', 'des', 'do', 'da',
  'y', 'e', 'o', 'u', 'i', 'и', 'с', 'в', 'для',
]);
const CATEGORY_WORDS = new Set([
  'viewer', 'view', 'reader', 'read', 'open', 'opener', 'file', 'files', 'image', 'images',
  'photo', 'photos', 'scan', 'scanner', 'editor', 'player', 'tool', 'tools', 'converter',
  'medical', 'imaging', 'study', 'studies', 'report', 'reports', 'results', 'radiology',
  'dental', 'dentist', 'x-ray', 'xray', 'ray', 'x', 'ct', 'mri', 'dicom', 'dcm', 'pacs', 'cbct',
  '3d', '2d', 'cloud', 'share', 'transfer', 'storage', 'film', 'films', 'medicine',
  // Localized "viewer / reader / images / x-ray" words.
  'visualizador', 'visor', 'visualizzatore', 'visualiseur', 'visionneuse', 'lecteur', 'betrachter',
  'görüntüleyici', 'goruntuleyici', 'przeglądarka', 'prohlížeč', 'просмотр', 'просмотрщик',
  'imagens', 'imagenes', 'imágenes', 'immagini', 'bilder', 'снимки', 'снимков', 'rayos', 'raios',
  'raio', 'rayo', 'rx', 'radiografia', 'radiografía', 'tomografia', 'tomografía', 'resonancia',
  'ressonância', 'magnetica', 'magnética', 'médica', 'medica', 'médico', 'medico', 'medizinische',
  '뷰어', 'ビューア', 'ビューアー', '查看器', 'عارض',
  'mrt', 'мрт', 'кт', 'tac', 'rm', 'irm', 'tc', 'röntgen', 'rontgen', 'rentgen', 'рентген',
  'odontologia', 'odontología', 'odontológico', 'odontologico', 'dentaire', 'zahn', 'zahnarzt', 'dentale',
]);
const CORPORATE = new Set([
  'inc', 'llc', 'ltd', 'gmbh', 'co', 'corp', 'corporation', 'sa', 'sl', 'srl', 'bv', 'ag',
  'limited', 'company', 'technologies', 'technology', 'tech', 'software', 'solutions', 'medical',
  'health', 'healthcare', 'imaging', 'systems', 'system', 'labs', 'lab', 'apps', 'app', 'studio',
  'group', 'digital', 'mobile', 'dental', 'international', 'global', 'services', 'development',
  'kg', 'oy', 'ab', 'as', 'pte', 'pty', 'sas', 'spa', 'kft', 'sro', 'ооо', '株式会社', 'the', 'and',
  'de', 'of', 'dicom', 'viewer', 'radiology', 'diagnostics', 'innovation', 'innovations',
]);

// --- Vocabulary: which tokens are generic and which are brands --------------

export interface CorpusApp {
  key: string;        // stable app identity (tid or bundle)
  title: string;
  developer: string;
}

export interface Vocabulary {
  titleDevelopers: Map<string, Set<string>>;
  developerTokens: Set<string>;
  tokenExample: Map<string, CorpusApp>;
  /** normalized full title → original title */
  titles: Map<string, string>;
}

export function buildVocabulary(apps: CorpusApp[]): Vocabulary {
  const titleDevelopers = new Map<string, Set<string>>();
  const developerTokens = new Set<string>();
  const tokenExample = new Map<string, CorpusApp>();
  const titles = new Map<string, string>();
  for (const app of apps) {
    const dev = normalized(app.developer || app.key);
    if (!titles.has(normalized(app.title))) titles.set(normalized(app.title), app.title);
    for (const token of new Set(tokenize(app.title))) {
      if (!titleDevelopers.has(token)) titleDevelopers.set(token, new Set());
      titleDevelopers.get(token)!.add(dev);
      if (!tokenExample.has(token)) tokenExample.set(token, app);
    }
    for (const token of tokenize(app.developer)) {
      if (token.length >= 3 && !CORPORATE.has(token)) developerTokens.add(token);
    }
  }
  return { titleDevelopers, developerTokens, tokenExample, titles };
}

export interface RelevanceProfile {
  id: 'medscan' | 'generic';
  knownBrands: Set<string>;
  trackedTokens: Set<string>;
  isIntentToken: (token: string) => boolean;
  /** null = relevant, string = rejection reason. */
  intentProblem: (phrase: string) => string | null;
  cluster: (phrase: string) => { id: string; label: string };
}

export type TokenKind = 'modifier' | 'generic' | 'brand' | 'unknown';

export function classifyToken(token: string, vocab: Vocabulary, profile: RelevanceProfile): TokenKind {
  if (MODIFIERS.has(token) || /^\d+$/.test(token)) return 'modifier';
  if (profile.knownBrands.has(token)) return 'brand';
  if (CATEGORY_WORDS.has(token)) return 'generic';
  // A word several unrelated developers put in their titles is category vocabulary.
  if ((vocab.titleDevelopers.get(token)?.size ?? 0) >= 3) return 'generic';
  if (vocab.developerTokens.has(token)) return 'brand';
  if (profile.isIntentToken(token)) return 'generic';
  if (profile.trackedTokens.has(token)) return 'generic';
  return 'unknown';
}

export function medScanProfile(trackedTokens: Set<string>): RelevanceProfile {
  return {
    id: 'medscan',
    knownBrands: MEDSCAN_KNOWN_BRANDS,
    trackedTokens,
    isIntentToken: (token) => hasMedScanMedicalIntent(token),
    intentProblem: (phrase) => {
      if (isMedScanOffTopic(phrase)) return 'другой интент (приколы, камеры, игры, недвижимость…)';
      if (!hasMedScanMedicalIntent(phrase)) return 'не про медицинские снимки';
      if (!hasMedScanViewerContext(phrase)) return 'неоднозначное сокращение без слова про просмотр/снимки';
      return null;
    },
    cluster: medScanCluster,
  };
}

export function genericProfile(trackedTokens: Set<string>): RelevanceProfile {
  return {
    id: 'generic',
    knownBrands: new Set(),
    trackedTokens,
    isIntentToken: () => false,
    intentProblem: (phrase) => tokenize(phrase).some((token) => trackedTokens.has(token) && !MODIFIERS.has(token))
      ? null
      : 'нет общих слов с отслеживаемыми ключами',
    cluster: (phrase) => {
      const head = tokenize(phrase).find((token) => trackedTokens.has(token) && !MODIFIERS.has(token));
      return head ? { id: head, label: head } : { id: 'other', label: 'Другое' };
    },
  };
}

export type Assessment =
  | { ok: true; reason: string; cluster: { id: string; label: string } }
  | { ok: false; reason: string };

export function assessCandidate(phrase: string, vocab: Vocabulary, profile: RelevanceProfile): Assessment {
  const text = normalized(phrase);
  if (/\s[-–—|]\s|[:|–—]/.test(text)) return { ok: false, reason: 'это название приложения, а не поисковый запрос' };
  if (/[&+!?/@#*()[\]"'.,;]/.test(text)) return { ok: false, reason: 'обрывок названия приложения (символы «&», «+», «/»…)' };
  const tokens = tokenize(text);
  if (!tokens.length) return { ok: false, reason: 'пустая фраза' };
  if (tokens.length > 4) return { ok: false, reason: 'слишком длинная фраза — так не ищут' };
  if (tokens.some((token, index) => token.length === 1 && !/\d/.test(token) && !MODIFIERS.has(token) && !(token === 'x' && tokens[index + 1] === 'ray'))) {
    return { ok: false, reason: 'бессмысленный одиночный символ' };
  }
  const kinds = tokens.map((token) => classifyToken(token, vocab, profile));
  const brand = tokens.find((_, index) => kinds[index] === 'brand');
  if (brand) {
    const example = vocab.tokenExample.get(brand);
    return { ok: false, reason: example ? `бренд «${brand}» (приложение «${example.title}»)` : `бренд «${brand}»` };
  }
  const unknown = tokens.find((_, index) => kinds[index] === 'unknown');
  if (unknown) {
    const example = vocab.tokenExample.get(unknown);
    return {
      ok: false,
      reason: example
        ? `«${unknown}» встречается только в названии «${example.title}» — похоже на бренд`
        : `редкое слово «${unknown}» — не подтверждено как общий запрос`,
    };
  }
  if (kinds.every((kind) => kind === 'modifier')) return { ok: false, reason: 'только служебные слова' };
  if (tokens.length === 1 && vocab.titles.has(text)) return { ok: false, reason: 'совпадает с названием приложения' };
  if (tokens.filter((_, index) => kinds[index] !== 'modifier').every((token) => CATEGORY_WORDS.has(token)) && tokens.length === 1) {
    return { ok: false, reason: 'слишком общее слово — непонятно, что ищут' };
  }
  if (vocab.titles.has(text) && tokens.length <= 2 && !kinds.some((kind) => kind === 'generic')) {
    return { ok: false, reason: 'совпадает с названием приложения' };
  }
  const problem = profile.intentProblem(text);
  if (problem) return { ok: false, reason: problem };
  const cluster = profile.cluster(text);
  const words = tokens.filter((_, index) => kinds[index] === 'generic');
  return {
    ok: true,
    cluster,
    reason: `Общий запрос темы «${cluster.label}»: ${words.map((word) => `«${word}»`).join(', ')} — без брендов`,
  };
}

// --- Expected effect ------------------------------------------------------

export interface GainInputs {
  asaPopularity?: number | null;
  autocomplete?: { index: number; total: number; seed: string; seeds: number } | null;
  competitorApps?: number;
  ourRank?: { rank: number | null; depth: number; source: string } | null;
  seedRank?: { rank: number | null; seed: string } | null;
  topRatingsMedian?: { value: number; apps: number } | null;
  /** The phrase is exactly another app's name: part of the demand is navigational. */
  exactAppTitle?: string | null;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const fmt = (value: number) => value.toFixed(2);

export function estimateGain(input: GainInputs): { score: number; level: GainLevel; demand: number; chance: number; inputs: string[] } {
  const lines: string[] = [];
  const demandParts: number[] = [];
  if (input.asaPopularity != null) {
    const value = 0.2 + 0.8 * clamp((input.asaPopularity - 5) / 25);
    demandParts.push(value);
    lines.push(`Спрос: популярность Apple Ads ${input.asaPopularity <= 5 ? '≤5' : input.asaPopularity}/100 → ${fmt(value)}`);
  }
  if (input.autocomplete) {
    const { index, total, seed, seeds } = input.autocomplete;
    const value = clamp(0.4 + 0.5 * (1 - Math.min(index, 9) / 9) + 0.05 * (seeds - 1), 0, 0.95);
    demandParts.push(value);
    lines.push(`Спрос: подсказка Apple №${index + 1} из ${total} при вводе «${seed}»${seeds > 1 ? ` (и ещё в ${seeds - 1})` : ''} → ${fmt(value)}`);
  }
  if (input.competitorApps) {
    const value = Math.min(0.8, 0.2 + 0.12 * input.competitorApps);
    demandParts.push(value);
    lines.push(`Спрос: фраза в названиях конкурентов из топ-5: ${input.competitorApps} → ${fmt(value)}`);
  }
  const demand = demandParts.length ? mean(demandParts) : 0.2;
  if (!demandParts.length) lines.push('Спрос: сигналов нет → 0.20');

  const chanceParts: number[] = [];
  if (input.ourRank) {
    const { rank, depth, source } = input.ourRank;
    if (rank != null) {
      const value = rank <= 3 ? 0.25 : rank <= 10 ? 0.7 : 0.9;
      chanceParts.push(value);
      lines.push(`Шанс: мы уже #${rank} по этой фразе (${source})${rank <= 3 ? ' — прирост небольшой' : ''} → ${fmt(value)}`);
    } else {
      lines.push(`Шанс: нас нет в топ-${depth} по этой фразе (${source})`);
    }
  }
  if (input.seedRank) {
    const { rank, seed } = input.seedRank;
    const value = rank == null ? 0.3 : rank <= 10 ? 0.85 : rank <= 30 ? 0.65 : rank <= 100 ? 0.45 : 0.3;
    chanceParts.push(value);
    lines.push(`Шанс: ${rank == null ? 'не ранжируемся' : `мы #${rank}`} по исходному ключу «${seed}» → ${fmt(value)}`);
  }
  if (input.topRatingsMedian) {
    const { value: ratings, apps } = input.topRatingsMedian;
    const value = ratings < 50 ? 0.95 : ratings < 500 ? 0.75 : ratings < 5000 ? 0.5 : 0.3;
    chanceParts.push(value);
    lines.push(`Шанс: медиана оценок топ-${apps} — ${Math.round(ratings).toLocaleString('ru-RU')} → ${fmt(value)}`);
  }
  if (input.exactAppTitle) {
    chanceParts.push(0.4);
    lines.push(`Шанс: фраза совпадает с названием «${input.exactAppTitle}» — часть поиска ищет именно его → 0.40`);
  }
  const chance = chanceParts.length ? mean(chanceParts) : 0.5;
  if (!chanceParts.length) lines.push('Шанс: данных нет → 0.50');

  const score = Math.round(100 * demand * chance);
  const level: GainLevel = score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
  lines.push(`Итог: ${fmt(demand)} × ${fmt(chance)} × 100 = ${score}`);
  return { score, level, demand: Number(fmt(demand)), chance: Number(fmt(chance)), inputs: lines };
}

// --- Data sources -----------------------------------------------------------

const STOREFRONT: Record<string, string> = {
  us: '143441', fr: '143442', de: '143443', gb: '143444', at: '143445',
  be: '143446', fi: '143447', gr: '143448', ie: '143449', it: '143450',
  lu: '143451', nl: '143452', pt: '143453', es: '143454', ca: '143455',
  se: '143456', no: '143457', dk: '143458', ch: '143459', au: '143460',
  nz: '143461', jp: '143462', hk: '143463', sg: '143464', cn: '143465',
  kr: '143466', in: '143467', mx: '143468', ru: '143469', tw: '143470',
  vn: '143471', za: '143472', my: '143473', ph: '143474', th: '143475',
  id: '143476', pk: '143477', pl: '143478', sa: '143479', tr: '143480',
  ae: '143481', hu: '143482', cl: '143483', np: '143484', pa: '143485',
  lk: '143486', ro: '143487', cz: '143489', sk: '143496', br: '143503',
};

function decodeXML(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const hintCache = new Map<string, { expiresAt: number; hints: string[] }>();

/** App Store search autocomplete. The `MacSearchAds` client only echoes the
 * seed back; the `Software` client with a storefront header returns the real,
 * popularity-ordered hint list. */
async function appleHints(seed: string, country: string): Promise<string[]> {
  const key = `${country}:${seed}`;
  const cached = hintCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.hints;
  const storefront = STOREFRONT[country] ?? STOREFRONT.us;
  const params = new URLSearchParams({ clientApplication: 'Software', term: seed });
  try {
    const response = await fetch(
      `https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/hints?${params}`,
      { headers: { 'X-Apple-Store-Front': `${storefront}-1,29` }, signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) return [];
    const xml = await response.text();
    const hints = Array.from(xml.matchAll(/<key>term<\/key>\s*<string>([\s\S]*?)<\/string>/g))
      .map((match) => normalized(decodeXML(match[1])))
      .filter(Boolean);
    hintCache.set(key, { expiresAt: Date.now() + 6 * 60 * 60_000, hints });
    return hints;
  } catch {
    return [];
  }
}

export interface AsaTerm { term: string; demandIndex: number | null; origins: string[] }

/** Ads API base. In the one-process studio the Ads API is mounted at
 * /asa-api on the same port; ASA_ADS_API_URL points at a standalone Ads
 * server root (legacy multi-process setup, e.g. http://localhost:5194). */
export function adsApiUrl(path: string): string {
  const standalone = process.env.ASA_ADS_API_URL;
  if (standalone) return `${standalone.replace(/\/$/, '')}/api${path}`;
  return `http://127.0.0.1:${process.env.STUDIO_PORT || 5173}/asa-api${path}`;
}

export type AsaPopularityStatus = 'ok' | 'stale' | 'pending' | 'none' | 'error';
export interface AsaPopularity {
  term: string;
  /** Apple Ads popularity 5–100 (5 = «≤5», low volume — never zero). */
  popularity: number | null;
  label: string | null;
  day: string | null;
  status: AsaPopularityStatus;
}
export interface AsaPopularityResult {
  source: string;
  sourceLabel: string;
  day: string;
  pending: number;
  values: Map<string, AsaPopularity>;
}

/** One consistent Apple Ads popularity (5–100) per keyword × storefront from
 * the Ads service (`/keyword-popularity`, cached there per day). Values not
 * cached yet come back `pending` and fill in the background. Null when the
 * Ads service is unreachable or the app has no numeric App Store id. */
export async function asaPopularity(app: AppConfig, country: string, terms: string[], waitMs = 0): Promise<AsaPopularityResult | null> {
  if (!/^\d+$/.test(String(app.iTunesId)) || !terms.length) return null;
  try {
    const response = await fetch(adsApiUrl('/keyword-popularity'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: String(app.iTunesId), country: country.toUpperCase(), terms: terms.slice(0, 2000), wait_ms: waitMs }),
      signal: AbortSignal.timeout(waitMs + 8_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { source?: string; sourceLabel?: string; day?: string; pending?: number; items?: Array<Partial<AsaPopularity>> };
    if (!Array.isArray(payload.items)) return null;
    const values = new Map<string, AsaPopularity>();
    for (const item of payload.items) {
      if (typeof item.term !== 'string') continue;
      const term = normalized(item.term);
      values.set(term, {
        term,
        popularity: typeof item.popularity === 'number' ? item.popularity : null,
        label: item.label ?? null,
        day: item.day ?? null,
        status: (item.status ?? 'pending') as AsaPopularityStatus,
      });
    }
    return { source: payload.source ?? 'apple-ads', sourceLabel: payload.sourceLabel ?? 'Apple Ads', day: payload.day ?? '', pending: payload.pending ?? 0, values };
  } catch {
    return null;
  }
}

/** Apple Ads suggestions + popularity through the local Ads service. Optional:
 * the service may be down or the app may have no Ads account — then ideas are
 * scored without it. Popularity comes from the per-day store (one 5–100
 * scale), so a term never reads 7 in one batch and 40 in the next. */
export async function asaTerms(app: AppConfig, country: string, terms: string[]): Promise<AsaTerm[] | null> {
  if (!/^\d+$/.test(String(app.iTunesId)) || !terms.length) return null;
  const params = new URLSearchParams({
    app_id: String(app.iTunesId),
    country: country.toUpperCase(),
    terms: terms.slice(0, 100).join(','),
  });
  try {
    const [response, popularity] = await Promise.all([
      fetch(adsApiUrl(`/traffic-intelligence?${params}`), { signal: AbortSignal.timeout(9_000) }),
      asaPopularity(app, country, terms.slice(0, 100), 4_000),
    ]);
    if (!response.ok) return null;
    const payload = (await response.json()) as { terms?: Array<{ term?: string; demandIndex?: number | null; origins?: string[] }> };
    if (!Array.isArray(payload.terms)) return null;
    return payload.terms
      .filter((row) => typeof row.term === 'string')
      .map((row) => {
        const term = normalized(row.term!);
        const stored = popularity?.values.get(term)?.popularity;
        return { term, demandIndex: stored ?? (typeof row.demandIndex === 'number' ? row.demandIndex : null), origins: row.origins ?? [] };
      });
  } catch {
    return null;
  }
}

interface Top5Row { name?: string; id?: string; dev?: string; tid?: number }
interface StoreRow { trackId?: number; trackName?: string; bundleId?: string; artistName?: string; userRatingCount?: number }

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const quote = (value: string) => `«${value}»`;
const listQuoted = (values: string[], max = 2) =>
  values.slice(0, max).map(quote).join(', ') + (values.length > max ? ` и ещё ${values.length - max}` : '');

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// --- Orchestration ------------------------------------------------------------

interface Candidate {
  keyword: string;
  sources: Set<IdeaSource>;
  assessment: Extract<Assessment, { ok: true }>;
  autocomplete?: { index: number; total: number; seed: string; seeds: number };
  competitorApps: Map<string, string>; // app key → title
  competitorKeywords: Map<string, number>; // tracked keyword → apps
  asaPopularity?: number | null;
}

const resultCache = new Map<string, { expiresAt: number; value: KeywordSuggestionsResponse }>();

export async function keywordSuggestions(appId: string, locale: string, options: { refresh?: boolean } = {}): Promise<KeywordSuggestionsResponse> {
  // Tracked keywords are part of the key: adding an idea must drop it from the list.
  const cacheKey = `${appId}:${locale}:${(loadKeywords(appId)[locale] ?? []).map(normalized).sort().join('|')}`;
  const cached = resultCache.get(cacheKey);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await computeSuggestions(appId, locale);
  resultCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, value });
  return value;
}

async function computeSuggestions(appId: string, locale: string): Promise<KeywordSuggestionsResponse> {
  const app = loadApps().find((item) => item.id === appId);
  const country = locale.split('-')[0].toLowerCase();
  const trackedList = (loadKeywords(appId)[locale] ?? []).map(normalized);
  const tracked = new Set(trackedList);
  const selfTid = Number(app?.iTunesId);
  const selfBundle = app?.bundle.toLocaleLowerCase() ?? '';
  const isSelf = (row: { id?: string; tid?: number; bundleId?: string; trackId?: number }) => {
    const tid = row.tid ?? row.trackId;
    if (Number.isFinite(selfTid) && tid === selfTid) return true;
    const bundle = (row.id ?? row.bundleId ?? '').toLocaleLowerCase();
    return Boolean(selfBundle && (bundle === selfBundle || bundle.startsWith(selfBundle)));
  };
  const isMedScan = appId === 'medscan';

  // Latest snapshot per keyword for this app (all locales feed the vocabulary;
  // the selected locale feeds ranks and competitor evidence).
  const snapshotRows = db.prepare(
    `SELECT s.locale, s.keyword, s.position, s.top5_json
       FROM snapshots s
       JOIN (
         SELECT locale, keyword, MAX(id) AS max_id
         FROM snapshots WHERE app = ? GROUP BY locale, keyword
       ) latest ON s.id = latest.max_id`
  ).all(appId) as Array<{ locale: string; keyword: string; position: number | null; top5_json: string | null }>;
  const storeRows = db.prepare('SELECT country, term, payload FROM store_search_cache').all() as Array<{ country: string; term: string; payload: string }>;

  const corpus: CorpusApp[] = [];
  for (const row of snapshotRows) {
    for (const item of parseJson<Top5Row[]>(row.top5_json, [])) {
      if (!item.name || isSelf(item)) continue;
      corpus.push({ key: String(item.tid ?? item.id ?? item.name), title: item.name, developer: item.dev ?? '' });
    }
  }
  const ratings = new Map<number, number>();
  const storeByTerm = new Map<string, StoreRow[]>();
  for (const row of storeRows) {
    const results = parseJson<StoreRow[]>(row.payload, []);
    if (!Array.isArray(results)) continue;
    for (const item of results) {
      if (!item.trackName || isSelf(item)) continue;
      corpus.push({ key: String(item.trackId ?? item.bundleId ?? item.trackName), title: item.trackName, developer: item.artistName ?? '' });
    }
    if (row.country.toLowerCase() !== country) continue;
    storeByTerm.set(normalized(row.term), results);
    for (const item of results) {
      if (typeof item.trackId === 'number' && typeof item.userRatingCount === 'number') ratings.set(item.trackId, item.userRatingCount);
    }
  }
  const vocab = buildVocabulary(corpus);
  const trackedTokens = new Set(trackedList.flatMap(tokenize));
  const baseProfile = isMedScan ? medScanProfile(trackedTokens) : genericProfile(trackedTokens);
  // Tracked brand keywords (e.g. «horos») must not make their brand generic.
  const profile: RelevanceProfile = { ...baseProfile, trackedTokens: new Set([...trackedTokens].filter((token) => {
    const kind = classifyToken(token, vocab, { ...baseProfile, trackedTokens: new Set() });
    return kind !== 'brand';
  })) };

  const localeSnapshots = new Map<string, { position: number | null; top5: Top5Row[] }>();
  for (const row of snapshotRows) {
    if (row.locale !== locale) continue;
    localeSnapshots.set(normalized(row.keyword), { position: row.position, top5: parseJson<Top5Row[]>(row.top5_json, []) });
  }
  const ourRankFor = (keyword: string) => localeSnapshots.get(keyword)?.position ?? null;

  const candidates = new Map<string, Candidate>();
  const rejected = new Map<string, string>();
  const fragments = new Set<string>();
  let trackedSkipped = 0;
  const consider = (phrase: string): Candidate | null => {
    const keyword = normalized(phrase);
    if (!keyword) return null;
    if (tracked.has(keyword)) { trackedSkipped++; return null; }
    const existing = candidates.get(keyword);
    if (existing) return existing;
    if (rejected.has(keyword)) return null;
    const assessment = assessCandidate(keyword, vocab, profile);
    if (!assessment.ok) { rejected.set(keyword, assessment.reason); return null; }
    const candidate: Candidate = { keyword, sources: new Set(), assessment, competitorApps: new Map(), competitorKeywords: new Map() };
    candidates.set(keyword, candidate);
    return candidate;
  };

  // 1. Competitor titles in the saved top-5 of tracked keywords.
  const competitorAppKeys = new Set<string>();
  for (const [keyword, snapshot] of localeSnapshots) {
    if (!tracked.has(keyword)) continue;
    for (const item of snapshot.top5) {
      const title = String(item.name || '');
      if (!title || isSelf(item)) continue;
      if (isMedScan && !isMedScanCompetitorEvidence(keyword, title, item.dev)) continue;
      const appKey = String(item.tid ?? item.id ?? title);
      competitorAppKeys.add(appKey);
      for (const segment of title.split(/\s[-–—|]\s|[:|–—]/g)) {
        const tokens = tokenize(segment);
        if (!tokens.length) continue;
        const phrases = new Set<string>();
        const raw = normalized(segment);
        phrases.add(raw);
        // Strip leading/trailing brand words: «Radiant DICOM Viewer» → «dicom viewer».
        const kinds = tokens.map((token) => classifyToken(token, vocab, profile));
        let start = 0;
        let end = tokens.length;
        while (start < end && (kinds[start] === 'brand' || kinds[start] === 'unknown')) start++;
        while (end > start && (kinds[end - 1] === 'brand' || kinds[end - 1] === 'unknown')) end--;
        if (end - start >= 1 && (start > 0 || end < tokens.length || /[&+]/.test(raw))) phrases.add(tokens.slice(start, end).join(' '));
        for (const phrase of phrases) {
          // A title fragment needs at least two meaningful words: «dental lite»
          // or «dental mobile app» are leftovers of «BoneBox – Dental Lite».
          const meaningful = tokenize(phrase).filter((token) => classifyToken(token, vocab, profile) !== 'modifier');
          if (meaningful.length < 2 && !candidates.has(normalized(phrase))) {
            if (!tracked.has(normalized(phrase))) fragments.add(normalized(phrase));
            continue;
          }
          const candidate = consider(phrase);
          if (!candidate) continue;
          candidate.sources.add('competitor_title');
          if (!candidate.competitorApps.has(appKey)) {
            candidate.competitorApps.set(appKey, title);
            candidate.competitorKeywords.set(keyword, (candidate.competitorKeywords.get(keyword) ?? 0) + 1);
          }
        }
      }
    }
  }

  // 2. Apple autocomplete for generic tracked seeds, strongest ranks first.
  const seeds = trackedList
    .filter((seed) => seed.length >= 3 && tokenize(seed).every((token) => {
      const kind = classifyToken(token, vocab, profile);
      return kind === 'generic' || kind === 'modifier';
    }))
    .sort((a, b) => (ourRankFor(a) ?? 999) - (ourRankFor(b) ?? 999) || a.length - b.length)
    .slice(0, 12);
  const hintGroups = await Promise.all(seeds.map((seed) => appleHints(seed, country)));
  let hintCount = 0;
  hintGroups.forEach((hints, seedIndex) => {
    const seed = seeds[seedIndex];
    hints.forEach((hint, index) => {
      hintCount++;
      if (hint === seed) return;
      const candidate = consider(hint);
      if (!candidate) return;
      candidate.sources.add('apple_autocomplete');
      if (!candidate.autocomplete) candidate.autocomplete = { index, total: hints.length, seed, seeds: 1 };
      else {
        candidate.autocomplete.seeds++;
        if (index < candidate.autocomplete.index) Object.assign(candidate.autocomplete, { index, total: hints.length, seed });
      }
    });
  });

  // 3. Apple Ads popularity (+ its keyword recommendations) when available.
  const prelim = Array.from(candidates.values())
    .sort((a, b) => (b.autocomplete ? 1 : 0) - (a.autocomplete ? 1 : 0) || b.competitorApps.size - a.competitorApps.size)
    .map((candidate) => candidate.keyword);
  const asa = app ? await asaTerms(app, country, [...prelim.slice(0, 80), ...seeds].slice(0, 100)) : null;
  let asaWithPopularity = 0;
  if (asa) {
    for (const row of asa) {
      let candidate = candidates.get(row.term);
      if (!candidate && row.origins.includes('apple-keyword-suggestion') && row.demandIndex != null) {
        candidate = consider(row.term) ?? undefined;
        candidate?.sources.add('asa_suggestion');
      }
      if (candidate && row.demandIndex != null) {
        candidate.asaPopularity = row.demandIndex;
        asaWithPopularity++;
      }
    }
  }

  const ideas: KeywordIdea[] = [];
  for (const candidate of candidates.values()) {
    if (!candidate.sources.size) continue;
    const origin: string[] = [];
    if (candidate.autocomplete) {
      const { index, total, seed, seeds: seedCount } = candidate.autocomplete;
      origin.push(`Подсказка Apple при вводе ${quote(seed)} — ${index + 1}-я из ${total}${seedCount > 1 ? `, встречается ещё в ${seedCount - 1} ${plural(seedCount - 1, 'подсказке', 'подсказках', 'подсказках')}` : ''}`);
    }
    if (candidate.competitorApps.size) {
      const n = candidate.competitorApps.size;
      const keywords = Array.from(candidate.competitorKeywords.entries()).sort((a, b) => b[1] - a[1]).map(([keyword]) => keyword);
      const example = Array.from(candidate.competitorApps.values())[0];
      origin.push(`В названии ${n} ${plural(n, 'конкурента', 'конкурентов', 'конкурентов')} из топ-5 по ${listQuoted(keywords)} — например, ${quote(example)}`);
    }
    if (candidate.sources.has('asa_suggestion')) origin.push('Рекомендация Apple Ads для этой страны');
    if (candidate.asaPopularity != null) origin.push(`Популярность Apple Ads: ${candidate.asaPopularity <= 5 ? '≤5 (низкий объём)' : candidate.asaPopularity} из 100`);

    // Exact-phrase evidence: an older snapshot, or a cached App Store search.
    let ourRank: GainInputs['ourRank'] = null;
    let topRatingsMedian: GainInputs['topRatingsMedian'] = null;
    const snapshot = localeSnapshots.get(candidate.keyword);
    const store = storeByTerm.get(candidate.keyword);
    if (snapshot) ourRank = { rank: snapshot.position, depth: 200, source: 'сохранённый снимок' };
    else if (store) {
      const index = store.findIndex((row) => isSelf(row));
      ourRank = { rank: index >= 0 ? index + 1 : null, depth: store.length, source: 'кэш поиска App Store' };
    }
    const topTids = (store ?? []).slice(0, 5).map((row) => row.trackId)
      .concat((snapshot?.top5 ?? []).map((row) => row.tid))
      .filter((tid): tid is number => typeof tid === 'number' && tid !== selfTid);
    const topRatings = Array.from(new Set(topTids)).slice(0, 5).map((tid) => ratings.get(tid)).filter((value): value is number => typeof value === 'number');
    if (topRatings.length >= 3) topRatingsMedian = { value: median(topRatings), apps: topRatings.length };

    let seedRank: GainInputs['seedRank'] = null;
    if (candidate.autocomplete) seedRank = { rank: ourRankFor(candidate.autocomplete.seed), seed: candidate.autocomplete.seed };
    else if (candidate.competitorKeywords.size) {
      const best = Array.from(candidate.competitorKeywords.keys())
        .map((keyword) => ({ keyword, rank: ourRankFor(keyword) }))
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0];
      seedRank = { rank: best.rank, seed: best.keyword };
    } else {
      const related = trackedList.filter((keyword) => candidate.keyword.includes(keyword))
        .sort((a, b) => b.length - a.length)[0];
      if (related) seedRank = { rank: ourRankFor(related), seed: related };
    }

    const gain = estimateGain({
      asaPopularity: candidate.asaPopularity,
      autocomplete: candidate.autocomplete,
      competitorApps: candidate.competitorApps.size,
      ourRank,
      seedRank,
      topRatingsMedian,
      exactAppTitle: vocab.titles.get(candidate.keyword) ?? null,
    });
    const sources = Array.from(candidate.sources);
    const primary: IdeaSource = candidate.sources.has('apple_autocomplete')
      ? 'apple_autocomplete'
      : candidate.sources.has('asa_suggestion') ? 'asa_suggestion' : 'competitor_title';
    ideas.push({
      keyword: candidate.keyword,
      source: primary,
      sources,
      origin,
      reason: candidate.assessment.reason,
      cluster: candidate.assessment.cluster,
      ...gain,
    });
  }

  for (const fragment of fragments) {
    if (!candidates.has(fragment) && !rejected.has(fragment)) rejected.set(fragment, 'обрывок названия: одно значимое слово');
  }
  ideas.sort((a, b) => b.score - a.score || b.demand - a.demand || a.keyword.localeCompare(b.keyword));
  const value: KeywordSuggestionsResponse = {
    locale,
    generatedAt: new Date().toISOString(),
    formula: GAIN_FORMULA,
    signals: {
      appleAutocomplete: hintCount > 0 ? 'ok' : 'empty',
      asaPopularity: asa == null ? 'unavailable' : asaWithPopularity > 0 ? 'ok' : 'no-data',
      competitorApps: competitorAppKeys.size,
    },
    ideas: ideas.slice(0, 80),
    rejected: Array.from(rejected, ([keyword, reason]) => ({ keyword, reason })).slice(0, 60),
    trackedSkipped,
  };
  return value;
}
