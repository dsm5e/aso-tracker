import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import "dotenv/config";
import { AsaApiError, AsaClient } from "../server/asa-client.ts";
import { loadConfig } from "../server/config.ts";

const START = "2026-06-01";
const END = "2026-08-31";
const APP_ID = 6762091560;
const OUTPUT = "/Users/qwar49/Desktop/MedScan_ASA_Adapty_3M_2026-06-01_2026-08-31.json";
const MONTHS = [
  { month: "2026-06", start: "2026-06-01", end: "2026-06-30" },
  { month: "2026-07", start: "2026-07-01", end: "2026-07-31" },
  { month: "2026-08", start: "2026-08-01", end: "2026-08-31" },
];

type Json = Record<string, any>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function adaptySecret(): string {
  return execFileSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", "--secret=ADAPTY_SECRET_MEDSCAN", "--project=dream-journal-by-nomle"],
    { encoding: "utf8" },
  ).trim();
}

async function adaptyPost(secret: string, path: "analytics" | "funnel", body: Json): Promise<Json> {
  await sleep(550);
  const response = await fetch(`https://api-admin.adapty.io/api/v1/client-api/metrics/${path}/`, {
    method: "POST",
    headers: {
      authorization: `Api-Key ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Adapty ${path} ${response.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as Json;
}

function analyticsRows(payload: Json, metric = "common"): Record<string, number> {
  const rows = payload?.data?.[metric]?.data ?? [];
  return Object.fromEntries(
    rows
      .filter((row: Json) => row.type !== "total")
      .map((row: Json) => [String(row.type), Number(row.value ?? 0)]),
  );
}

function analyticsBreakdown(payload: Json, metric: string): Array<{ key: string; title: string; value: number }> {
  return (payload?.data?.[metric]?.data ?? [])
    .filter((row: Json) => row.type !== "total")
    .map((row: Json) => ({ key: String(row.type), title: String(row.title ?? row.type), value: Number(row.value ?? 0) }))
    .sort((a: { value: number }, b: { value: number }) => b.value - a.value);
}

function funnelRows(payload: Json): Record<string, { installs: number; paywalls: number; trials: number; paid: number; period2: number }> {
  const out: Record<string, { installs: number; paywalls: number; trials: number; paid: number; period2: number }> = {};
  for (const row of payload?.data ?? []) {
    if (row.type === "total") continue;
    const values = new Map<number, number>(
      (row.values ?? []).map((value: Json): [number, number] => [Number(value.period), Number(value.value ?? 0)]),
    );
    out[String(row.title)] = {
      installs: values.get(-2) ?? 0,
      paywalls: values.get(-1) ?? 0,
      trials: values.get(0) ?? 0,
      paid: values.get(1) ?? 0,
      period2: values.get(2) ?? 0,
    };
  }
  return out;
}

function totalValue(payload: Json, metric: string): number {
  const total = (payload?.data?.[metric]?.data ?? []).find((row: Json) => row.type === "total");
  return Number(total?.value ?? payload?.data?.[metric]?.value ?? 0);
}

function appleMetrics(row: Json) {
  const total = row?.total ?? {};
  return {
    impressions: Number(total.impressions ?? 0),
    taps: Number(total.taps ?? 0),
    installs: Number(total.totalInstalls ?? 0),
    spend: Number(total.localSpend?.amount ?? 0),
    avgCpt: Number(total.avgCPT?.amount ?? 0),
    cpi: Number(total.totalAvgCPI?.amount ?? 0),
    ttr: Number(total.ttr ?? 0),
    installRate: Number(total.totalInstallRate ?? 0),
  };
}

async function campaignReport(
  asa: AsaClient,
  start = START,
  end = END,
  granularity: "DAILY" | "MONTHLY" = "MONTHLY",
): Promise<Json[]> {
  const response = await asa.req<Json>("POST", "/reports/campaigns", {
    body: {
      startTime: start,
      endTime: end,
      granularity,
      returnRowTotals: true,
      returnRecordsWithNoMetrics: true,
      selector: {
        conditions: [{ field: "deleted", operator: "IN", values: [true, false] }],
        orderBy: [{ field: "localSpend", sortOrder: "DESCENDING" }],
        pagination: { offset: 0, limit: 1000 },
      },
    },
  });
  return (response?.data?.reportingDataResponse?.row ?? []).filter(
    (row: Json) => Number(row?.metadata?.app?.adamId) === APP_ID,
  );
}

async function keywordReport(asa: AsaClient, campaignId: number): Promise<Json[]> {
  try {
    const response = await asa.req<Json>("POST", `/reports/campaigns/${campaignId}/keywords`, {
      body: {
        startTime: START,
        endTime: END,
        granularity: "MONTHLY",
        returnRowTotals: true,
        returnRecordsWithNoMetrics: false,
        selector: {
          conditions: [{ field: "deleted", operator: "IN", values: [true, false] }],
          orderBy: [{ field: "localSpend", sortOrder: "DESCENDING" }],
          pagination: { offset: 0, limit: 1000 },
        },
      },
    });
    return response?.data?.reportingDataResponse?.row ?? [];
  } catch (error) {
    if (error instanceof AsaApiError && [400, 404].includes(error.status)) return [];
    throw error;
  }
}

async function mapLimit<T, U>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function metricBundle(metrics: Record<string, Record<string, number>>, id: string) {
  return {
    installs: metrics.installs[id] ?? 0,
    trials: metrics.trials[id] ?? 0,
    paid: metrics.paid[id] ?? 0,
    grossRevenue: metrics.grossRevenue[id] ?? 0,
    proceeds: metrics.proceeds[id] ?? 0,
    netRevenue: metrics.netRevenue[id] ?? 0,
  };
}

async function main() {
  const asa = new AsaClient(loadConfig().asa);
  const secret = adaptySecret();

  const campaignsRaw = await campaignReport(asa);
  console.log(`Apple campaigns: ${campaignsRaw.length}`);
  const keywordBatches = await mapLimit(campaignsRaw, 5, async (row, index) => {
    const rows = await keywordReport(asa, Number(row.metadata.campaignId));
    if ((index + 1) % 10 === 0 || index + 1 === campaignsRaw.length) {
      console.log(`Apple keyword reports: ${index + 1}/${campaignsRaw.length}`);
    }
    return rows;
  });
  const keywordsRaw = keywordBatches.flat();

  const baseFilters = { date: [START, END], store: ["app_store"] };
  const paidFilters = { ...baseFilters, attribution_status: ["non_organic"] };
  const charts = ["installs", "trials_new", "subscriptions_new", "revenue"] as const;
  const adapty: Json = { campaign: {}, creative: {} };

  for (const segmentation of ["attribution_campaign", "attribution_creative"] as const) {
    const target = segmentation === "attribution_campaign" ? adapty.campaign : adapty.creative;
    for (const chart of charts) {
      target[chart] = await adaptyPost(secret, "analytics", {
        chart_id: chart,
        filters: paidFilters,
        period_unit: "month",
        segmentation,
      });
    }
    target.funnel = await adaptyPost(secret, "funnel", {
      filters: paidFilters,
      period_unit: "month",
      show_value_as: "absolute",
      segmentation,
    });
  }

  const totalRevenue = await adaptyPost(secret, "analytics", {
    chart_id: "revenue",
    filters: baseFilters,
    period_unit: "month",
    segmentation: "attribution_status",
  });
  const revenueByCountry = await adaptyPost(secret, "analytics", {
    chart_id: "revenue",
    filters: baseFilters,
    period_unit: "month",
    segmentation: "country",
  });
  const attributedRevenueByCountry = await adaptyPost(secret, "analytics", {
    chart_id: "revenue",
    filters: paidFilters,
    period_unit: "month",
    segmentation: "country",
  });
  const revenueByProduct = await adaptyPost(secret, "analytics", {
    chart_id: "revenue",
    filters: baseFilters,
    period_unit: "month",
    segmentation: "store_product_id",
  });

  const monthly = [];
  for (const period of MONTHS) {
    const filters = { date: [period.start, period.end], store: ["app_store"] };
    const nonOrganicFilters = { ...filters, attribution_status: ["non_organic"] };
    const [appleRows, allRevenue, attributedRevenue] = await Promise.all([
      campaignReport(asa, period.start, period.end, "DAILY"),
      adaptyPost(secret, "analytics", {
        chart_id: "revenue",
        filters,
        period_unit: "month",
        segmentation: "attribution_status",
      }),
      adaptyPost(secret, "analytics", {
        chart_id: "revenue",
        filters: nonOrganicFilters,
        period_unit: "month",
        segmentation: "attribution_status",
      }),
    ]);
    const apple = appleRows.reduce(
      (sum, row) => {
        const metrics = appleMetrics(row);
        sum.spend += metrics.spend;
        sum.impressions += metrics.impressions;
        sum.taps += metrics.taps;
        sum.installs += metrics.installs;
        return sum;
      },
      { spend: 0, impressions: 0, taps: 0, installs: 0 },
    );
    const attributedNet = totalValue(attributedRevenue, "net_revenue");
    monthly.push({
      ...period,
      apple,
      adapty: {
        grossRevenue: totalValue(allRevenue, "revenue"),
        proceeds: totalValue(allRevenue, "proceeds"),
        netRevenue: totalValue(allRevenue, "net_revenue"),
        attributedGrossRevenue: totalValue(attributedRevenue, "revenue"),
        attributedNetRevenue: attributedNet,
      },
      attributedNetRoas: apple.spend > 0 ? attributedNet / apple.spend : null,
    });
  }

  function extractMetrics(source: Json) {
    return {
      installs: analyticsRows(source.installs),
      trials: analyticsRows(source.trials_new),
      paid: analyticsRows(source.subscriptions_new),
      grossRevenue: analyticsRows(source.revenue, "revenue"),
      proceeds: analyticsRows(source.revenue, "proceeds"),
      netRevenue: analyticsRows(source.revenue, "net_revenue"),
    };
  }

  const campaignMetrics = extractMetrics(adapty.campaign);
  const creativeMetrics = extractMetrics(adapty.creative);
  const campaignFunnel = funnelRows(adapty.campaign.funnel);
  const creativeFunnel = funnelRows(adapty.creative.funnel);

  const campaignById = new Map(campaignsRaw.map((row) => [String(row.metadata.campaignId), row]));
  const campaignTable = campaignsRaw.map((row) => {
    const id = String(row.metadata.campaignId);
    const apple = appleMetrics(row);
    const revenue = metricBundle(campaignMetrics, id);
    const funnel = campaignFunnel[id] ?? { installs: 0, paywalls: 0, trials: 0, paid: 0, period2: 0 };
    return {
      id,
      name: row.metadata.campaignName,
      countries: row.metadata.countriesOrRegions,
      deleted: Boolean(row.metadata.deleted),
      displayStatus: row.metadata.displayStatus,
      ...apple,
      adapty: revenue,
      funnel,
      netRoas: apple.spend > 0 ? revenue.netRevenue / apple.spend : null,
      grossRoas: apple.spend > 0 ? revenue.grossRevenue / apple.spend : null,
      trialRate: funnel.installs > 0 ? funnel.trials / funnel.installs : null,
      paidRate: funnel.installs > 0 ? funnel.paid / funnel.installs : null,
    };
  });

  const keywordTable = keywordsRaw.map((row) => {
    const id = String(row.metadata.keywordId);
    const campaignId = String(row.metadata.campaignId);
    const campaign = campaignById.get(campaignId);
    const apple = appleMetrics(row);
    const revenue = metricBundle(creativeMetrics, id);
    const funnel = creativeFunnel[id] ?? { installs: 0, paywalls: 0, trials: 0, paid: 0, period2: 0 };
    return {
      id,
      campaignId,
      campaignName: campaign?.metadata?.campaignName ?? row.metadata.campaignName,
      text: row.metadata.keyword,
      matchType: row.metadata.matchType,
      adGroupId: String(row.metadata.adGroupId ?? ""),
      deleted: Boolean(row.metadata.deleted),
      bid: Number(row.metadata.bidAmount?.amount ?? 0),
      ...apple,
      adapty: revenue,
      funnel,
      netRoas: apple.spend > 0 ? revenue.netRevenue / apple.spend : null,
      grossRoas: apple.spend > 0 ? revenue.grossRevenue / apple.spend : null,
      trialRate: funnel.installs > 0 ? funnel.trials / funnel.installs : null,
      paidRate: funnel.installs > 0 ? funnel.paid / funnel.installs : null,
    };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    window: { start: START, end: END, threeCompleteCalendarMonths: true },
    app: { adamId: APP_ID, name: "DICOM Viewer: MedScan CT MRI" },
    monthly,
    totals: {
      grossRevenue: totalValue(totalRevenue, "revenue"),
      proceeds: totalValue(totalRevenue, "proceeds"),
      netRevenue: totalValue(totalRevenue, "net_revenue"),
      attributionStatusGross: analyticsBreakdown(totalRevenue, "revenue"),
      attributionStatusNet: analyticsBreakdown(totalRevenue, "net_revenue"),
      revenueByCountryGross: analyticsBreakdown(revenueByCountry, "revenue"),
      revenueByCountryNet: analyticsBreakdown(revenueByCountry, "net_revenue"),
      attributedRevenueByCountryGross: analyticsBreakdown(attributedRevenueByCountry, "revenue"),
      attributedRevenueByCountryNet: analyticsBreakdown(attributedRevenueByCountry, "net_revenue"),
      revenueByProductGross: analyticsBreakdown(revenueByProduct, "revenue"),
      revenueByProductNet: analyticsBreakdown(revenueByProduct, "net_revenue"),
    },
    campaigns: campaignTable.sort((a, b) => b.adapty.netRevenue - a.adapty.netRevenue),
    keywords: keywordTable.sort((a, b) => b.adapty.netRevenue - a.adapty.netRevenue),
    unmatchedAdapty: { campaign: campaignMetrics, creative: creativeMetrics },
  };

  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUTPUT, campaigns: campaignTable.length, keywords: keywordTable.length }, null, 2));
}

await main();
