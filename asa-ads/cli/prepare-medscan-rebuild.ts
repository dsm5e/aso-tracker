import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import "dotenv/config";
import { AsaApiError, AsaClient } from "../server/asa-client.ts";
import { loadConfig } from "../server/config.ts";
import {
  MEDSCAN_APP_ID,
  buildRebuildPlan,
  type RebuildPlan,
  type RemoteAdGroup,
  type RemoteCampaign,
  type RemoteKeyword,
  type RevenueSignal,
  type SemanticRegistry,
} from "./lib/medscan-rebuild-plan.ts";

const DEFAULT_REGISTRY = "/Users/qwar49/Desktop/MedScan — Semantic Registry DRAFT — 2026-09-04.json";
const DEFAULT_ROOT = "/Users/qwar49/Desktop/asa/medscan-rebuild";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

type JsonRecord = Record<string, unknown>;

interface RemoteSnapshot {
  schemaVersion: 1;
  source: "Apple Ads Campaign Management API v5";
  fetchedAt: string;
  appId: number;
  campaigns: RemoteCampaign[];
  sourceErrors: Array<{ endpoint: string; status: number | null; message: string }>;
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function safeTimestamp(date = new Date()): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactApiMessage(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, "[redacted private key]")
    .slice(0, 800);
}

async function readEndpoint(
  asa: AsaClient,
  endpoint: string,
  sourceErrors: RemoteSnapshot["sourceErrors"],
  optional = false,
): Promise<JsonRecord[]> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await asa.req<{ data?: JsonRecord[] }>("GET", endpoint, { query: { limit: 1000 } });
      await sleep(80);
      return Array.isArray(response?.data) ? response.data : [];
    } catch (error) {
      const status = error instanceof AsaApiError ? error.status : null;
      if (status !== null && RETRYABLE.has(status) && attempt < 4) {
        await sleep(Math.min(8_000, 750 * 2 ** attempt));
        continue;
      }
      const item = { endpoint, status, message: redactApiMessage(errorMessage(error)) };
      sourceErrors.push(item);
      if (optional) return [];
      throw new Error(`${endpoint} snapshot failed (${status ?? "unknown"})`);
    }
  }
  throw new Error(`${endpoint} snapshot retry loop exhausted`);
}

async function collectRemoteSnapshot(asa: AsaClient): Promise<RemoteSnapshot> {
  const sourceErrors: RemoteSnapshot["sourceErrors"] = [];
  const campaignRows = await readEndpoint(asa, "/campaigns", sourceErrors);
  const campaigns: RemoteCampaign[] = [];
  const medscanRows = campaignRows.filter((row) => Number(row.adamId) === MEDSCAN_APP_ID);

  for (const [campaignIndex, row] of medscanRows.entries()) {
    const campaignId = Number(row.id);
    console.error(`[snapshot] campaign ${campaignIndex + 1}/${medscanRows.length}: ${campaignId}`);
    const [groupRows, campaignNegatives] = await Promise.all([
      readEndpoint(asa, `/campaigns/${campaignId}/adgroups`, sourceErrors),
      readEndpoint(asa, `/campaigns/${campaignId}/negativekeywords`, sourceErrors, true),
    ]);
    const adGroups: RemoteAdGroup[] = [];
    for (const groupRow of groupRows) {
      const adGroupId = Number(groupRow.id);
      const [keywordRows, groupNegatives] = await Promise.all([
        readEndpoint(asa, `/campaigns/${campaignId}/adgroups/${adGroupId}/targetingkeywords`, sourceErrors),
        readEndpoint(asa, `/campaigns/${campaignId}/adgroups/${adGroupId}/negativekeywords`, sourceErrors, true),
      ]);
      adGroups.push({
        ...(groupRow as unknown as Omit<RemoteAdGroup, "keywords" | "negativeKeywords">),
        id: adGroupId,
        campaignId,
        name: String(groupRow.name ?? ""),
        keywords: keywordRows as unknown as RemoteKeyword[],
        negativeKeywords: groupNegatives,
      });
    }
    campaigns.push({
      ...(row as unknown as Omit<RemoteCampaign, "adGroups" | "negativeKeywords">),
      id: campaignId,
      adamId: Number(row.adamId),
      name: String(row.name ?? ""),
      adGroups,
      negativeKeywords: campaignNegatives,
    });
  }

  return {
    schemaVersion: 1,
    source: "Apple Ads Campaign Management API v5",
    fetchedAt: new Date().toISOString(),
    appId: MEDSCAN_APP_ID,
    campaigns,
    sourceErrors,
  };
}

function loadRevenueSignals(db: Database.Database): RevenueSignal[] {
  return (db.prepare(`
    SELECT
      r.keyword_id AS keywordId,
      r.attributed_installs AS attributedInstalls,
      r.trials,
      r.paid,
      r.revenue_usd AS revenueUsd
    FROM asa_kw_revenue r
    JOIN asa_campaigns c ON c.id = r.campaign_id
    WHERE c.app_id = ?
  `).all(MEDSCAN_APP_ID) as RevenueSignal[]);
}

function loadDelivery60d(db: Database.Database): JsonRecord[] {
  return db.prepare(`
    SELECT
      k.id AS keywordId,
      k.campaign_id AS campaignId,
      k.ad_group_id AS adGroupId,
      c.name AS campaignName,
      c.country,
      k.text,
      k.match_type AS matchType,
      k.bid,
      COALESCE(SUM(d.impressions), 0) AS impressions,
      COALESCE(SUM(d.taps), 0) AS taps,
      COALESCE(SUM(d.installs), 0) AS installs,
      ROUND(COALESCE(SUM(d.spend), 0), 4) AS spend
    FROM asa_keywords k
    JOIN asa_campaigns c ON c.id = k.campaign_id
    LEFT JOIN asa_kw_daily d ON d.keyword_id = k.id AND d.date >= date('now', '-59 day')
    WHERE c.app_id = ? AND c.status = 'ENABLED' AND k.deleted = 0 AND k.status = 'ACTIVE'
    GROUP BY k.id
    ORDER BY impressions DESC, taps DESC, installs DESC
  `).all(MEDSCAN_APP_ID) as JsonRecord[];
}

function loadFreshness(db: Database.Database): JsonRecord {
  const campaign = db.prepare(`
    SELECT MAX(synced_at) AS syncedAt FROM asa_campaigns WHERE app_id = ?
  `).get(MEDSCAN_APP_ID) as JsonRecord;
  const revenue = db.prepare(`
    SELECT MAX(r.updated_at) AS syncedAt
    FROM asa_kw_revenue r JOIN asa_campaigns c ON c.id = r.campaign_id
    WHERE c.app_id = ?
  `).get(MEDSCAN_APP_ID) as JsonRecord;
  return { campaign, revenue };
}

function rollbackMap(snapshot: RemoteSnapshot, plan: RebuildPlan): JsonRecord {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    appId: MEDSCAN_APP_ID,
    invariant: "Legacy campaigns are paused, never deleted, during the rollback window",
    restoreCampaigns: snapshot.campaigns.map((campaign) => ({
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status ?? null,
      dailyBudgetAmount: campaign.dailyBudgetAmount ?? null,
      countriesOrRegions: campaign.countriesOrRegions ?? [],
    })),
    restoreAdGroups: snapshot.campaigns.flatMap((campaign) => campaign.adGroups.map((group) => ({
      campaignId: campaign.id,
      adGroupId: group.id,
      name: group.name,
      status: group.status ?? null,
      defaultBidAmount: group.defaultBidAmount ?? null,
      automatedKeywordsOptIn: group.automatedKeywordsOptIn ?? null,
    }))),
    restoreKeywords: snapshot.campaigns.flatMap((campaign) => campaign.adGroups.flatMap((group) =>
      group.keywords.map((keyword) => ({
        campaignId: campaign.id,
        adGroupId: group.id,
        keywordId: keyword.id,
        text: keyword.text,
        matchType: keyword.matchType,
        status: keyword.status ?? null,
        bidAmount: keyword.bidAmount ?? null,
        deleted: keyword.deleted ?? false,
      })),
    )),
    restoreCampaignNegatives: snapshot.campaigns.flatMap((campaign) =>
      campaign.negativeKeywords.map((negative) => ({ campaignId: campaign.id, ...negative })),
    ),
    restoreAdGroupNegatives: snapshot.campaigns.flatMap((campaign) => campaign.adGroups.flatMap((group) =>
      group.negativeKeywords.map((negative) => ({ campaignId: campaign.id, adGroupId: group.id, ...negative })),
    )),
    rollbackNewCampaigns: plan.desiredCampaigns.map((campaign) => ({
      campaignRef: campaign.ref,
      campaignName: campaign.name,
      action: "PAUSE_IF_CREATED",
    })),
  };
}

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, stringify(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(path: string, header: string[], rows: unknown[][]): void {
  const content = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function writeReviewCsvs(outputDir: string, plan: RebuildPlan): string[] {
  const files = [
    "ADD-campaigns.csv",
    "ADD-keywords.csv",
    "NEGATIVE-discovery.csv",
    "KEEP-PAUSE-legacy-keywords.csv",
    "PAUSE-legacy-campaigns-after-readback.csv",
  ];
  writeCsv(resolve(outputDir, files[0]),
    ["action", "campaignRef", "name", "portfolio", "tier", "countries", "dailyBudgetUsd", "defaultBidUsd", "searchMatch", "initialStatus"],
    plan.desiredCampaigns.map((campaign) => [
      "ADD_PAUSED", campaign.ref, campaign.name, campaign.portfolio, campaign.tier,
      campaign.countriesOrRegions.join(" "), campaign.dailyBudgetAmount, campaign.defaultBidAmount,
      campaign.automatedKeywordsOptIn, campaign.status,
    ]),
  );
  writeCsv(resolve(outputDir, files[1]),
    ["action", "campaignRef", "campaignName", "portfolio", "countries", "term", "matchType", "bidUsd", "rationale"],
    plan.desiredCampaigns.flatMap((campaign) => campaign.keywords.map((keyword) => [
      "ADD", campaign.ref, campaign.name, campaign.portfolio, campaign.countriesOrRegions.join(" "),
      keyword.text, keyword.matchType, keyword.bidAmount, keyword.rationale,
    ])),
  );
  writeCsv(resolve(outputDir, files[2]),
    ["action", "campaignRef", "campaignName", "countries", "term", "matchType"],
    plan.desiredCampaigns.flatMap((campaign) => campaign.negativeExact.map((term) => [
      "ADD_NEGATIVE", campaign.ref, campaign.name, campaign.countriesOrRegions.join(" "), term, "EXACT",
    ])),
  );
  writeCsv(resolve(outputDir, files[3]),
    ["action", "campaignId", "campaignName", "adGroupId", "keywordId", "term", "matchType", "bidUsd", "countries", "migrationTargets", "installs", "trials", "paid", "revenueUsd", "reason"],
    plan.legacyKeywords.map((keyword) => [
      keyword.action, keyword.campaignId, keyword.campaignName, keyword.adGroupId, keyword.keywordId,
      keyword.text, keyword.matchType, keyword.bidAmount, keyword.countriesOrRegions.join(" "),
      keyword.migrationTargets.join(" | "), keyword.economics?.attributedInstalls,
      keyword.economics?.trials, keyword.economics?.paid, keyword.economics?.revenueUsd, keyword.reason,
    ]),
  );
  writeCsv(resolve(outputDir, files[4]),
    ["action", "campaignId", "campaignName", "countries", "currentStatus"],
    plan.legacyCampaignCutover.map((campaign) => [
      campaign.action, campaign.campaignId, campaign.campaignName,
      campaign.countriesOrRegions.join(" "), campaign.currentStatus,
    ]),
  );
  return files;
}

function summary(snapshot: RemoteSnapshot, plan: RebuildPlan, outputDir: string, freshness: JsonRecord): string {
  const activeKeywords = snapshot.campaigns.flatMap((campaign) => campaign.adGroups.flatMap((group) => group.keywords))
    .filter((keyword) => !keyword.deleted && keyword.status !== "PAUSED");
  const desiredKeywords = plan.desiredCampaigns.reduce((sum, campaign) => sum + campaign.keywords.length, 0);
  const desiredNegatives = plan.desiredCampaigns.reduce((sum, campaign) => sum + campaign.negativeExact.length, 0);
  const keep = plan.legacyKeywords.filter((item) => item.action === "KEEP_UNTIL_CUTOVER").length;
  const pause = plan.legacyKeywords.filter((item) => item.action === "PAUSE_AT_CUTOVER").length;
  const usCore = plan.desiredCampaigns.find((campaign) => campaign.name === "M26 - US - CORE-EXACT");
  const usBids = usCore?.keywords.map((keyword) => `  - \`${keyword.text}\` exact — \`$${keyword.bidAmount.toFixed(2)}\``).join("\n") ?? "";

  return `# MedScan ASA rebuild — approval batch\n\n` +
    `Generated: ${snapshot.fetchedAt}\n\n` +
    `This is a read-only dry run. No Apple Ads object was changed.\n\n` +
    `## Baseline\n\n` +
    `- Live remote campaigns: ${snapshot.campaigns.length}\n` +
    `- Active remote keywords: ${activeKeywords.length}\n` +
    `- Source errors: ${snapshot.sourceErrors.length}\n` +
    `- Local freshness: \`${JSON.stringify(freshness)}\`\n\n` +
    `## Proposed desired state\n\n` +
    `- Paid storefronts: ${plan.validation.paidStorefrontCount}; CN excluded: ${plan.validation.cnExcluded}\n` +
    `- New campaigns: ${plan.desiredCampaigns.length}, all created PAUSED\n` +
    `- Desired keywords: ${desiredKeywords}\n` +
    `- Discovery exact-negatives: ${desiredNegatives}\n` +
    `- Daily budget envelope: $${plan.validation.totalDailyBudgetUsd.toFixed(2)} (current envelope preserved)\n` +
    `- Desired geo × term × match conflicts: ${plan.validation.ownershipConflicts.length}\n` +
    `- Legacy keyword disposition: keep through read-back ${keep}; pause at cutover ${pause}\n` +
    `- Legacy campaigns to pause only after read-back: ${plan.legacyCampaignCutover.length}\n\n` +
    `## US first bids\n\n${usBids}\n\n` +
    `No blanket $1 bid is proposed. Discovery starts below exact; \`romexis\` and \`weasis\` start at $0.20.\n\n` +
    `## Cutover gates\n\n` +
    `1. Create every new campaign PAUSED.\n` +
    `2. Create its ad group, keywords, and negatives.\n` +
    `3. Read the objects back from Apple and require zero ownership conflicts.\n` +
    `4. Enable new owners and pause the matching legacy owners in bounded batches.\n` +
    `5. Never delete legacy during the rollback window.\n\n` +
    `## Validation\n\n` +
    `${plan.validation.errors.length ? plan.validation.errors.map((error) => `- ERROR: ${error}`).join("\n") : "- PASS"}\n\n` +
    `Artifacts: \`${outputDir}\`\n`;
}

async function main(): Promise<void> {
  if (process.argv.includes("--apply")) {
    throw new Error("This command is intentionally read-only and does not accept --apply");
  }
  const cfg = loadConfig();
  const registryPath = resolve(argument("registry") ?? DEFAULT_REGISTRY);
  const snapshotInput = argument("snapshot");
  const root = resolve(argument("output-root") ?? DEFAULT_ROOT);
  const outputDir = resolve(root, safeTimestamp());
  if (existsSync(outputDir)) throw new Error(`Immutable output already exists: ${outputDir}`);
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });

  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as SemanticRegistry;
  const dbPath = resolve(cfg.dataDir, "asa-ads.db");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const asa = new AsaClient(cfg.asa);
  try {
    const snapshot = snapshotInput
      ? JSON.parse(readFileSync(resolve(snapshotInput), "utf8")) as RemoteSnapshot
      : await collectRemoteSnapshot(asa);
    if (snapshot.appId !== MEDSCAN_APP_ID || snapshot.sourceErrors.length) {
      throw new Error("Input snapshot is incomplete or belongs to another app");
    }
    const revenueSignals = loadRevenueSignals(db);
    const delivery60d = loadDelivery60d(db);
    const freshness = loadFreshness(db);
    const plan = buildRebuildPlan(registry, snapshot.campaigns, revenueSignals);
    if (plan.validation.errors.length) {
      throw new Error(`Dry-run validation failed: ${plan.validation.errors.join("; ")}`);
    }

    const snapshotPath = resolve(outputDir, "before-remote.json");
    const rollbackPath = resolve(outputDir, "rollback-map.json");
    const manifestPath = resolve(outputDir, "dry-run-manifest.json");
    const deliveryPath = resolve(outputDir, "delivery-60d.json");
    const registryCopyPath = resolve(outputDir, basename(registryPath));
    writeJson(snapshotPath, snapshot);
    writeJson(rollbackPath, rollbackMap(snapshot, plan));
    writeJson(manifestPath, plan);
    writeJson(deliveryPath, delivery60d);
    writeFileSync(registryCopyPath, readFileSync(registryPath), { flag: "wx", mode: 0o600 });
    await db.backup(resolve(outputDir, "asa-ads-before.db"));
    const reviewCsvs = writeReviewCsvs(outputDir, plan);

    const summaryText = summary(snapshot, plan, outputDir, freshness);
    writeFileSync(resolve(outputDir, "APPROVAL-BATCH.md"), summaryText, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const artifactNames = [
      "before-remote.json",
      "rollback-map.json",
      "dry-run-manifest.json",
      "delivery-60d.json",
      basename(registryPath),
      "asa-ads-before.db",
      "APPROVAL-BATCH.md",
      ...reviewCsvs,
    ];
    const checksums = Object.fromEntries(artifactNames.map((name) => {
      const content = readFileSync(resolve(outputDir, name));
      return [name, sha256(content)];
    }));
    writeJson(resolve(outputDir, "SHA256SUMS.json"), checksums);

    console.log(stringify({
      ok: true,
      mode: plan.mode,
      outputDir,
      liveCampaigns: snapshot.campaigns.length,
      desiredCampaigns: plan.desiredCampaigns.length,
      paidStorefronts: plan.validation.paidStorefrontCount,
      targetDailyBudgetUsd: plan.validation.totalDailyBudgetUsd,
      ownershipConflicts: plan.validation.ownershipConflicts.length,
      sourceErrors: snapshot.sourceErrors.length,
    }));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(redactApiMessage(errorMessage(error)));
  process.exitCode = 1;
});
