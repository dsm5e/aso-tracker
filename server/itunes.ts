// iTunes Search API wrapper — no proxy, conservative rate limit.
// Ports logic from rank.py: 2 workers per locale, 0.5s sleep, one retry on 502, abort on persistent 502.

export class RateLimited extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'RateLimited';
  }
}

const BASE = 'https://itunes.apple.com';

const COUNTRY_OVERRIDE: Record<string, string> = {
  'in-hi': 'in', 'in-gu': 'in', 'in-kn': 'in', 'in-ml': 'in',
  'in-mr': 'in', 'in-or': 'in', 'in-pa': 'in', 'in-ta': 'in', 'in-te': 'in',
  'es-ca': 'es',
};

export interface SearchResult {
  bundleId?: string;
  trackName?: string;
  artistName?: string;
  trackId?: number;
  trackViewUrl?: string;
}

// Global gate: enforce a minimum interval between any two iTunes requests,
// regardless of which worker fires them. This makes rate-limiting per-second reliable
// AND makes the first request in a session instant (no pointless initial sleep).
let nextAllowedAt = 0;
async function throttle(sleepMs: number) {
  const now = Date.now();
  const wait = nextAllowedAt - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  nextAllowedAt = Math.max(nextAllowedAt, Date.now()) + sleepMs;
}

export async function searchItunes(
  country: string,
  term: string,
  { sleepMs = 500 }: { sleepMs?: number } = {}
): Promise<SearchResult[]> {
  const cc = COUNTRY_OVERRIDE[country] ?? country;
  const params = new URLSearchParams({
    term,
    country: cc,
    media: 'software',
    entity: 'software',
    limit: '200',
  });
  await throttle(sleepMs);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE}/search?${params}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'aso-tracker/0.1 (self-hosted)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 502) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        throw new RateLimited(`iTunes 502 twice for ${cc}/${term}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { results?: SearchResult[] };
      return data.results || [];
    } catch (e) {
      if (e instanceof RateLimited) throw e;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    }
  }
  return [];
}

export async function lookupItunes(
  id: string | number,
  country = 'us'
): Promise<SearchResult | null> {
  const params = new URLSearchParams({ id: String(id), country });
  const res = await fetch(`${BASE}/lookup?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: SearchResult[] };
  return data.results?.[0] || null;
}

export interface Position {
  position: number | null;
  total: number;
  top5: Array<{ name: string; id: string; dev: string }>;
}

export function findPosition(results: SearchResult[], match: string): Position {
  const m = match.toLowerCase();
  let position: number | null = null;
  for (let i = 0; i < results.length; i++) {
    const bid = (results[i].bundleId || '').toLowerCase();
    if (bid === m || bid.startsWith(m)) {
      position = i + 1;
      break;
    }
  }
  const top5 = results.slice(0, 5).map((a) => ({
    name: a.trackName || '',
    id: a.bundleId || '',
    dev: a.artistName || '',
  }));
  return { position, total: results.length, top5 };
}
