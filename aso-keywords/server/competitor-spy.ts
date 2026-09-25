import type { Express, Request, Response } from 'express';
import { db } from './db.js';
import { assertSafeAppId, loadApps, loadKeywords, saveKeywords, type AppConfig } from './config.js';
import { searchItunes, type SearchResult } from './itunes.js';
import { asaPopularity, normalized, tokenize } from './suggestions.js';

// Competitor spy: reverse keyword lookup + gap analysis for one competitor in
// one storefront. Everything is built from App Store result sets we actually
// fetched (crowd-sourced across all our apps, like Astro): nothing here is a
// private competitor metric. Each row says how deep the result set it comes
// from was, so "not found" is never confused with "not checked".

db.exec(`
  -- Full-depth (up to 200) App Store result sets fetched by the spy.
  -- store_search_cache keeps only 15 results; snapshots only the top 5.
  CREATE TABLE IF NOT EXISTS competitor_spy_serp (
    country    TEXT NOT NULL,
    term       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (country, term)
  );
`);

// --- Pure scoring (spec section 4) ------------------------------------------

export interface StrengthInput {
  ratings: number | null;
  exactInTitle: boolean;
  /** Days since the last version update, when known. */
  updatedDaysAgo: number | null;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** S = 0.6·norm(log10(ratings+1), 0..6) + 0.25·exact_in_title + 0.15·(updated<90d).
 * Unknown ratings/update date count as a neutral 0.5 of their weight. */
export function appStrength(input: StrengthInput): number {
  const ratings = input.ratings == null ? 0.5 : clamp01(Math.log10(Math.max(0, input.ratings) + 1) / 6);
  const recent = input.updatedDaysAgo == null ? 0.5 : input.updatedDaysAgo < 90 ? 1 : 0;
  return 0.6 * ratings + 0.25 * (input.exactInTitle ? 1 : 0) + 0.15 * recent;
}

/** D = 100 · Σ w_i·S_i / Σ w_i over the top 10, w_i = 1/√i. Needs at least
 * three apps with a known rating count, otherwise the estimate is refused. */
export function difficulty(top: StrengthInput[]): number | null {
  const apps = top.slice(0, 10);
  if (apps.filter((app) => app.ratings != null).length < 3) return null;
  let sum = 0;
  let weights = 0;
  apps.forEach((app, index) => {
    const weight = 1 / Math.sqrt(index + 1);
    sum += weight * appStrength(app);
    weights += weight;
  });
  return weights ? Math.round((100 * sum) / weights) : null;
}

/** C = 100 / (1 + e^{(D − A)/12}), A = our strength on the same 0–100 scale. */
export function chance(difficultyValue: number | null, ourStrength: number): number | null {
  if (difficultyValue == null) return null;
  return Math.round(100 / (1 + Math.exp((difficultyValue - ourStrength) / 12)));
}

/** R = 1 when we are already top-3, 0.5 when top-10, else 0. */
export function rankSaturation(ourRank: number | null): number {
  if (ourRank == null) return 0;
  if (ourRank <= 3) return 1;
  if (ourRank <= 10) return 0.5;
  return 0;
}

/** O = Pop × C/100 × (1 − R). Unknown popularity → no Opportunity (never 0);
 * unknown chance is assumed 50 and flagged by the caller. */
export function opportunity(popularity: number | null, chanceValue: number | null, ourRank: number | null): number | null {
  if (popularity == null) return null;
  const c = chanceValue ?? 50;
  return Math.round(popularity * (c / 100) * (1 - rankSaturation(ourRank)) * 10) / 10;
}

export type GapClass = 'theirs' | 'shared' | 'ours' | 'none';
export interface RankEvidence { rank: number | null; depth: number }

/** Ranks within `limit`? `unknown` when the result set is shallower than the
 * limit and the app was not in it. */
export function presence(evidence: RankEvidence | null, limit: number): 'in' | 'out' | 'unknown' {
  if (!evidence) return 'unknown';
  if (evidence.rank != null) return evidence.rank <= limit ? 'in' : 'out';
  return evidence.depth >= limit ? 'out' : 'unknown';
}

/** Venn class for one keyword. Unknown presence is treated as absent but
 * reported as `uncertain` so the UI can say "not checked deeper than top-N". */
export function classifyGap(their: RankEvidence | null, ours: RankEvidence | null, limit: number): { gap: GapClass; uncertain: boolean } {
  const t = presence(their, limit);
  const o = presence(ours, limit);
  const gap: GapClass = t === 'in' && o === 'in' ? 'shared' : t === 'in' ? 'theirs' : o === 'in' ? 'ours' : 'none';
  const uncertain = (gap === 'theirs' && o === 'unknown') || (gap === 'ours' && t === 'unknown');
  return { gap, uncertain };
}

/** Rows with Opportunity first (desc), then by chance·(1−R), then their rank. */
export function compareByOpportunity(a: SpyRow, b: SpyRow): number {
  if (a.opportunity != null || b.opportunity != null) {
    if (a.opportunity == null) return 1;
    if (b.opportunity == null) return -1;
    if (b.opportunity !== a.opportunity) return b.opportunity - a.opportunity;
  }
  const proxy = (row: SpyRow) => (row.chance ?? 50) * (1 - rankSaturation(row.ourRank));
  return proxy(b) - proxy(a) || (a.theirRank ?? 999) - (b.theirRank ?? 999) || a.keyword.localeCompare(b.keyword);
}

// --- Text helpers ---------------------------------------------------------------

const STOP = new Set([
  'the', 'and', 'for', 'with', 'your', 'my', 'of', 'on', 'in', 'to', 'a', 'an', 'by', 'at', 'or', 'app', 'apps',
  'de', 'la', 'el', 'para', 'di', 'per', 'und', 'für', 'et', 'pour', 'le', 'les', 'des', 'do', 'da', 'y', 'e', 'o', 'u', 'i',
  'и', 'с', 'в', 'для', 'на',
]);

/** Whole-phrase match on word boundaries: «dicom viewer» ⊂ «IDV - IMAIOS DICOM Viewer». */
export function containsPhrase(text: string | null | undefined, phrase: string): boolean {
  if (!text) return false;
  const haystack = ` ${tokenize(text).join(' ')} `;
  const needle = tokenize(phrase).join(' ');
  return Boolean(needle) && haystack.includes(` ${needle} `);
}

/** Every word of the keyword appears somewhere in the field (not necessarily adjacent). */
function containsAllWords(text: string | null | undefined, phrase: string): boolean {
  if (!text) return false;
  const words = new Set(tokenize(text));
  const needle = tokenize(phrase).filter((token) => !STOP.has(token));
  return needle.length > 0 && needle.every((token) => words.has(token));
}

/** Untracked query candidates from a competitor's title and subtitle: 1–3-word
 * n-grams inside each segment; brand words (developer name) are ranked last. */
export function candidatePhrases(title: string, subtitle: string | null, developer: string): string[] {
  const brand = new Set(tokenize(developer).filter((token) => token.length > 2));
  const out = new Map<string, number>();
  for (const field of [title, subtitle ?? '']) {
    for (const segment of field.split(/\s[-–—|]\s|[:|–—,·&+/()]/g)) {
      const tokens = tokenize(segment);
      for (let n = 1; n <= 3; n++) {
        for (let i = 0; i + n <= tokens.length; i++) {
          const gram = tokens.slice(i, i + n);
          if (STOP.has(gram[0]) || STOP.has(gram[gram.length - 1])) continue;
          if (gram.every((token) => token.length < 2)) continue;
          const phrase = gram.join(' ');
          if (phrase.length < 3) continue;
          const branded = gram.some((token) => brand.has(token));
          // 2-grams first, then 3-grams, then single words; brand phrases last.
          const rank = (branded ? 10 : 0) + (n === 2 ? 0 : n === 3 ? 1 : 2);
          out.set(phrase, Math.min(out.get(phrase) ?? 99, rank));
        }
      }
    }
  }
  return [...out.entries()].sort((a, b) => a[1] - b[1]).map(([phrase]) => phrase);
}

// --- App metadata (lookup + product page subtitle) ------------------------------

export interface SpyAppMeta {
  trackId: number | null;
  bundleId: string;
  name: string;
  subtitle: string | null;
  developer: string;
  iconUrl: string | null;
  ratings: number | null;
  rating: number | null;
  updatedAt: string | null;
  storeUrl: string | null;
}

const metaCache = new Map<string, { expiresAt: number; value: SpyAppMeta | null }>();

export async function productPageSubtitle(trackId: number, country: string, genre: string | undefined): Promise<string | null> {
  try {
    const response = await fetch(`https://apps.apple.com/${country}/app/id${trackId}`, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;
    const payload = JSON.parse(match[1]) as { data?: Array<{ data?: { lockup?: { subtitle?: string; adamId?: string } } }> };
    const lockup = payload.data?.[0]?.data?.lockup;
    const subtitle = lockup?.subtitle?.trim();
    // Without a subtitle Apple shows the category in the same slot.
    if (!subtitle || (genre && subtitle.toLocaleLowerCase() === genre.toLocaleLowerCase())) return null;
    return subtitle;
  } catch {
    return null;
  }
}

export async function appMeta(idOrBundle: string, country: string): Promise<SpyAppMeta | null> {
  const key = `${country}:${idOrBundle.toLocaleLowerCase()}`;
  const cached = metaCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const params = new URLSearchParams({ country });
  if (/^\d+$/.test(idOrBundle)) params.set('id', idOrBundle); else params.set('bundleId', idOrBundle);
  let value: SpyAppMeta | null = null;
  try {
    const response = await fetch(`https://itunes.apple.com/lookup?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (response.ok) {
      const data = (await response.json()) as { results?: Array<SearchResult & { currentVersionReleaseDate?: string }> };
      const item = data.results?.[0];
      if (item?.trackId) {
        value = {
          trackId: item.trackId,
          bundleId: item.bundleId ?? idOrBundle,
          name: item.trackName ?? '',
          subtitle: await productPageSubtitle(item.trackId, country, item.primaryGenreName),
          developer: item.artistName ?? '',
          iconUrl: item.artworkUrl100 ?? null,
          ratings: item.userRatingCount ?? null,
          rating: item.averageUserRating ?? null,
          updatedAt: item.currentVersionReleaseDate ?? null,
          storeUrl: item.trackViewUrl ?? null,
        };
      }
    }
  } catch {/* lookup is best-effort; the caller degrades to snapshot names */}
  metaCache.set(key, { expiresAt: Date.now() + (value ? 12 * 60 * 60_000 : 5 * 60_000), value });
  return value;
}

// --- Evidence: which result sets exist for this storefront ------------------------

interface SerpApp { tid: number | null; id: string; name: string; dev: string; ratings: number | null; updatedAt: string | null }
interface Serp { term: string; apps: SerpApp[]; depth: number; source: 'full' | 'cache' | 'snapshot'; checkedAt: string }

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

const isQueryTerm = (term: string) => !/^\d+$/.test(term) && !(/^[\w.-]+$/.test(term) && term.includes('.'));
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Best result set per term: full spy fetch (200) > App Store search cache (15) > snapshot top-5. */
function storefrontSerps(storefront: string): Map<string, Serp> {
  const country = storefront.split('-')[0].toLowerCase();
  const out = new Map<string, Serp>();
  const put = (serp: Serp) => {
    const current = out.get(serp.term);
    if (!current || serp.depth > current.depth || (serp.depth === current.depth && serp.checkedAt > current.checkedAt)) out.set(serp.term, serp);
  };

  const snapshotRows = db.prepare(`
    SELECT s.keyword, s.date, s.top5_json
      FROM snapshots s
      JOIN (SELECT keyword, MAX(id) AS id FROM snapshots
             WHERE locale = ? AND top5_json IS NOT NULL AND error IS NULL
          GROUP BY keyword) latest ON latest.id = s.id
  `).all(storefront) as Array<{ keyword: string; date: string; top5_json: string }>;
  for (const row of snapshotRows) {
    const apps = parseJson<Array<{ name?: string; id?: string; dev?: string; tid?: number }>>(row.top5_json, []);
    if (!apps.length) continue;
    put({
      term: normalized(row.keyword),
      apps: apps.map((app) => ({ tid: app.tid ?? null, id: app.id ?? '', name: app.name ?? '', dev: app.dev ?? '', ratings: null, updatedAt: null })),
      depth: apps.length,
      source: 'snapshot',
      checkedAt: row.date,
    });
  }

  const cacheRows = db.prepare('SELECT term, payload, fetched_at FROM store_search_cache WHERE country = ?').all(country) as Array<{ term: string; payload: string; fetched_at: number }>;
  for (const row of cacheRows) {
    if (!isQueryTerm(row.term)) continue;
    const apps = parseJson<Array<SearchResult>>(row.payload, []);
    if (!Array.isArray(apps) || !apps.length) continue;
    put({
      term: normalized(row.term),
      apps: apps.map((app) => ({ tid: app.trackId ?? null, id: app.bundleId ?? '', name: app.trackName ?? '', dev: app.artistName ?? '', ratings: app.userRatingCount ?? null, updatedAt: null })),
      depth: apps.length,
      source: 'cache',
      checkedAt: isoDate(row.fetched_at),
    });
  }

  const fullRows = db.prepare('SELECT term, payload, fetched_at FROM competitor_spy_serp WHERE country = ?').all(country) as Array<{ term: string; payload: string; fetched_at: number }>;
  for (const row of fullRows) {
    const apps = parseJson<SerpApp[]>(row.payload, []);
    // An empty full result set is still evidence: nobody ranks for it.
    put({ term: normalized(row.term), apps, depth: Math.max(apps.length, 200), source: 'full', checkedAt: isoDate(row.fetched_at) });
  }
  return out;
}

function matches(app: SerpApp, target: { trackId: number | null; bundleId: string }, prefix = false): boolean {
  if (target.trackId != null && app.tid === target.trackId) return true;
  const id = app.id.toLocaleLowerCase();
  const bundle = target.bundleId.toLocaleLowerCase();
  return Boolean(bundle && id && (id === bundle || (prefix && id.startsWith(bundle))));
}

function rankIn(serp: Serp, target: { trackId: number | null; bundleId: string }, prefix = false): RankEvidence {
  const index = serp.apps.findIndex((app) => matches(app, target, prefix));
  return { rank: index < 0 ? null : index + 1, depth: serp.depth };
}

// --- Apple Ads popularity (optional) ------------------------------------------

/** Popularity from the Ads service's per-day store (one 5–100 scale). Values
 * still being fetched count as unknown — never cached here as null. */
async function popularityFor(app: AppConfig, country: string, terms: string[]): Promise<{ values: Map<string, number | null>; status: 'ok' | 'no-data' | 'unavailable' }> {
  const values = new Map<string, number | null>();
  if (!terms.length) return { values, status: 'no-data' };
  const result = await asaPopularity(app, country, terms, 6_000);
  if (!result) return { values, status: 'unavailable' };
  for (const term of terms) values.set(term, result.values.get(normalized(term))?.popularity ?? null);
  const known = [...values.values()].filter((value) => value != null).length;
  return { values, status: known ? 'ok' : 'no-data' };
}

// --- Report -------------------------------------------------------------------

export interface SpyRow {
  keyword: string;
  theirRank: number | null;
  theirDepth: number;
  ourRank: number | null;
  ourDepth: number;
  source: Serp['source'];
  checkedAt: string;
  /** Tracked by the current app in this storefront. */
  tracked: boolean;
  /** Other own apps that track the phrase here (crowd pool). */
  trackedBy: string[];
  popularity: number | null;
  difficulty: number | null;
  chance: number | null;
  opportunity: number | null;
  inTheirTitle: boolean;
  inTheirSubtitle: boolean;
  /** Every word present in title+subtitle, even if not adjacent. */
  wordsInTheirMeta: boolean;
  inOurTitle: boolean;
  gap: GapClass;
  uncertain: boolean;
}

export interface SpyReport {
  storefront: string;
  limit: number;
  generatedAt: string;
  competitor: SpyAppMeta;
  ours: SpyAppMeta | null;
  ourStrength: number;
  coverage: { checked: number; found: number; full: number; cache: number; snapshot: number; trackedUnchecked: number };
  popularity: 'ok' | 'no-data' | 'unavailable';
  counts: Record<Exclude<GapClass, 'none'>, number>;
  rows: SpyRow[];
  candidates: string[];
  formula: string[];
}

export const SPY_FORMULA = [
  'Сила приложения S = 0,6·(log10(оценок+1)/6) + 0,25·(ключ точно в названии) + 0,15·(обновление < 90 дней); неизвестное = 0,5 доли.',
  'Difficulty D = 100·Σ wᵢ·Sᵢ / Σ wᵢ по топ-10 выдачи, wᵢ = 1/√i. Нужны оценки минимум у 3 приложений.',
  'Chance C = 100 / (1 + e^((D − A)/12)), A — сила нашего приложения по тем же правилам.',
  'Opportunity O = Popularity × C/100 × (1 − R); R = 1 при нашей позиции в топ-3, 0,5 — в топ-10, иначе 0. Нет популярности Apple Ads — нет Opportunity.',
];

function daysAgo(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor((Date.now() - ms) / 86_400_000) : null;
}

function trackedPool(storefront: string): Map<string, string[]> {
  const pool = new Map<string, string[]>();
  for (const app of loadApps()) {
    for (const keyword of loadKeywords(app.id)[storefront] ?? []) {
      const term = normalized(keyword);
      pool.set(term, [...(pool.get(term) ?? []), app.id]);
    }
  }
  return pool;
}

export async function competitorSpyReport(appId: string, competitorRef: string, storefront: string, limit = 10): Promise<SpyReport> {
  const app = loadApps().find((item) => item.id === appId);
  if (!app) throw new Error(`unknown app ${appId}`);
  const country = storefront.split('-')[0].toLowerCase();
  const [competitor, ours] = await Promise.all([appMeta(competitorRef, country), appMeta(app.iTunesId || app.bundle, country)]);
  const target = competitor ?? { trackId: null, bundleId: competitorRef, name: competitorRef, subtitle: null, developer: '', iconUrl: null, ratings: null, rating: null, updatedAt: null, storeUrl: null };
  const self = { trackId: Number(app.iTunesId) || null, bundleId: app.bundle };

  const serps = storefrontSerps(storefront);
  const pool = trackedPool(storefront);

  // App facts (ratings, update date) known anywhere, to score top-5-only sets.
  const facts = new Map<number, { ratings: number | null; updatedAt: string | null }>();
  for (const serp of serps.values()) {
    for (const item of serp.apps) {
      if (item.tid == null) continue;
      const current = facts.get(item.tid);
      facts.set(item.tid, { ratings: item.ratings ?? current?.ratings ?? null, updatedAt: item.updatedAt ?? current?.updatedAt ?? null });
    }
  }
  for (const meta of [competitor, ours]) if (meta?.trackId) facts.set(meta.trackId, { ratings: meta.ratings, updatedAt: meta.updatedAt });

  // Our current position from the app's own snapshots (full 200 depth).
  const ownSnapshots = new Map<string, { position: number | null; total: number | null }>();
  for (const row of db.prepare(`
    SELECT s.keyword, s.position, s.total FROM snapshots s
      JOIN (SELECT keyword, MAX(id) AS id FROM snapshots WHERE app = ? AND locale = ? AND error IS NULL GROUP BY keyword) l ON l.id = s.id
  `).all(appId, storefront) as Array<{ keyword: string; position: number | null; total: number | null }>) {
    ownSnapshots.set(normalized(row.keyword), { position: row.position, total: row.total });
  }

  const ourTitle = ours?.name ?? app.name;
  const rowsBase: Array<Omit<SpyRow, 'popularity' | 'opportunity' | 'gap' | 'uncertain'>> = [];
  const coverage = { checked: serps.size, found: 0, full: 0, cache: 0, snapshot: 0, trackedUnchecked: 0 };
  for (const serp of serps.values()) {
    coverage[serp.source]++;
    const their = rankIn(serp, target);
    if (their.rank != null) coverage.found++;
    const own = ownSnapshots.get(serp.term);
    const ourEvidence: RankEvidence = own ? { rank: own.position, depth: Math.max(own.total ?? 0, 200) } : rankIn(serp, self, true);
    const top: StrengthInput[] = serp.apps.slice(0, 10).map((item) => {
      const fact = item.tid != null ? facts.get(item.tid) : undefined;
      return { ratings: item.ratings ?? fact?.ratings ?? null, exactInTitle: containsPhrase(item.name, serp.term), updatedDaysAgo: daysAgo(item.updatedAt ?? fact?.updatedAt) };
    });
    const d = difficulty(top);
    const ourStrength = 100 * appStrength({ ratings: ours?.ratings ?? null, exactInTitle: containsPhrase(ourTitle, serp.term), updatedDaysAgo: daysAgo(ours?.updatedAt) });
    rowsBase.push({
      keyword: serp.term,
      theirRank: their.rank,
      theirDepth: their.depth,
      ourRank: ourEvidence.rank,
      ourDepth: ourEvidence.depth,
      source: serp.source,
      checkedAt: serp.checkedAt,
      tracked: (pool.get(serp.term) ?? []).includes(appId),
      trackedBy: (pool.get(serp.term) ?? []).filter((id) => id !== appId),
      difficulty: d,
      chance: chance(d, ourStrength),
      inTheirTitle: containsPhrase(target.name, serp.term),
      inTheirSubtitle: containsPhrase(target.subtitle, serp.term),
      wordsInTheirMeta: containsAllWords(`${target.name} ${target.subtitle ?? ''}`, serp.term),
      inOurTitle: containsPhrase(ourTitle, serp.term),
    });
  }
  for (const term of pool.keys()) if (!serps.has(term)) coverage.trackedUnchecked++;

  // Popularity only for rows that can show up anywhere in the report.
  const interesting = rowsBase.filter((row) => row.theirRank != null || (row.ourRank != null && row.ourRank <= Math.max(limit, 10)));
  const pop = await popularityFor(app, country, interesting.map((row) => row.keyword));

  const rows: SpyRow[] = [];
  const counts = { theirs: 0, shared: 0, ours: 0 };
  for (const row of rowsBase) {
    const { gap, uncertain } = classifyGap({ rank: row.theirRank, depth: row.theirDepth }, { rank: row.ourRank, depth: row.ourDepth }, limit);
    if (gap === 'none' && row.theirRank == null) continue;
    if (gap !== 'none') counts[gap]++;
    const popularity = pop.values.get(row.keyword) ?? null;
    rows.push({ ...row, popularity, opportunity: opportunity(popularity, row.chance, row.ourRank), gap, uncertain });
  }
  rows.sort(compareByOpportunity);

  const checked = new Set(serps.keys());
  const candidates = candidatePhrases(target.name, target.subtitle, target.developer)
    .filter((phrase) => !checked.has(phrase))
    .concat([...pool.keys()].filter((term) => !checked.has(term)))
    // Then re-check shallow sets (top-5/top-15) where the competitor shows up
    // or where the gap class is uncertain, to full depth.
    .concat(rows.filter((row) => row.source !== 'full' && (row.uncertain || row.theirRank != null)).map((row) => row.keyword))
    .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 120);

  return {
    storefront,
    limit,
    generatedAt: new Date().toISOString(),
    competitor: target,
    ours,
    ourStrength: Math.round(100 * appStrength({ ratings: ours?.ratings ?? null, exactInTitle: false, updatedDaysAgo: daysAgo(ours?.updatedAt) })),
    coverage,
    popularity: pop.status,
    counts,
    rows,
    candidates,
    formula: SPY_FORMULA,
  };
}

// --- Difficulty / Chance for the positions table ----------------------------------

export interface KeywordDifficulty {
  difficulty: number | null;
  chance: number | null;
  /** Result set depth the estimate is based on and where it came from. */
  depth: number;
  source: Serp['source'] | null;
  checkedAt: string | null;
}

/** Difficulty and Chance (spec §4) for our own tracked keywords in one
 * storefront, from the same best-available result sets and app facts the spy
 * report uses. `ourStrength` is A on the 0–100 scale (exact-title counted per keyword). */
export async function keywordDifficulty(appId: string, storefront: string, keywords: string[]): Promise<{ ourStrength: number; rows: Map<string, KeywordDifficulty> }> {
  const app = loadApps().find((item) => item.id === appId);
  if (!app) throw new Error(`unknown app ${appId}`);
  const country = storefront.split('-')[0].toLowerCase();
  const ours = await appMeta(app.iTunesId || app.bundle, country).catch(() => null);
  const serps = storefrontSerps(storefront);
  const facts = new Map<number, { ratings: number | null; updatedAt: string | null }>();
  for (const serp of serps.values()) {
    for (const item of serp.apps) {
      if (item.tid == null) continue;
      const current = facts.get(item.tid);
      facts.set(item.tid, { ratings: item.ratings ?? current?.ratings ?? null, updatedAt: item.updatedAt ?? current?.updatedAt ?? null });
    }
  }
  if (ours?.trackId) facts.set(ours.trackId, { ratings: ours.ratings, updatedAt: ours.updatedAt });
  const ourTitle = ours?.name ?? app.name;
  const rows = new Map<string, KeywordDifficulty>();
  for (const keyword of keywords) {
    const term = normalized(keyword);
    const serp = serps.get(term);
    if (!serp) { rows.set(term, { difficulty: null, chance: null, depth: 0, source: null, checkedAt: null }); continue; }
    const top: StrengthInput[] = serp.apps.slice(0, 10).map((item) => {
      const fact = item.tid != null ? facts.get(item.tid) : undefined;
      return { ratings: item.ratings ?? fact?.ratings ?? null, exactInTitle: containsPhrase(item.name, serp.term), updatedDaysAgo: daysAgo(item.updatedAt ?? fact?.updatedAt) };
    });
    const d = difficulty(top);
    const a = 100 * appStrength({ ratings: ours?.ratings ?? null, exactInTitle: containsPhrase(ourTitle, term), updatedDaysAgo: daysAgo(ours?.updatedAt) });
    rows.set(term, { difficulty: d, chance: chance(d, a), depth: serp.depth, source: serp.source, checkedAt: serp.checkedAt });
  }
  return {
    ourStrength: Math.round(100 * appStrength({ ratings: ours?.ratings ?? null, exactInTitle: false, updatedDaysAgo: daysAgo(ours?.updatedAt) })),
    rows,
  };
}

// --- Fresh App Store checks (rate-limited background job) -------------------------

export interface SpyCheckJob {
  id: string;
  storefront: string;
  terms: string[];
  done: number;
  current: string | null;
  status: 'running' | 'done' | 'error' | 'aborted';
  error: string | null;
  note: string | null;
  startedAt: string;
}

const jobs = new Map<string, SpyCheckJob>();
let activeJob: SpyCheckJob | null = null;

function saveFullSerp(country: string, term: string, results: SearchResult[]) {
  const apps: SerpApp[] = results.slice(0, 200).map((item) => ({
    tid: item.trackId ?? null,
    id: item.bundleId ?? '',
    name: item.trackName ?? '',
    dev: item.artistName ?? '',
    ratings: item.userRatingCount ?? null,
    updatedAt: (item as SearchResult & { currentVersionReleaseDate?: string }).currentVersionReleaseDate ?? null,
  }));
  db.prepare(`
    INSERT INTO competitor_spy_serp (country, term, payload, fetched_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(country, term) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
  `).run(country, term, JSON.stringify(apps), Date.now());
}

export function startSpyCheck(storefront: string, rawTerms: string[]): SpyCheckJob {
  if (activeJob?.status === 'running') return activeJob;
  const terms = Array.from(new Set(rawTerms.map(normalized).filter((term) => term && isQueryTerm(term)))).slice(0, 50);
  const job: SpyCheckJob = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    storefront,
    terms,
    done: 0,
    current: null,
    status: 'running',
    error: null,
    note: null,
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  activeJob = job;
  const country = storefront.split('-')[0].toLowerCase();
  void (async () => {
    try {
      for (const term of terms) {
        if (job.status !== 'running') return;
        job.current = term;
        job.note = null;
        // searchItunes shares the global gate with snapshots (≈18 requests/min).
        const results = await searchItunes(storefront, term, {
          onRetry: ({ delayMs, reason }) => { job.note = `${reason}; повтор через ${Math.round(delayMs / 1000)} с`; },
        });
        saveFullSerp(country, term, results);
        job.done++;
      }
      job.status = 'done';
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      job.current = null;
      if (activeJob === job) activeJob = null;
    }
  })();
  return job;
}

// --- Routes -------------------------------------------------------------------

function storefrontParam(value: unknown): string | null {
  const storefront = String(value ?? '').trim().toLowerCase();
  return /^[a-z]{2}(-[a-z]{2,4})?$/.test(storefront) ? storefront : null;
}

export function registerCompetitorSpyRoutes(app: Express) {
  app.get('/api/apps/:id/competitor-spy', async (req: Request, res: Response) => {
    const storefront = storefrontParam(req.query.storefront);
    const competitor = String(req.query.competitor ?? '').trim();
    const limit = [10, 30, 100, 200].includes(Number(req.query.limit)) ? Number(req.query.limit) : 10;
    if (!storefront || !competitor) { res.status(400).json({ error: 'storefront and competitor required' }); return; }
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await competitorSpyReport(String(req.params.id), competitor, storefront, limit));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/competitor-spy/check', (req: Request, res: Response) => {
    const storefront = storefrontParam(req.body?.storefront);
    const terms = Array.isArray(req.body?.terms) ? (req.body.terms as unknown[]).map(String) : [];
    if (!storefront || !terms.length) { res.status(400).json({ error: 'storefront and terms required' }); return; }
    res.json(startSpyCheck(storefront, terms));
  });

  app.get('/api/competitor-spy/check/:jobId', (req: Request, res: Response) => {
    const job = jobs.get(String(req.params.jobId));
    if (!job) { res.status(404).json({ error: 'job not found' }); return; }
    res.set('Cache-Control', 'no-store');
    res.json(job);
  });

  app.post('/api/competitor-spy/check/:jobId/abort', (req: Request, res: Response) => {
    const job = jobs.get(String(req.params.jobId));
    if (job?.status === 'running') job.status = 'aborted';
    res.json(job ?? null);
  });

  /** Append keywords to several storefronts in one write (server-side merge,
   * so a stale client map can never drop keywords). */
  app.post('/api/apps/:id/competitor-spy/track', (req: Request, res: Response) => {
    const appId = assertSafeAppId(req.params.id);
    const keywords = Array.isArray(req.body?.keywords) ? (req.body.keywords as unknown[]).map((value) => String(value).trim()).filter(Boolean) : [];
    const storefronts = Array.isArray(req.body?.storefronts) ? (req.body.storefronts as unknown[]).map(storefrontParam).filter((value): value is string => Boolean(value)) : [];
    if (!keywords.length || !storefronts.length) { res.status(400).json({ error: 'keywords and storefronts required' }); return; }
    const map = loadKeywords(appId);
    let added = 0;
    for (const storefront of storefronts) {
      const current = map[storefront] ?? [];
      const seen = new Set(current.map(normalized));
      const additions = keywords.filter((keyword) => !seen.has(normalized(keyword)));
      added += additions.length;
      map[storefront] = [...current, ...additions];
    }
    saveKeywords(appId, map);
    res.json({ added, keywords: map });
  });
}
