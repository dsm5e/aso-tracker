import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AsaClient, RawCampaign } from "./asa-client.ts";
import { getDb, openDb } from "./db.ts";
import { attributableCampaignCountry, campaignSyncScopes, syncCampaigns } from "./sync.ts";

const campaign = (id: number, name: string): RawCampaign => ({
  id,
  adamId: 6771391236,
  name,
  status: "ENABLED",
  servingStatus: "RUNNING",
  countriesOrRegions: ["BR"],
  dailyBudgetAmount: { amount: "2", currency: "USD" },
}) as RawCampaign;

test("syncCampaigns marks campaigns missing from the live response as deleted", async () => {
  openDb(mkdtempSync(join(tmpdir(), "asa-sync-")));
  let live = [campaign(1, "Legacy"), campaign(2, "Current")];
  const asa = { listCampaigns: async () => live } as unknown as AsaClient;

  await syncCampaigns(asa);
  live = [campaign(2, "Current")];
  await syncCampaigns(asa);

  const rows = getDb()
    .prepare("SELECT id, status, serving_status, display_status FROM asa_campaigns ORDER BY id")
    .all() as Array<Record<string, unknown>>;

  assert.deepEqual(rows, [
    { id: 1, status: "DELETED", serving_status: "NOT_RUNNING", display_status: "DELETED" },
    { id: 2, status: "ENABLED", serving_status: "RUNNING", display_status: null },
  ]);
});

test("campaignSyncScopes loads paused structure without requesting paused reports", () => {
  const enabled = campaign(1, "Live");
  const paused = { ...campaign(2, "Staged"), status: "PAUSED", servingStatus: "NOT_RUNNING" };

  assert.deepEqual(campaignSyncScopes([enabled, paused]), {
    structureIds: [1, 2],
    reportIds: [1],
  });
});

test("keyword revenue labels only dedicated-country campaigns with a storefront", () => {
  assert.equal(attributableCampaignCountry('["BR"]', "BR"), "BR");
  assert.equal(attributableCampaignCountry('["AR","BR","MX"]', "AR"), null);
  assert.equal(attributableCampaignCountry(null, "de"), "DE");
  assert.equal(attributableCampaignCountry("not-json", "US"), "US");
});
