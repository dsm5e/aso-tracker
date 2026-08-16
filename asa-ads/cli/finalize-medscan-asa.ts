import "dotenv/config";
import { loadConfig } from "../server/config.ts";
import { AsaClient, type RawCampaign, type RawKeyword } from "../server/asa-client.ts";

const APP_ID = 6762091560;
const APPLY = process.argv.includes("--apply");
const countryArg = process.argv.find((argument) => argument.startsWith("--countries="));
const SELECTED_COUNTRIES = countryArg
  ? new Set(countryArg.slice("--countries=".length).split(",").map((country) => country.trim().toUpperCase()))
  : undefined;

type MatchType = "EXACT" | "BROAD";
type KeywordSpec = { text: string; matchType: MatchType };
type GeoSpec = {
  country: string;
  campaignId?: number;
  dailyBudget: string;
  bid: string;
};

const CORE: KeywordSpec[] = [
  { text: "dicom", matchType: "BROAD" },
  { text: "dicom viewer", matchType: "EXACT" },
  { text: "ct viewer", matchType: "EXACT" },
  { text: "cbct", matchType: "EXACT" },
  { text: "cbct viewer", matchType: "EXACT" },
];

// Existing campaign IDs were verified immediately before this rollout.
const GEOS: GeoSpec[] = [
  { country: "DE", campaignId: 2143996547, dailyBudget: "3", bid: "0.30" },
  { country: "ID", campaignId: 2144054238, dailyBudget: "2", bid: "0.30" },
  { country: "IN", campaignId: 2143997247, dailyBudget: "2", bid: "0.30" },
  { country: "GB", campaignId: 2143895169, dailyBudget: "2", bid: "0.30" },
  { country: "US", campaignId: 2143996597, dailyBudget: "2", bid: "0.15" },
  { country: "ES", campaignId: 2144463213, dailyBudget: "2", bid: "0.30" },
  { country: "AE", campaignId: 2143996503, dailyBudget: "2", bid: "0.30" },
  { country: "BR", campaignId: 2143997847, dailyBudget: "2", bid: "0.30" },
  { country: "EG", campaignId: 2144094759, dailyBudget: "2", bid: "0.30" },
  { country: "FR", campaignId: 2143889206, dailyBudget: "2", bid: "0.30" },
  { country: "GR", campaignId: 2143996353, dailyBudget: "2", bid: "0.30" },
  { country: "MX", campaignId: 2143895053, dailyBudget: "2", bid: "0.30" },
  { country: "PK", campaignId: 2144363065, dailyBudget: "2", bid: "0.30" },
  { country: "RO", campaignId: 2144053751, dailyBudget: "2", bid: "0.30" },
  { country: "UA", campaignId: 2144054497, dailyBudget: "2", bid: "0.15" },
  { country: "CA", dailyBudget: "2", bid: "0.30" },
  { country: "AU", dailyBudget: "2", bid: "0.30" },
  { country: "CH", dailyBudget: "2", bid: "0.30" },
];

// Fresh Adapty attribution_creative audit, 2026-05-17 through 2026-08-14.
// Any currently live paid keyword outside CORE is retained automatically.
const PAID_KEYWORD_IDS = new Set([
  2270193665, 2270209631, 2270226072, 2270240152, 2274175565,
  2274185437, 2276237647, 2276238110, 2296131153, 2296140296,
  2296149487, 2296149563, 2267205496, 2267454588, 2270205812,
  2270206916, 2270470275, 2267463145, 2270195530,
]);

type AnyRecord = Record<string, any>;

const unwrap = <T = AnyRecord>(value: any): T => (value?.data ?? value) as T;
const normalized = (value: string) => value.trim().toLocaleLowerCase();
const keywordKey = (keyword: Pick<RawKeyword, "text" | "matchType">) =>
  `${keyword.matchType}:${normalized(keyword.text)}`;
const specKey = (keyword: KeywordSpec) => `${keyword.matchType}:${normalized(keyword.text)}`;

async function createCampaign(asa: AsaClient, geo: GeoSpec): Promise<RawCampaign> {
  return unwrap<RawCampaign>(
    await asa.req("POST", "/campaigns", {
      body: {
        name: geo.country,
        billingEvent: "TAPS",
        dailyBudgetAmount: { amount: geo.dailyBudget, currency: "USD" },
        adamId: APP_ID,
        countriesOrRegions: [geo.country],
        supplySources: ["APPSTORE_SEARCH_RESULTS"],
        adChannelType: "SEARCH",
        biddingStrategy: "MANUAL_CPT",
        status: "PAUSED",
      },
    }),
  );
}

async function configureGeo(asa: AsaClient, geo: GeoSpec) {
  const campaigns = (await asa.listCampaigns()).filter(
    (campaign) => campaign.adamId === APP_ID && campaign.countriesOrRegions?.includes(geo.country),
  );
  let campaign = geo.campaignId
    ? campaigns.find((candidate) => candidate.id === geo.campaignId)
    : campaigns.find((candidate) => candidate.name === geo.country) ?? campaigns[0];

  if (geo.campaignId && !campaign) {
    throw new Error(`${geo.country}: verified campaign ${geo.campaignId} is missing`);
  }
  if (!campaign) {
    if (!APPLY) {
      return { country: geo.country, action: "CREATE", desired: CORE, bid: geo.bid };
    }
    campaign = await createCampaign(asa, geo);
  }
  if (!campaign?.id || campaign.adamId !== APP_ID || !campaign.countriesOrRegions?.includes(geo.country)) {
    throw new Error(`${geo.country}: campaign ownership/country verification failed`);
  }

  const duplicateCampaigns = campaigns.filter((candidate) => candidate.id !== campaign!.id);
  let groups = await asa.listAdGroups(campaign.id);
  let group = groups.find((candidate) => !((candidate as AnyRecord).deleted));

  if (!APPLY) {
    const keywords = group ? await asa.listKeywords(campaign.id, group.id) : [];
    const live = keywords.filter((keyword) => !keyword.deleted);
    const paidExtras = live.filter(
      (keyword) => PAID_KEYWORD_IDS.has(keyword.id) && !CORE.some((wanted) => specKey(wanted) === keywordKey(keyword)),
    );
    const wanted = new Set([...CORE.map(specKey), ...paidExtras.map(keywordKey)]);
    return {
      country: geo.country,
      campaignId: campaign.id,
      campaignName: campaign.name,
      groupId: group?.id,
      groupName: group?.name,
      duplicateCampaignIds: duplicateCampaigns.map((candidate) => candidate.id),
      keep: live.filter((keyword) => wanted.has(keywordKey(keyword))).map((keyword) => ({ id: keyword.id, text: keyword.text, matchType: keyword.matchType })),
      add: CORE.filter((wantedKeyword) => !live.some((keyword) => keywordKey(keyword) === specKey(wantedKeyword))),
      delete: live.filter((keyword) => !wanted.has(keywordKey(keyword))).map((keyword) => ({ id: keyword.id, text: keyword.text, matchType: keyword.matchType })),
      paidExtras: paidExtras.map((keyword) => ({ id: keyword.id, text: keyword.text, matchType: keyword.matchType })),
      bid: geo.bid,
      dailyBudget: geo.dailyBudget,
    };
  }

  await asa.req("PUT", `/campaigns/${campaign.id}`, {
    body: {
      campaign: {
        name: geo.country,
        dailyBudgetAmount: { amount: geo.dailyBudget, currency: "USD" },
      },
    },
  });

  if (!group) {
    group = unwrap(
      await asa.req("POST", `/campaigns/${campaign.id}/adgroups`, {
        body: {
          name: `${geo.country} — Core`,
          startTime: new Date().toISOString(),
          automatedKeywordsOptIn: false,
          pricingModel: "CPC",
          defaultBidAmount: { amount: geo.bid, currency: "USD" },
          targetingDimensions: { deviceClass: { included: ["IPHONE", "IPAD"] } },
          status: "ENABLED",
        },
      }),
    );
  } else {
    await asa.req("PUT", `/campaigns/${campaign.id}/adgroups/${group.id}`, {
      body: {
        name: `${geo.country} — Core`,
        automatedKeywordsOptIn: false,
        defaultBidAmount: { amount: geo.bid, currency: "USD" },
        status: "ENABLED",
      },
    });
  }
  if (!group?.id) throw new Error(`${geo.country}: ad group creation/update failed`);

  const before = await asa.listKeywords(campaign.id, group.id);
  const liveBefore = before.filter((keyword) => !keyword.deleted);
  const paidExtras = liveBefore.filter(
    (keyword) => PAID_KEYWORD_IDS.has(keyword.id) && !CORE.some((wanted) => specKey(wanted) === keywordKey(keyword)),
  );
  const wantedKeys = new Set([...CORE.map(specKey), ...paidExtras.map(keywordKey)]);

  const missing = CORE.filter(
    (wanted) => !liveBefore.some((keyword) => keywordKey(keyword) === specKey(wanted)),
  );
  if (missing.length) {
    const created = unwrap<AnyRecord[]>(
      await asa.req("POST", `/campaigns/${campaign.id}/adgroups/${group.id}/targetingkeywords/bulk`, {
        body: missing.map((keyword) => ({
          ...keyword,
          bidAmount: { amount: geo.bid, currency: "USD" },
        })),
      }),
    );
    const failures = created.filter((item) => item?.error);
    if (failures.length) throw new Error(`${geo.country}: keyword create failures ${JSON.stringify(failures)}`);
  }

  const afterCreate = await asa.listKeywords(campaign.id, group.id);
  const keep = afterCreate.filter((keyword) => !keyword.deleted && wantedKeys.has(keywordKey(keyword)));
  if (keep.length) {
    const updated = unwrap<AnyRecord[]>(
      await asa.req("PUT", `/campaigns/${campaign.id}/adgroups/${group.id}/targetingkeywords/bulk`, {
        body: keep.map((keyword) => ({
          id: keyword.id,
          status: "ACTIVE",
          bidAmount: { amount: geo.bid, currency: "USD" },
        })),
      }),
    );
    const failures = updated.filter((item) => item?.error);
    if (failures.length) throw new Error(`${geo.country}: keyword update failures ${JSON.stringify(failures)}`);
  }

  const stale = afterCreate.filter((keyword) => !keyword.deleted && !wantedKeys.has(keywordKey(keyword)));
  if (stale.length) {
    await asa.req(
      "POST",
      `/campaigns/${campaign.id}/adgroups/${group.id}/targetingkeywords/delete/bulk`,
      { body: stale.map((keyword) => keyword.id) },
    );
  }

  await asa.resumeCampaign(campaign.id);
  for (const duplicate of duplicateCampaigns) {
    await asa.req("DELETE", `/campaigns/${duplicate.id}`);
  }

  const finalCampaign = (await asa.listCampaigns()).find((candidate) => candidate.id === campaign!.id);
  const finalGroups = await asa.listAdGroups(campaign.id);
  const finalGroup = finalGroups.find((candidate) => candidate.id === group!.id);
  const groupDetail = unwrap<AnyRecord>(
    await asa.req("GET", `/campaigns/${campaign.id}/adgroups/${group.id}`),
  );
  const finalKeywords = (await asa.listKeywords(campaign.id, group.id)).filter((keyword) => !keyword.deleted);
  const finalKeys = new Set(finalKeywords.map(keywordKey));
  const expectedKeys = new Set([...CORE.map(specKey), ...paidExtras.map(keywordKey)]);
  const invalidKeys = [...finalKeys].filter((key) => !expectedKeys.has(key));
  const missingKeys = [...expectedKeys].filter((key) => !finalKeys.has(key));
  const wrongBids = finalKeywords.filter((keyword) => Number(keyword.bidAmount?.amount) !== Number(geo.bid));
  const inactive = finalKeywords.filter((keyword) => keyword.status !== "ACTIVE");

  if (
    !finalCampaign ||
    finalCampaign.name !== geo.country ||
    finalCampaign.status !== "ENABLED" ||
    Number(finalCampaign.dailyBudgetAmount?.amount) !== Number(geo.dailyBudget) ||
    !finalGroup ||
    finalGroup.name !== `${geo.country} — Core` ||
    Number(finalGroup.defaultBidAmount?.amount) !== Number(geo.bid) ||
    groupDetail.automatedKeywordsOptIn !== false ||
    invalidKeys.length ||
    missingKeys.length ||
    wrongBids.length ||
    inactive.length
  ) {
    throw new Error(`${geo.country}: final verification failed ${JSON.stringify({
      campaign: finalCampaign,
      group: finalGroup,
      searchMatch: groupDetail.automatedKeywordsOptIn,
      invalidKeys,
      missingKeys,
      wrongBids: wrongBids.map((keyword) => keyword.id),
      inactive: inactive.map((keyword) => keyword.id),
    })}`);
  }

  return {
    country: geo.country,
    campaignId: campaign.id,
    groupId: group.id,
    status: finalCampaign.servingStatus,
    dailyBudget: finalCampaign.dailyBudgetAmount.amount,
    bid: finalGroup.defaultBidAmount.amount,
    searchMatch: groupDetail.automatedKeywordsOptIn,
    deletedCount: stale.length,
    duplicateCampaignsDeleted: duplicateCampaigns.map((candidate) => candidate.id),
    keywords: finalKeywords.map((keyword) => ({ id: keyword.id, text: keyword.text, matchType: keyword.matchType })),
    paidExtras: paidExtras.map((keyword) => ({ id: keyword.id, text: keyword.text, matchType: keyword.matchType })),
  };
}

async function main() {
  const asa = new AsaClient(loadConfig().asa);
  const results = [];
  const errors = [];
  for (const geo of GEOS.filter((candidate) => !SELECTED_COUNTRIES || SELECTED_COUNTRIES.has(candidate.country))) {
    console.error(`[${APPLY ? "apply" : "audit"}] ${geo.country} start`);
    try {
      results.push(await configureGeo(asa, geo));
      console.error(`[${APPLY ? "apply" : "audit"}] ${geo.country} done`);
    } catch (error) {
      errors.push({ country: geo.country, error: error instanceof Error ? error.message : String(error) });
      console.error(`[${APPLY ? "apply" : "audit"}] ${geo.country} failed`);
    }
  }
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", results, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
