// App Store rank sources. Every request goes through the per-host gate
// (host-gate.ts): AIMD token bucket, priorities, coalescing, 5-min pause on 403/429.
//
// - `searchAppStore` — the App Store app's own search (MZStore): ~250 ordered
//   adamIds, full lockups for the first 8. Matches the on-device order.
// - `searchItunes` — the public iTunes Search API: ≤200 results with metadata,
//   ordered differently from the store. Fallback and dual-measurement source.

import { GateHttpError, hostGate, isGateLimitStatus, type GateHost, type GatePriority } from './host-gate.js';
import type { AppMetaRecord } from './meta-store.js';
import { storeFrontHeader, storefrontCountry } from './storefront-ids.js';

export class RateLimited extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'RateLimited';
  }
}

const BASE = 'https://itunes.apple.com';
const MZSTORE_SEARCH = 'https://search.itunes.apple.com/WebObjects/MZStore.woa/wa/search';
/** The App Store app's user agent; MZStore serves the app's JSON only to it. */
export const APP_STORE_UA = 'AppStore/3.0 iOS/17.5 model/iPhone15,2 hwp/t8120 build/21F79 (6; dt:280) AMS/1';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

export type RankSource = 'appstore' | 'itunes';

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

export interface RetryInfo { attempt: number; maxAttempts: number; delayMs: number; reason: string }

export interface GatedRequestOptions {
  priority?: GatePriority;
  signal?: AbortSignal;
  onRetry?: (event: RetryInfo) => void;
  /** @deprecated pacing is owned by the host gate; ignored. */
  sleepMs?: number;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';
const isTimeout = (e: unknown) => (e as Error)?.name === 'TimeoutError';

/**
 * iTunes Search API. 403/429 pause the `itunes.apple.com` gate for 5 minutes and
 * throw `RateLimited` at once (the caller re-queues; the gate holds the pause).
 * 5xx and timeouts are retried through the gate — no fixed sleeps.
 */
export async function searchItunes(
  country: string,
  term: string,
  { priority = 'top', signal, onRetry }: GatedRequestOptions = {}
): Promise<SearchResult[]> {
  const cc = storefrontCountry(country);
  const params = new URLSearchParams({ term, country: cc, media: 'software', entity: 'software', limit: '200' });
  const gate = hostGate('itunes.apple.com');
  let lastReason = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await gate.run(async (via) => {
        const res = await via.fetch(`${BASE}/search?${params}`, {
          headers: { Accept: 'application/json', 'User-Agent': 'aso-tracker/0.3 (self-hosted)' },
          signal: requestSignal(signal),
        });
        if (!res.ok) throw new GateHttpError(res.status, `iTunes HTTP ${res.status} for ${cc}/${term}`);
        const data = (await res.json()) as { results?: SearchResult[] };
        return data.results || [];
      }, { key: `search|${cc}|${term.toLowerCase()}`, priority, signal });
    } catch (e) {
      if (isAbort(e)) throw e;
      if (e instanceof GateHttpError && isGateLimitStatus(e.status)) {
        console.warn(`[itunes] ${cc}/"${term}" → HTTP ${e.status}; itunes.apple.com paused 5 min`);
        throw new RateLimited(`Apple ограничил iTunes API (HTTP ${e.status}); пауза 5 мин, темп снижен вдвое`);
      }
      const transient = isTimeout(e) || (e instanceof GateHttpError && e.status >= 500);
      if (!transient) throw e;
      lastReason = isTimeout(e) ? 'Apple не ответил за 15 секунд' : `Apple вернул HTTP ${(e as GateHttpError).status}`;
      console.warn(`[itunes] ${cc}/"${term}" → ${lastReason} (attempt ${attempt}/${MAX_ATTEMPTS})`);
      if (attempt < MAX_ATTEMPTS) onRetry?.({ attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, delayMs: 0, reason: lastReason });
    }
  }
  throw new Error(`iTunes: ${lastReason || 'нет ответа'} (${cc}/${term})`);
}

// --- App Store (MZStore) search ---------------------------------------------

export interface RankLockup {
  name: string;
  developer: string;
  rating?: number;
  ratingCount?: number;
  genre?: string;
  bundleId?: string;
}

export interface RankSearch {
  /** Ordered adamIds as the store ranks them. */
  ids: string[];
  /** Metadata for ids we have it for (MZStore: first 8; iTunes: all). */
  lockups: Map<string, RankLockup>;
  source: RankSource;
  /** Why an App Store request fell back to iTunes, if it did. */
  fallbackReason?: string;
  ms: number;
}

interface MzLockup {
  id?: string;
  name?: string;
  artistName?: string;
  bundleId?: string;
  genreNames?: string[];
  userRating?: { value?: number; ratingCount?: number };
}

/** Parse an MZStore search payload; null means the schema changed. */
export function parseMzSearch(json: unknown): { ids: string[]; lockups: Map<string, RankLockup> } | null {
  const root = json as {
    pageData?: { bubbles?: Array<{ name?: string; results?: Array<{ id?: unknown }> }> };
    storePlatformData?: { 'native-search-lockup'?: { results?: Record<string, MzLockup> } };
  } | null;
  const bubbles = root?.pageData?.bubbles;
  if (!Array.isArray(bubbles)) return null;
  const bubble = bubbles.find((b) => b?.name === 'software');
  // A query nothing matches comes back as a page without the software bubble —
  // that is «not in the results», not a schema change.
  if (!bubble) return { ids: [], lockups: new Map() };
  if (!Array.isArray(bubble.results)) return null;
  const ids = bubble.results.map((r) => String(r?.id ?? '')).filter((id) => /^\d+$/.test(id));
  const lockups = new Map<string, RankLockup>();
  for (const [id, l] of Object.entries(root?.storePlatformData?.['native-search-lockup']?.results ?? {})) {
    if (!l || typeof l !== 'object') continue;
    lockups.set(String(l.id ?? id), {
      name: l.name ?? '',
      developer: l.artistName ?? '',
      rating: l.userRating?.value,
      ratingCount: l.userRating?.ratingCount,
      genre: l.genreNames?.[0],
      bundleId: l.bundleId,
    });
  }
  return { ids, lockups };
}

/** Names seen in any lockup, so positions past the first 8 still get a label. */
const lockupNameCache = new Map<string, RankLockup>();
const LOCKUP_CACHE_MAX = 20_000;
function rememberLockups(lockups: Map<string, RankLockup>) {
  for (const [id, l] of lockups) {
    if (lockupNameCache.size >= LOCKUP_CACHE_MAX) lockupNameCache.delete(lockupNameCache.keys().next().value!);
    lockupNameCache.set(id, l);
  }
}
export function cachedLockup(id: string): RankLockup | undefined {
  return lockupNameCache.get(id);
}

/** MZStore keeps results for 15 minutes (Cache-Control max-age=900) — so do we. */
const APPSTORE_CACHE_MS = 15 * 60_000;
const appStoreCache = new Map<string, { at: number; value: RankSearch }>();
let schemaWarned = false;

/**
 * The App Store app's own search — the only rank source (the iTunes Search API
 * was dropped as one on 2026-09-26: on-device checks in KZ and US matched this
 * order, not iTunes'). No fallback: a failed request is an error the snapshot
 * retries later, never a number from another search engine.
 */
export async function searchAppStore(
  country: string,
  term: string,
  opts: GatedRequestOptions = {}
): Promise<RankSearch> {
  const started = Date.now();
  const cc = storefrontCountry(country);
  const key = `${cc}|${term.trim().toLowerCase()}`;
  const cached = appStoreCache.get(key);
  if (cached && Date.now() - cached.at < APPSTORE_CACHE_MS) return { ...cached.value, ms: 0 };

  const header = storeFrontHeader(cc);
  if (!header) throw new Error(`App Store storefront id for "${cc}" unknown`);
  const gate = hostGate('search.itunes.apple.com');
  if (gate.isPaused()) throw new RateLimited('search.itunes.apple.com paused after a rate limit');

  const { priority = 'top', signal } = opts;
  let payload: unknown;
  try {
    payload = await gate.run(async (via) => {
      const params = new URLSearchParams({ clientApplication: 'Software', media: 'software', term });
      const res = await via.fetch(`${MZSTORE_SEARCH}?${params}`, {
        headers: { 'User-Agent': APP_STORE_UA, 'X-Apple-Store-Front': header, Accept: 'application/json' },
        signal: requestSignal(signal),
      });
      if (!res.ok) throw new GateHttpError(res.status, `MZStore HTTP ${res.status}`);
      return res.json();
    }, { key: `mz|${key}`, priority, signal });
  } catch (e) {
    if (isAbort(e)) throw e;
    if (e instanceof RateLimited) throw e;
    if (e instanceof GateHttpError && (e.status === 403 || e.status === 429)) throw new RateLimited(`App Store HTTP ${e.status}`);
    const reason = e instanceof GateHttpError ? `App Store HTTP ${e.status}` : isTimeout(e) ? 'App Store timeout' : (e as Error).message;
    console.warn(`[appstore] ${cc}/"${term}" → ${reason}`);
    throw new Error(reason);
  }

  const parsed = parseMzSearch(payload);
  if (!parsed) {
    if (!schemaWarned) {
      schemaWarned = true;
      console.warn('[appstore] ⚠️ MZStore response schema changed: pageData missing or software bubble without results — ranks fail until fixed');
    }
    throw new Error('App Store response schema changed');
  }
  rememberLockups(parsed.lockups);
  const value: RankSearch = { ...parsed, source: 'appstore', ms: Date.now() - started };
  persistSerp(cc, term, 'appstore', parsed.ids);
  appStoreCache.set(key, { at: Date.now(), value });
  if (appStoreCache.size > 5000) appStoreCache.delete(appStoreCache.keys().next().value!);
  return value;
}

export async function lookupItunes(
  id: string | number,
  country = 'us'
): Promise<SearchResult | null> {
  const appId = String(id).trim();
  const cc = storefrontCountry(country);
  const params = new URLSearchParams({ id: appId, country: cc });

  if (hostGate('itunes.apple.com').isPaused()) return lookupFromAppStorePage(appId, cc);
  try {
    const result = await hostGate('itunes.apple.com').run(async (via) => {
      const res = await via.fetch(`${BASE}/lookup?${params}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'aso-tracker/0.3 (self-hosted)' },
        signal: requestSignal(),
      });
      if (!res.ok) throw new GateHttpError(res.status);
      const data = (await res.json()) as { results?: SearchResult[] };
      return data.results?.[0] ?? null;
    }, { key: `lookup|${cc}|${appId}`, priority: 'interactive' });
    if (result) return result;
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
  let html: string;
  try {
    html = await hostGate('apps.apple.com').run(async (via) => {
      const res = await via.fetch(pageUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new GateHttpError(res.status);
      return res.text();
    }, { key: `page|${country}|${appId}`, priority: 'interactive' });
  } catch (e) {
    console.warn(`[itunes] App Store fallback ${country}/${appId} → ${(e as Error).message}`);
    return null;
  }
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

export type Top5Entry = { name: string; id: string; dev: string; tid?: number; pos?: number };

export interface Position {
  position: number | null;
  total: number;
  top5: Top5Entry[];
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
  // Persist the real top five. The tracked app stays in the result set so the
  // icons agree with the reported organic position.
  const top5 = results.slice(0, 5).map((a, i) => ({
    name: a.trackName || '',
    id: a.bundleId || '',
    dev: a.artistName || '',
    tid: a.trackId,
    pos: i + 1,
  }));
  return { position, total: results.length, top5 };
}

/**
 * Our app's position in a ranked id list: by App Store id first, then by
 * bundle-id prefix over the lockups we have metadata for. top5 keeps the
 * shape the UI reads from top5_json: name, id (bundle), dev, tid, pos.
 */
export function positionFromRank(search: Pick<RankSearch, 'ids' | 'lockups'>, app: { iTunesId?: string; bundle?: string }): Position {
  const { ids, lockups } = search;
  let position: number | null = null;
  const tid = String(app.iTunesId ?? '').trim();
  if (tid) {
    const i = ids.indexOf(tid);
    if (i >= 0) position = i + 1;
  }
  if (position == null && app.bundle) {
    const m = app.bundle.toLowerCase();
    for (let i = 0; i < ids.length; i++) {
      const bid = (lockups.get(ids[i])?.bundleId ?? '').toLowerCase();
      if (bid && (bid === m || bid.startsWith(m))) {
        position = i + 1;
        break;
      }
    }
  }
  const top5 = ids.slice(0, 5).map((id, i) => {
    const l = lockups.get(id) ?? cachedLockup(id);
    return { name: l?.name ?? '', id: l?.bundleId ?? '', dev: l?.developer ?? '', tid: Number(id), pos: i + 1 };
  });
  return { position, total: ids.length, top5 };
}

// --- Gated generic Apple requests -----------------------------------------------

/** Thrown for an interactive request while its host sits out a rate-limit pause. */
export class HostPaused extends Error {
  constructor(readonly host: GateHost) {
    super(`${host}: пауза после лимита Apple`);
    this.name = 'HostPaused';
  }
}

export interface AppleRequestOptions {
  priority?: GatePriority;
  signal?: AbortSignal;
  /** Coalescing key; defaults to the URL. */
  key?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Injected fetch (tests, metadata-history). */
  fetchImpl?: typeof fetch;
}

export function gateHostOf(url: string): GateHost {
  const host = new URL(url).hostname;
  if (host === 'search.itunes.apple.com') return 'search.itunes.apple.com';
  if (host === 'apps.apple.com') return 'apps.apple.com';
  if (host === 'itunes.apple.com') return 'itunes.apple.com';
  throw new Error(`no gate for host ${host}`);
}

/**
 * One request to an Apple host through its gate, body read inside the gated
 * task so identical requests can share it. Non-2xx throws `GateHttpError`
 * (403/429 also pause the host). Interactive requests fail fast with
 * `HostPaused` instead of waiting out a 5-minute pause.
 */
async function appleRequest<T>(url: string, read: (res: Response) => Promise<T>, opts: AppleRequestOptions): Promise<T> {
  const host = gateHostOf(url);
  const gate = hostGate(host);
  const priority = opts.priority ?? 'interactive';
  if (priority === 'interactive' && gate.isPaused()) throw new HostPaused(host);
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  // `via` (egress lane) is optional so this also works with a gate that passes none.
  return gate.run(async (via?: { fetch?: (url: string, init?: RequestInit) => Promise<Response> }) => {
    const doFetch = opts.fetchImpl ?? via?.fetch ?? fetch;
    const res = await doFetch(url, {
      headers: opts.headers ?? { Accept: 'application/json' },
      redirect: 'follow',
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
    if (!res.ok) throw new GateHttpError(res.status, `${host} HTTP ${res.status}`);
    return read(res);
  }, { key: opts.key ?? url, priority, signal: opts.signal });
}

export function appleJson<T = unknown>(url: string, opts: AppleRequestOptions = {}): Promise<T> {
  return appleRequest(url, (res) => res.json() as Promise<T>, opts);
}

export function appleText(url: string, opts: AppleRequestOptions = {}): Promise<string> {
  return appleRequest(url, (res) => res.text(), {
    ...opts,
    headers: opts.headers ?? { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36' },
  });
}

// --- Batch lookup + SERP persistence ----------------------------------------------

/** 150 ids → 150 results in tests; 250 ids → only 210, so never more than 150. */
export const LOOKUP_CHUNK = 150;

type MetaStore = typeof import('./meta-store.js');
let metaStorePromise: Promise<MetaStore> | null = null;
/** Lazy so importing itunes.ts (pure helpers, tests) never opens the database. */
function metaStore(): Promise<MetaStore> {
  metaStorePromise ??= import('./meta-store.js');
  return metaStorePromise;
}

function persistSerp(cc: string, term: string, source: RankSource, ids: string[]) {
  const t = term.trim().toLowerCase().replace(/\s+/g, ' ');
  void metaStore()
    .then((store) => store.writeSerp(cc, t, source, ids))
    .catch((e) => console.warn(`[serp] persist ${cc}/"${t}" failed: ${(e as Error).message}`));
}

/** In-flight per-id lookups, so overlapping batches share one request per id. */
const lookupPending = new Map<string, Promise<AppMetaRecord | null>>();

export interface LookupBatchOptions {
  priority?: GatePriority;
  signal?: AbortSignal;
}

/**
 * iTunes lookup for many ids in one storefront: 24 h SQLite cache, then
 * requests of ≤150 ids through the `itunes.apple.com` gate. Ids already being
 * fetched by another call are awaited, not requested twice. Best-effort: a
 * failed chunk leaves its ids out of the result (aborts still throw).
 */
export async function lookupBatch(ids: Array<string | number>, country: string, opts: LookupBatchOptions = {}): Promise<Map<string, AppMetaRecord>> {
  const cc = storefrontCountry(country);
  const uniq = Array.from(new Set(ids.map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id))));
  const out = new Map<string, AppMetaRecord>();
  if (!uniq.length) return out;
  const store = await metaStore();
  const cached = store.readAppMeta(cc, uniq);
  const waits: Array<Promise<void>> = [];
  const toFetch: string[] = [];
  for (const id of uniq) {
    if (cached.has(id)) {
      const value = cached.get(id);
      if (value) out.set(id, value);
      continue;
    }
    const pending = lookupPending.get(`${cc}|${id}`);
    if (pending) waits.push(pending.then((value) => { if (value) out.set(id, value); }));
    else toFetch.push(id);
  }

  for (let i = 0; i < toFetch.length; i += LOOKUP_CHUNK) {
    const chunk = toFetch.slice(i, i + LOOKUP_CHUNK);
    const request = fetchLookupChunk(cc, chunk, opts, store);
    request.catch(() => { /* surfaced below */ });
    for (const id of chunk) {
      const key = `${cc}|${id}`;
      const perId = request.then((found) => found.get(id) ?? null, () => null);
      lookupPending.set(key, perId);
      void perId.finally(() => { if (lookupPending.get(key) === perId) lookupPending.delete(key); });
    }
    waits.push(request.then(
      (found) => { for (const [id, value] of found) out.set(id, value); },
      (e) => {
        if (isAbort(e)) throw e;
        console.warn(`[lookup] ${cc} batch of ${chunk.length} failed: ${(e as Error).message}`);
      }
    ));
  }
  await Promise.all(waits);
  return out;
}

async function fetchLookupChunk(cc: string, chunk: string[], opts: LookupBatchOptions, store: MetaStore): Promise<Map<string, AppMetaRecord>> {
  const params = new URLSearchParams({ id: chunk.join(','), country: cc });
  const data = await appleJson<{ results?: Array<Record<string, unknown>> }>(`${BASE}/lookup?${params}`, {
    priority: opts.priority ?? 'top',
    signal: opts.signal,
    key: `lookupBatch|${cc}|${chunk.join(',')}`,
    headers: { Accept: 'application/json', 'User-Agent': 'aso-tracker/0.3 (self-hosted)' },
  });
  const found = new Map<string, AppMetaRecord>();
  for (const item of data.results ?? []) {
    if (!item?.trackId) continue;
    found.set(String(item.trackId), store.slimLookupItem(item));
  }
  // Ids Apple did not return (removed / not sold here) are cached as misses for 1 h.
  store.writeAppMeta(cc, chunk.map((id) => [id, found.get(id) ?? null] as [string, AppMetaRecord | null]));
  return found;
}

/** Cached metadata only (no network): for sync readers such as the spy report. */
export async function cachedAppMeta(ids: string[], country: string): Promise<Map<string, AppMetaRecord>> {
  const store = await metaStore();
  const out = new Map<string, AppMetaRecord>();
  for (const [id, value] of store.readAppMeta(storefrontCountry(country), ids)) if (value) out.set(id, value);
  return out;
}

/**
 * Fill top-5 entries that have no name (MZStore lockups cover only the first
 * 8, and some ids come without one) from `lookupBatch`. Mutates and returns `top5`.
 */
export async function fillTop5Names(top5: Top5Entry[], country: string, opts: LookupBatchOptions = {}): Promise<Top5Entry[]> {
  const missing = top5.filter((e) => !e.name && e.tid).map((e) => String(e.tid));
  if (!missing.length) return top5;
  const meta = await lookupBatch(missing, country, opts);
  for (const entry of top5) {
    const m = entry.tid ? meta.get(String(entry.tid)) : undefined;
    if (!m) continue;
    entry.name ||= m.trackName ?? '';
    entry.dev ||= m.artistName ?? '';
    entry.id ||= m.bundleId ?? '';
  }
  return top5;
}
export type { AppMetaRecord };
