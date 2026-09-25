import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import "dotenv/config";
import { AsaApiError, AsaClient, type RawAdGroup, type RawCampaign } from "../server/asa-client.ts";
import { loadConfig } from "../server/config.ts";
import { MEDSCAN_APP_ID, type DesiredCampaign, type RebuildPlan } from "./lib/medscan-rebuild-plan.ts";

const APPROVAL = "cutover-m26-replace-legacy";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

type Prepared = { desired: DesiredCampaign; campaign: RawCampaign; group: RawAdGroup };

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function sameSet(left: string[] | undefined, right: string[]): boolean {
  return JSON.stringify([...(left ?? [])].sort()) === JSON.stringify([...right].sort());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1200);
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
      throw new Error(`${label}: ${message(error)}`);
    }
  }
  throw new Error(`${label}: retry loop exhausted`);
}

async function validateDesired(asa: AsaClient, plan: RebuildPlan): Promise<Prepared[]> {
  const campaigns = (await retry("list campaigns", () => asa.listCampaigns()))
    .filter((campaign) => campaign.adamId === MEDSCAN_APP_ID);
  const prepared: Prepared[] = [];

  for (const desired of plan.desiredCampaigns) {
    const matches = campaigns.filter((campaign) => campaign.name === desired.name);
    if (matches.length !== 1) throw new Error(`${desired.name}: expected one remote campaign, got ${matches.length}`);
    const campaign = matches[0];
    if (campaign.status !== "PAUSED") throw new Error(`${desired.name}: campaign must be PAUSED before cutover`);
    if (!sameSet(campaign.countriesOrRegions, desired.countriesOrRegions)) throw new Error(`${desired.name}: storefront mismatch`);
    if (Number(campaign.dailyBudgetAmount?.amount) !== desired.dailyBudgetAmount) throw new Error(`${desired.name}: budget mismatch`);

    const groups = (await retry(`${desired.name}: list ad groups`, () => asa.listAdGroups(campaign.id)))
      .filter((group) => !(group as RawAdGroup & { deleted?: boolean }).deleted);
    if (groups.length !== 1 || groups[0]?.name !== desired.adGroupName) throw new Error(`${desired.name}: ad-group layout mismatch`);
    const group = groups[0];
    if (!group || !["PAUSED", "ENABLED"].includes(group.status)) throw new Error(`${desired.name}: invalid ad-group status`);
    if (Number(group.defaultBidAmount?.amount) !== desired.defaultBidAmount) throw new Error(`${desired.name}: default bid mismatch`);
    if (group.automatedKeywordsOptIn !== desired.automatedKeywordsOptIn) throw new Error(`${desired.name}: Search Match mismatch`);

    const keywords = (await retry(`${desired.name}: list keywords`, () => asa.listKeywords(campaign.id, group.id)))
      .filter((keyword) => !keyword.deleted && keyword.status !== "PAUSED");
    const actualKeywords = new Map(keywords.map((keyword) => [
      `${keyword.matchType}:${normalize(keyword.text)}`,
      Number(keyword.bidAmount?.amount),
    ]));
    const expectedKeywords = new Map(desired.keywords.map((keyword) => [
      `${keyword.matchType}:${normalize(keyword.text)}`,
      keyword.bidAmount,
    ]));
    if (actualKeywords.size !== expectedKeywords.size) throw new Error(`${desired.name}: keyword cardinality mismatch`);
    for (const [key, bid] of expectedKeywords) {
      if (!actualKeywords.has(key) || actualKeywords.get(key) !== bid) throw new Error(`${desired.name}: keyword mismatch ${key}`);
    }

    const negativeResponse = await retry(`${desired.name}: list negatives`, () => asa.req<{ data?: Array<{ text?: string; matchType?: string; deleted?: boolean }> }>(
      "GET", `/campaigns/${campaign.id}/negativekeywords`, { query: { limit: 1000 } },
    ));
    const actualNegatives = new Set((negativeResponse.data ?? [])
      .filter((negative) => !negative.deleted)
      .map((negative) => `${negative.matchType ?? "EXACT"}:${normalize(String(negative.text ?? ""))}`));
    const expectedNegatives = new Set(desired.negativeExact.map((text) => `EXACT:${normalize(text)}`));
    if (actualNegatives.size !== expectedNegatives.size || [...expectedNegatives].some((key) => !actualNegatives.has(key))) {
      throw new Error(`${desired.name}: negative keyword mismatch`);
    }
    prepared.push({ desired, campaign, group });
  }
  return prepared;
}

async function setGroupStatus(asa: AsaClient, item: Prepared, status: "ENABLED" | "PAUSED"): Promise<void> {
  await retry(`${item.desired.name}: set ad group ${status}`, () => asa.req(
    "PUT", `/campaigns/${item.campaign.id}/adgroups/${item.group.id}`, {
      body: {
        name: item.desired.adGroupName,
        automatedKeywordsOptIn: item.desired.automatedKeywordsOptIn,
        defaultBidAmount: { amount: item.desired.defaultBidAmount.toFixed(2), currency: "USD" },
        status,
      },
    },
  ));
}

async function verifyStatuses(
  asa: AsaClient,
  desiredIds: Set<number>,
  legacyIds: Set<number>,
  desiredStatus: "ENABLED" | "PAUSED",
  legacyStatus: "ENABLED" | "PAUSED",
): Promise<void> {
  const campaigns = await retry("verify campaign statuses", () => asa.listCampaigns());
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  for (const id of desiredIds) if (byId.get(id)?.status !== desiredStatus) throw new Error(`desired campaign ${id} is not ${desiredStatus}`);
  for (const id of legacyIds) if (byId.get(id)?.status !== legacyStatus) throw new Error(`legacy campaign ${id} is not ${legacyStatus}`);
}

async function main(): Promise<void> {
  const manifestPath = resolve(argument("manifest") ?? "");
  if (!existsSync(manifestPath)) throw new Error("A valid --manifest path is required");
  const plan = JSON.parse(readFileSync(manifestPath, "utf8")) as RebuildPlan;
  if (
    plan.appId !== MEDSCAN_APP_ID || plan.mode !== "DRY_RUN_ONLY" || plan.validation.errors.length ||
    plan.validation.ownershipConflicts.length || !plan.validation.cnExcluded || plan.validation.totalDailyBudgetUsd !== 100
  ) throw new Error("Manifest is not a validated MedScan cutover plan");

  const cfg = loadConfig();
  const asa = new AsaClient(cfg.asa);
  const prepared = await validateDesired(asa, plan);
  const desiredIds = new Set(prepared.map((item) => item.campaign.id));
  const legacyIds = new Set(plan.legacyCampaignCutover.map((item) => item.campaignId));
  if ([...legacyIds].some((id) => desiredIds.has(id))) throw new Error("Legacy and desired campaign sets overlap");

  const exactDiff = {
    enable: prepared.map((item) => ({ id: item.campaign.id, name: item.campaign.name })),
    pause: plan.legacyCampaignCutover.map((item) => ({ id: item.campaignId, name: item.campaignName })),
    totalDailyBudgetUsd: plan.validation.totalDailyBudgetUsd,
  };
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ mode: "DRY_RUN", validated: true, ...exactDiff }, null, 2));
    return;
  }
  if (!cfg.allowAppleAdsMutations || argument("approval") !== APPROVAL) {
    throw new Error(`Apply is fail-closed; set ASA_MUTATIONS_ENABLED=true and --approval=${APPROVAL}`);
  }

  let legacyPaused = false;
  try {
    // Pre-arm groups while every M26 campaign is still paused, so the final
    // campaign switch is fast and there is no partially configured traffic.
    for (const item of prepared) await setGroupStatus(asa, item, "ENABLED");
    for (const item of prepared) {
      const groups = await retry(`${item.desired.name}: verify armed group`, () => asa.listAdGroups(item.campaign.id));
      if (groups.find((group) => group.id === item.group.id)?.status !== "ENABLED") throw new Error(`${item.desired.name}: group arming failed`);
    }

    for (const legacy of plan.legacyCampaignCutover) {
      await retry(`${legacy.campaignName}: pause legacy`, () => asa.pauseCampaign(legacy.campaignId));
    }
    legacyPaused = true;
    await verifyStatuses(asa, desiredIds, legacyIds, "PAUSED", "PAUSED");

    for (const item of prepared) await retry(`${item.desired.name}: enable`, () => asa.resumeCampaign(item.campaign.id));
    await verifyStatuses(asa, desiredIds, legacyIds, "ENABLED", "PAUSED");

    const outputDir = resolve(dirname(manifestPath), `cutover-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`);
    mkdirSync(outputDir, { recursive: false, mode: 0o700 });
    const result = {
      mode: "APPLIED_M26_CUTOVER",
      appliedAt: new Date().toISOString(),
      sourceManifest: basename(manifestPath),
      sourceManifestSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
      invariant: "M26 enabled; legacy paused but retained for rollback; no campaign deleted",
      readback: "PASS",
      ...exactDiff,
    };
    writeFileSync(resolve(outputDir, "cutover-readback.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ ok: true, outputDir, enabled: desiredIds.size, pausedLegacy: legacyIds.size, readback: "PASS" }, null, 2));
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const item of prepared) {
      try { await retry(`${item.desired.name}: rollback pause`, () => asa.pauseCampaign(item.campaign.id)); }
      catch (rollbackError) { rollbackErrors.push(message(rollbackError)); }
      try { await setGroupStatus(asa, item, "PAUSED"); }
      catch (rollbackError) { rollbackErrors.push(message(rollbackError)); }
    }
    if (legacyPaused) {
      for (const legacy of plan.legacyCampaignCutover) {
        try { await retry(`${legacy.campaignName}: rollback enable`, () => asa.resumeCampaign(legacy.campaignId)); }
        catch (rollbackError) { rollbackErrors.push(message(rollbackError)); }
      }
    }
    throw new Error(`Cutover failed and rollback was attempted: ${message(error)}; rollbackErrors=${rollbackErrors.join(" | ") || "none"}`);
  }
}

main().catch((error) => {
  console.error(message(error));
  process.exitCode = 1;
});
