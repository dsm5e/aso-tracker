import { createHash } from 'node:crypto';
import { db } from './db.js';

const API_ROOT = 'https://adrepository.apple.com/api/v1';
const CACHE_TTL_MS = 24 * 60 * 60_000;
const PARTIAL_CACHE_TTL_MS = 30 * 60_000;
const PAGE_SIZE = 50;
// The public endpoint returns "Number of countries greater than allowed limit"
// for six or more codes, although the PDF doesn't document that ceiling.
export const AD_REPOSITORY_COUNTRY_BATCH_SIZE = 5;

export const APPLE_AD_REPOSITORY_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LU', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const;

export type AdRepositoryDatePreset = 'LAST_90_DAYS' | 'LAST_180_DAYS' | 'LAST_YEAR';
export type AdRepositoryCacheStatus = 'fresh' | 'refreshed' | 'partial' | 'stale-fallback';

export interface AdRepositoryAsset {
  videoUrl: string | null;
  pictureUrl: string | null;
  order: number | null;
  height: number | null;
  width: number | null;
  orientation: string | null;
}

export interface AdRepositoryAd {
  adId: string;
  appId: string;
  appName: string;
  developerName: string;
  legalName: string;
  placement: string;
  format: string;
  subFormat: string | null;
  countryOrRegion: string;
  firstImpressionDate: string | null;
  lastImpressionDate: string | null;
  defaultLanguageTag: string | null;
  defaultPreviewDevice: string | null;
  subtitle: string | null;
  primaryCategory: string | null;
  iconPictureUrl: string | null;
  promotionalText: string | null;
  inAppPurchases: boolean | null;
  audienceRefinement: {
    ageTarget: boolean;
    genderTarget: boolean;
    locationTarget: boolean;
    customerTypeTarget: boolean;
  };
  assets: AdRepositoryAsset[];
  localeVariationCount: number;
  creativeSignature: string;
  productPageId: string | null;
}

export interface AdRepositoryPayload {
  appId: string;
  source: 'Apple App Store Advertising Repository';
  sourceUrl: string;
  official: true;
  scope: 'EU';
  datePreset: AdRepositoryDatePreset;
  dataStartDate: string | null;
  dataEndDate: string | null;
  fetchedAt: string;
  cacheStatus: AdRepositoryCacheStatus;
  coverageCountries: string[];
  ads: AdRepositoryAd[];
  summary: {
    adCount: number;
    countryCount: number;
    placementCount: number;
    creativeVariantCount: number;
    confirmedCppCount: number;
  };
  partialErrors: Array<{ countries: string[]; message: string }>;
  limitations: string[];
}

type RawRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

let appleRequestQueue: Promise<void> = Promise.resolve();
let lastAppleRequestAt = 0;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response, attempt: number) {
  const raw = response.headers.get('retry-after');
  const seconds = raw == null ? NaN : Number(raw);
  if (Number.isFinite(seconds)) return Math.min(15_000, Math.max(1_000, seconds * 1_000));
  return Math.min(8_000, 1_000 * (2 ** attempt));
}

function queuedAppleFetch(url: string, fetchImpl: FetchLike): Promise<Response> {
  const operation = appleRequestQueue.then(async () => {
    const spacing = Math.max(0, lastAppleRequestAt + 350 - Date.now());
    if (spacing) await delay(spacing);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      lastAppleRequestAt = Date.now();
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) return response;
      await delay(retryDelay(response, attempt));
    }
    throw new Error('Apple Ad Repository unavailable');
  });
  appleRequestQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function record(value: unknown): RawRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RawRecord : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.toLowerCase() !== 'null' ? normalized : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true';
}

function dateValue(value: unknown): string | null {
  const raw = stringValue(value);
  return raw ? raw.slice(0, 10) : null;
}

function findProductPageId(value: unknown): string | null {
  const raw = JSON.stringify(value);
  const match = raw.match(/[?&]ppid=([0-9a-z-]+)/i);
  return match?.[1] ?? null;
}

export function buildAdRepositoryQuery(appId: string, countries: readonly string[], datePreset: AdRepositoryDatePreset): string {
  return `type==APP;id==${appId};countryOrRegion=in=(${countries.join(',')});datePreset==${datePreset}`;
}

export function normalizeAdRepositoryAd(value: unknown): AdRepositoryAd | null {
  const item = record(value);
  const adId = stringValue(item.adId);
  if (!adId) return null;
  const banner = record(item.adBanner);
  const audience = record(item.audienceRefinement);
  const assets = (Array.isArray(item.adAssets) ? item.adAssets : []).map((candidate): AdRepositoryAsset => {
    const asset = record(candidate);
    return {
      videoUrl: stringValue(asset.videoUrl),
      pictureUrl: stringValue(asset.pictureUrl),
      order: numberValue(asset.order),
      height: numberValue(asset.height),
      width: numberValue(asset.width),
      orientation: stringValue(asset.orientation),
    };
  }).filter((asset) => asset.videoUrl || asset.pictureUrl);
  const signatureInput = JSON.stringify({
    format: stringValue(item.format),
    subtitle: stringValue(banner.subtitle),
    assets: assets.map((asset) => [asset.pictureUrl, asset.videoUrl, asset.order]),
  });
  return {
    adId,
    appId: String(item.appId ?? ''),
    appName: stringValue(item.appName) ?? '',
    developerName: stringValue(item.developerName) ?? '',
    legalName: stringValue(item.legalName) ?? '',
    placement: stringValue(item.placement) ?? 'UNKNOWN',
    format: stringValue(item.format) ?? 'UNKNOWN',
    subFormat: stringValue(item.subFormat),
    countryOrRegion: stringValue(item.countryOrRegion)?.toUpperCase() ?? '',
    firstImpressionDate: dateValue(item.firstImpressionDate),
    lastImpressionDate: dateValue(item.lastImpressionDate),
    defaultLanguageTag: stringValue(item.defaultLanguageTag),
    defaultPreviewDevice: stringValue(item.defaultPreviewDevice),
    subtitle: stringValue(banner.subtitle),
    primaryCategory: stringValue(banner.primaryCategory),
    iconPictureUrl: stringValue(banner.iconPictureUrl),
    promotionalText: stringValue(banner.promotionalText),
    inAppPurchases: banner.inAppPurchases == null ? null : booleanValue(banner.inAppPurchases),
    audienceRefinement: {
      ageTarget: booleanValue(audience.ageTarget),
      genderTarget: booleanValue(audience.genderTarget),
      locationTarget: booleanValue(audience.locationTarget),
      customerTypeTarget: booleanValue(audience.customerTypeTarget),
    },
    assets,
    localeVariationCount: Array.isArray(item.adLocaleVariations) ? item.adLocaleVariations.length : 0,
    creativeSignature: createHash('sha256').update(signatureInput).digest('hex').slice(0, 16),
    productPageId: findProductPageId(item),
  };
}

function summarize(payload: Omit<AdRepositoryPayload, 'summary'>): AdRepositoryPayload {
  return {
    ...payload,
    summary: {
      adCount: payload.ads.length,
      countryCount: new Set(payload.ads.map((ad) => ad.countryOrRegion).filter(Boolean)).size,
      placementCount: new Set(payload.ads.map((ad) => ad.placement)).size,
      creativeVariantCount: new Set(payload.ads.map((ad) => ad.creativeSignature)).size,
      confirmedCppCount: new Set(payload.ads.map((ad) => ad.productPageId).filter(Boolean)).size,
    },
  };
}

async function fetchPage(
  appId: string,
  countries: readonly string[],
  datePreset: AdRepositoryDatePreset,
  offset: number,
  fetchImpl: FetchLike,
): Promise<RawRecord> {
  const params = new URLSearchParams({
    ql: buildAdRepositoryQuery(appId, countries, datePreset),
    offset: String(offset),
    limit: String(PAGE_SIZE),
  });
  const response = await queuedAppleFetch(`${API_ROOT}/ad-repository-ads?${params}`, fetchImpl);
  const raw = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (!response.ok) {
    const errors = record(parsed).errors;
    const first = Array.isArray(errors) ? record(errors[0]) : {};
    throw new Error(stringValue(first.message) ?? `Apple Ad Repository ${response.status}`);
  }
  return record(parsed);
}

async function fetchCountryBatch(
  appId: string,
  countries: readonly string[],
  datePreset: AdRepositoryDatePreset,
  fetchImpl: FetchLike,
) {
  const ads: AdRepositoryAd[] = [];
  let offset = 0;
  let dataStartDate: string | null = null;
  let dataEndDate: string | null = null;
  for (let page = 0; page < 40; page += 1) {
    const payload = await fetchPage(appId, countries, datePreset, offset, fetchImpl);
    const rows = Array.isArray(payload.data) ? payload.data : [];
    for (const row of rows) {
      const normalized = normalizeAdRepositoryAd(row);
      if (normalized) ads.push(normalized);
    }
    dataStartDate = dateValue(payload.dataStartDate) ?? dataStartDate;
    dataEndDate = dateValue(payload.dataEndDate) ?? dataEndDate;
    const pagination = record(payload.pagination);
    const total = numberValue(pagination.totalResults) ?? rows.length;
    offset += rows.length;
    if (rows.length === 0 || offset >= total) break;
  }
  return { ads, dataStartDate, dataEndDate };
}

function readCached(appId: string, datePreset: AdRepositoryDatePreset) {
  const row = db.prepare(`
    SELECT payload, fetched_at AS fetchedAt, expires_at AS expiresAt
      FROM ad_repository_cache
     WHERE app_id = ? AND date_preset = ?
  `).get(appId, datePreset) as { payload: string; fetchedAt: number; expiresAt: number } | undefined;
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload) as AdRepositoryPayload, fetchedAt: row.fetchedAt, expiresAt: row.expiresAt };
  } catch {
    db.prepare('DELETE FROM ad_repository_cache WHERE app_id = ? AND date_preset = ?').run(appId, datePreset);
    return null;
  }
}

function writeCached(payload: AdRepositoryPayload, now: number, ttl = CACHE_TTL_MS) {
  db.prepare(`
    INSERT INTO ad_repository_cache (app_id, date_preset, payload, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(app_id, date_preset) DO UPDATE SET
      payload = excluded.payload,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at
  `).run(payload.appId, payload.datePreset, JSON.stringify(payload), now, now + ttl);
}

const inFlight = new Map<string, Promise<AdRepositoryPayload>>();

export async function getAdRepositoryAds(
  appId: string,
  datePreset: AdRepositoryDatePreset = 'LAST_YEAR',
  options: { force?: boolean; fetchImpl?: FetchLike; now?: number } = {},
): Promise<AdRepositoryPayload> {
  if (!/^\d+$/.test(appId)) throw new Error('numeric app id required');
  const now = options.now ?? Date.now();
  const cached = readCached(appId, datePreset);
  if (!options.force && cached && cached.expiresAt > now) return { ...cached.payload, cacheStatus: 'fresh' };
  const key = `${appId}:${datePreset}`;
  const active = inFlight.get(key);
  if (active) return active;

  const request = (async () => {
    const ads: AdRepositoryAd[] = [];
    const partialErrors: AdRepositoryPayload['partialErrors'] = [];
    const successfulCountries: string[] = [];
    let dataStartDate: string | null = null;
    let dataEndDate: string | null = null;
    const fetchImpl = options.fetchImpl ?? fetch;
    for (let start = 0; start < APPLE_AD_REPOSITORY_COUNTRIES.length; start += AD_REPOSITORY_COUNTRY_BATCH_SIZE) {
      const countries = APPLE_AD_REPOSITORY_COUNTRIES.slice(start, start + AD_REPOSITORY_COUNTRY_BATCH_SIZE);
      try {
        const result = await fetchCountryBatch(appId, countries, datePreset, fetchImpl);
        ads.push(...result.ads);
        successfulCountries.push(...countries);
        dataStartDate = result.dataStartDate ?? dataStartDate;
        dataEndDate = result.dataEndDate ?? dataEndDate;
      } catch (error) {
        partialErrors.push({ countries: [...countries], message: error instanceof Error ? error.message : String(error) });
      }
    }

    if (partialErrors.length && cached) {
      return {
        ...cached.payload,
        cacheStatus: 'stale-fallback' as const,
        partialErrors,
      };
    }
    if (partialErrors.length * AD_REPOSITORY_COUNTRY_BATCH_SIZE >= APPLE_AD_REPOSITORY_COUNTRIES.length && ads.length === 0) {
      throw new Error(partialErrors[0]?.message ?? 'Apple Ad Repository unavailable');
    }

    const unique = new Map<string, AdRepositoryAd>();
    for (const ad of ads) unique.set(`${ad.adId}:${ad.countryOrRegion}`, ad);
    const normalizedAds = [...unique.values()].sort((a, b) =>
      String(b.lastImpressionDate ?? '').localeCompare(String(a.lastImpressionDate ?? ''))
      || a.countryOrRegion.localeCompare(b.countryOrRegion));
    const payload = summarize({
      appId,
      source: 'Apple App Store Advertising Repository',
      sourceUrl: 'https://adrepository.apple.com/',
      official: true,
      scope: 'EU',
      datePreset,
      dataStartDate,
      dataEndDate,
      fetchedAt: new Date(now).toISOString(),
      cacheStatus: partialErrors.length ? 'partial' : 'refreshed',
      coverageCountries: successfulCountries,
      ads: normalizedAds,
      partialErrors,
      limitations: [
        'Only Apple-delivered ads with impressions in supported EU countries are included.',
        'Repository data is delayed by seven days and does not include keywords, bids, spend, impression counts, installs, or competitor share of voice.',
        'A creative asset set is not proof of a Custom Product Page unless a product page identifier is present.',
      ],
    });
    writeCached(payload, now, partialErrors.length ? PARTIAL_CACHE_TTL_MS : CACHE_TTL_MS);
    return payload;
  })();

  inFlight.set(key, request);
  try { return await request; } finally { inFlight.delete(key); }
}
