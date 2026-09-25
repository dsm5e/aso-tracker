import { execFileSync } from "node:child_process";

/**
 * Deterministic Apple Ads acquisition economics from Adapty Analytics Export
 * API. Adapty resolves AdServices attribution in its iOS SDK; for Apple Ads the
 * `attribution_creative` segment is the numeric Apple keyword id.
 *
 * Revenue is requested with `date_type=profile_install_date`, so the selected
 * date range is an acquisition cohort rather than a transaction-date window.
 */
export interface KeywordRevenueRow {
  campaignId: number;
  keywordId: number;
  adGroupId: number | null;
  country: string | null;
  attributedInstalls: number;
  trials: number;
  paid: number;
  revenueUsd: number;
  windows: Array<{
    day: number;
    attributedInstalls: number;
    trials: number;
    paid: number;
    revenueUsd: number;
    fullyMature: boolean;
  }>;
}

export interface KeywordRevenuePayload {
  rows: KeywordRevenueRow[];
  bounded: true;
  window: { start: string; end: string };
  observedThrough: string;
}

interface AdaptyMetricRow {
  title?: string;
  type?: string;
  value?: number;
}

interface AdaptyMetric {
  data?: AdaptyMetricRow[];
}

type FetchLike = typeof fetch;

const ENDPOINT = "https://api-admin.adapty.io/api/v1/client-api/metrics/analytics/";

function analyticsKey(): string {
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

function metricByNumericId(metric?: AdaptyMetric): Map<number, number> {
  const values = new Map<number, number>();
  for (const row of metric?.data ?? []) {
    const id = Number(row.type || row.title);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    values.set(id, Number(row.value) || 0);
  }
  return values;
}

async function requestMetric(
  key: string,
  chartId: "installs" | "trials_new" | "subscriptions_new" | "revenue",
  cohortWindow: { start: string; end: string },
  segmentation: "attribution_creative" | "country",
  fetchImpl: FetchLike,
  country?: string,
): Promise<Record<string, AdaptyMetric>> {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Api-Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      chart_id: chartId,
      filters: {
        date: [cohortWindow.start, cohortWindow.end],
        store: ["app_store"],
        attribution_source: ["apple_search_ads"],
        attribution_status: ["non_organic"],
        // Adapty's analytics filter is case-sensitive here: country segment
        // rows use lowercase codes, while the filter requires ISO uppercase.
        ...(country ? { country: [country.toUpperCase()] } : {}),
      },
      period_unit: "day",
      date_type: "profile_install_date",
      segmentation,
      format: "json",
    }),
  });
  const json = await response.json().catch(() => null) as { data?: Record<string, AdaptyMetric>; detail?: string } | null;
  if (!response.ok) {
    throw new Error(`Adapty ${segmentation} analytics ${response.status}${json?.detail ? `: ${json.detail}` : ""}`);
  }
  return json?.data ?? {};
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchKeywordRevenue(
  cohortWindow: { start: string; end: string },
  options: { key?: string; fetchImpl?: FetchLike; throttleMs?: number; country?: string } = {},
): Promise<KeywordRevenuePayload> {
  const key = options.key ?? analyticsKey();
  const fetchImpl = options.fetchImpl ?? fetch;
  const throttleMs = options.throttleMs ?? 550; // documented limit: 2 req/s

  const installsBody = await requestMetric(key, "installs", cohortWindow, "attribution_creative", fetchImpl, options.country);
  if (throttleMs) await pause(throttleMs);
  const trialsBody = await requestMetric(key, "trials_new", cohortWindow, "attribution_creative", fetchImpl, options.country);
  if (throttleMs) await pause(throttleMs);
  const paidBody = await requestMetric(key, "subscriptions_new", cohortWindow, "attribution_creative", fetchImpl, options.country);
  if (throttleMs) await pause(throttleMs);
  const revenueBody = await requestMetric(key, "revenue", cohortWindow, "attribution_creative", fetchImpl, options.country);

  const installs = metricByNumericId(installsBody.common);
  const trials = metricByNumericId(trialsBody.common);
  const paid = metricByNumericId(paidBody.common);
  const revenue = metricByNumericId(revenueBody.net_revenue);
  const keywordIds = new Set([...installs.keys(), ...trials.keys(), ...paid.keys(), ...revenue.keys()]);

  return {
    rows: [...keywordIds].sort((a, b) => a - b).map((keywordId) => ({
      campaignId: 0, // resolved against the local Apple Ads keyword catalogue
      keywordId,
      adGroupId: null,
      country: options.country?.toUpperCase() ?? null,
      attributedInstalls: installs.get(keywordId) ?? 0,
      trials: trials.get(keywordId) ?? 0,
      paid: paid.get(keywordId) ?? 0,
      revenueUsd: revenue.get(keywordId) ?? 0,
      // Adapty exposes D0-D60 for the whole cohort, but not with keyword
      // segmentation. Keep this empty instead of manufacturing false windows.
      windows: [],
    })),
    bounded: true,
    window: cohortWindow,
    observedThrough: new Date().toISOString(),
  };
}

export async function fetchAdaptyGeoRevenue(
  cohortWindow: { start: string; end: string },
  options: { key?: string; fetchImpl?: FetchLike; throttleMs?: number } = {},
): Promise<Array<{ country: string; trials: number; paid: number; revenueUsd: number }>> {
  const key = options.key ?? analyticsKey();
  const fetchImpl = options.fetchImpl ?? fetch;
  const throttleMs = options.throttleMs ?? 550;
  const asCountryMap = (metric?: AdaptyMetric) => new Map(
    (metric?.data ?? [])
      .filter((row) => /^[A-Za-z]{2}$/.test(row.type ?? ""))
      .map((row) => [(row.type ?? "").toUpperCase(), Number(row.value) || 0]),
  );

  const trials = asCountryMap((await requestMetric(key, "trials_new", cohortWindow, "country", fetchImpl)).common);
  if (throttleMs) await pause(throttleMs);
  const paid = asCountryMap((await requestMetric(key, "subscriptions_new", cohortWindow, "country", fetchImpl)).common);
  if (throttleMs) await pause(throttleMs);
  const revenue = asCountryMap((await requestMetric(key, "revenue", cohortWindow, "country", fetchImpl)).net_revenue);
  const countries = new Set([...trials.keys(), ...paid.keys(), ...revenue.keys()]);

  return [...countries].map((country) => ({
    country,
    trials: trials.get(country) ?? 0,
    paid: paid.get(country) ?? 0,
    revenueUsd: revenue.get(country) ?? 0,
  })).sort((a, b) => b.revenueUsd - a.revenueUsd);
}
