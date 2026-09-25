import { createHash } from 'node:crypto';
import { db } from './db.js';
import { idempotentCreate, normalizeIdempotencyKey } from './idempotency.js';

export const PAID_OBSERVATION_SOURCES = [
  'manual_app_store_observation',
  'authorized_partner_export',
] as const;
export type PaidObservationSource = typeof PAID_OBSERVATION_SOURCES[number];

export type PaidObservationPlacement = 'SEARCH_RESULTS';

export interface PaidResultInput {
  name: string;
  rank: number;
  placement: PaidObservationPlacement;
  appId?: string;
  bundleId?: string;
  clickUrl?: string;
}

export interface PaidResult extends Required<Pick<PaidResultInput, 'name' | 'rank' | 'placement'>> {
  appId: string | null;
  bundleId: string | null;
  clickUrl: string | null;
  productPageId: string | null;
  cppEvidence: 'confirmed' | 'not_confirmed';
}

export interface PaidObservationInput {
  locale: string;
  keyword: string;
  observedAt?: string;
  source: PaidObservationSource;
  evidenceUrl?: string;
  paidResults: PaidResultInput[];
  notes?: string;
  idempotencyKey?: string;
}

export interface PaidObservation {
  id: number;
  appId: string;
  locale: string;
  keyword: string;
  observedAt: string;
  source: PaidObservationSource;
  evidenceUrl: string | null;
  evidenceQuality: 'linked' | 'declared';
  paidResults: PaidResult[];
  notes: string | null;
  createdAt: string;
}

export interface PaidObservationPayload {
  capability: {
    available: boolean;
    kind: 'observed_paid_search_results';
    reason: string;
    sourceScope: string[];
    limitations: string[];
  };
  observations: PaidObservation[];
  summary: {
    observationCount: number;
    observedPaidAppearanceRate: number | null;
    latestObservedAt: string | null;
    confirmedCppIds: string[];
  };
}

export interface CreatePaidObservationResult {
  observation: PaidObservation;
  /** False means a retry returned the original append-only capture. */
  created: boolean;
}

type StoredRow = {
  id: number;
  app_id: string;
  locale: string;
  keyword: string;
  observed_at: string;
  source: PaidObservationSource;
  evidence_url: string | null;
  evidence_quality: 'linked' | 'declared';
  paid_results_json: string;
  notes: string | null;
  created_at: number;
};

function cleanText(value: unknown, field: string, maxLength: number, required = false): string | null {
  if (value == null || value === '') {
    if (required) throw new Error(`${field} required`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  const trimmed = value.trim();
  if (!trimmed && required) throw new Error(`${field} required`);
  if (trimmed.length > maxLength) throw new Error(`${field} is too long`);
  return trimmed || null;
}

export function normalizeLocale(value: unknown): string {
  const locale = cleanText(value, 'locale', 16, true)!.toLowerCase();
  if (!/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/i.test(locale)) throw new Error('locale must be a storefront code');
  return locale;
}

function normalizeIsoDate(value: unknown, field: string, now = Date.now()): string {
  if (value == null || value === '') return new Date(now).toISOString();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) {
    throw new Error(`${field} must be an ISO date`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field} must be an ISO date`);
  if (timestamp > now + 5 * 60_000) throw new Error(`${field} cannot be in the future`);
  return new Date(timestamp).toISOString();
}

function safeUrl(value: unknown, field: string): string | null {
  const raw = cleanText(value, field, 2_000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`${field} must be an http(s) URL`);
  }
}

/** ppid is evidence only when it exists in a captured destination/evidence URL. */
export function productPageIdFromEvidence(...urls: Array<string | null | undefined>): string | null {
  for (const raw of urls) {
    if (!raw) continue;
    try {
      const parsed = new URL(raw);
      // `ppid` is a Custom Product Page identifier only in an Apple App Store
      // destination. A user-provided capture URL can contain arbitrary query
      // parameters and must not manufacture CPP evidence.
      if (parsed.hostname !== 'apps.apple.com' && parsed.hostname !== 'itunes.apple.com') continue;
      const ppid = parsed.searchParams.get('ppid');
      if (ppid && /^[0-9a-z-]{3,128}$/i.test(ppid)) return ppid;
    } catch {
      // Inputs are validated before persistence.  This protects callers using
      // the helper directly from treating arbitrary prose as CPP evidence.
    }
  }
  return null;
}

function normalizePaidResult(value: unknown, evidenceUrl: string | null): PaidResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('paidResults entries must be objects');
  const item = value as Record<string, unknown>;
  const name = cleanText(item.name, 'paidResults.name', 200, true)!;
  const rank = typeof item.rank === 'number' ? item.rank : Number(item.rank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 200) throw new Error('paidResults.rank must be 1–200');
  if (item.placement !== 'SEARCH_RESULTS') throw new Error('paidResults.placement must be SEARCH_RESULTS');
  const clickUrl = safeUrl(item.clickUrl, 'paidResults.clickUrl');
  const appId = cleanText(item.appId, 'paidResults.appId', 64);
  const bundleId = cleanText(item.bundleId, 'paidResults.bundleId', 255);
  const productPageId = productPageIdFromEvidence(clickUrl, evidenceUrl);
  return {
    name,
    rank,
    placement: 'SEARCH_RESULTS',
    appId,
    bundleId,
    clickUrl,
    productPageId,
    cppEvidence: productPageId ? 'confirmed' : 'not_confirmed',
  };
}

type NormalizedPaidObservation = Omit<PaidObservation, 'id' | 'appId' | 'createdAt'> & { idempotencyKey: string | null };

export function normalizePaidObservation(input: unknown, now = Date.now()): NormalizedPaidObservation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('observation body must be an object');
  const body = input as Record<string, unknown>;
  const source = body.source;
  if (!PAID_OBSERVATION_SOURCES.includes(source as PaidObservationSource)) {
    throw new Error(`source must be one of: ${PAID_OBSERVATION_SOURCES.join(', ')}`);
  }
  const evidenceUrl = safeUrl(body.evidenceUrl, 'evidenceUrl');
  if (!Array.isArray(body.paidResults) || body.paidResults.length === 0 || body.paidResults.length > 25) {
    throw new Error('paidResults must contain 1–25 observed paid apps');
  }
  const paidResults = body.paidResults.map((item) => normalizePaidResult(item, evidenceUrl));
  return {
    locale: normalizeLocale(body.locale),
    keyword: cleanText(body.keyword, 'keyword', 160, true)!.toLocaleLowerCase(),
    observedAt: normalizeIsoDate(body.observedAt, 'observedAt', now),
    source: source as PaidObservationSource,
    evidenceUrl,
    evidenceQuality: evidenceUrl ? 'linked' : 'declared',
    paidResults,
    notes: cleanText(body.notes, 'notes', 2_000),
    idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey),
  };
}

function parseResults(raw: string): PaidResult[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PaidResult => Boolean(item && typeof item === 'object'));
  } catch {
    return [];
  }
}

function rowToObservation(row: StoredRow): PaidObservation {
  return {
    id: row.id,
    appId: row.app_id,
    locale: row.locale,
    keyword: row.keyword,
    observedAt: row.observed_at,
    source: row.source,
    evidenceUrl: row.evidence_url,
    evidenceQuality: row.evidence_quality,
    paidResults: parseResults(row.paid_results_json),
    notes: row.notes,
    createdAt: new Date(row.created_at * 1_000).toISOString(),
  };
}

function paidObservationById(appId: string, id: number): PaidObservation | null {
  const row = db.prepare(`
    SELECT id, app_id, locale, keyword, observed_at, source, evidence_url,
           evidence_quality, paid_results_json, notes, created_at
      FROM paid_search_observations WHERE app_id = ? AND id = ?
  `).get(appId, id) as StoredRow | undefined;
  return row ? rowToObservation(row) : null;
}

export function createPaidObservation(appId: string, input: unknown, now = Date.now()): CreatePaidObservationResult {
  const normalized = normalizePaidObservation(input, now);
  const { idempotencyKey, ...observation } = normalized;
  const deliveryKey = idempotencyKey
    ? `client:${idempotencyKey}`
    : `fingerprint:${paidObservationFingerprint(observation)}`;
  return idempotentCreate(db, 'paid-observation', appId, deliveryKey, () => {
    const result = db.prepare(`
      INSERT INTO paid_search_observations
        (app_id, locale, keyword, observed_at, source, evidence_url, evidence_quality, paid_results_json, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      appId,
      observation.locale,
      observation.keyword,
      observation.observedAt,
      observation.source,
      observation.evidenceUrl,
      observation.evidenceQuality,
      JSON.stringify(observation.paidResults),
      observation.notes,
    );
    return {
      id: Number(result.lastInsertRowid),
      appId,
      ...observation,
      createdAt: new Date(now).toISOString(),
    };
  }, (id) => paidObservationById(appId, id));
}

function matchesCompetitor(result: PaidResult, competitorId?: string): boolean {
  if (!competitorId) return false;
  const match = competitorId.trim().toLowerCase();
  return result.appId?.toLowerCase() === match || result.bundleId?.toLowerCase() === match;
}

export function getPaidObservations(
  appId: string,
  options: { locale?: string; keyword?: string; competitorId?: string; limit?: number } = {},
): PaidObservationPayload {
  const where = ['app_id = ?'];
  const params: Array<string | number> = [appId];
  if (options.locale) {
    where.push('locale = ?');
    params.push(normalizeLocale(options.locale));
  }
  if (options.keyword?.trim()) {
    where.push('keyword = ?');
    params.push(options.keyword.trim().toLocaleLowerCase());
  }
  const limit = Math.max(1, Math.min(500, Math.trunc(options.limit ?? 90)));
  const rows = db.prepare(`
    SELECT id, app_id, locale, keyword, observed_at, source, evidence_url,
           evidence_quality, paid_results_json, notes, created_at
      FROM paid_search_observations
     WHERE ${where.join(' AND ')}
  ORDER BY observed_at DESC, id DESC
     LIMIT ?
  `).all(...params, limit) as StoredRow[];
  const observations = rows.map(rowToObservation);
  const observedCount = options.competitorId
    ? observations.filter((observation) => observation.paidResults.some((result) => matchesCompetitor(result, options.competitorId))).length
    : 0;
  const cppIds = new Set(observations.flatMap((observation) => observation.paidResults)
    .map((result) => result.productPageId)
    .filter((value): value is string => Boolean(value)));
  const available = observations.length > 0;
  return {
    capability: {
      available,
      kind: 'observed_paid_search_results',
      reason: available
        ? 'Saved observations are available for this scope.'
        : 'Apple public APIs do not expose keyword-level paid search results. Add a direct observation or an authorized export to measure this scope.',
      sourceScope: [...new Set(observations.map((observation) => observation.source))],
      limitations: [
        'Observed paid appearance rate is the fraction of saved observations containing the selected app. It is not impression share, traffic share, spend, or an estimate of competitor installs.',
        'Apple Ads Platform API exposes paid search metrics only for the authenticated advertiser account.',
        'A CPP is confirmed only when ppid was present in a saved destination or evidence URL.',
      ],
    },
    observations,
    summary: {
      observationCount: observations.length,
      observedPaidAppearanceRate: options.competitorId && observations.length
        ? +(observedCount / observations.length).toFixed(4)
        : null,
      latestObservedAt: observations[0]?.observedAt ?? null,
      confirmedCppIds: [...cppIds].sort(),
    },
  };
}

/** Stable capture fingerprint for import clients; not used as a uniqueness rule. */
export function paidObservationFingerprint(observation: Omit<PaidObservation, 'id' | 'appId' | 'createdAt'>): string {
  return createHash('sha256').update(JSON.stringify({
    locale: observation.locale,
    keyword: observation.keyword,
    observedAt: observation.observedAt,
    source: observation.source,
    evidenceUrl: observation.evidenceUrl,
    paidResults: observation.paidResults,
    notes: observation.notes,
  })).digest('hex').slice(0, 20);
}
