import "dotenv/config";
import { loadConfig } from "../server/config.ts";
import { AsaClient } from "../server/asa-client.ts";

// Tier-1 acquisition test for Elara.
//
// Rationale (2026-08-01): every live Elara campaign targets cheap geos only, so
// tier-1 conversion has never been measured. ASC shows 2 active US subscriptions
// against 13 US installs per week — an absence of presence, not a bad market.
// This campaign buys a controlled, Exact-only sample in the US.
//
// Deliberate choices:
// - Exact only. Broad in a tier-1 auction burns budget on Flo's traffic.
// - No head terms ("pregnancy tracker", "pregnancy app"). We cannot outbid
//   Flo/Philips on those. We buy the long tail where the product is genuinely
//   differentiated: partner mode, contractions, kicks, week-by-week.
// - Bid ladder starts at $0.60. The $0.10 cheap-geo bid does not enter a tier-1
//   auction at all. Raise to $1.00, then $1.50 only if delivery stays at zero.
// - Success metric is install -> paywall -> purchase_started, not CPI.

const APP_ID = 6771391236;
const CAMPAIGN_NAME = "Elara — Tier1 Exact v1";
const COUNTRIES = ["US"];
const DAILY_BUDGET = "5";
const BID = "0.60";

// Existing, verified CPP creatives (see vault: Apple Ads + CPP — Current Strategy).
const CREATIVE_PARTNER = 3990052;
const CREATIVE_CONTRACTIONS = 3987863;
const CREATIVE_KICK = 3988558;

type RecordLike = Record<string, any>;

const partnerExact = [
  "pregnancy app for couples",
  "pregnancy tracker for couples",
  "partner pregnancy app",
  "pregnancy app for husband",
  "pregnancy app with partner",
  "pregnancy tracker with partner",
  "share pregnancy app",
  "couples pregnancy app",
];

const contractionsExact = [
  "contraction timer",
  "contraction counter",
  "labor contraction timer",
  "contraction tracker",
];

const kickExact = [
  "kick counter",
  "baby kick counter",
  "fetal movement counter",
  "baby movement tracker",
];

const coreExact = [
  "pregnancy week by week",
  "pregnancy week by week tracker",
  "baby size by week",
  "pregnancy journal",
  "pregnancy diary",
  "pregnancy countdown",
  "my pregnancy week by week",
];

// Competitor and off-intent protection. Exact-only ad groups make these mostly
// belt-and-braces, but they also guard future Broad experiments in this campaign.
const broadNegatives = ["flo", "period", "ovulation", "ivf", "baby names"];
const exactNegatives = ["clue", "ovia", "babycenter", "what to expect", "glow"];

function unwrap<T = RecordLike>(response: any): T {
  return (response?.data ?? response) as T;
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

async function ensureAdGroup(
  asa: AsaClient,
  campaignId: number,
  name: string,
): Promise<RecordLike> {
  const groups = await asa.listAdGroups(campaignId);
  let group = groups.find((candidate: RecordLike) => candidate.name === name);
  if (!group) {
    group = unwrap(
      await asa.req("POST", `/campaigns/${campaignId}/adgroups`, {
        body: {
          name,
          startTime: new Date().toISOString(),
          automatedKeywordsOptIn: false,
          pricingModel: "CPC",
          defaultBidAmount: { amount: BID, currency: "USD" },
          targetingDimensions: { deviceClass: { included: ["IPHONE"] } },
          status: "ENABLED",
        },
      }),
    );
  }
  if (!group?.id || (group as RecordLike).automatedKeywordsOptIn !== false) {
    throw new Error(`${name}: invalid ad group`);
  }
  return group;
}

async function ensureKeywords(
  asa: AsaClient,
  campaignId: number,
  adGroupId: number,
  texts: string[],
): Promise<void> {
  const current = await asa.listKeywords(campaignId, adGroupId);
  const missing = texts.filter(
    (text) =>
      !current.some(
        (candidate: RecordLike) =>
          !candidate.deleted &&
          normalized(candidate.text) === normalized(text) &&
          candidate.matchType === "EXACT" &&
          candidate.status === "ACTIVE",
      ),
  );
  if (!missing.length) return;
  const response = unwrap<RecordLike[]>(
    await asa.req(
      "POST",
      `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`,
      {
        body: missing.map((text) => ({
          text,
          matchType: "EXACT",
          bidAmount: { amount: BID, currency: "USD" },
        })),
      },
    ),
  );
  const failures = response.filter((item) => item?.error);
  if (failures.length) throw new Error(`Keyword failures: ${JSON.stringify(failures)}`);
}

async function ensureNegative(
  asa: AsaClient,
  campaignId: number,
  text: string,
  matchType: "EXACT" | "BROAD",
): Promise<void> {
  const response = unwrap<RecordLike[]>(
    await asa.req("GET", `/campaigns/${campaignId}/negativekeywords`, {
      query: { limit: 1000 },
    }),
  );
  if (
    response.some(
      (candidate: RecordLike) =>
        !candidate.deleted &&
        normalized(candidate.text) === normalized(text) &&
        candidate.matchType === matchType,
    )
  ) {
    return;
  }
  await asa.addCampaignNegative(campaignId, text, matchType);
}

async function ensureCppAd(
  asa: AsaClient,
  campaignId: number,
  adGroupId: number,
  creativeId: number,
  name: string,
): Promise<RecordLike | null> {
  const existing = unwrap<RecordLike[]>(
    await asa.req("GET", `/campaigns/${campaignId}/adgroups/${adGroupId}/ads`, {
      query: { limit: 100 },
    }),
  );
  const live = existing?.find?.(
    (ad: RecordLike) => !ad.deleted && Number(ad.creativeId) === creativeId,
  );
  if (live) return live;
  return unwrap(
    await asa.req("POST", `/campaigns/${campaignId}/adgroups/${adGroupId}/ads`, {
      body: { name, creativeId, status: "ENABLED" },
    }),
  );
}

async function main() {
  if (!process.argv.includes("--apply")) {
    throw new Error("Refusing to mutate Apple Ads without --apply");
  }

  const asa = new AsaClient(loadConfig().asa);
  const baseline = await asa.listCampaigns();

  let campaign = baseline.find(
    (candidate: RecordLike) =>
      candidate.adamId === APP_ID && candidate.name === CAMPAIGN_NAME,
  );
  if (!campaign) {
    campaign = unwrap(
      await asa.req("POST", "/campaigns", {
        body: {
          name: CAMPAIGN_NAME,
          billingEvent: "TAPS",
          dailyBudgetAmount: { amount: DAILY_BUDGET, currency: "USD" },
          adamId: APP_ID,
          countriesOrRegions: COUNTRIES,
          supplySources: ["APPSTORE_SEARCH_RESULTS"],
          adChannelType: "SEARCH",
          biddingStrategy: "MANUAL_CPT",
          status: "PAUSED",
        },
      }),
    );
  }
  if (!campaign?.id || campaign.adamId !== APP_ID) {
    throw new Error("Tier-1 campaign creation failed");
  }
  const campaignId = Number(campaign.id);
  if (JSON.stringify(campaign.countriesOrRegions) !== JSON.stringify(COUNTRIES)) {
    throw new Error(
      `Refusing to resume non-US campaign: ${JSON.stringify(campaign.countriesOrRegions)}`,
    );
  }

  const creativeResponse = unwrap<RecordLike[]>(
    await asa.req("GET", "/creatives", { query: { limit: 1000 } }),
  );
  for (const creativeId of [CREATIVE_PARTNER, CREATIVE_CONTRACTIONS, CREATIVE_KICK]) {
    const creative = creativeResponse.find(
      (candidate: RecordLike) => Number(candidate.id) === creativeId,
    );
    if (!creative || creative.state !== "VALID") {
      throw new Error(`Refusing to resume with inactive creative ${creativeId}`);
    }
  }

  const partner = await ensureAdGroup(asa, campaignId, "T1 Partner Exact");
  const contractions = await ensureAdGroup(asa, campaignId, "T1 Contractions Exact");
  const kick = await ensureAdGroup(asa, campaignId, "T1 Kick Exact");
  const core = await ensureAdGroup(asa, campaignId, "T1 Core Exact");

  await ensureKeywords(asa, campaignId, Number(partner.id), partnerExact);
  await ensureKeywords(asa, campaignId, Number(contractions.id), contractionsExact);
  await ensureKeywords(asa, campaignId, Number(kick.id), kickExact);
  await ensureKeywords(asa, campaignId, Number(core.id), coreExact);

  // Intent-matched product pages. Core intentionally has no custom ad, so it
  // serves the default App Store page.
  const ads: RecordLike = {};
  ads.partner = await ensureCppAd(
    asa,
    campaignId,
    Number(partner.id),
    CREATIVE_PARTNER,
    "T1 Partner CPP",
  );
  ads.contractions = await ensureCppAd(
    asa,
    campaignId,
    Number(contractions.id),
    CREATIVE_CONTRACTIONS,
    "T1 Contractions CPP",
  );
  ads.kick = await ensureCppAd(
    asa,
    campaignId,
    Number(kick.id),
    CREATIVE_KICK,
    "T1 Kick CPP",
  );

  for (const text of broadNegatives) {
    await ensureNegative(asa, campaignId, text, "BROAD");
  }
  for (const text of exactNegatives) {
    await ensureNegative(asa, campaignId, text, "EXACT");
  }

  await asa.resumeCampaign(campaignId);

  const after = await asa.listCampaigns();
  const live = after.find((candidate: RecordLike) => candidate.id === campaignId);
  if (live?.status !== "ENABLED" || live.servingStatus !== "RUNNING") {
    throw new Error(
      `Live verification failed: status=${live?.status} serving=${live?.servingStatus} reasons=${JSON.stringify(live?.servingStateReasons)}`,
    );
  }

  const groups = await asa.listAdGroups(campaignId);
  const report: RecordLike = {
    campaign: {
      id: campaignId,
      name: live.name,
      status: live.status,
      servingStatus: live.servingStatus,
      countries: live.countriesOrRegions,
      dailyBudget: live.dailyBudgetAmount,
      bid: BID,
    },
    adGroups: [],
    ads: Object.fromEntries(
      Object.entries(ads).map(([key, value]) => [
        key,
        { id: (value as RecordLike)?.id, creativeId: (value as RecordLike)?.creativeId },
      ]),
    ),
  };
  for (const group of groups) {
    const keywords = await asa.listKeywords(campaignId, group.id);
    report.adGroups.push({
      id: group.id,
      name: group.name,
      status: group.status,
      servingStatus: group.servingStatus,
      activeExact: keywords.filter(
        (keyword: RecordLike) => keyword.status === "ACTIVE" && keyword.matchType === "EXACT",
      ).length,
    });
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
