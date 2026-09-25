// Country navigation: storefront table (shared with the server), matrix and
// per-app country sets. Kept apart from api.ts so parallel work there never collides.
import { STOREFRONTS, LOCALE_NAMES, storefrontOf, searchStorefronts, type Storefront, type CountryPreset } from '../server/storefronts';
import type { MatrixCell, MatrixResponse, CountrySet, CountrySets, CountrySetsResponse } from '../server/countries-types';

export { STOREFRONTS, LOCALE_NAMES, storefrontOf, searchStorefronts };
export type { Storefront, CountryPreset, MatrixCell, MatrixResponse, CountrySet, CountrySets, CountrySetsResponse };

const json = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
};

export const countriesApi = {
  matrix: (appId: string, locales?: string[], signal?: AbortSignal) =>
    fetch(`/api/apps/${appId}/matrix${locales?.length ? `?locales=${locales.join(',')}` : ''}`, { cache: 'no-store', signal })
      .then((r) => json<MatrixResponse>(r)),
  countrySets: (appId: string) =>
    fetch(`/api/apps/${appId}/country-sets`, { cache: 'no-store' }).then((r) => json<CountrySetsResponse>(r)),
  saveCountrySets: (appId: string, sets: CountrySets) =>
    fetch(`/api/apps/${appId}/country-sets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sets),
    }).then((r) => json<CountrySetsResponse>(r)),
};

/** Built-in column sets of the matrix (not stored): favorites, top by keywords, everything. */
export const SET_FAVORITES = 'fav';
export const SET_TOP = 'top';
export const SET_ALL = 'all';
export const TOP_COLUMNS = 12;

export interface ColumnSetOption {
  id: string;
  name: string;
  hint: string;
  locales: string[];
  kind: 'builtin' | 'preset' | 'user';
}

/** Every column set the matrix can show for an app, in menu order. */
export function columnSets(sets: CountrySetsResponse | null, keywordMap: Record<string, string[]>): ColumnSetOption[] {
  const tracked = Object.keys(keywordMap).map((code) => code.toLowerCase());
  const trackedSet = new Set(tracked);
  const byCount = [...tracked].sort((a, b) => (keywordMap[b]?.length ?? 0) - (keywordMap[a]?.length ?? 0) || a.localeCompare(b));
  const favorites = (sets?.favorites ?? []).filter((code) => trackedSet.has(code));
  const out: ColumnSetOption[] = [];
  if (favorites.length) out.push({ id: SET_FAVORITES, name: 'Избранные', hint: `${favorites.length} стран`, locales: favorites, kind: 'builtin' });
  out.push({ id: SET_TOP, name: `Топ-${Math.min(TOP_COLUMNS, tracked.length)} по ключам`, hint: 'больше всего ключей', locales: byCount.slice(0, TOP_COLUMNS), kind: 'builtin' });
  out.push({ id: SET_ALL, name: 'Все страны', hint: `${tracked.length} витрин`, locales: [...tracked].sort((a, b) => storefrontOf(a).name.localeCompare(storefrontOf(b).name, 'ru')), kind: 'builtin' });
  for (const preset of sets?.presets ?? []) out.push({ id: preset.id, name: preset.name, hint: preset.hint, locales: preset.locales, kind: 'preset' });
  for (const set of sets?.sets ?? []) {
    const locales = set.locales.filter((code) => trackedSet.has(code));
    if (locales.length) out.push({ id: set.id, name: set.name, hint: `${locales.length} стран`, locales, kind: 'user' });
  }
  return out;
}

/** Default matrix columns: favorites when there are any, otherwise the top storefronts by tracked keywords. */
export function resolveColumnSet(options: ColumnSetOption[], id: string | null): ColumnSetOption | undefined {
  return options.find((option) => option.id === id)
    ?? options.find((option) => option.id === SET_FAVORITES)
    ?? options.find((option) => option.id === SET_TOP);
}

// --- recent storefronts (per viewer, per app) ---------------------------------
const RECENT_KEY = (appId: string) => `aso-keywords.recent-storefronts.${appId}`;

export function loadRecent(appId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY(appId)) || '[]');
    return Array.isArray(value) ? value.filter((code): code is string => typeof code === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function pushRecent(appId: string, code: string): string[] {
  const next = [code, ...loadRecent(appId).filter((item) => item !== code)].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY(appId), JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

// --- rank presentation ---------------------------------------------------------
export type RankTier = 'top3' | 'top10' | 'top50' | 'deep' | 'out' | 'pending';

/** 0 = not in results, null = no snapshot yet. */
export function rankTier(position: number | null): RankTier {
  if (position == null) return 'pending';
  if (position <= 0) return 'out';
  if (position <= 3) return 'top3';
  if (position <= 10) return 'top10';
  if (position <= 50) return 'top50';
  return 'deep';
}

/** Rank change, positive = moved up. Entering or leaving the results is reported separately. */
export function rankChange(current: number | null, previous: number | null): { value: number | null; label: string; tone: 'up' | 'down' | 'flat' } {
  if (current == null || previous == null) return { value: null, label: '—', tone: 'flat' };
  if (previous === 0 && current > 0) return { value: null, label: 'вошёл в выдачу', tone: 'up' };
  if (previous > 0 && current === 0) return { value: null, label: 'выпал из выдачи', tone: 'down' };
  if (previous === 0 && current === 0) return { value: 0, label: '—', tone: 'flat' };
  const value = previous - current;
  return { value, label: value > 0 ? `↑ ${value}` : value < 0 ? `↓ ${-value}` : '0', tone: value > 0 ? 'up' : value < 0 ? 'down' : 'flat' };
}
