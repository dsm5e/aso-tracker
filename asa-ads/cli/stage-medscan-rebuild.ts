import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import "dotenv/config";
import { AsaApiError, AsaClient, type RawAdGroup, type RawCampaign, type RawKeyword } from "../server/asa-client.ts";
import { loadConfig } from "../server/config.ts";
import { MEDSCAN_APP_ID, type DesiredCampaign, type RebuildPlan } from "./lib/medscan-rebuild-plan.ts";

const APPROVAL = "stage-paused-only";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

type JsonRecord = Record<string, unknown>;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function amount(value: number): string {
  return value.toFixed(2);
}

function unwrap<T>(value: unknown): T {
  const record = value as { data?: T };
  return (record?.data ?? value) as T;
}

function safeTimestamp(date = new Date()): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, "[redacted private key]")
    .slice(0, 1200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function retry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await operation();
      await sleep(120);
      return result;
    } catch (error) {
      const status = error instanceof AsaApiError ? error.status : null;
      if (status !== null && RETRYABLE.has(status) && attempt < 4) {
        await sleep(Math.min(8_000, 750 * 2 ** attempt));
        continue;
      }
      throw new Error(`${label}: ${redact(errorMessage(error))}`);
    }
  }
  throw new Error(`${label}: retry loop exhausted`);
}

function selectedCampaigns(plan: RebuildPlan, bundle: string): DesiredCampaign[] {
  const normalizedBundle = bundle.toUpperCase();
  const prefix = `M26 - ${normalizedBundle} - `;
  const selected = plan.desiredCampaigns.filter((campaign) =>
    campaign.name.startsWith(prefix) || (
      campaign.portfolio === "LOCAL_EXACT" &&
      campaign.countriesOrRegions.length === 1 &&
      campaign.countriesOrRegions[0] === normalizedBundle
    ),
  );

  if (normalizedBundle.startsWith("L10N-")) {
    if (selected.length !== 1 || selected[0]?.portfolio !== "LOCAL_EXACT") {
      throw new Error(`${bundle}: expected exactly one localized exact campaign`);
    }
    if (selected[0].status !== "PAUSED") throw new Error(`${bundle}: staged campaign must be PAUSED`);
    return selected;
  }

  if (normalizedBundle === "ALL") {
    if (selected.length !== 1 || selected[0]?.portfolio !== "BRAND_EXACT") {
      throw new Error(`${bundle}: expected exactly one global brand campaign`);
    }
    if (selected[0].status !== "PAUSED") throw new Error(`${bundle}: staged campaign must be PAUSED`);
    return selected;
  }

  // A storefront-only term can legitimately live outside a four-campaign geo
  // bundle (for example KG inside T4-EMERGING). Allow staging that one isolated,
  // paused LOCAL_EXACT campaign by its country code.
  if (
    selected.length === 1 &&
    selected[0]?.portfolio === "LOCAL_EXACT" &&
    selected[0].countriesOrRegions.length === 1 &&
    selected[0].countriesOrRegions[0] === normalizedBundle
  ) {
    if (selected[0].status !== "PAUSED") throw new Error(`${bundle}: staged campaign must be PAUSED`);
    return selected;
  }

  const expected = new Set(["CORE_EXACT", "DISC_BROAD", "DISC_SM", "COMP_EXACT"]);
  const core = selected.filter((campaign) => expected.has(campaign.portfolio));
  if (core.length !== expected.size || new Set(core.map((campaign) => campaign.portfolio)).size !== expected.size) {
    throw new Error(`${bundle}: expected exactly four core portfolio campaigns`);
  }
  if (selected.some((campaign) => campaign.status !== "PAUSED")) {
    throw new Error(`${bundle}: every staged campaign must be PAUSED`);
  }
  return selected;
}

function sameCountries(left: string[] | undefined, right: string[]): boolean {
  return JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...right].sort());
}

function keywordKey(keyword: Pick<RawKeyword, "text" | "matchType">): string {
  return `${keyword.matchType}:${normalize(keyword.text)}`;
}

function desiredKeywordKey(keyword: DesiredCampaign["keywords"][number]): string {
  return `${keyword.matchType}:${normalize(keyword.text)}`;
}

function negativeKey(value: JsonRecord): string {
  return `${String(value.matchType ?? "EXACT")}:${normalize(String(value.text ?? ""))}`;
}

async function createCampaign(asa: AsaClient, desired: DesiredCampaign): Promise<RawCampaign> {
  const response = await retry(`create ${desired.name}`, () => asa.req("POST", "/campaigns", {
    body: {
      name: desired.name,
      billingEvent: "TAPS",
      dailyBudgetAmount: { amount: amount(desired.dailyBudgetAmount), currency: "USD" },
      adamId: MEDSCAN_APP_ID,
      countriesOrRegions: desired.countriesOrRegions,
      supplySources: ["APPSTORE_SEARCH_RESULTS"],
      adChannelType: "SEARCH",
      biddingStrategy: "MANUAL_CPT",
      status: "PAUSED",
    },
  }));
  return unwrap<RawCampaign>(response);
}

async function createAdGroup(asa: AsaClient, campaignId: number, desired: DesiredCampaign): Promise<RawAdGroup> {
  const response = await retry(`create ad group for ${desired.name}`, () => asa.req(
    "POST",
    `/campaigns/${campaignId}/adgroups`,
    {
      body: {
        name: desired.adGroupName,
        startTime: new Date().toISOString(),
        automatedKeywordsOptIn: desired.automatedKeywordsOptIn,
        pricingModel: "CPC",
        defaultBidAmount: { amount: amount(desired.defaultBidAmount), currency: "USD" },
        targetingDimensions: { deviceClass: { included: ["IPHONE", "IPAD"] } },
        status: "PAUSED",
      },
    },
  ));
  return unwrap<RawAdGroup>(response);
}

async function stageOne(asa: AsaClient, desired: DesiredCampaign): Promise<JsonRecord> {
  let campaigns = await retry("list campaigns", () => asa.listCampaigns());
  const nameMatches = campaigns.filter((campaign) => campaign.name === desired.name && campaign.adamId === MEDSCAN_APP_ID);
  if (nameMatches.length > 1) throw new Error(`${desired.name}: duplicate campaign names already exist`);
  let campaign = nameMatches[0];
  let campaignCreated = false;

  if (!campaign) {
    campaign = await createCampaign(asa, desired);
    campaignCreated = true;
    const createdCampaignId = campaign.id;
    campaigns = await retry("read campaigns after create", () => asa.listCampaigns());
    const readBackCampaign = campaigns.find((candidate) => candidate.id === createdCampaignId);
    if (!readBackCampaign) throw new Error(`${desired.name}: campaign read-back failed`);
    campaign = readBackCampaign;
  }
  if (!campaign) throw new Error(`${desired.name}: campaign read-back failed`);
  if (
    campaign.status !== "PAUSED" ||
    !sameCountries(campaign.countriesOrRegions, desired.countriesOrRegions) ||
    Number(campaign.dailyBudgetAmount?.amount) !== desired.dailyBudgetAmount
  ) {
    throw new Error(`${desired.name}: existing/read-back campaign does not match approved paused spec`);
  }

  let groups = await retry(`list ad groups ${campaign.id}`, () => asa.listAdGroups(campaign.id));
  const liveGroups = groups.filter((group) => (group as RawAdGroup & { deleted?: boolean }).deleted !== true);
  const namedGroups = liveGroups.filter((group) => group.name === desired.adGroupName);
  if (namedGroups.length > 1 || liveGroups.some((group) => group.name !== desired.adGroupName)) {
    throw new Error(`${desired.name}: unexpected ad-group layout; refusing to mutate`);
  }
  let group = namedGroups[0];
  let adGroupCreated = false;
  if (!group) {
    group = await createAdGroup(asa, campaign.id, desired);
    adGroupCreated = true;
    const createdAdGroupId = group.id;
    groups = await retry(`read ad groups ${campaign.id}`, () => asa.listAdGroups(campaign.id));
    const readBackGroup = groups.find((candidate) => candidate.id === createdAdGroupId);
    if (!readBackGroup) throw new Error(`${desired.name}: ad-group read-back failed`);
    group = readBackGroup;
  }
  if (!group) throw new Error(`${desired.name}: ad-group read-back failed`);
  if (
    !["PAUSED", "ENABLED"].includes(group.status) ||
    Number(group.defaultBidAmount?.amount) !== desired.defaultBidAmount ||
    group.automatedKeywordsOptIn !== desired.automatedKeywordsOptIn
  ) {
    throw new Error(`${desired.name}: existing/read-back ad group does not match approved spec`);
  }

  let keywords = await retry(`list keywords ${campaign.id}/${group.id}`, () => asa.listKeywords(campaign.id, group.id));
  const liveKeywords = keywords.filter((keyword) => !keyword.deleted);
  const desiredByKey = new Map(desired.keywords.map((keyword) => [desiredKeywordKey(keyword), keyword]));
  const unexpectedKeywords = liveKeywords.filter((keyword) => !desiredByKey.has(keywordKey(keyword)));
  if (unexpectedKeywords.length) {
    throw new Error(`${desired.name}: unexpected keywords already exist; refusing to mutate`);
  }
  const missingKeywords = desired.keywords.filter(
    (candidate) => !liveKeywords.some((keyword) => keywordKey(keyword) === desiredKeywordKey(candidate)),
  );
  if (missingKeywords.length) {
    await retry(`create keywords ${desired.name}`, () => asa.req(
      "POST",
      `/campaigns/${campaign.id}/adgroups/${group.id}/targetingkeywords/bulk`,
      {
        body: missingKeywords.map((keyword) => ({
          text: keyword.text,
          matchType: keyword.matchType,
          bidAmount: { amount: amount(keyword.bidAmount), currency: "USD" },
          status: "ACTIVE",
        })),
      },
    ));
  }
  const bidUpdates = liveKeywords.flatMap((keyword) => {
    const wanted = desiredByKey.get(keywordKey(keyword));
    if (!wanted || Number(keyword.bidAmount?.amount) === wanted.bidAmount) return [];
    return [{ id: keyword.id, bidAmount: { amount: amount(wanted.bidAmount), currency: "USD" } }];
  });
  if (bidUpdates.length) {
    await retry(`update keyword bids ${desired.name}`, () => asa.req(
      "PUT",
      `/campaigns/${campaign.id}/adgroups/${group.id}/targetingkeywords/bulk`,
      { body: bidUpdates },
    ));
  }

  const negativesResponse = await retry(`list negatives ${campaign.id}`, () => asa.req<{ data?: JsonRecord[] }>(
    "GET",
    `/campaigns/${campaign.id}/negativekeywords`,
    { query: { limit: 1000 } },
  ));
  const negatives = Array.isArray(negativesResponse?.data) ? negativesResponse.data : [];
  const desiredNegativeKeys = new Set(desired.negativeExact.map((text) => `EXACT:${normalize(text)}`));
  // A newly tightened semantic registry can leave obsolete negatives in an
  // already staged, PAUSED campaign. Add the required negatives here and let
  // the dedicated paused-only reconcile command remove the extras afterward.
  // No live campaign or delivery state is changed in this step.
  const existingNegativeKeys = new Set(negatives.map(negativeKey));
  const missingNegatives = desired.negativeExact.filter((text) => !existingNegativeKeys.has(`EXACT:${normalize(text)}`));
  if (missingNegatives.length) {
    await retry(`create negatives ${desired.name}`, () => asa.req(
      "POST",
      `/campaigns/${campaign.id}/negativekeywords/bulk`,
      { body: missingNegatives.map((text) => ({ text, matchType: "EXACT" })) },
    ));
  }

  keywords = await retry(`verify keywords ${campaign.id}/${group.id}`, () => asa.listKeywords(campaign.id, group.id));
  const verifiedKeywords = keywords.filter((keyword) => !keyword.deleted);
  const missingAfter = desired.keywords.filter(
    (candidate) => !verifiedKeywords.some((keyword) => keywordKey(keyword) === desiredKeywordKey(candidate)),
  );
  const wrongBids = verifiedKeywords.filter((keyword) => {
    const wanted = desiredByKey.get(keywordKey(keyword));
    return !wanted || Number(keyword.bidAmount?.amount) !== wanted.bidAmount || keyword.status !== "ACTIVE";
  });
  const verifiedNegativesResponse = await retry(`verify negatives ${campaign.id}`, () => asa.req<{ data?: JsonRecord[] }>(
    "GET",
    `/campaigns/${campaign.id}/negativekeywords`,
    { query: { limit: 1000 } },
  ));
  const verifiedNegatives = Array.isArray(verifiedNegativesResponse?.data) ? verifiedNegativesResponse.data : [];
  const verifiedNegativeKeys = new Set(verifiedNegatives.map(negativeKey));
  const missingNegativeAfter = [...desiredNegativeKeys].filter((key) => !verifiedNegativeKeys.has(key));
  if (missingAfter.length || wrongBids.length || missingNegativeAfter.length) {
    throw new Error(`${desired.name}: final keyword/negative read-back failed`);
  }

  return {
    campaignId: campaign.id,
    campaignName: desired.name,
    campaignCreated,
    campaignStatus: campaign.status,
    adGroupId: group.id,
    adGroupCreated,
    keywordCount: verifiedKeywords.length,
    bidUpdateCount: bidUpdates.length,
    negativeCount: verifiedNegatives.length,
  };
}

async function main(): Promise<void> {
  const manifestPath = resolve(argument("manifest") ?? "");
  const bundle = (argument("bundle") ?? "").toUpperCase();
  const applying = process.argv.includes("--apply");
  if (!manifestPath || !existsSync(manifestPath)) throw new Error("A valid --manifest path is required");
  if (!bundle) throw new Error("--bundle is required");

  const plan = JSON.parse(readFileSync(manifestPath, "utf8")) as RebuildPlan;
  if (plan.appId !== MEDSCAN_APP_ID || plan.mode !== "DRY_RUN_ONLY" || plan.validation.errors.length) {
    throw new Error("Manifest is invalid, unvalidated, or belongs to another app");
  }
  const desired = selectedCampaigns(plan, bundle);
  const exactDiff = desired.map((campaign) => ({
    action: "STAGE_PAUSED",
    name: campaign.name,
    countriesOrRegions: campaign.countriesOrRegions,
    dailyBudgetUsd: campaign.dailyBudgetAmount,
    defaultBidUsd: campaign.defaultBidAmount,
    searchMatch: campaign.automatedKeywordsOptIn,
    keywords: campaign.keywords.map((keyword) => ({ text: keyword.text, matchType: keyword.matchType, bidUsd: keyword.bidAmount })),
    negativeExact: campaign.negativeExact,
  }));

  if (!applying) {
    console.log(JSON.stringify({ ok: true, mode: "DRY_RUN", manifest: manifestPath, bundle, exactDiff }, null, 2));
    return;
  }

  const cfg = loadConfig();
  if (!cfg.allowAppleAdsMutations || argument("approval") !== APPROVAL) {
    throw new Error(`Apply is fail-closed; set ASA_MUTATIONS_ENABLED=true and --approval=${APPROVAL}`);
  }
  const asa = new AsaClient(cfg.asa);
  const results: JsonRecord[] = [];
  for (const campaign of desired) {
    console.error(`[stage] ${campaign.name}`);
    results.push(await stageOne(asa, campaign));
  }

  const outputDir = resolve(dirname(manifestPath), `stage-${bundle}-${safeTimestamp()}`);
  mkdirSync(outputDir, { recursive: false, mode: 0o700 });
  const result = {
    schemaVersion: 1,
    mode: "APPLIED_STAGE_PAUSED_ONLY",
    appliedAt: new Date().toISOString(),
    sourceManifest: basename(manifestPath),
    sourceManifestSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
    bundle,
    invariant: "No staged campaign was enabled and no legacy object was changed",
    exactDiff,
    results,
  };
  writeFileSync(resolve(outputDir, "stage-readback.json"), `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify({ ok: true, outputDir, bundle, results }, null, 2));
}

main().catch((error) => {
  console.error(redact(errorMessage(error)));
  process.exitCode = 1;
});
