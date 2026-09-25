import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import "dotenv/config";
import { AsaApiError, AsaClient } from "../server/asa-client.ts";
import { loadConfig } from "../server/config.ts";
import { buildStagedReconcilePlan } from "./lib/medscan-rebuild-reconcile.ts";
import type { RebuildPlan, RemoteCampaign } from "./lib/medscan-rebuild-plan.ts";

const APPROVAL = "reconcile-paused-only";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 800);
}

async function retry(label: string, operation: () => Promise<unknown>): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await operation();
      await sleep(120);
      return;
    } catch (error) {
      const status = error instanceof AsaApiError ? error.status : null;
      if (status !== null && RETRYABLE.has(status) && attempt < 4) {
        await sleep(Math.min(8_000, 750 * 2 ** attempt));
        continue;
      }
      throw new Error(`${label}: ${message(error)}`);
    }
  }
}

async function main(): Promise<void> {
  const manifestPath = resolve(argument("manifest") ?? "");
  const snapshotPath = resolve(argument("snapshot") ?? "");
  if (!existsSync(manifestPath) || !existsSync(snapshotPath)) {
    throw new Error("Valid --manifest and --snapshot paths are required");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RebuildPlan;
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as { campaigns: RemoteCampaign[] };
  const diff = buildStagedReconcilePlan(manifest.desiredCampaigns, snapshot.campaigns);
  if (diff.errors.length) throw new Error(`Reconcile refused: ${diff.errors.join("; ")}`);

  const applying = process.argv.includes("--apply");
  if (!applying) {
    console.log(JSON.stringify({ mode: "DRY_RUN", ...diff }, null, 2));
    return;
  }
  const cfg = loadConfig();
  if (!cfg.allowAppleAdsMutations || argument("approval") !== APPROVAL) {
    throw new Error(`Apply is fail-closed; set ASA_MUTATIONS_ENABLED=true and --approval=${APPROVAL}`);
  }

  const asa = new AsaClient(cfg.asa);
  for (const item of diff.keywordRemovals) {
    await retry(`${item.campaignName}: delete keyword ${item.text}`, async () => {
      try {
        await asa.req("DELETE", `/campaigns/${item.campaignId}/adgroups/${item.adGroupId}/targetingkeywords/${item.id}`);
      } catch (error) {
        // A prior interrupted reconcile may already have soft-deleted the
        // keyword. The readback below still proves that the ID is absent.
        if (!(error instanceof AsaApiError)) throw error;
        const alreadyDeleted = error.status === 404
          || (error.status === 400 && error.body.includes("DELETED_KEYWORD"));
        if (!alreadyDeleted) throw error;
      }
    });
  }
  const negativeBatches = new Map<string, { label: string; ids: number[] }>();
  for (const item of diff.negativeRemovals) {
    const endpoint = item.kind === "campaign-negative"
      ? `/campaigns/${item.campaignId}/negativekeywords/delete/bulk`
      : `/campaigns/${item.campaignId}/adgroups/${item.adGroupId}/negativekeywords/delete/bulk`;
    const batch = negativeBatches.get(endpoint) ?? { label: item.campaignName, ids: [] };
    batch.ids.push(item.id);
    negativeBatches.set(endpoint, batch);
  }
  for (const [endpoint, batch] of negativeBatches) {
    await retry(`${batch.label}: bulk delete ${batch.ids.length} negatives`, () =>
      asa.req("POST", endpoint, { body: batch.ids }));
  }

  const affectedKeywordGroups = new Map<string, { campaignId: number; adGroupId: number }>();
  for (const item of diff.keywordRemovals) {
    affectedKeywordGroups.set(`${item.campaignId}:${item.adGroupId}`, item);
  }
  for (const item of affectedKeywordGroups.values()) {
    const response = await asa.req<{ data?: Array<{ id?: number; deleted?: boolean }> }>(
      "GET", `/campaigns/${item.campaignId}/adgroups/${item.adGroupId}/targetingkeywords`, { query: { limit: 1000 } },
    );
    const liveIds = new Set((response.data ?? []).filter((row) => !row.deleted).map((row) => Number(row.id)));
    const remaining = diff.keywordRemovals.filter((row) => row.campaignId === item.campaignId && row.adGroupId === item.adGroupId && liveIds.has(row.id));
    if (remaining.length) throw new Error(`Keyword readback failed for campaign ${item.campaignId}`);
  }
  const affectedNegativeCampaigns = new Set(diff.negativeRemovals.map((item) => item.campaignId));
  for (const campaignId of affectedNegativeCampaigns) {
    const response = await asa.req<{ data?: Array<{ id?: number; deleted?: boolean }> }>(
      "GET", `/campaigns/${campaignId}/negativekeywords`, { query: { limit: 1000 } },
    );
    const liveIds = new Set((response.data ?? []).filter((row) => !row.deleted).map((row) => Number(row.id)));
    const remaining = diff.negativeRemovals.filter((row) => row.kind === "campaign-negative" && row.campaignId === campaignId && liveIds.has(row.id));
    if (remaining.length) throw new Error(`Negative readback failed for campaign ${campaignId}`);
  }
  const affectedNegativeGroups = new Map<string, { campaignId: number; adGroupId: number }>();
  for (const item of diff.negativeRemovals) {
    if (item.kind === "adgroup-negative" && item.adGroupId !== null) {
      affectedNegativeGroups.set(`${item.campaignId}:${item.adGroupId}`, {
        campaignId: item.campaignId,
        adGroupId: item.adGroupId,
      });
    }
  }
  for (const item of affectedNegativeGroups.values()) {
    const response = await asa.req<{ data?: Array<{ id?: number; deleted?: boolean }> }>(
      "GET", `/campaigns/${item.campaignId}/adgroups/${item.adGroupId}/negativekeywords`, { query: { limit: 1000 } },
    );
    const liveIds = new Set((response.data ?? []).filter((row) => !row.deleted).map((row) => Number(row.id)));
    const remaining = diff.negativeRemovals.filter((row) => row.kind === "adgroup-negative" && row.campaignId === item.campaignId && row.adGroupId === item.adGroupId && liveIds.has(row.id));
    if (remaining.length) throw new Error(`Ad-group negative readback failed for ${item.campaignId}:${item.adGroupId}`);
  }

  const outputDir = resolve(dirname(manifestPath), `reconcile-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`);
  mkdirSync(outputDir, { mode: 0o700 });
  const result = {
    mode: "APPLIED_RECONCILE_PAUSED_ONLY",
    appliedAt: new Date().toISOString(),
    sourceManifest: basename(manifestPath),
    sourceManifestSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
    invariant: "Only extra keywords and negatives in PAUSED M26 campaigns were removed; no legacy or status changed",
    keywordRemovals: diff.keywordRemovals,
    negativeRemovals: diff.negativeRemovals,
    readback: "PASS",
  };
  writeFileSync(resolve(outputDir, "reconcile-readback.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ ok: true, outputDir, keywordRemovals: diff.keywordRemovals.length, negativeRemovals: diff.negativeRemovals.length, readback: "PASS" }, null, 2));
}

main().catch((error) => {
  console.error(message(error));
  process.exitCode = 1;
});
