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
  artworkUrl60?: string;
  artworkUrl100?: string;
  artworkUrl512?: string;
  primaryGenreName?: string;
  averageUserRating?: number;
  userRatingCount?: number;
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
  const appId = String(id).trim();
  const cc = COUNTRY_OVERRIDE[country] ?? country;
  const params = new URLSearchParams({ id: appId, country: cc });

  try {
    const res = await fetch(`${BASE}/lookup?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'aso-tracker/0.2 (self-hosted)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { results?: SearchResult[] };
      if (data.results?.[0]) return data.results[0];
    } else {
      console.warn(`[itunes] lookup ${cc}/${appId} → HTTP ${res.status}; trying App Store page fallback`);
    }
  } catch (e) {
    console.warn(`[itunes] lookup ${cc}/${appId} failed: ${(e as Error).message}; trying App Store page fallback`);
  }

  return lookupFromAppStorePage(appId, cc);
}

/** Apple intermittently returns 403 from the legacy iTunes Lookup API while
 * the public App Store product page remains available. Its server payload
 * includes the same adamId + PurchaseConfiguration data needed by AppAdder. */
async function lookupFromAppStorePage(appId: string, country: string): Promise<SearchResult | null> {
  const pageUrl = `https://apps.apple.com/${encodeURIComponent(country)}/app/id${encodeURIComponent(appId)}`;
  const res = await fetch(pageUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    console.warn(`[itunes] App Store fallback ${country}/${appId} → HTTP ${res.status}`);
    return null;
  }

  const html = await res.text();
  const payloadMatch = html.match(/<script[^>]+id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!payloadMatch) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadMatch[1]);
  } catch {
    return null;
  }

  const stack: unknown[] = [payload];
  let product: Record<string, unknown> | null = null;
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const obj = value as Record<string, unknown>;
    const purchase = obj.purchaseConfiguration;
    if (purchase && typeof purchase === 'object') {
      const pc = purchase as Record<string, unknown>;
      if (String(pc.adamId ?? '') === appId && typeof pc.bundleId === 'string') {
        product = pc;
        break;
      }
    }
    if (String(obj.adamId ?? '') === appId && typeof obj.bundleId === 'string') {
      product = obj;
      break;
    }
    stack.push(...Object.values(obj));
  }
  if (!product?.bundleId) return null;

  const title = typeof product.appName === 'string'
    ? product.appName
    : html.match(/<meta\s+name=["']apple:title["']\s+content=["']([^"']+)/i)?.[1]?.replace(/ App - App Store$/, '');
  const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1] ?? '';
  const artistName = description.match(/\sby\s(.+?)\son the App Store/i)?.[1];
  const artworkUrl100 = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)/i)?.[1];
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)/i)?.[1] ?? pageUrl;

  return {
    bundleId: String(product.bundleId),
    trackName: title,
    artistName,
    trackId: Number(appId),
    trackViewUrl: canonical,
    artworkUrl100,
  };
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
