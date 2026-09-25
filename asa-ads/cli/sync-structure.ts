import "dotenv/config";
import { loadConfig } from "../server/config.ts";
import { openDb } from "../server/db.ts";
import { AsaClient } from "../server/asa-client.ts";
import { syncAdGroupsAndKeywords, syncCampaigns } from "../server/sync.ts";

async function main(): Promise<void> {
  const cfg = loadConfig();
  openDb(cfg.dataDir);
  const asa = new AsaClient(cfg.asa);
  const campaigns = await syncCampaigns(asa);
  const medscan = campaigns.filter((campaign) => campaign.adamId === 6762091560);
  const structure = await syncAdGroupsAndKeywords(asa, medscan.map((campaign) => campaign.id));
  console.log(JSON.stringify({ campaigns: medscan.length, adGroups: structure.adGroups.length, keywords: structure.keywords.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
