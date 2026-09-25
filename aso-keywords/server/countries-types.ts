// Wire types of the country navigation API. Dependency-free: the React client
// imports this file directly (see src/countries.ts).
import type { CountryPreset } from './storefronts.js';

/**
 * Cell tuple (compact on the wire — 1900 keywords × 89 storefronts is ~170k cells):
 *   [keywordIndex, position, prev1d, prev7d, dateIndex]
 * position / prev: N > 0 = rank, 0 = snapshot says «not in results», null = no snapshot.
 * A cell is present only when the keyword is tracked in that storefront; absence
 * means «not tracked here» (rendered empty), which is different from «—».
 */
export type MatrixCell = [kw: number, pos: number | null, prev1: number | null, prev7: number | null, date: number];

export interface MatrixLocaleStats {
  tracked: number;
  ranked: number;
  top10: number;
  avg: number | null;
}

export interface MatrixResponse {
  app: string;
  locales: string[];
  keywords: string[];
  dates: string[];
  cells: Record<string, MatrixCell[]>;
  stats: Record<string, MatrixLocaleStats>;
  latestDate: string | null;
  /** Server time spent, and whether the per-app snapshot summary came from cache. */
  ms: number;
  cached: boolean;
}

export interface CountrySet {
  id: string;
  name: string;
  locales: string[];
}

export interface CountrySets {
  favorites: string[];
  sets: CountrySet[];
}

export interface CountrySetsResponse extends CountrySets {
  presets: CountryPreset[];
}
