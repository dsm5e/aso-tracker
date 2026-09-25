import { randomUUID } from "node:crypto";
import { request } from "undici";
import type { AsaClient } from "./asa-client.ts";

const PLATFORM_BASE_URL = "https://api.ads.apple.com/v1";
const DEFAULT_CACHE_MS = 15 * 60_000;
const ACCOUNT_CACHE_MS = 60 * 60_000;
const MAX_PAGES = 20;
const APPLE_MAX_PAGE_SIZE = 1_000;

type JsonRecord = Record<string, unknown>;

// Keep this shared with the durable snapshot layer.  Apple responses should
// never contain credentials, but an upstream error/proxy echo must not turn a
// diagnostic into a secret disclosure.
const SENSITIVE_KEY = /(authorization|(?:access|refresh|id)[._-]?token|token|client[._-]?secret|private[._-]?key|password|api[._-]?key|credential|secret)/i;

export function isSensitivePlatformKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redactPlatformText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/((?:authorization|(?:access|refresh|id)[._-]?token|token|client[._-]?secret|private[._-]?key|password|api[._-]?key|credential|secret)["']?\s*[:=]\s*["']?)[^\s,}\]"']+/gi, "$1[redacted]");
}

export interface PlatformTransportResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  text(): Promise<string>;
}

export type PlatformTransport = (
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
) => Promise<PlatformTransportResponse>;

export interface PlatformRequestMeta {
  request: {
    method: "GET" | "POST";
    path: string;
    correlationId: string;
    body?: unknown;
  };
  response: {
    status: number;
    requestId?: string;
    pagination?: PlatformPagination;
    topLevelFields: string[];
  };
  attempts: number;
  durationMs: number;
  fetchedAt: string;
  cached: boolean;
}

export interface PlatformRead<T> {
  data: T;
  meta: PlatformRequestMeta;
}

export interface PlatformPagination {
  totalCount?: number;
  offset?: number;
  pageSize?: number;
}

export interface PlatformAccount {
  adAccountId: string;
  orgId?: string;
  role?: string;
  raw: JsonRecord;
}

export class PlatformApiError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    requestId?: string,
    retryable = false,
  ) {
    super(message);
    this.status = status;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

interface CacheEntry<T> {
  expiresAt: number;
  value: PlatformRead<T>;
}

interface RequestOptions {
  body?: unknown;
  accountContext?: boolean;
  cacheMs?: number;
  forceRefresh?: boolean;
}

function defaultTransport(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
): Promise<PlatformTransportResponse> {
  // Undici otherwise allows an upstream socket to keep the composite traffic
  // request open indefinitely. One slow Apple endpoint must degrade to a
  // partial result instead of trapping the dashboard in a loading state.
  return request(url, { ...init, signal: AbortSignal.timeout(10_000) }).then((res) => ({
    statusCode: res.statusCode,
    headers: res.headers as Record<string, string | string[] | undefined>,
    text: () => res.body.text(),
  }));
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  const output: JsonRecord = {};
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    output[key] = isSensitivePlatformKey(key)
      ? "[redacted]"
      : sanitize(child);
  }
  return output;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function paginationOf(payload: unknown): PlatformPagination | undefined {
  const p = asRecord(asRecord(payload).pagination);
  if (!Object.keys(p).length) return undefined;
  return {
    totalCount: typeof p.totalCount === "number" ? p.totalCount : undefined,
    offset: typeof p.offset === "number" ? p.offset : undefined,
    pageSize: typeof p.pageSize === "number" ? p.pageSize : undefined,
  };
}

function resultRows(payload: unknown): unknown[] {
  const root = asRecord(payload);
  const result = root.result;
  if (Array.isArray(result)) return result;
  const rows = asRecord(result).rows;
  if (Array.isArray(rows)) return rows;
  const data = root.data;
  if (Array.isArray(data)) return data;
  return [];
}

function resultObject(payload: unknown): unknown {
  const root = asRecord(payload);
  return root.result ?? root.data ?? null;
}

export class PlatformApiClient {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<PlatformRead<unknown>>>();
  private accountCache?: { expiresAt: number; value: PlatformAccount };
  private accountInflight?: Promise<PlatformAccount>;
  private readonly tokenProvider: Pick<AsaClient, "token">;
  private readonly preferredOrgId?: string;
  private readonly transport: PlatformTransport;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxConcurrency: number;
  private activeTransports = 0;
  private readonly transportWaiters: Array<() => void> = [];

  constructor(
    tokenProvider: Pick<AsaClient, "token">,
    preferredOrgId?: string,
    transport: PlatformTransport = defaultTransport,
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxConcurrency = 2,
  ) {
    this.tokenProvider = tokenProvider;
    this.preferredOrgId = preferredOrgId;
    this.transport = transport;
    this.sleep = sleep;
    this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
  }

  private async runTransport<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeTransports >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.transportWaiters.push(resolve));
    }
    this.activeTransports += 1;
    try {
      return await operation();
    } finally {
      this.activeTransports -= 1;
      this.transportWaiters.shift()?.();
    }
  }

  async resolveAdAccount(): Promise<PlatformAccount> {
    if (this.accountCache && this.accountCache.expiresAt > Date.now()) return this.accountCache.value;
    if (this.accountInflight) return this.accountInflight;
    this.accountInflight = (async () => {
      try {
        const read = await this.read<unknown>("GET", "/acls", { accountContext: false, cacheMs: ACCOUNT_CACHE_MS });
        const result = asRecord(asRecord(read.data).result);
        const rows = (Array.isArray(result.acls) ? result.acls : resultRows(read.data)).map(asRecord);
        if (!rows.length) throw new PlatformApiError("Apple Ads ACL returned no accessible ad accounts", 404);
        const preferred = rows.find((row) => {
          const nestedAccount = asRecord(row.adAccount);
          const org = row.orgId ?? row.organizationId ?? nestedAccount.orgId ?? asRecord(row.org).id;
          return this.preferredOrgId !== undefined && String(org) === this.preferredOrgId;
        });
        const raw = preferred ?? rows[0];
        const nested = asRecord(raw.adAccount);
        const id = raw.adAccountId ?? nested.id ?? raw.id;
        if (id === undefined || id === null || String(id) === "") {
          throw new PlatformApiError("Apple Ads ACL response is missing adAccountId", 502);
        }
        const account: PlatformAccount = {
          adAccountId: String(id),
          orgId: (raw.orgId ?? nested.orgId) === undefined ? undefined : String(raw.orgId ?? nested.orgId),
          role: raw.role === undefined
            ? Array.isArray(raw.roles) && raw.roles[0] !== undefined ? String(raw.roles[0]) : undefined
            : String(raw.role),
          raw,
        };
        this.accountCache = { expiresAt: Date.now() + ACCOUNT_CACHE_MS, value: account };
        return account;
      } finally {
        this.accountInflight = undefined;
      }
    })();
    return this.accountInflight;
  }

  async read<T>(method: "GET" | "POST", path: string, options: RequestOptions = {}): Promise<PlatformRead<T>> {
    if (method !== "GET" && method !== "POST") throw new Error("PlatformApiClient is read-only");
    const key = JSON.stringify([method, path, options.body ?? null, options.accountContext !== false]);
    const cached = this.cache.get(key);
    if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
      const value = cached.value as PlatformRead<T>;
      return { data: value.data, meta: { ...value.meta, cached: true } };
    }
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<PlatformRead<T>>;

    const promise = this.perform<T>(method, path, options);
    this.inflight.set(key, promise as Promise<PlatformRead<unknown>>);
    try {
      const value = await promise;
      const ttl = options.cacheMs ?? DEFAULT_CACHE_MS;
      if (ttl > 0) this.cache.set(key, { expiresAt: Date.now() + ttl, value });
      return value;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async perform<T>(method: "GET" | "POST", path: string, options: RequestOptions): Promise<PlatformRead<T>> {
    const startedAt = Date.now();
    const correlationId = randomUUID();
    const token = await this.tokenProvider.token();
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "x-correlation-id": correlationId,
    };
    if (options.accountContext !== false) {
      const account = await this.resolveAdAccount();
      headers["x-ap-context"] = `adAccountId=${account.adAccountId}`;
    }
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let attempts = 0;
    while (attempts < 4) {
      attempts += 1;
      let response: PlatformTransportResponse;
      try {
        response = await this.runTransport(() => this.transport(`${PLATFORM_BASE_URL}${path}`, { method, headers, body }));
      } catch (error) {
        if (attempts < 4) {
          await this.sleep(Math.min(2_000, 250 * 2 ** (attempts - 1)));
          continue;
        }
        throw new PlatformApiError(
          `Apple Ads ${method} ${path} transport failed: ${error instanceof Error ? redactPlatformText(error.message).slice(0, 240) : "unknown error"}`,
          503,
          undefined,
          true,
        );
      }
      const text = await response.text();
      const requestId = header(response.headers, "x-request-id") ?? header(response.headers, "x-apple-request-uuid");
      if (response.statusCode >= 200 && response.statusCode < 300) {
        let parsed: unknown = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new PlatformApiError(`Apple Ads returned invalid JSON for ${method} ${path}`, 502, requestId);
          }
        }
        const root = asRecord(parsed);
        return {
          data: parsed as T,
          meta: {
            request: { method, path, correlationId, body: sanitize(options.body) },
            response: {
              status: response.statusCode,
              requestId,
              pagination: paginationOf(parsed),
              topLevelFields: Object.keys(root),
            },
            attempts,
            durationMs: Date.now() - startedAt,
            fetchedAt: new Date().toISOString(),
            cached: false,
          },
        };
      }

      const retryable = response.statusCode === 429 || response.statusCode >= 500;
      if (retryable && attempts < 4) {
        const retryAfter = header(response.headers, "retry-after");
        const seconds = retryAfter === undefined ? Number.NaN : Number(retryAfter);
        const delay = Number.isFinite(seconds)
          ? Math.min(5_000, Math.max(0, seconds * 1000))
          : Math.min(2_000, 250 * 2 ** (attempts - 1));
        await this.sleep(delay);
        continue;
      }
      let apiMessage = "";
      try {
        const parsed = asRecord(JSON.parse(text));
        apiMessage = String(parsed.message ?? asRecord(parsed.error).message ?? "");
      } catch { /* non-JSON error body */ }
      throw new PlatformApiError(
        `Apple Ads ${method} ${path} failed (${response.statusCode})${apiMessage ? `: ${redactPlatformText(apiMessage).slice(0, 240)}` : ""}`,
        response.statusCode,
        requestId,
        retryable,
      );
    }
    throw new PlatformApiError(`Apple Ads ${method} ${path} exhausted retries`, 503, undefined, true);
  }

  async queryRows<T extends JsonRecord>(path: string, body: JsonRecord, pageSize = 5000, forceRefresh = false): Promise<PlatformRead<T[]>> {
    const items: T[] = [];
    const pageMeta: PlatformRequestMeta[] = [];
    // Platform API query endpoints currently reject page sizes above 1,000.
    // Keep callers free to express a desired batch size, but never send an
    // invalid value upstream (several typed collectors historically used
    // 5,000, which made otherwise valid reads fail with HTTP 400).
    const effectivePageSize = Math.max(1, Math.min(APPLE_MAX_PAGE_SIZE, Math.floor(pageSize)));
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const pageBody = { ...body, pagination: { offset, pageSize: effectivePageSize } };
      const read = await this.read<unknown>("POST", path, { body: pageBody, forceRefresh });
      const rows = resultRows(read.data) as T[];
      items.push(...rows);
      pageMeta.push(read.meta);
      const pagination = paginationOf(read.data);
      const total = pagination?.totalCount;
      if (!rows.length || (total !== undefined ? items.length >= total : rows.length < effectivePageSize)) break;
      offset += pagination?.pageSize ?? rows.length;
    }
    const last = pageMeta.at(-1);
    if (!last) throw new PlatformApiError(`Apple Ads ${path} returned no pages`, 502);
    return {
      data: items,
      meta: {
        ...last,
        response: {
          ...last.response,
          pagination: { totalCount: items.length, offset: 0, pageSize: effectivePageSize },
        },
        attempts: pageMeta.reduce((sum, meta) => sum + meta.attempts, 0),
        durationMs: pageMeta.reduce((sum, meta) => sum + meta.durationMs, 0),
        cached: pageMeta.every((meta) => meta.cached),
      },
    };
  }

  async queryObject<T>(path: string, body: JsonRecord): Promise<PlatformRead<T | null>> {
    const read = await this.read<unknown>("POST", path, { body });
    return { data: resultObject(read.data) as T | null, meta: read.meta };
  }
}

export function appleFilter(field: string, operator: string, value: unknown): JsonRecord {
  return { field, operator, value };
}
