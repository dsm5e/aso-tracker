import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import "dotenv/config";
import { AsaApiError, AsaClient, type RawKeyword } from "../server/asa-client.ts";
import { loadConfig } from "../server/config.ts";
import { buildDesiredCampaigns, MEDSCAN_APP_ID, type SemanticRegistry } from "./lib/medscan-rebuild-plan.ts";

const APPROVAL = "preserve-proven-discovery-volume";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function normalize(value: string): string { return value.trim().toLocaleLowerCase(); }
function sleep(ms: number): Promise<void> { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function message(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 1000); }

async function retry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { const result = await operation(); await sleep(150); return result; }
    catch (error) {
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

function key(keyword: Pick<RawKeyword, "text" | "matchType">): string {
  return `${keyword.matchType}:${normalize(keyword.text)}`;
}

async function main(): Promise<void> {
  const registryPath = resolve(argument("registry") ?? "");
  if (!existsSync(registryPath)) throw new Error("A valid --registry path is required");
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as SemanticRegistry;
  const desired = buildDesiredCampaigns(registry).filter((campaign) => campaign.portfolio === "DISC_BROAD");
  const cfg = loadConfig();
  const asa = new AsaClient(cfg.asa);
  const campaigns = (await retry("list campaigns", () => asa.listCampaigns()))
    .filter((campaign) => campaign.adamId === MEDSCAN_APP_ID);
  const exactDiff = [];

  for (const campaign of desired) {
    const remote = campaigns.find((candidate) => candidate.name === campaign.name);
    if (!remote || remote.status !== "ENABLED") throw new Error(`${campaign.name}: active campaign not found`);
    const groups = await retry(`${campaign.name}: list groups`, () => asa.listAdGroups(remote.id));
    const group = groups.find((candidate) => candidate.name === campaign.adGroupName);
    if (!group || group.status !== "ENABLED" || group.automatedKeywordsOptIn !== false) throw new Error(`${campaign.name}: active broad group not found`);
    const keywords = (await retry(`${campaign.name}: list keywords`, () => asa.listKeywords(remote.id, group.id)))
      .filter((keyword) => !keyword.deleted);
    const existing = new Map(keywords.map((keyword) => [key(keyword), keyword]));
    exactDiff.push({
      campaign: campaign.name,
      add: campaign.keywords.filter((item) => !existing.has(`BROAD:${normalize(item.text)}`)).map((item) => ({ text: item.text, bid: item.bidAmount })),
      update: campaign.keywords.map((item) => ({
        id: existing.get(`BROAD:${normalize(item.text)}`)?.id ?? null,
        text: item.text,
        from: existing.get(`BROAD:${normalize(item.text)}`) ? Number(existing.get(`BROAD:${normalize(item.text)}`)?.bidAmount.amount) : null,
        to: item.bidAmount,
      })),
    });
  }

  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ mode: "DRY_RUN", campaigns: desired.length, exactDiff }, null, 2));
    return;
  }
  if (!cfg.allowAppleAdsMutations || argument("approval") !== APPROVAL) {
    throw new Error(`Apply is fail-closed; set ASA_MUTATIONS_ENABLED=true and --approval=${APPROVAL}`);
  }

  const applied = [];
  for (const campaign of desired) {
    const remote = campaigns.find((candidate) => candidate.name === campaign.name)!;
    const group = (await retry(`${campaign.name}: list groups before apply`, () => asa.listAdGroups(remote.id)))
      .find((candidate) => candidate.name === campaign.adGroupName)!;
    let keywords = (await retry(`${campaign.name}: list keywords before apply`, () => asa.listKeywords(remote.id, group.id)))
      .filter((keyword) => !keyword.deleted);
    const byKey = new Map(keywords.map((keyword) => [key(keyword), keyword]));
    const missing = campaign.keywords.filter((item) => !byKey.has(`BROAD:${normalize(item.text)}`));
    if (missing.length) {
      await retry(`${campaign.name}: add broad seeds`, () => asa.req(
        "POST", `/campaigns/${remote.id}/adgroups/${group.id}/targetingkeywords/bulk`, {
          body: missing.map((item) => ({
            text: item.text,
            matchType: "BROAD",
            bidAmount: { amount: item.bidAmount.toFixed(2), currency: "USD" },
            status: "ACTIVE",
          })),
        },
      ));
      keywords = (await retry(`${campaign.name}: read created seeds`, () => asa.listKeywords(remote.id, group.id)))
        .filter((keyword) => !keyword.deleted);
    }
    const refreshed = new Map(keywords.map((keyword) => [key(keyword), keyword]));
    await retry(`${campaign.name}: set proven bids`, () => asa.req(
      "PUT", `/campaigns/${remote.id}/adgroups/${group.id}/targetingkeywords/bulk`, {
        body: campaign.keywords.map((item) => {
          const keyword = refreshed.get(`BROAD:${normalize(item.text)}`);
          if (!keyword) throw new Error(`${campaign.name}: failed to create ${item.text}`);
          return { id: keyword.id, status: "ACTIVE", bidAmount: { amount: item.bidAmount.toFixed(2), currency: "USD" } };
        }),
      },
    ));
    const verified = (await retry(`${campaign.name}: verify broad seeds`, () => asa.listKeywords(remote.id, group.id)))
      .filter((keyword) => !keyword.deleted);
    for (const item of campaign.keywords) {
      const keyword = verified.find((candidate) => key(candidate) === `BROAD:${normalize(item.text)}`);
      if (!keyword || keyword.status !== "ACTIVE" || Number(keyword.bidAmount.amount) !== item.bidAmount) {
        throw new Error(`${campaign.name}: readback failed for ${item.text}`);
      }
    }
    applied.push({ campaign: campaign.name, keywordCount: campaign.keywords.length, added: missing.length });
  }
  console.log(JSON.stringify({ ok: true, mode: "APPLIED", applied, readback: "PASS" }, null, 2));
}

main().catch((error) => { console.error(message(error)); process.exitCode = 1; });
