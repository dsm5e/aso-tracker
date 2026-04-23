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

// iTunes returns 403/429 when IP is throttled, 502/503/504 when overloaded.
// Treat all of these as transient — pause + retry. Persistent = RateLimited (aborts snapshot).
const RATE_LIMIT_STATUSES = new Set([403, 429, 502, 503, 504]);

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

  // Up to 3 attempts: immediate, +5s, +30s. If still throttled → RateLimited.
  const backoffs = [0, 5_000, 30_000];
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt] > 0) {
      await new Promise((r) => setTimeout(r, backoffs[attempt]));
    }
    try {
      const res = await fetch(`${BASE}/search?${params}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'aso-tracker/0.1 (self-hosted)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (RATE_LIMIT_STATUSES.has(res.status)) {
        lastErr = new Error(`iTunes throttled (HTTP ${res.status}) for ${cc}/${term}`);
        console.warn(`[itunes] ${cc}/"${term}" → HTTP ${res.status} (attempt ${attempt + 1}/${backoffs.length})`);
        continue;
      }
      if (!res.ok) throw new Error(`iTunes HTTP ${res.status} for ${cc}/${term}`);
      const data = (await res.json()) as { results?: SearchResult[] };
      return data.results || [];
    } catch (e) {
      const err = e as Error;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        lastErr = new Error(`iTunes timeout (30s) for ${cc}/${term}`);
        console.warn(`[itunes] ${cc}/"${term}" → timeout (attempt ${attempt + 1}/${backoffs.length})`);
        continue;
      }
      // Non-retriable (bad URL, parse error, etc.)
      throw err;
    }
  }
  // Persistent throttle → abort snapshot with readable reason.
  throw new RateLimited(
    `iTunes is rate-limiting your IP (persistent ${lastErr?.message || 'errors'}). Wait 2–5 min and Resume.`
  );
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
  top5: Array<{ name: string; id: string; dev: string; tid?: number; pos?: number }>;
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
  // Capture top-6 so after excluding ourselves (when we rank in top-5)
  // we still have 5 real competitors to display.
  const top5 = results.slice(0, 6).map((a, i) => ({
    name: a.trackName || '',
    id: a.bundleId || '',
    dev: a.artistName || '',
    tid: a.trackId,
    pos: i + 1,
  }));
  return { position, total: results.length, top5 };
}
