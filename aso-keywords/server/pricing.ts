import { db } from './db.js';

export interface PricingProduct {
  name: string;
  subtitle?: string;
  price: string;
  duration?: string;
  kind: 'subscription' | 'iap';
}

export interface PricingInfo {
  iTunesId: string;
  country: string;
  subscriptions: PricingProduct[];
  iap: PricingProduct[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

db.exec(`
  CREATE TABLE IF NOT EXISTS pricing_cache (
    itunes_id   TEXT NOT NULL,
    country     TEXT NOT NULL,
    fetched_at  INTEGER NOT NULL,
    payload     TEXT NOT NULL,
    PRIMARY KEY (itunes_id, country)
  );
`);

function inferDuration(productId: string): string {
  const p = productId.toLowerCase();
  if (/\b(weekly|week|7day|7d)\b/.test(p)) return 'weekly';
  if (/\b(monthly|month|1mo|30day)\b/.test(p)) return 'monthly';
  if (/\b(yearly|annual|year|1y|12mo|365day)\b/.test(p)) return 'yearly';
  if (/\b(quarterly|3mo|90day)\b/.test(p)) return 'quarterly';
  if (/\b(lifetime|forever|oneTime|permanent)\b/.test(p)) return 'lifetime';
  return '';
}

function extractProducts(shelf: unknown, kind: PricingProduct['kind']): PricingProduct[] {
  if (!shelf || typeof shelf !== 'object') return [];
  const items = (shelf as { items?: unknown[] }).items;
  if (!Array.isArray(items)) return [];
  const out: PricingProduct[] = [];
  for (const it of items) {
    try {
      const itAny = it as any;
      const lockupInner =
        itAny?.buttonAction?.installRequiredAction?.pageData?.lockup ?? {};
      const btnInner = lockupInner.buttonAction ?? {};
      const pid: string =
        itAny?.productIdentifier ??
        itAny?.buttonAction?.productIdentifier ??
        lockupInner.productIdentifier ??
        '';
      const name = lockupInner.title ?? itAny?.title ?? '?';
      const price = btnInner.priceFormatted ?? (btnInner.price != null ? String(btnInner.price) : '?');
      const subtitle =
        lockupInner.productDescription ??
        itAny?.productDescription ??
        lockupInner.subtitle ??
        undefined;
      const duration = inferDuration(pid);
      out.push({ name, subtitle, price, duration, kind });
    } catch {
      // skip broken item
    }
  }
  return out;
}

function parseAppStorePage(html: string): { subscriptions: PricingProduct[]; iap: PricingProduct[] } {
  const m = html.match(
    /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) return { subscriptions: [], iap: [] };
  const raw = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'");
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { subscriptions: [], iap: [] };
  }
  const root = data?.data?.[0]?.data?.shelfMapping ?? {};
  return {
    subscriptions: extractProducts(root.subscriptions, 'subscription'),
    iap: extractProducts(root.inAppPurchases, 'iap'),
  };
}

export async function getCompetitorPricing(
  iTunesId: string,
  country: string
): Promise<PricingInfo | null> {
  const cc = country.toLowerCase();
  const now = Date.now();

  const cached = db
    .prepare(
      `SELECT fetched_at, payload FROM pricing_cache
        WHERE itunes_id = ? AND country = ?`
    )
    .get(iTunesId, cc) as { fetched_at: number; payload: string } | undefined;

  if (cached && now - cached.fetched_at < CACHE_TTL_MS) {
    try {
      return JSON.parse(cached.payload) as PricingInfo;
    } catch {
      // fall through to refetch
    }
  }

  const url = `https://apps.apple.com/${cc}/app/id${iTunesId}`;
  let html = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const { subscriptions, iap } = parseAppStorePage(html);
  const info: PricingInfo = {
    iTunesId,
    country: cc,
    subscriptions,
    iap,
    fetchedAt: now,
  };

  db.prepare(
    `INSERT OR REPLACE INTO pricing_cache (itunes_id, country, fetched_at, payload)
     VALUES (?, ?, ?, ?)`
  ).run(iTunesId, cc, now, JSON.stringify(info));

  return info;
}
