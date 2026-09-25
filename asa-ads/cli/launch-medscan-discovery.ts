import "dotenv/config";
import { loadConfig } from "../server/config.ts";
import { openDb } from "../server/db.ts";
import { AsaClient, type RawCampaign, type RawKeyword } from "../server/asa-client.ts";
import { syncAdGroupsAndKeywords, syncCampaigns } from "../server/sync.ts";

const APP_ID = 6762091560;
const COMPETITOR_CAMPAIGN_ID = 2144500912;
const DISCOVERY_NAME = "DISCOVERY — All Geos";
const DAILY_BUDGET = "3.00";
const DEFAULT_BID = "0.10";
const SEARCH_MATCH_GROUP = "Search Match — global";
const BROAD_GROUP = "Broad expansion — global";

const BROAD_KEYWORDS = [
  "dicom viewer",
  "cbct viewer",
  "x-ray viewer",
  "pacs viewer",
  "medical imaging",
  "radiology viewer",
];

const CORE_EXACT_NEGATIVES = [
  "medscan",
  "dicom",
  "dicom viewer",
  "cbct",
  "cbct viewer",
  "pacs",
  "pacs mobile",
  "raio x",
  "visualizador dicom",
  "x-ray",
  "radiology app",
  "exocad",
];

type RecordLike = Record<string, any>;

const unwrap = <T>(value: any): T => (value?.data ?? value) as T;
const normalize = (value: string) => value.trim().toLocaleLowerCase();
const sameSet = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value) => right.includes(value));

async function ensureCompetitorKeyword(asa: AsaClient): Promise<void> {
  const campaign = (await asa.listCampaigns()).find(
    (candidate) => candidate.id === COMPETITOR_CAMPAIGN_ID && candidate.adamId === APP_ID,
  );
  if (!campaign) throw new Error("MedScan competitor campaign is missing");

  const groups = await asa.listAdGroups(campaign.id);
  const group = groups.find((candidate) => candidate.status === "ENABLED") ?? groups[0];
  if (!group) throw new Error("MedScan competitor ad group is missing");

  const keywords = await asa.listKeywords(campaign.id, group.id);
  const existing = keywords.find(
    (keyword) =>
      !keyword.deleted && keyword.matchType === "EXACT" && normalize(keyword.text) === "exocad",
  );
  if (existing) {
    await asa.req(
      "PUT",
      `/campaigns/${campaign.id}/adgroups/${group.id}/targetingkeywords/bulk`,
      {
        body: [
          {
            id: existing.id,
            bidAmount: { amount: "0.12", currency: "USD" },
            status: "ACTIVE",
          },
        ],
      },
    );
    return;
  }

  await asa.req(
    "POST",
    `/campaigns/${campaign.id}/adgroups/${group.id}/targetingkeywords/bulk`,
    {
      body: [
        {
          text: "exocad",
          matchType: "EXACT",
          bidAmount: { amount: "0.12", currency: "USD" },
          status: "ACTIVE",
        },
      ],
    },
  );
}

async function ensureCampaign(
  asa: AsaClient,
  countriesOrRegions: string[],
): Promise<RawCampaign> {
  const campaigns = await asa.listCampaigns();
  let campaign = campaigns.find(
    (candidate) => candidate.adamId === APP_ID && candidate.name === DISCOVERY_NAME,
  );
  if (!campaign) {
    campaign = unwrap<RawCampaign>(
      await asa.req("POST", "/campaigns", {
        body: {
          name: DISCOVERY_NAME,
          billingEvent: "TAPS",
          dailyBudgetAmount: { amount: DAILY_BUDGET, currency: "USD" },
          adamId: APP_ID,
          countriesOrRegions,
          supplySources: ["APPSTORE_SEARCH_RESULTS"],
          adChannelType: "SEARCH",
          biddingStrategy: "MANUAL_CPT",
          status: "PAUSED",
        },
      }),
    );
  }
  if (!campaign?.id || campaign.adamId !== APP_ID) {
    throw new Error("Discovery campaign creation failed");
  }
  if (!sameSet(campaign.countriesOrRegions, countriesOrRegions)) {
    throw new Error(
      `Discovery geo mismatch: expected ${countriesOrRegions.length}, got ${campaign.countriesOrRegions.length}`,
    );
  }
  await asa.req("PUT", `/campaigns/${campaign.id}`, {
    body: {
      campaign: {
        name: DISCOVERY_NAME,
        dailyBudgetAmount: { amount: DAILY_BUDGET, currency: "USD" },
      },
    },
  });
  return campaign;
}

async function ensureAdGroup(
  asa: AsaClient,
  campaignId: number,
  name: string,
  searchMatch: boolean,
): Promise<RecordLike> {
  const groups = (await asa.listAdGroups(campaignId)) as RecordLike[];
  let group = groups.find((candidate) => candidate.name === name && !candidate.deleted);
  if (!group) {
    group = unwrap<RecordLike>(
      await asa.req("POST", `/campaigns/${campaignId}/adgroups`, {
        body: {
          name,
          startTime: new Date().toISOString(),
          automatedKeywordsOptIn: searchMatch,
          pricingModel: "CPC",
          defaultBidAmount: { amount: DEFAULT_BID, currency: "USD" },
          targetingDimensions: { deviceClass: { included: ["IPHONE", "IPAD"] } },
          status: "ENABLED",
        },
      }),
    );
  } else {
    await asa.req("PUT", `/campaigns/${campaignId}/adgroups/${group.id}`, {
      body: {
        name,
        automatedKeywordsOptIn: searchMatch,
        defaultBidAmount: { amount: DEFAULT_BID, currency: "USD" },
        status: "ENABLED",
      },
    });
  }
  if (!group?.id) throw new Error(`${name}: ad group creation failed`);
  return group;
}

async function ensureBroadKeywords(
  asa: AsaClient,
  campaignId: number,
  adGroupId: number,
): Promise<void> {
  const existing = await asa.listKeywords(campaignId, adGroupId);
  const activeByText = new Map(
    existing
      .filter((keyword) => !keyword.deleted && keyword.matchType === "BROAD")
      .map((keyword) => [normalize(keyword.text), keyword]),
  );
  const missing = BROAD_KEYWORDS.filter((text) => !activeByText.has(normalize(text)));
  if (missing.length) {
    await asa.req(
      "POST",
      `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`,
      {
        body: missing.map((text) => ({
          text,
          matchType: "BROAD",
          bidAmount: { amount: DEFAULT_BID, currency: "USD" },
          status: "ACTIVE",
        })),
      },
    );
  }

  const afterCreate = await asa.listKeywords(campaignId, adGroupId);
  const wanted = afterCreate.filter(
    (keyword) =>
      !keyword.deleted &&
      keyword.matchType === "BROAD" &&
      BROAD_KEYWORDS.includes(normalize(keyword.text)),
  );
  if (wanted.length) {
    await asa.req(
      "PUT",
      `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`,
      {
        body: wanted.map((keyword) => ({
          id: keyword.id,
          bidAmount: { amount: DEFAULT_BID, currency: "USD" },
          status: "ACTIVE",
        })),
      },
    );
  }
}

async function ensureNegatives(
  asa: AsaClient,
  campaignId: number,
  competitorKeywords: RawKeyword[],
): Promise<number> {
  const response = unwrap<RecordLike[]>(
    await asa.req("GET", `/campaigns/${campaignId}/negativekeywords`, {
      query: { limit: 1000 },
    }),
  );
  const existing = new Set(
    response
      .filter((negative) => !negative.deleted && negative.matchType === "EXACT")
      .map((negative) => normalize(String(negative.text))),
  );
  const desired = [
    ...CORE_EXACT_NEGATIVES,
    ...competitorKeywords
      .filter((keyword) => !keyword.deleted && keyword.status === "ACTIVE")
      .map((keyword) => keyword.text),
  ];
  const missing = [...new Set(desired.map(normalize))].filter((text) => !existing.has(text));
  if (missing.length) {
    await asa.req("POST", `/campaigns/${campaignId}/negativekeywords/bulk`, {
      body: missing.map((text) => ({ text, matchType: "EXACT" })),
    });
  }
  return missing.length;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("Refusing to mutate Apple Ads without --apply");
  }

  const cfg = loadConfig();
  openDb(cfg.dataDir);
  const asa = new AsaClient(cfg.asa);
  const baseline = await asa.listCampaigns();
  const competitor = baseline.find(
    (campaign) => campaign.id === COMPETITOR_CAMPAIGN_ID && campaign.adamId === APP_ID,
  );
  if (!competitor || competitor.countriesOrRegions.length !== 90) {
    throw new Error("Expected the verified 90-geo MedScan competitor campaign");
  }
  const competitorGroups = await asa.listAdGroups(competitor.id);
  const competitorGroup = competitorGroups.find((group) => group.status === "ENABLED") ?? competitorGroups[0];
  if (!competitorGroup) throw new Error("Competitor ad group is missing");

  await ensureCompetitorKeyword(asa);
  const campaign = await ensureCampaign(asa, competitor.countriesOrRegions);
  const searchMatchGroup = await ensureAdGroup(asa, campaign.id, SEARCH_MATCH_GROUP, true);
  const broadGroup = await ensureAdGroup(asa, campaign.id, BROAD_GROUP, false);
  await ensureBroadKeywords(asa, campaign.id, Number(broadGroup.id));

  const competitorKeywords = await asa.listKeywords(competitor.id, competitorGroup.id);
  const negativesAdded = await ensureNegatives(asa, campaign.id, competitorKeywords);
  await asa.resumeCampaign(campaign.id);

  const liveCampaign = (await asa.listCampaigns()).find((candidate) => candidate.id === campaign.id);
  if (
    !liveCampaign ||
    liveCampaign.status !== "ENABLED" ||
    liveCampaign.countriesOrRegions.length !== 90 ||
    Number(liveCampaign.dailyBudgetAmount.amount) !== Number(DAILY_BUDGET)
  ) {
    throw new Error("Discovery campaign live verification failed");
  }
  const liveGroups = (await asa.listAdGroups(campaign.id)) as RecordLike[];
  const liveSearchMatch = liveGroups.find((group) => group.id === searchMatchGroup.id);
  const liveBroad = liveGroups.find((group) => group.id === broadGroup.id);
  if (
    !liveSearchMatch ||
    liveSearchMatch.status !== "ENABLED" ||
    liveSearchMatch.automatedKeywordsOptIn !== true ||
    !liveBroad ||
    liveBroad.status !== "ENABLED" ||
    liveBroad.automatedKeywordsOptIn !== false
  ) {
    throw new Error("Discovery ad group verification failed");
  }
  const liveBroadKeywords = (await asa.listKeywords(campaign.id, Number(broadGroup.id))).filter(
    (keyword) => !keyword.deleted && keyword.status === "ACTIVE",
  );
  for (const text of BROAD_KEYWORDS) {
    const keyword = liveBroadKeywords.find(
      (candidate) => candidate.matchType === "BROAD" && normalize(candidate.text) === normalize(text),
    );
    if (!keyword || Number(keyword.bidAmount.amount) !== Number(DEFAULT_BID)) {
      throw new Error(`${text}: broad keyword verification failed`);
    }
  }
  const liveCompetitorKeywords = await asa.listKeywords(competitor.id, competitorGroup.id);
  const exocad = liveCompetitorKeywords.find(
    (keyword) => !keyword.deleted && keyword.status === "ACTIVE" && normalize(keyword.text) === "exocad",
  );
  if (!exocad || Number(exocad.bidAmount.amount) !== 0.12) {
    throw new Error("exocad competitor keyword verification failed");
  }

  await syncCampaigns(asa);
  const synced = await syncAdGroupsAndKeywords(asa, [campaign.id, competitor.id]);
  console.log(
    JSON.stringify(
      {
        campaignId: campaign.id,
        campaignName: liveCampaign.name,
        status: liveCampaign.status,
        servingStatus: liveCampaign.servingStatus,
        countries: liveCampaign.countriesOrRegions.length,
        dailyBudget: Number(liveCampaign.dailyBudgetAmount.amount),
        defaultBid: Number(DEFAULT_BID),
        searchMatch: true,
        broadKeywords: BROAD_KEYWORDS,
        negativesAdded,
        competitorKeywordAdded: { text: "exocad", matchType: "EXACT", bid: 0.12 },
        synced: { adGroups: synced.adGroups.length, keywords: synced.keywords.length },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
