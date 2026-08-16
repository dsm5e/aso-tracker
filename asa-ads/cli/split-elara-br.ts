import "dotenv/config";
import { loadConfig } from "../server/config.ts";
import { AsaClient } from "../server/asa-client.ts";

const APP_ID = 6771391236;
const BR_COUNTRIES = ["BR"];
const EX_BR_COUNTRIES = ["ID", "MX", "ZA", "CL", "PH", "TR"];
const ORIGINAL_COUNTRIES = ["BR", "ID", "MX", "ZA", "CL", "PH", "TR"];
const SPLIT_BUDGET = "1";

type RecordLike = Record<string, any>;

interface CampaignPlan {
  id: number;
  oldName: string;
  exBrName: string;
  brName: string;
  groups: Array<{
    id: number;
    name: string;
    exact: number;
    broad: number;
    creativeId?: number;
  }>;
  negatives: number;
}

const PLANS: CampaignPlan[] = [
  {
    id: 2144361718,
    oldName: "Elara — Pregnancy Core — Cheap Geo v1",
    exBrName: "Elara — Pregnancy Core — Tier2 ex-BR v1",
    brName: "Elara — Pregnancy Core — BR v1",
    groups: [
      { id: 2150050522, name: "Core Exact", exact: 24, broad: 0 },
      { id: 2150049199, name: "Discovery Broad", exact: 0, broad: 13 },
    ],
    negatives: 19,
  },
  {
    id: 2144362055,
    oldName: "Elara — CPP Calendar — Cheap Geo v1",
    exBrName: "Elara — CPP Calendar — Tier2 ex-BR v1",
    brName: "Elara — CPP Calendar — BR v1",
    groups: [
      {
        id: 2150049875,
        name: "Intent — Exact + Broad",
        exact: 15,
        broad: 14,
        creativeId: 3990153,
      },
    ],
    negatives: 18,
  },
  {
    id: 2144362156,
    oldName: "Elara — CPP Contraction Timer — Cheap Geo v1",
    exBrName: "Elara — CPP Contraction Timer — Tier2 ex-BR v1",
    brName: "Elara — CPP Contraction Timer — BR v1",
    groups: [
      {
        id: 2150048301,
        name: "Intent — Exact + Broad",
        exact: 5,
        broad: 11,
        creativeId: 3987863,
      },
    ],
    negatives: 3,
  },
  {
    id: 2144362650,
    oldName: "Elara — CPP Kick Counter — Cheap Geo v1",
    exBrName: "Elara — CPP Kick Counter — Tier2 ex-BR v1",
    brName: "Elara — CPP Kick Counter — BR v1",
    groups: [
      {
        id: 2150049633,
        name: "Intent — Exact + Broad",
        exact: 7,
        broad: 12,
        creativeId: 3988558,
      },
    ],
    negatives: 2,
  },
];

const unwrap = <T = RecordLike>(value: any): T => (value?.data ?? value) as T;
const normalize = (value: string): string => value.trim().toLocaleLowerCase();
const sorted = (values: string[]): string[] => [...values].sort();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameCountries(actual: string[], expected: string[]): boolean {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

function amount(value: unknown): string {
  return String(value ?? "").replace(/\.0+$/, "");
}

async function listNegatives(asa: AsaClient, campaignId: number): Promise<RecordLike[]> {
  return unwrap<RecordLike[]>(
    await asa.req("GET", `/campaigns/${campaignId}/negativekeywords`, {
      query: { limit: 1000 },
    }),
  ).filter((negative) => !negative.deleted && negative.status !== "PAUSED");
}

async function listAds(
  asa: AsaClient,
  campaignId: number,
  adGroupId: number,
): Promise<RecordLike[]> {
  return unwrap<RecordLike[]>(
    await asa.req("GET", `/campaigns/${campaignId}/adgroups/${adGroupId}/ads`, {
      query: { limit: 1000 },
    }),
  ).filter((ad) => !ad.deleted && ad.status === "ENABLED");
}

async function validateOriginals(asa: AsaClient): Promise<RecordLike[]> {
  const campaigns = await asa.listCampaigns();
  const creatives = unwrap<RecordLike[]>(
    await asa.req("GET", "/creatives", { query: { limit: 1000 } }),
  );
  const snapshots: RecordLike[] = [];

  for (const plan of PLANS) {
    const campaign = campaigns.find((candidate) => candidate.id === plan.id);
    assert(campaign, `${plan.id}: original campaign is missing`);
    assert(campaign.adamId === APP_ID, `${plan.id}: app ownership drift`);
    assert(campaign.name === plan.oldName, `${plan.id}: campaign name drift: ${campaign.name}`);
    assert(campaign.status === "ENABLED", `${plan.id}: expected ENABLED, got ${campaign.status}`);
    assert(campaign.servingStatus === "RUNNING", `${plan.id}: expected RUNNING, got ${campaign.servingStatus}`);
    assert(amount(campaign.dailyBudgetAmount?.amount) === "2", `${plan.id}: daily budget drift`);
    assert(sameCountries(campaign.countriesOrRegions, ORIGINAL_COUNTRIES), `${plan.id}: geo drift`);

    const liveGroups = (await asa.listAdGroups(plan.id)).filter(
      (group: RecordLike) => group.status === "ENABLED",
    );
    assert(liveGroups.length === plan.groups.length, `${plan.id}: enabled ad-group count drift`);
    const groupSnapshots: RecordLike[] = [];

    for (const expected of plan.groups) {
      const group = liveGroups.find((candidate: RecordLike) => candidate.id === expected.id);
      assert(group, `${plan.id}/${expected.id}: source ad group is missing`);
      assert(group.name === expected.name, `${plan.id}/${expected.id}: ad-group name drift`);
      assert(group.automatedKeywordsOptIn === false, `${plan.id}/${expected.id}: Search Match is on`);
      assert(amount(group.defaultBidAmount?.amount) === "0.1", `${plan.id}/${expected.id}: bid drift`);

      const keywords = (await asa.listKeywords(plan.id, expected.id)).filter(
        (keyword: RecordLike) => !keyword.deleted && keyword.status === "ACTIVE",
      );
      const exact = keywords.filter((keyword) => keyword.matchType === "EXACT").length;
      const broad = keywords.filter((keyword) => keyword.matchType === "BROAD").length;
      assert(exact === expected.exact && broad === expected.broad, `${plan.id}/${expected.id}: keyword drift (${exact}/${broad})`);

      const ads = await listAds(asa, plan.id, expected.id);
      if (expected.creativeId) {
        assert(ads.length === 1, `${plan.id}/${expected.id}: expected one enabled CPP ad`);
        assert(Number(ads[0].creativeId) === expected.creativeId, `${plan.id}/${expected.id}: creative drift`);
        const creative = creatives.find((candidate) => Number(candidate.id) === expected.creativeId);
        assert(creative?.state === "VALID", `${expected.creativeId}: creative is not VALID`);
      } else {
        assert(ads.length === 0, `${plan.id}/${expected.id}: unexpected custom ad`);
      }

      groupSnapshots.push({ group, keywords, ads });
    }

    const negatives = await listNegatives(asa, plan.id);
    assert(negatives.length === plan.negatives, `${plan.id}: negative-keyword drift (${negatives.length})`);
    snapshots.push({ plan, campaign, groups: groupSnapshots, negatives });
  }
  return snapshots;
}

async function ensureBrCampaign(
  asa: AsaClient,
  snapshot: RecordLike,
): Promise<RecordLike> {
  const { plan } = snapshot as { plan: CampaignPlan };
  let campaigns = await asa.listCampaigns();
  let campaign = campaigns.find(
    (candidate) => candidate.adamId === APP_ID && candidate.name === plan.brName,
  ) as RecordLike | undefined;

  if (!campaign) {
    campaign = unwrap(
      await asa.req("POST", "/campaigns", {
        body: {
          name: plan.brName,
          billingEvent: "TAPS",
          dailyBudgetAmount: { amount: SPLIT_BUDGET, currency: "USD" },
          adamId: APP_ID,
          countriesOrRegions: BR_COUNTRIES,
          supplySources: ["APPSTORE_SEARCH_RESULTS"],
          adChannelType: "SEARCH",
          biddingStrategy: "MANUAL_CPT",
          status: "PAUSED",
        },
      }),
    );
  }

  assert(campaign?.id, `${plan.brName}: campaign creation returned no id`);
  assert(campaign.adamId === APP_ID, `${plan.brName}: app ownership mismatch`);
  assert(campaign.status === "PAUSED", `${plan.brName}: existing copy is not PAUSED`);
  assert(sameCountries(campaign.countriesOrRegions, BR_COUNTRIES), `${plan.brName}: geo mismatch`);
  assert(amount(campaign.dailyBudgetAmount?.amount) === SPLIT_BUDGET, `${plan.brName}: budget mismatch`);

  const campaignId = Number(campaign.id);
  for (const source of snapshot.groups as RecordLike[]) {
    const sourceGroup = source.group as RecordLike;
    const groups = await asa.listAdGroups(campaignId);
    let group = groups.find((candidate: RecordLike) => candidate.name === sourceGroup.name) as RecordLike | undefined;
    if (!group) {
      group = unwrap(
        await asa.req("POST", `/campaigns/${campaignId}/adgroups`, {
          body: {
            name: sourceGroup.name,
            startTime: new Date().toISOString(),
            automatedKeywordsOptIn: false,
            pricingModel: "CPC",
            defaultBidAmount: {
              amount: sourceGroup.defaultBidAmount.amount,
              currency: "USD",
            },
            targetingDimensions: sourceGroup.targetingDimensions ?? {
              deviceClass: { included: ["IPHONE"] },
            },
            status: "ENABLED",
          },
        }),
      );
    }
    assert(group?.id, `${plan.brName}/${sourceGroup.name}: ad-group creation failed`);
    assert(group.status === "ENABLED", `${plan.brName}/${sourceGroup.name}: ad group is not ENABLED`);
    assert(group.automatedKeywordsOptIn === false, `${plan.brName}/${sourceGroup.name}: Search Match is on`);
    assert(amount(group.defaultBidAmount?.amount) === amount(sourceGroup.defaultBidAmount?.amount), `${plan.brName}/${sourceGroup.name}: default bid mismatch`);

    const adGroupId = Number(group.id);
    const currentKeywords = await asa.listKeywords(campaignId, adGroupId);
    const missingKeywords = (source.keywords as RecordLike[]).filter(
      (wanted) =>
        !currentKeywords.some(
          (candidate: RecordLike) =>
            !candidate.deleted &&
            candidate.status === "ACTIVE" &&
            candidate.matchType === wanted.matchType &&
            normalize(candidate.text) === normalize(wanted.text),
        ),
    );
    if (missingKeywords.length) {
      const response = unwrap<RecordLike[]>(
        await asa.req(
          "POST",
          `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords/bulk`,
          {
            body: missingKeywords.map((keyword) => ({
              text: keyword.text,
              matchType: keyword.matchType,
              bidAmount: {
                amount: keyword.bidAmount?.amount ?? sourceGroup.defaultBidAmount.amount,
                currency: "USD",
              },
            })),
          },
        ),
      );
      assert(!response.some((item) => item?.error), `${plan.brName}/${sourceGroup.name}: keyword copy failed`);
    }

    const currentAds = await listAds(asa, campaignId, adGroupId);
    for (const sourceAd of source.ads as RecordLike[]) {
      if (!currentAds.some((candidate) => Number(candidate.creativeId) === Number(sourceAd.creativeId))) {
        await asa.req("POST", `/campaigns/${campaignId}/adgroups/${adGroupId}/ads`, {
          body: {
            name: sourceAd.name,
            creativeId: sourceAd.creativeId,
            status: "ENABLED",
          },
        });
      }
    }
  }

  const existingNegatives = await listNegatives(asa, campaignId);
  const missingNegatives = (snapshot.negatives as RecordLike[]).filter(
    (wanted) =>
      !existingNegatives.some(
        (candidate) =>
          candidate.matchType === wanted.matchType &&
          normalize(candidate.text) === normalize(wanted.text),
      ),
  );
  if (missingNegatives.length) {
    const response = unwrap<RecordLike[]>(
      await asa.req("POST", `/campaigns/${campaignId}/negativekeywords/bulk`, {
        body: missingNegatives.map((negative) => ({
          text: negative.text,
          matchType: negative.matchType,
        })),
      }),
    );
    assert(!response.some((item) => item?.error), `${plan.brName}: negative-keyword copy failed`);
  }

  campaigns = await asa.listCampaigns();
  return campaigns.find((candidate) => candidate.id === campaignId) as RecordLike;
}

async function validateCopy(
  asa: AsaClient,
  snapshot: RecordLike,
  copy: RecordLike,
): Promise<RecordLike> {
  const { plan } = snapshot as { plan: CampaignPlan };
  assert(copy.status === "PAUSED", `${plan.brName}: must remain PAUSED during validation`);
  assert(sameCountries(copy.countriesOrRegions, BR_COUNTRIES), `${plan.brName}: invalid BR geo`);
  assert(amount(copy.dailyBudgetAmount?.amount) === SPLIT_BUDGET, `${plan.brName}: invalid budget`);
  const groups = (await asa.listAdGroups(Number(copy.id))).filter(
    (group: RecordLike) => group.status === "ENABLED",
  );
  assert(groups.length === plan.groups.length, `${plan.brName}: ad-group count mismatch`);

  const summary: RecordLike[] = [];
  for (const expected of plan.groups) {
    const group = groups.find((candidate: RecordLike) => candidate.name === expected.name);
    assert(group, `${plan.brName}/${expected.name}: copied group is missing`);
    assert(group.automatedKeywordsOptIn === false, `${plan.brName}/${expected.name}: Search Match is on`);
    assert(amount(group.defaultBidAmount?.amount) === "0.1", `${plan.brName}/${expected.name}: bid mismatch`);
    const keywords = (await asa.listKeywords(Number(copy.id), Number(group.id))).filter(
      (keyword: RecordLike) => !keyword.deleted && keyword.status === "ACTIVE",
    );
    const exact = keywords.filter((keyword) => keyword.matchType === "EXACT").length;
    const broad = keywords.filter((keyword) => keyword.matchType === "BROAD").length;
    assert(exact === expected.exact && broad === expected.broad, `${plan.brName}/${expected.name}: keyword count mismatch`);
    const ads = await listAds(asa, Number(copy.id), Number(group.id));
    assert(ads.length === (expected.creativeId ? 1 : 0), `${plan.brName}/${expected.name}: ad count mismatch`);
    if (expected.creativeId) {
      assert(Number(ads[0].creativeId) === expected.creativeId, `${plan.brName}/${expected.name}: creative mismatch`);
    }
    summary.push({
      id: group.id,
      name: group.name,
      exact,
      broad,
      searchMatch: group.automatedKeywordsOptIn,
      ads: ads.map((ad) => ({ id: ad.id, creativeId: ad.creativeId })),
    });
  }
  const negatives = await listNegatives(asa, Number(copy.id));
  assert(negatives.length === plan.negatives, `${plan.brName}: negative count mismatch`);
  return { groups: summary, negatives: negatives.length };
}

async function rollback(
  asa: AsaClient,
  snapshots: RecordLike[],
  copies: RecordLike[],
): Promise<RecordLike[]> {
  const outcomes: RecordLike[] = [];
  for (const copy of copies) {
    try {
      await asa.pauseCampaign(Number(copy.id));
      outcomes.push({ id: copy.id, action: "paused BR copy", ok: true });
    } catch (error) {
      outcomes.push({ id: copy.id, action: "pause BR copy", ok: false, error: String(error) });
    }
  }
  for (const snapshot of snapshots) {
    try {
      const campaign = snapshot.campaign as RecordLike;
      await asa.req("PUT", `/campaigns/${campaign.id}`, {
        body: {
          campaign: {
            name: campaign.name,
            countriesOrRegions: campaign.countriesOrRegions,
            dailyBudgetAmount: campaign.dailyBudgetAmount,
            status: "ENABLED",
          },
        },
      });
      outcomes.push({ id: campaign.id, action: "restore original", ok: true });
    } catch (error) {
      outcomes.push({ id: snapshot.campaign.id, action: "restore original", ok: false, error: String(error) });
    }
  }
  return outcomes;
}

async function main(): Promise<void> {
  if (!process.argv.includes("--apply")) {
    throw new Error("Refusing to mutate Apple Ads without --apply");
  }

  const asa = new AsaClient(loadConfig().asa);
  const startedAt = new Date().toISOString();
  const snapshots = await validateOriginals(asa);
  const copies: RecordLike[] = [];
  const copyStructures: RecordLike[] = [];
  let originalsTouched = false;

  try {
    for (const snapshot of snapshots) {
      const copy = await ensureBrCampaign(asa, snapshot);
      copies.push(copy);
      copyStructures.push(await validateCopy(asa, snapshot, copy));
    }

    originalsTouched = true;
    for (const snapshot of snapshots) {
      await asa.pauseCampaign(Number(snapshot.campaign.id));
    }
    const paused = await asa.listCampaigns();
    for (const snapshot of snapshots) {
      const campaign = paused.find((candidate) => candidate.id === snapshot.campaign.id);
      assert(campaign?.status === "PAUSED", `${snapshot.campaign.id}: failed to pause original`);
    }

    for (const snapshot of snapshots) {
      const plan = snapshot.plan as CampaignPlan;
      await asa.req("PUT", `/campaigns/${plan.id}`, {
        body: {
          campaign: {
            name: plan.exBrName,
            countriesOrRegions: EX_BR_COUNTRIES,
            dailyBudgetAmount: { amount: SPLIT_BUDGET, currency: "USD" },
          },
        },
      });
    }

    let changed = await asa.listCampaigns();
    for (const snapshot of snapshots) {
      const plan = snapshot.plan as CampaignPlan;
      const campaign = changed.find((candidate) => candidate.id === plan.id);
      assert(campaign?.status === "PAUSED", `${plan.id}: original unexpectedly enabled during cutover`);
      assert(campaign.name === plan.exBrName, `${plan.id}: rename failed`);
      assert(sameCountries(campaign.countriesOrRegions, EX_BR_COUNTRIES), `${plan.id}: ex-BR geo update failed`);
      assert(amount(campaign.dailyBudgetAmount?.amount) === SPLIT_BUDGET, `${plan.id}: budget update failed`);
    }

    for (const snapshot of snapshots) {
      await asa.resumeCampaign(Number(snapshot.campaign.id));
    }
    for (const copy of copies) {
      await asa.resumeCampaign(Number(copy.id));
    }

    changed = await asa.listCampaigns();
    const finalCampaigns: RecordLike[] = [];
    for (let index = 0; index < snapshots.length; index += 1) {
      const plan = snapshots[index].plan as CampaignPlan;
      const original = changed.find((candidate) => candidate.id === plan.id);
      const copy = changed.find((candidate) => candidate.id === copies[index].id);
      assert(original?.status === "ENABLED" && original.servingStatus === "RUNNING", `${plan.id}: ex-BR campaign is not RUNNING`);
      assert(copy?.status === "ENABLED" && copy.servingStatus === "RUNNING", `${plan.brName}: BR campaign is not RUNNING`);
      assert(sameCountries(original.countriesOrRegions, EX_BR_COUNTRIES), `${plan.id}: final ex-BR geo mismatch`);
      assert(sameCountries(copy.countriesOrRegions, BR_COUNTRIES), `${plan.brName}: final BR geo mismatch`);
      assert(amount(original.dailyBudgetAmount?.amount) === SPLIT_BUDGET, `${plan.id}: final ex-BR budget mismatch`);
      assert(amount(copy.dailyBudgetAmount?.amount) === SPLIT_BUDGET, `${plan.brName}: final BR budget mismatch`);
      finalCampaigns.push(
        {
          id: original.id,
          name: original.name,
          countries: original.countriesOrRegions,
          dailyBudget: original.dailyBudgetAmount,
          status: original.status,
          servingStatus: original.servingStatus,
        },
        {
          id: copy.id,
          name: copy.name,
          countries: copy.countriesOrRegions,
          dailyBudget: copy.dailyBudgetAmount,
          status: copy.status,
          servingStatus: copy.servingStatus,
          structure: copyStructures[index],
        },
      );
    }

    const totalDailyCap = finalCampaigns.reduce(
      (sum, campaign) => sum + Number(campaign.dailyBudget.amount),
      0,
    );
    assert(totalDailyCap === 8, `final cheap-geo cap is $${totalDailyCap}, expected $8`);

    console.log(JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), totalDailyCap, campaigns: finalCampaigns }, null, 2));
  } catch (error) {
    if (originalsTouched) {
      const rollbackResult = await rollback(asa, snapshots, copies);
      console.error(JSON.stringify({ error: String(error), rollback: rollbackResult }, null, 2));
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
