import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { importPKCS8, SignJWT } from "jose";

const START = "2026-05-17";
const END = "2026-08-14";
const APP_ID = "6762091560";
const AD_ACCOUNT_ID = "21686690";
const OUTPUT = "/Users/qwar49/Desktop/MedScan_ASA_raw_2026-08-15.json";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function appleToken(): Promise<string> {
  const clientId = "SEARCHADS.6b2a137a-cae0-4ce1-a738-a4b5def9e427";
  const keyId = "909ba158-c703-4e6c-a0e2-8304e1b2698e";
  const key = await importPKCS8(readFileSync("/Users/qwar49/.aso-studio/keys/asa-private.p8", "utf8"), "ES256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: assertion,
    scope: "searchadsorg",
  });
  const response = await fetch("https://appleid.apple.com/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Apple OAuth ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function applePost(token: string, path: string, body: unknown): Promise<any> {
  const response = await fetch(`https://api.ads.apple.com/v1${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-ap-context": `adAccountId=${AD_ACCOUNT_ID}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Apple ${path} ${response.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text);
}

function adaptyToken(): string {
  return execFileSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", "--secret=ADAPTY_SECRET_MEDSCAN", "--project=dream-journal-by-nomle"],
    { encoding: "utf8" },
  ).trim();
}

async function adaptyPost(token: string, path: string, body: unknown): Promise<any> {
  await sleep(600);
  const response = await fetch(`https://api-admin.adapty.io/api/v1/client-api/metrics/${path}/`, {
    method: "POST",
    headers: { authorization: `Api-Key ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Adapty ${path} ${response.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text);
}

function segmentRows(payload: any, metric = "common"): Record<string, number> {
  const rows = payload?.data?.[metric]?.data ?? [];
  return Object.fromEntries(rows.filter((row: any) => row.type !== "total").map((row: any) => [String(row.type), Number(row.value)]));
}

function totalMetrics(row: any) {
  const metrics = row?.totalMetrics ?? {};
  return {
    impressions: Number(metrics.impressions ?? 0),
    taps: Number(metrics.taps ?? 0),
    installs: Number(metrics.totalInstalls ?? metrics.tapInstalls ?? metrics.installs ?? 0),
    spend: Number(metrics.localSpend?.amount ?? metrics.spend?.amount ?? metrics.localSpend ?? 0),
    avgCpt: Number(metrics.avgCPT?.amount ?? metrics.avgCpt?.amount ?? 0),
    avgCpi: Number(metrics.totalAvgCPI?.amount ?? metrics.avgCPI?.amount ?? metrics.avgCpi?.amount ?? 0),
  };
}

function dateSlice(row: any, from: string) {
  const out = { impressions: 0, taps: 0, installs: 0, spend: 0 };
  for (const point of row?.granularMetrics ?? []) {
    const date = String(point.date ?? point.timePeriod?.start ?? "").slice(0, 10);
    if (date < from) continue;
    const m = point.metrics ?? point;
    out.impressions += Number(m.impressions ?? 0);
    out.taps += Number(m.taps ?? 0);
    out.installs += Number(m.totalInstalls ?? m.tapInstalls ?? m.installs ?? 0);
    out.spend += Number(m.localSpend?.amount ?? m.spend?.amount ?? m.localSpend ?? 0);
  }
  return out;
}

async function main() {
  const [asaToken, adaptyKey] = await Promise.all([appleToken(), Promise.resolve(adaptyToken())]);
  const baseReport = {
    timeRange: { start: START, end: END, timeZone: "ORTZ", granularity: "DAILY" },
  };
  const campaignResponse = await applePost(asaToken, "/campaigns/query", {
    filters: [{ field: "promotedObjectId", operator: "EQUALS", value: APP_ID }],
  });
  const campaigns = campaignResponse.result ?? [];
  const campaignDefinitionById = new Map(campaigns.map((campaign: any) => [String(campaign.id), campaign]));
  const campaignIds = new Set(campaigns.map((campaign: any) => String(campaign.id)));
  const campaignReportResponse = await applePost(asaToken, "/reports/apps/campaigns/query", baseReport);
  const campaignRows = (campaignReportResponse.result?.rows ?? []).filter(
    (row: any) => String(row.metadata?.promotedObjectId ?? row.metadata?.adamId ?? "") === APP_ID || campaignIds.has(String(row.metadata?.id)),
  );

  const keywordRows: any[] = [];
  for (const campaign of campaigns) {
    const response = await applePost(asaToken, "/reports/apps/keywords/query", {
      ...baseReport,
      filters: [{ field: "campaignId", operator: "EQUALS", value: Number(campaign.id) }],
    });
    keywordRows.push(...(response.result?.rows ?? []));
  }

  const impressionShareResponse = await applePost(asaToken, "/insights/apps/impression-share/query", {
    filters: [
      { field: "promotedObjectId", operator: "IN", value: [APP_ID] },
      { field: "countryOrRegion", operator: "IN", value: ["DE", "US", "GB", "AU"] },
    ],
    options: { impressionShareReportType: "ALL_SLOTS" },
    timeRange: { start: "2026-07-16", end: "2026-08-14", granularity: "DAILY" },
    pagination: { offset: 0, pageSize: 5000 },
  });

  const charts = ["installs", "trials_new", "subscriptions_new", "revenue"];
  const adapty: Record<string, any> = { campaign: {}, keyword: {} };
  for (const segmentation of ["attribution_campaign", "attribution_creative"] as const) {
    const target = segmentation === "attribution_campaign" ? adapty.campaign : adapty.keyword;
    for (const chart of charts) {
      target[chart] = await adaptyPost(adaptyKey, "analytics", {
        chart_id: chart,
        filters: { date: [START, END], attribution_status: ["non_organic"] },
        period_unit: "month",
        segmentation,
        format: "json",
      });
    }
  }

  const campaignMetric = {
    installs: segmentRows(adapty.campaign.installs),
    trials: segmentRows(adapty.campaign.trials_new),
    paid: segmentRows(adapty.campaign.subscriptions_new),
    grossRevenue: segmentRows(adapty.campaign.revenue, "revenue"),
    netRevenue: segmentRows(adapty.campaign.revenue, "net_revenue"),
  };
  const keywordMetric = {
    installs: segmentRows(adapty.keyword.installs),
    trials: segmentRows(adapty.keyword.trials_new),
    paid: segmentRows(adapty.keyword.subscriptions_new),
    grossRevenue: segmentRows(adapty.keyword.revenue, "revenue"),
    netRevenue: segmentRows(adapty.keyword.revenue, "net_revenue"),
  };

  const campaignTable = campaignRows.map((row: any) => {
    const id = String(row.metadata?.id ?? row.metadata?.campaignId);
    const definition: any = campaignDefinitionById.get(id);
    const apple = totalMetrics(row);
    return {
      id,
      name: row.metadata?.name ?? definition?.name,
      country: definition?.targeting?.countryOrRegion?.include?.[0] ?? definition?.countriesOrRegions?.[0],
      status: row.metadata?.status ?? definition?.status,
      ...apple,
      last30: dateSlice(row, "2026-07-16"),
      last14: dateSlice(row, "2026-08-01"),
      adaptyInstalls: campaignMetric.installs[id] ?? 0,
      trials: campaignMetric.trials[id] ?? 0,
      paid: campaignMetric.paid[id] ?? 0,
      grossRevenue: campaignMetric.grossRevenue[id] ?? 0,
      netRevenue: campaignMetric.netRevenue[id] ?? 0,
    };
  });

  const keywordTable = keywordRows.map((row: any) => {
    const id = String(row.metadata?.id ?? row.metadata?.keywordId);
    const campaignId = String(row.metadata?.campaignId);
    const definition: any = campaignDefinitionById.get(campaignId);
    const apple = totalMetrics(row);
    return {
      id,
      campaignId,
      campaignName: row.metadata?.campaignName ?? definition?.name,
      country: definition?.targeting?.countryOrRegion?.include?.[0] ?? definition?.countriesOrRegions?.[0],
      adGroupId: String(row.metadata?.adGroupId),
      adGroupName: row.metadata?.adGroupName,
      text: row.metadata?.text,
      matchType: row.metadata?.matchType,
      status: row.metadata?.status,
      bid: Number(row.metadata?.bid?.amount ?? row.metadata?.bidAmount?.amount ?? 0),
      ...apple,
      last30: dateSlice(row, "2026-07-16"),
      last14: dateSlice(row, "2026-08-01"),
      adaptyInstalls: keywordMetric.installs[id] ?? 0,
      trials: keywordMetric.trials[id] ?? 0,
      paid: keywordMetric.paid[id] ?? 0,
      grossRevenue: keywordMetric.grossRevenue[id] ?? 0,
      netRevenue: keywordMetric.netRevenue[id] ?? 0,
    };
  });

  const cohorts: Record<string, any> = {};
  for (const campaign of campaignTable.filter((row: any) => ["DE", "US", "GB"].includes(row.country))) {
    const response = await adaptyPost(adaptyKey, "cohort", {
      filters: { date: [START, END], attribution_status: ["non_organic"], attribution_campaign: [campaign.id] },
      period_unit: "month",
      period_type: "days",
      value_type: "absolute",
      value_field: "revenue",
      accounting_type: "net_revenue",
      renewal_days: [0, 7, 14, 30, 60, 90],
      format: "json",
    });
    cohorts[campaign.country] = response.data;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    window: { start: START, end: END, currentDayExcluded: true },
    exclusions: { dummyCampaignId: "1234567890", dummyKeywordId: "12323222" },
    campaignDefinitions: campaigns,
    impressionShare: impressionShareResponse,
    campaigns: campaignTable,
    keywords: keywordTable,
    adaptyMetrics: { campaign: campaignMetric, keyword: keywordMetric },
    cohorts,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUTPUT, campaigns: campaignTable.length, keywords: keywordTable.length }, null, 2));
}

await main();
