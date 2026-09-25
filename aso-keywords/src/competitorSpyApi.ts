// Client for server/competitor-spy.ts (reverse keyword lookup + gap analysis).

export type GapClass = 'theirs' | 'shared' | 'ours' | 'none';

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

export interface SpyRow {
  keyword: string;
  theirRank: number | null;
  theirDepth: number;
  ourRank: number | null;
  ourDepth: number;
  source: 'full' | 'cache' | 'snapshot';
  checkedAt: string;
  tracked: boolean;
  trackedBy: string[];
  popularity: number | null;
  difficulty: number | null;
  chance: number | null;
  opportunity: number | null;
  inTheirTitle: boolean;
  inTheirSubtitle: boolean;
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
  counts: { theirs: number; shared: number; ours: number };
  rows: SpyRow[];
  candidates: string[];
  formula: string[];
}

export interface SpyCheckJob {
  id: string;
  storefront: string;
  terms: string[];
  done: number;
  current: string | null;
  status: 'running' | 'done' | 'error' | 'aborted';
  error: string | null;
  note: string | null;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const spyApi = {
  report: (appId: string, competitor: string, storefront: string, limit: number, signal?: AbortSignal) =>
    fetch(`/api/apps/${appId}/competitor-spy?${new URLSearchParams({ competitor, storefront, limit: String(limit) })}`, { signal }).then((r) => json<SpyReport>(r)),
  startCheck: (storefront: string, terms: string[]) =>
    post('/api/competitor-spy/check', { storefront, terms }).then((r) => json<SpyCheckJob>(r)),
  job: (id: string) => fetch(`/api/competitor-spy/check/${id}`).then((r) => json<SpyCheckJob>(r)),
  abort: (id: string) => post(`/api/competitor-spy/check/${id}/abort`, {}).then((r) => json<SpyCheckJob>(r)),
  track: (appId: string, keywords: string[], storefronts: string[]) =>
    post(`/api/apps/${appId}/competitor-spy/track`, { keywords, storefronts }).then((r) => json<{ added: number; keywords: Record<string, string[]> }>(r)),
};
