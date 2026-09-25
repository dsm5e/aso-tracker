import { createHash } from 'node:crypto';
import { db } from './db.js';
import type { AppConfig } from './config.js';
import { normalizeLocale } from './paid-observations.js';
import { idempotentCreate, normalizeIdempotencyKey } from './idempotency.js';
import { appleJson } from './itunes.js';
import { GateHttpError } from './host-gate.js';

const METADATA_CACHE_TTL_MS = 24 * 60 * 60_000;
const ITUNES_ROOT = 'https://itunes.apple.com';
const COUNTRY_OVERRIDE: Record<string, string> = {
  'in-hi': 'in', 'in-gu': 'in', 'in-kn': 'in', 'in-ml': 'in', 'in-mr': 'in',
  'in-or': 'in', 'in-pa': 'in', 'in-ta': 'in', 'in-te': 'in', 'es-ca': 'es',
};

export const ASO_EXPERIMENT_STATUSES = ['draft', 'scheduled', 'running', 'completed'] as const;
export type AsoExperimentStatus = typeof ASO_EXPERIMENT_STATUSES[number];
export type MetadataSource = 'public_app_store' | 'manual_asc_export';

export interface MetadataSnapshot {
  id: number;
  appId: string;
  locale: string;
  observedAt: string;
  version: string | null;
  title: string | null;
  subtitle: string | null;
  keywords: string | null;
  description: string | null;
  category: string | null;
  sellerName: string | null;
  storeUrl: string | null;
  iconUrl: string | null;
  screenshotUrls: string[];
  source: MetadataSource;
  sourceUrl: string | null;
  fingerprint: string;
  createdAt: string;
}

export interface MetadataHistoryPayload {
  capability: {
    publicFields: string[];
    unavailablePublicFields: string[];
    limitations: string[];
  };
  latest: MetadataSnapshot | null;
  history: MetadataSnapshot[];
}

export interface MetadataSnapshotInput {
  locale: string;
  observedAt?: string;
  version?: string;
  title?: string;
  subtitle?: string;
  keywords?: string;
  description?: string;
  category?: string;
  sellerName?: string;
  storeUrl?: string;
  iconUrl?: string;
  screenshotUrls?: string[];
  source: MetadataSource;
  sourceUrl?: string;
  idempotencyKey?: string;
}

interface NormalizedMetadataSnapshotInput {
  locale: string;
  observedAt: string;
  version: string | null;
  title: string | null;
  subtitle: string | null;
  keywords: string | null;
  description: string | null;
  category: string | null;
  sellerName: string | null;
  storeUrl: string | null;
  iconUrl: string | null;
  screenshotUrls: string[];
  source: MetadataSource;
  sourceUrl: string | null;
  idempotencyKey: string | null;
}

export interface AsoExperiment {
  id: number;
  appId: string;
  name: string;
  status: AsoExperimentStatus;
  hypothesis: string | null;
  locales: string[];
  metadataChanges: Array<{ field: string; before: string | null; after: string | null; locale?: string }>;
  notes: string | null;
  beforeStart: string | null;
  beforeEnd: string | null;
  afterStart: string | null;
  afterEnd: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  events: AsoExperimentEvent[];
}

export interface AsoExperimentEvent {
  id: number;
  action: 'created' | 'updated' | 'archived';
  payload: Record<string, unknown>;
  createdAt: string;
}

type SnapshotRow = {
  id: number; app_id: string; locale: string; observed_at: string; version: string | null;
  title: string | null; subtitle: string | null; keywords: string | null; description: string | null;
  category: string | null; seller_name: string | null; store_url: string | null; icon_url: string | null;
  screenshots_json: string; source: MetadataSource; source_url: string | null; fingerprint: string; created_at: number;
};

type ExperimentRow = {
  id: number; app_id: string; name: string; status: AsoExperimentStatus; hypothesis: string | null;
  locales_json: string; metadata_changes_json: string; notes: string | null;
  before_start: string | null; before_end: string | null; after_start: string | null; after_end: string | null;
  created_at: number; updated_at: number; archived_at: number | null;
};

type ExperimentEventRow = { id: number; action: AsoExperimentEvent['action']; payload_json: string; created_at: number };
type FetchLike = typeof fetch;

const publicMetadataInFlight = new Map<string, Promise<PublicCaptureResult>>();

function text(value: unknown, field: string, max = 20_000, required = false): string | null {
  if (value == null || value === '') {
    if (required) throw new Error(`${field} required`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  const normalized = value.trim();
  if (!normalized && required) throw new Error(`${field} required`);
  if (normalized.length > max) throw new Error(`${field} is too long`);
  return normalized || null;
}

function httpUrl(value: unknown, field: string): string | null {
  const raw = text(value, field, 2_000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`${field} must be an http(s) URL`);
  }
}

function iso(value: unknown, field: string, now = Date.now()): string {
  if (value == null || value === '') return new Date(now).toISOString();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO date`);
  }
  if (Date.parse(value) > now + 5 * 60_000) throw new Error(`${field} cannot be in the future`);
  return new Date(Date.parse(value)).toISOString();
}

function strings(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${field} must contain at most ${maxItems} values`);
  return [...new Set(value.map((item) => text(item, field, maxLength, true)!))];
}

function parseStrings(value: string): string[] {
  try {
    const result = JSON.parse(value) as unknown;
    return Array.isArray(result) ? result.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function snapshotFingerprint(input: Omit<NormalizedMetadataSnapshotInput, 'observedAt' | 'sourceUrl' | 'idempotencyKey'>): string {
  return createHash('sha256').update(JSON.stringify({
    locale: input.locale, version: input.version ?? null, title: input.title ?? null,
    subtitle: input.subtitle ?? null, keywords: input.keywords ?? null, description: input.description ?? null,
    category: input.category ?? null, sellerName: input.sellerName ?? null, storeUrl: input.storeUrl ?? null,
    iconUrl: input.iconUrl ?? null, screenshotUrls: input.screenshotUrls ?? [], source: input.source,
  })).digest('hex').slice(0, 24);
}

export function normalizeMetadataSnapshotInput(input: unknown, now = Date.now()): NormalizedMetadataSnapshotInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('metadata body must be an object');
  const body = input as Record<string, unknown>;
  if (body.source !== 'public_app_store' && body.source !== 'manual_asc_export') {
    throw new Error('source must be public_app_store or manual_asc_export');
  }
  return {
    locale: normalizeLocale(body.locale),
    observedAt: iso(body.observedAt, 'observedAt', now),
    version: text(body.version, 'version', 128),
    title: text(body.title, 'title', 255),
    subtitle: text(body.subtitle, 'subtitle', 255),
    keywords: text(body.keywords, 'keywords', 4_000),
    description: text(body.description, 'description', 20_000),
    category: text(body.category, 'category', 255),
    sellerName: text(body.sellerName, 'sellerName', 255),
    storeUrl: httpUrl(body.storeUrl, 'storeUrl'),
    iconUrl: httpUrl(body.iconUrl, 'iconUrl'),
    screenshotUrls: strings(body.screenshotUrls, 'screenshotUrls', 20, 2_000),
    source: body.source,
    sourceUrl: httpUrl(body.sourceUrl, 'sourceUrl'),
    idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey),
  };
}

function snapshotFromRow(row: SnapshotRow): MetadataSnapshot {
  return {
    id: row.id, appId: row.app_id, locale: row.locale, observedAt: row.observed_at, version: row.version,
    title: row.title, subtitle: row.subtitle, keywords: row.keywords, description: row.description,
    category: row.category, sellerName: row.seller_name, storeUrl: row.store_url, iconUrl: row.icon_url,
    screenshotUrls: parseStrings(row.screenshots_json), source: row.source, sourceUrl: row.source_url,
    fingerprint: row.fingerprint, createdAt: new Date(row.created_at * 1_000).toISOString(),
  };
}

function metadataSnapshotById(appId: string, id: number): MetadataSnapshot | null {
  const row = db.prepare(`
    SELECT id, app_id, locale, observed_at, version, title, subtitle, keywords, description, category,
           seller_name, store_url, icon_url, screenshots_json, source, source_url, fingerprint, created_at
      FROM public_metadata_snapshots WHERE app_id = ? AND id = ?
  `).get(appId, id) as SnapshotRow | undefined;
  return row ? snapshotFromRow(row) : null;
}

function latestSnapshot(appId: string, locale: string): MetadataSnapshot | null {
  const row = db.prepare(`
    SELECT id, app_id, locale, observed_at, version, title, subtitle, keywords, description, category,
           seller_name, store_url, icon_url, screenshots_json, source, source_url, fingerprint, created_at
      FROM public_metadata_snapshots WHERE app_id = ? AND locale = ?
  ORDER BY observed_at DESC, id DESC LIMIT 1
  `).get(appId, locale) as SnapshotRow | undefined;
  return row ? snapshotFromRow(row) : null;
}

function insertSnapshot(appId: string, normalized: NormalizedMetadataSnapshotInput, now = Date.now()): MetadataSnapshot {
  const { idempotencyKey: _idempotencyKey, ...snapshotInput } = normalized;
  const fingerprint = snapshotFingerprint(snapshotInput);
  const run = db.prepare(`
    INSERT INTO public_metadata_snapshots
      (app_id, locale, observed_at, version, title, subtitle, keywords, description, category, seller_name,
       store_url, icon_url, screenshots_json, source, source_url, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(appId, snapshotInput.locale, snapshotInput.observedAt, snapshotInput.version, snapshotInput.title, snapshotInput.subtitle,
    snapshotInput.keywords, snapshotInput.description, snapshotInput.category, snapshotInput.sellerName, snapshotInput.storeUrl,
    snapshotInput.iconUrl, JSON.stringify(snapshotInput.screenshotUrls), snapshotInput.source, snapshotInput.sourceUrl, fingerprint);
  return { id: Number(run.lastInsertRowid), appId, ...snapshotInput, fingerprint, createdAt: new Date(now).toISOString() };
}

/** Manual ASC exports are append-only; these fields are not publicly returned by iTunes. */
export function appendMetadataSnapshot(appId: string, input: unknown, now = Date.now()): { snapshot: MetadataSnapshot; created: boolean } {
  const normalized = normalizeMetadataSnapshotInput(input, now);
  if (normalized.source !== 'manual_asc_export') {
    throw new Error('public_app_store snapshots must be captured by the server');
  }
  const { idempotencyKey, ...snapshotInput } = normalized;
  const fingerprint = snapshotFingerprint(snapshotInput);
  const deliveryKey = idempotencyKey
    ? `client:${idempotencyKey}`
    : `fingerprint:${snapshotInput.locale}:${snapshotInput.source}:${snapshotInput.observedAt}:${fingerprint}`;
  const result = idempotentCreate(db, 'metadata-snapshot', appId, deliveryKey,
    () => insertSnapshot(appId, normalized, now),
    (id) => metadataSnapshotById(appId, id),
  );
  return { snapshot: result.value, created: result.created };
}

/** iTunes lookup through the itunes.apple.com gate (pacing, 403/429 pause,
 * coalescing); 5xx and timeouts are retried up to 3 times. */
async function requestPublicMetadata(url: string, fetchImpl?: FetchLike): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await appleJson(url, { fetchImpl });
    } catch (error) {
      lastError = error;
      const status = error instanceof GateHttpError ? error.status : null;
      const transient = status == null ? (error as Error)?.name === 'TimeoutError' : status >= 500;
      if (!transient) break;
    }
  }
  if (lastError instanceof GateHttpError) throw new Error(`Public App Store lookup failed (${lastError.status})`);
  throw lastError;
}

type PublicCaptureResult = {
  snapshot: MetadataSnapshot | null;
  cacheStatus: 'fresh' | 'refreshed' | 'unchanged' | 'stale-fallback';
  error: string | null;
};

export function publicPayloadToInput(payload: unknown, locale: string, expectedTrackId: string): MetadataSnapshotInput | null {
  const data = payload as { results?: Array<Record<string, unknown>> };
  const item = data.results?.[0];
  if (!item) return null;
  if (String(item.trackId ?? '') !== expectedTrackId) return null;
  return {
    locale,
    version: typeof item.version === 'string' ? item.version : undefined,
    title: typeof item.trackName === 'string' ? item.trackName : undefined,
    description: typeof item.description === 'string' ? item.description : undefined,
    category: typeof item.primaryGenreName === 'string' ? item.primaryGenreName : undefined,
    sellerName: typeof item.sellerName === 'string' ? item.sellerName : typeof item.artistName === 'string' ? item.artistName : undefined,
    storeUrl: typeof item.trackViewUrl === 'string' ? item.trackViewUrl : undefined,
    iconUrl: typeof item.artworkUrl512 === 'string' ? item.artworkUrl512 : typeof item.artworkUrl100 === 'string' ? item.artworkUrl100 : undefined,
    screenshotUrls: Array.isArray(item.screenshotUrls) ? item.screenshotUrls.filter((url): url is string => typeof url === 'string') : [],
    source: 'public_app_store',
    sourceUrl: typeof item.trackViewUrl === 'string' ? item.trackViewUrl : undefined,
  };
}

export async function capturePublicMetadata(
  app: AppConfig,
  requestedLocale: string,
  options: { force?: boolean; now?: number; fetchImpl?: FetchLike } = {},
): Promise<PublicCaptureResult> {
  const locale = normalizeLocale(requestedLocale);
  const now = options.now ?? Date.now();
  const cached = latestSnapshot(app.id, locale);
  if (!options.force && cached && Date.parse(cached.observedAt) + METADATA_CACHE_TTL_MS > now) {
    return { snapshot: cached, cacheStatus: 'fresh', error: null };
  }
  const key = `${app.id}:${locale}`;
  const active = publicMetadataInFlight.get(key);
  if (active) return active;
  const request = (async (): Promise<PublicCaptureResult> => {
    const country = COUNTRY_OVERRIDE[locale] ?? locale.split('-')[0];
    const params = new URLSearchParams({ id: app.iTunesId, country });
    try {
      const payload = await requestPublicMetadata(`${ITUNES_ROOT}/lookup?${params}`, options.fetchImpl);
      const input = publicPayloadToInput(payload, locale, app.iTunesId);
      if (!input) throw new Error('App not returned by this storefront');
      const normalized = normalizeMetadataSnapshotInput(input, now);
      const fingerprint = snapshotFingerprint(normalized);
      if (cached && cached.fingerprint === fingerprint) {
        return { snapshot: cached, cacheStatus: 'unchanged', error: null };
      }
      return { snapshot: insertSnapshot(app.id, normalized, now), cacheStatus: 'refreshed', error: null };
    } catch (error) {
      if (cached) return { snapshot: cached, cacheStatus: 'stale-fallback', error: error instanceof Error ? error.message : String(error) };
      return { snapshot: null, cacheStatus: 'stale-fallback', error: error instanceof Error ? error.message : String(error) };
    }
  })();
  publicMetadataInFlight.set(key, request);
  try { return await request; } finally { publicMetadataInFlight.delete(key); }
}

export function getMetadataHistory(appId: string, locale?: string, limit = 100): MetadataHistoryPayload {
  const params: Array<string | number> = [appId];
  const where = ['app_id = ?'];
  if (locale) { where.push('locale = ?'); params.push(normalizeLocale(locale)); }
  const rows = db.prepare(`
    SELECT id, app_id, locale, observed_at, version, title, subtitle, keywords, description, category,
           seller_name, store_url, icon_url, screenshots_json, source, source_url, fingerprint, created_at
      FROM public_metadata_snapshots
     WHERE ${where.join(' AND ')}
  ORDER BY observed_at DESC, id DESC LIMIT ?
  `).all(...params, Math.max(1, Math.min(500, Math.trunc(limit)))) as SnapshotRow[];
  const history = rows.map(snapshotFromRow);
  return {
    capability: {
      publicFields: ['title', 'description', 'version', 'category', 'sellerName', 'storeUrl', 'iconUrl', 'screenshots'],
      unavailablePublicFields: ['subtitle', 'keyword field', 'organic impressions', 'organic downloads'],
      limitations: [
        'Public App Store lookup data is storefront-specific and may lag the storefront page.',
        'Subtitle and the hidden keyword field must be recorded from an authorized App Store Connect export; Apple does not expose them publicly.',
      ],
    },
    latest: history[0] ?? null,
    history,
  };
}

function parseJsonArray<T>(raw: string): T[] {
  try { const value = JSON.parse(raw) as unknown; return Array.isArray(value) ? value as T[] : []; } catch { return []; }
}

function eventRows(experimentId: number): AsoExperimentEvent[] {
  const rows = db.prepare(`
    SELECT id, action, payload_json, created_at FROM aso_experiment_events
     WHERE experiment_id = ? ORDER BY created_at ASC, id ASC
  `).all(experimentId) as ExperimentEventRow[];
  return rows.map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch { /* preserve event shell if legacy payload is malformed */ }
    return { id: row.id, action: row.action, payload, createdAt: new Date(row.created_at * 1_000).toISOString() };
  });
}

function experimentFromRow(row: ExperimentRow): AsoExperiment {
  return {
    id: row.id, appId: row.app_id, name: row.name, status: row.status, hypothesis: row.hypothesis,
    locales: parseJsonArray<string>(row.locales_json),
    metadataChanges: parseJsonArray<AsoExperiment['metadataChanges'][number]>(row.metadata_changes_json),
    notes: row.notes, beforeStart: row.before_start, beforeEnd: row.before_end,
    afterStart: row.after_start, afterEnd: row.after_end,
    createdAt: new Date(row.created_at * 1_000).toISOString(), updatedAt: new Date(row.updated_at * 1_000).toISOString(),
    archivedAt: row.archived_at ? new Date(row.archived_at * 1_000).toISOString() : null,
    events: eventRows(row.id),
  };
}

function normalizeWindow(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  return iso(value, field);
}

function validateWindowOrder(beforeStart: string | null, beforeEnd: string | null, afterStart: string | null, afterEnd: string | null) {
  if (beforeStart && beforeEnd && Date.parse(beforeStart) > Date.parse(beforeEnd)) throw new Error('beforeStart must be before beforeEnd');
  if (afterStart && afterEnd && Date.parse(afterStart) > Date.parse(afterEnd)) throw new Error('afterStart must be before afterEnd');
}

function normalizeChanges(value: unknown): AsoExperiment['metadataChanges'] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('metadataChanges must contain at most 100 records');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('metadataChanges entries must be objects');
    const item = entry as Record<string, unknown>;
    const field = text(item.field, 'metadataChanges.field', 100, true)!;
    const before = text(item.before, 'metadataChanges.before', 20_000);
    const after = text(item.after, 'metadataChanges.after', 20_000);
    const locale = item.locale == null ? undefined : normalizeLocale(item.locale);
    return { field, before, after, ...(locale ? { locale } : {}) };
  });
}

type NormalizedExperimentInput = Omit<AsoExperiment, 'id' | 'appId' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'events'>;

export function normalizeAsoExperimentInput(input: unknown, partial = false): Partial<NormalizedExperimentInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('experiment body must be an object');
  const body = input as Record<string, unknown>;
  const result: Partial<NormalizedExperimentInput> = {};
  // A PATCH may clear optional text fields, but not the experiment's identity.
  // Previously `{ name: null }` silently overwrote it with an empty string.
  if ('name' in body || !partial) result.name = text(body.name, 'name', 200, true) ?? '';
  if ('status' in body || !partial) {
    const status = body.status ?? 'draft';
    if (!ASO_EXPERIMENT_STATUSES.includes(status as AsoExperimentStatus)) throw new Error(`status must be one of: ${ASO_EXPERIMENT_STATUSES.join(', ')}`);
    result.status = status as AsoExperimentStatus;
  }
  if ('hypothesis' in body || !partial) result.hypothesis = text(body.hypothesis, 'hypothesis', 4_000);
  if ('locales' in body || !partial) result.locales = strings(body.locales, 'locales', 50, 16).map((locale) => normalizeLocale(locale));
  if ('metadataChanges' in body || !partial) result.metadataChanges = normalizeChanges(body.metadataChanges);
  if ('notes' in body || !partial) result.notes = text(body.notes, 'notes', 10_000);
  if ('beforeStart' in body || !partial) result.beforeStart = normalizeWindow(body.beforeStart, 'beforeStart');
  if ('beforeEnd' in body || !partial) result.beforeEnd = normalizeWindow(body.beforeEnd, 'beforeEnd');
  if ('afterStart' in body || !partial) result.afterStart = normalizeWindow(body.afterStart, 'afterStart');
  if ('afterEnd' in body || !partial) result.afterEnd = normalizeWindow(body.afterEnd, 'afterEnd');
  validateWindowOrder(result.beforeStart ?? null, result.beforeEnd ?? null, result.afterStart ?? null, result.afterEnd ?? null);
  return result;
}

function appendExperimentEvent(experimentId: number, appId: string, action: AsoExperimentEvent['action'], payload: Record<string, unknown>, now = Date.now()) {
  db.prepare(`INSERT INTO aso_experiment_events (experiment_id, app_id, action, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    experimentId, appId, action, JSON.stringify(payload), Math.floor(now / 1_000));
}

export function createAsoExperiment(appId: string, input: unknown, now = Date.now()): AsoExperiment {
  const normalized = normalizeAsoExperimentInput(input) as NormalizedExperimentInput;
  const seconds = Math.floor(now / 1_000);
  const run = db.prepare(`
    INSERT INTO aso_experiments
      (app_id, name, status, hypothesis, locales_json, metadata_changes_json, notes, before_start, before_end, after_start, after_end, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(appId, normalized.name, normalized.status, normalized.hypothesis, JSON.stringify(normalized.locales),
    JSON.stringify(normalized.metadataChanges), normalized.notes, normalized.beforeStart, normalized.beforeEnd,
    normalized.afterStart, normalized.afterEnd, seconds, seconds);
  const id = Number(run.lastInsertRowid);
  appendExperimentEvent(id, appId, 'created', { ...normalized }, now);
  return getAsoExperiment(appId, id)!;
}

export function getAsoExperiment(appId: string, experimentId: number): AsoExperiment | null {
  const row = db.prepare(`
    SELECT id, app_id, name, status, hypothesis, locales_json, metadata_changes_json, notes,
           before_start, before_end, after_start, after_end, created_at, updated_at, archived_at
      FROM aso_experiments WHERE app_id = ? AND id = ?
  `).get(appId, experimentId) as ExperimentRow | undefined;
  return row ? experimentFromRow(row) : null;
}

export function listAsoExperiments(appId: string, includeArchived = false): AsoExperiment[] {
  const rows = db.prepare(`
    SELECT id, app_id, name, status, hypothesis, locales_json, metadata_changes_json, notes,
           before_start, before_end, after_start, after_end, created_at, updated_at, archived_at
      FROM aso_experiments WHERE app_id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'}
  ORDER BY updated_at DESC, id DESC
  `).all(appId) as ExperimentRow[];
  return rows.map(experimentFromRow);
}

export function updateAsoExperiment(appId: string, experimentId: number, input: unknown, now = Date.now()): AsoExperiment | null {
  const existing = getAsoExperiment(appId, experimentId);
  if (!existing) return null;
  if (existing.archivedAt) throw new Error('archived experiments are immutable; create a follow-up experiment instead');
  const patch = normalizeAsoExperimentInput(input, true);
  const next: NormalizedExperimentInput = {
    name: patch.name ?? existing.name, status: patch.status ?? existing.status,
    hypothesis: patch.hypothesis === undefined ? existing.hypothesis : patch.hypothesis,
    locales: patch.locales ?? existing.locales, metadataChanges: patch.metadataChanges ?? existing.metadataChanges,
    notes: patch.notes === undefined ? existing.notes : patch.notes,
    beforeStart: patch.beforeStart === undefined ? existing.beforeStart : patch.beforeStart,
    beforeEnd: patch.beforeEnd === undefined ? existing.beforeEnd : patch.beforeEnd,
    afterStart: patch.afterStart === undefined ? existing.afterStart : patch.afterStart,
    afterEnd: patch.afterEnd === undefined ? existing.afterEnd : patch.afterEnd,
  };
  validateWindowOrder(next.beforeStart, next.beforeEnd, next.afterStart, next.afterEnd);
  const seconds = Math.floor(now / 1_000);
  db.prepare(`
    UPDATE aso_experiments SET name = ?, status = ?, hypothesis = ?, locales_json = ?, metadata_changes_json = ?, notes = ?,
      before_start = ?, before_end = ?, after_start = ?, after_end = ?, updated_at = ? WHERE app_id = ? AND id = ?
  `).run(next.name, next.status, next.hypothesis, JSON.stringify(next.locales), JSON.stringify(next.metadataChanges), next.notes,
    next.beforeStart, next.beforeEnd, next.afterStart, next.afterEnd, seconds, appId, experimentId);
  appendExperimentEvent(experimentId, appId, 'updated', patch as Record<string, unknown>, now);
  return getAsoExperiment(appId, experimentId)!;
}

/** Soft delete: keeps experiment and event history available with includeArchived=1. */
export function archiveAsoExperiment(appId: string, experimentId: number, now = Date.now()): AsoExperiment | null {
  const existing = getAsoExperiment(appId, experimentId);
  if (!existing) return null;
  if (!existing.archivedAt) {
    const seconds = Math.floor(now / 1_000);
    db.prepare('UPDATE aso_experiments SET archived_at = ?, updated_at = ? WHERE app_id = ? AND id = ?').run(seconds, seconds, appId, experimentId);
    appendExperimentEvent(experimentId, appId, 'archived', { previousStatus: existing.status }, now);
  }
  return getAsoExperiment(appId, experimentId)!;
}
