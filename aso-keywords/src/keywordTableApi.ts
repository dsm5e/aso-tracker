// Positions table (one storefront): metrics, tags/notes and bulk keyword ×
// storefront edits. Server: server/routes-keyword-table.ts.

export type PopularityStatus = 'ok' | 'stale' | 'pending' | 'none' | 'error' | 'unavailable';

export interface KeywordTableRow {
  keyword: string;
  /** Latest snapshot rank: number, 0 = not in results, null = never checked. */
  current: number | null;
  prev1: number | null;
  prev7: number | null;
  entered7: boolean;
  dropped7: boolean;
  total: number | null;
  /** One value per day (last 30 days): rank, 0 = out, null = no snapshot. */
  trend: Array<number | null>;
  popularity: number | null;
  popularityLabel: string | null;
  popularityStatus: PopularityStatus;
  popularityDay: string | null;
  difficulty: number | null;
  chance: number | null;
  opportunity: number | null;
  serpDepth: number;
  serpSource: 'full' | 'cache' | 'snapshot' | null;
  tags: string[];
  note: string;
  /** In the app's global list (tracked in every storefront). */
  global?: boolean;
}

export interface KeywordTableResponse {
  storefront: string;
  generatedAt: string;
  ms: number;
  latestDate: string | null;
  trendDates: string[];
  ourStrength: number | null;
  popularity: { status: 'ok' | 'unavailable'; source: string | null; sourceLabel: string; day: string | null; pending: number; note: string };
  formula: string[];
  palette: Array<{ tag: string; count: number }>;
  rows: KeywordTableRow[];
}

export interface TagsResponse {
  tags: Record<string, string[]>;
  notes: Record<string, Record<string, string>>;
  palette: Array<{ tag: string; count: number }>;
}

export interface KeywordPair { keyword: string; storefront: string }

const json = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try { message = ((await response.json()) as { error?: string }).error ?? message; } catch { /* not json */ }
    throw new Error(message);
  }
  return (await response.json()) as T;
};

const post = (url: string, body: unknown, method = 'POST') => fetch(url, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const tagKey = (keyword: string) => keyword.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export const keywordTableApi = {
  table: (appId: string, storefront: string, signal?: AbortSignal) =>
    fetch(`/api/apps/${appId}/keyword-table?storefront=${storefront}`, { cache: 'no-store', signal }).then((r) => json<KeywordTableResponse>(r)),
  tag: (appId: string, keywords: string[], add: string[], remove: string[]) =>
    post(`/api/apps/${appId}/tags`, { keywords, add, remove }).then((r) => json<TagsResponse>(r)),
  note: (appId: string, storefront: string, keyword: string, note: string) =>
    post(`/api/apps/${appId}/notes`, { storefront, keyword, note }, 'PUT').then((r) => json<{ note: string }>(r)),
  bulk: (appId: string, add: KeywordPair[], remove: KeywordPair[]) =>
    post(`/api/apps/${appId}/keywords/bulk`, { add, remove }).then((r) => json<{ added: number; removed: number; existing: number; keywords: Record<string, string[]> }>(r)),
  /** Global list: add moves keywords into «every storefront», remove drops them everywhere. */
  setGlobal: (appId: string, add: string[], remove: string[] = []) =>
    post(`/api/apps/${appId}/keywords/global`, { add, remove }, 'PUT').then((r) => json<{ global: string[]; keywords: Record<string, string[]> }>(r)),
};
