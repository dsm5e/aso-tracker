import { execFileSync } from "node:child_process";
import type Database from "better-sqlite3";

type Json = Record<string, unknown>;

export interface AdaptyFunnelStage {
  installs: number;
  paywallViews: number;
  trials: number;
  paid: number;
  secondRenewals: number;
}

interface AdaptySegment {
  type?: string;
  title?: string;
  values?: Array<{ period?: number; value?: number }>;
}

interface CachedPayload {
  all: AdaptySegment[];
  nonOrganic: AdaptySegment[];
}

interface AdaptyCohortValueRaw {
  period?: number;
  installs?: number;
  subscriptions?: number;
  subscribers?: number;
  revenue_usd?: number;
  proceeds_usd?: number;
  net_revenue_usd?: number;
  currently_active_period?: boolean;
}

interface AdaptyCohortRaw {
  segment_start_date?: string;
  type?: string;
  title?: string;
  total_installs?: number;
  total_subscriptions?: number;
  total_paid_subscribers?: number;
  total_revenue_usd?: number;
  total_proceeds_usd?: number;
  total_net_revenue_usd?: number;
  values?: AdaptyCohortValueRaw[];
}

export interface AdaptyCohortValue {
  day: number;
  installs: number;
  paidSubscribers: number;
  netRevenueUsd: number;
  proceedsUsd: number;
  grossRevenueUsd: number;
  netRevenuePerInstall: number;
  mature: boolean;
}

export interface AdaptyCohortRow {
  startDate: string;
  endDate: string;
  title: string;
  installs: number;
  paidSubscribers: number;
  totalNetRevenueUsd: number;
  values: AdaptyCohortValue[];
}

interface CachedCohortPayload {
  rows: AdaptyCohortRaw[];
}

const EMPTY: AdaptyFunnelStage = { installs: 0, paywallViews: 0, trials: 0, paid: 0, secondRenewals: 0 };
const COHORT_DAYS = [0, 7, 14, 30, 60] as const;
const COHORT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

function stage(row?: AdaptySegment): AdaptyFunnelStage {
  if (!row) return { ...EMPTY };
  const values = new Map((row.values ?? []).map((value) => [Number(value.period), Number(value.value ?? 0)]));
  return {
    installs: values.get(-2) ?? 0,
    paywallViews: values.get(-1) ?? 0,
    trials: values.get(0) ?? 0,
    paid: values.get(1) ?? 0,
    secondRenewals: values.get(2) ?? 0,
  };
}

function secret(): string {
  if (process.env.ADAPTY_ANALYTICS_KEY) return process.env.ADAPTY_ANALYTICS_KEY;
  try {
    return execFileSync("gcloud", [
      "secrets", "versions", "access", "latest",
      `--secret=${process.env.ADAPTY_SECRET_NAME ?? "ADAPTY_SECRET_MEDSCAN"}`,
      `--project=${process.env.ADAPTY_GCP_PROJECT ?? "dream-journal-by-nomle"}`,
    ], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("Ключ аналитики Adapty недоступен в окружении и GCP Secret Manager.");
  }
}

async function adaptyFunnel(key: string, start: string, end: string, nonOrganic: boolean): Promise<AdaptySegment[]> {
  const filters: Json = { date: [start, end], store: ["app_store"] };
  if (nonOrganic) filters.attribution_status = ["non_organic"];
  const response = await fetch("https://api-admin.adapty.io/api/v1/client-api/metrics/funnel/", {
    method: "POST",
    headers: { authorization: `Api-Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ filters, period_unit: "month", show_value_as: "absolute", segmentation: "country" }),
  });
  const body = await response.json().catch(() => null) as { data?: AdaptySegment[]; detail?: string } | null;
  if (!response.ok) throw new Error(`Adapty funnel ${response.status}${body?.detail ? `: ${body.detail}` : ""}`);
  return Array.isArray(body?.data) ? body.data : [];
}

async function adaptyCohorts(key: string, start: string, end: string): Promise<AdaptyCohortRaw[]> {
  const response = await fetch("https://api-admin.adapty.io/api/v1/client-api/metrics/cohort/", {
    method: "POST",
    headers: { authorization: `Api-Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      filters: { date: [start, end], store: ["app_store"] },
      period_unit: "month",
      period_type: "days",
      value_type: "absolute",
      value_field: "revenue",
      accounting_type: "net_revenue",
      renewal_days: COHORT_DAYS,
      format: "json",
    }),
  });
  const body = await response.json().catch(() => null) as { data?: AdaptyCohortRaw[]; detail?: string } | null;
  if (!response.ok) throw new Error(`Adapty cohorts ${response.status}${body?.detail ? `: ${body.detail}` : ""}`);
  return Array.isArray(body?.data) ? body.data : [];
}

function iso(value: Date) {
  return value.toISOString().slice(0, 10);
}

function endOfMonth(start: string) {
  const [year, month] = start.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0));
}

export function completedCohortWindow(now = new Date(), months = 3) {
  const safeMonths = Math.max(1, Math.min(12, Math.floor(months)));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - safeMonths + 1, 1));
  return { start: iso(start), end: iso(end), months: safeMonths };
}

export function normalizeCohorts(raw: AdaptyCohortRaw[], dataAsOf: string): AdaptyCohortRow[] {
  const asOf = new Date(`${dataAsOf}T23:59:59.999Z`).getTime();
  return raw.filter((row) => row.type === "single" && /^\d{4}-\d{2}-\d{2}$/.test(row.segment_start_date ?? "")).map((row) => {
    const startDate = row.segment_start_date!;
    const cohortEnd = endOfMonth(startDate);
    const valuesByDay = new Map((row.values ?? []).map((value) => [Number(value.period), value]));
    const installs = Number(row.total_installs ?? 0);
    const values = COHORT_DAYS.map((day): AdaptyCohortValue => {
      const value = valuesByDay.get(day);
      const matureAt = cohortEnd.getTime() + day * 86_400_000;
      const netRevenueUsd = Number(value?.net_revenue_usd ?? 0);
      return {
        day,
        installs: Number(value?.installs ?? installs),
        paidSubscribers: Number(value?.subscribers ?? value?.subscriptions ?? 0),
        netRevenueUsd,
        proceedsUsd: Number(value?.proceeds_usd ?? 0),
        grossRevenueUsd: Number(value?.revenue_usd ?? 0),
        netRevenuePerInstall: installs > 0 ? netRevenueUsd / installs : 0,
        mature: asOf >= matureAt,
      };
    });
    return {
      startDate,
      endDate: iso(cohortEnd),
      title: row.title ?? startDate,
      installs,
      paidSubscribers: Number(row.total_paid_subscribers ?? row.total_subscriptions ?? 0),
      totalNetRevenueUsd: Number(row.total_net_revenue_usd ?? 0),
      values,
    };
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function matureSummary(rows: AdaptyCohortRow[]) {
  return COHORT_DAYS.map((day) => {
    const matureRows = rows.filter((row) => row.values.find((value) => value.day === day)?.mature);
    const values = matureRows.map((row) => row.values.find((value) => value.day === day)!);
    const installs = matureRows.reduce((sum, row) => sum + row.installs, 0);
    const netRevenueUsd = values.reduce((sum, value) => sum + value.netRevenueUsd, 0);
    return {
      day,
      cohorts: matureRows.length,
      installs,
      paidSubscribers: values.reduce((sum, value) => sum + value.paidSubscribers, 0),
      netRevenueUsd,
      netRevenuePerInstall: installs > 0 ? netRevenueUsd / installs : null,
    };
  });
}

function rowFor(rows: AdaptySegment[], country?: string) {
  if (!country) return rows.find((row) => row.type === "total");
  const title = displayNames.of(country.toUpperCase())?.toLocaleLowerCase();
  return rows.find((row) => row.type !== "total" && row.title?.toLocaleLowerCase() === title);
}

export class AdaptyAnalyticsService {
  private readonly db: Database.Database;
  private readonly appId: number;

  constructor(db: Database.Database, appId: number) {
    this.db = db;
    this.appId = appId;
    db.exec(`
      CREATE TABLE IF NOT EXISTS adapty_funnel_cache (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS adapty_cohort_cache (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  private cache(start: string, end: string) {
    const key = JSON.stringify({ appId: this.appId, start, end });
    const row = this.db.prepare(`SELECT payload, generated_at AS generatedAt, expires_at AS expiresAt FROM adapty_funnel_cache WHERE cache_key = ?`).get(key) as { payload: string; generatedAt: string; expiresAt: number } | undefined;
    if (!row) return null;
    try { return { key, data: JSON.parse(row.payload) as CachedPayload, generatedAt: row.generatedAt, expiresAt: row.expiresAt }; }
    catch { return null; }
  }

  async get(input: { appId: number; start: string; end: string; country?: string; force?: boolean }) {
    if (input.appId !== this.appId) {
      return { available: false, reason: "Для этого приложения не настроен аналитический ключ Adapty." };
    }
    const cacheKey = JSON.stringify({ appId: input.appId, start: input.start, end: input.end });
    const cached = this.cache(input.start, input.end);
    let payload = cached?.data;
    let generatedAt = cached?.generatedAt ?? null;
    let stale = Boolean(cached && cached.expiresAt <= Date.now());
    let refreshError: string | null = null;

    if (!payload || stale || input.force) {
      try {
        const key = secret();
        const all = await adaptyFunnel(key, input.start, input.end, false);
        await new Promise((resolve) => setTimeout(resolve, 600));
        const nonOrganic = await adaptyFunnel(key, input.start, input.end, true);
        payload = { all, nonOrganic };
        generatedAt = new Date().toISOString();
        stale = false;
        this.db.prepare(`
          INSERT INTO adapty_funnel_cache (cache_key,payload,generated_at,expires_at) VALUES (?,?,?,?)
          ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,generated_at=excluded.generated_at,expires_at=excluded.expires_at
        `).run(cacheKey, JSON.stringify(payload), generatedAt, Date.now() + 30 * 60_000);
      } catch (error) {
        refreshError = error instanceof Error ? error.message : String(error);
        if (!payload) return { available: false, reason: refreshError };
        stale = true;
      }
    }

    const knownCountries = this.db.prepare(`
      SELECT DISTINCT UPPER(country) AS country FROM asc_store_engagement_daily WHERE app_id = ? AND country <> ''
      UNION SELECT DISTINCT UPPER(country) FROM asa_campaigns WHERE app_id = ? AND country <> ''
    `).all(input.appId, input.appId) as Array<{ country: string }>;
    const countries = knownCountries.map(({ country }) => ({
      country,
      title: displayNames.of(country) ?? country,
      all: stage(rowFor(payload!.all, country)),
      nonOrganic: stage(rowFor(payload!.nonOrganic, country)),
    })).filter((row) => row.all.installs > 0 || row.nonOrganic.installs > 0).sort((a, b) => b.all.installs - a.all.installs);

    return {
      available: true,
      source: "Adapty Analytics API",
      generatedAt,
      stale,
      refreshError,
      country: input.country?.toUpperCase() ?? null,
      all: stage(rowFor(payload!.all, input.country)),
      nonOrganic: stage(rowFor(payload!.nonOrganic, input.country)),
      countries,
      window: { start: input.start, end: input.end },
      cohort: false,
      note: "Это периодный funnel Adapty; пользователи сгруппированы по событиям окна, а не по дате install cohort.",
    };
  }

  async getCohorts(input: { appId: number; months?: number; force?: boolean }) {
    if (input.appId !== this.appId) {
      return { available: false, reason: "Для этого приложения не настроен аналитический ключ Adapty." };
    }
    const window = completedCohortWindow(new Date(), input.months ?? 3);
    const cacheKey = JSON.stringify({ appId: input.appId, start: window.start, end: window.end, grain: "month", days: COHORT_DAYS });
    const cache = this.db.prepare(`SELECT payload, generated_at AS generatedAt, expires_at AS expiresAt FROM adapty_cohort_cache WHERE cache_key = ?`).get(cacheKey) as { payload: string; generatedAt: string; expiresAt: number } | undefined;
    let payload: CachedCohortPayload | null = null;
    if (cache) {
      try { payload = JSON.parse(cache.payload) as CachedCohortPayload; } catch { payload = null; }
    }
    let generatedAt = cache?.generatedAt ?? null;
    let stale = Boolean(cache && cache.expiresAt <= Date.now());
    let refreshError: string | null = null;

    if (!payload || stale || input.force) {
      try {
        const rows = await adaptyCohorts(secret(), window.start, window.end);
        payload = { rows };
        generatedAt = new Date().toISOString();
        stale = false;
        this.db.prepare(`
          INSERT INTO adapty_cohort_cache (cache_key,payload,generated_at,expires_at) VALUES (?,?,?,?)
          ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,generated_at=excluded.generated_at,expires_at=excluded.expires_at
        `).run(cacheKey, JSON.stringify(payload), generatedAt, Date.now() + COHORT_CACHE_TTL_MS);
      } catch (error) {
        refreshError = error instanceof Error ? error.message : String(error);
        if (!payload) return { available: false, reason: refreshError };
        stale = true;
      }
    }

    const rows = normalizeCohorts(payload.rows, window.end);
    return {
      available: true,
      source: "Adapty Analytics API",
      generatedAt,
      stale,
      refreshError,
      country: null,
      window: { start: window.start, end: window.end, months: window.months },
      days: [...COHORT_DAYS],
      rows,
      matureByDay: matureSummary(rows),
      summary: {
        cohorts: rows.length,
        installs: rows.reduce((sum, row) => sum + row.installs, 0),
        paidSubscribers: rows.reduce((sum, row) => sum + row.paidSubscribers, 0),
        totalNetRevenueUsd: rows.reduce((sum, row) => sum + row.totalNetRevenueUsd, 0),
      },
      maturityRule: "Окно Dn считается зрелым, когда n дней прошло после последнего дня набора месячной когорты.",
      limitation: "Когортный endpoint Adapty не применяет country-фильтр стабильно, поэтому этот срез явно показан по всем странам.",
    };
  }
}
