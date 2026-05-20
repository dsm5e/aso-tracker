import "dotenv/config";
import { loadConfig } from "../server/config.ts";
import { openDb } from "../server/db.ts";
import { AsaClient } from "../server/asa-client.ts";
import { AscClient } from "../server/asc-client.ts";
import { fullSync } from "../server/sync.ts";

async function main(): Promise<void> {
  const cfg = loadConfig();
  openDb(cfg.dataDir);
  const asa = new AsaClient(cfg.asa);
  const asc = new AscClient(cfg.asc);
  const days = Number(process.argv[2] ?? 14);
  console.log(`Syncing last ${days} days...`);
  const res = await fullSync(asa, asc, days);
  console.log(`Done: ${res.campaigns} campaigns, ${res.adGroups} ad groups, ${res.keywords} keywords`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
