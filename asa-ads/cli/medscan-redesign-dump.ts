import "dotenv/config";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../server/config.ts";
import { AsaClient } from "../server/asa-client.ts";

// Read-only snapshot of every enabled MedScan campaign: ad groups, keywords, negatives.
const ADAM = 6762091560;
const OUT = process.argv[2] ?? "data/medscan-redesign-2026-09-18/before.json";

async function all<T>(asa: AsaClient, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await asa.req<{ data: T[]; pagination?: { totalResults: number } }>("GET", path, { query: { limit: 1000, offset } });
    out.push(...r.data);
    if (!r.pagination || out.length >= r.pagination.totalResults) break;
  }
  return out;
}

async function main() {
  const asa = new AsaClient(loadConfig().asa);
  const camps = (await all<any>(asa, "/campaigns")).filter((c) => c.adamId === ADAM && !c.deleted && c.status === (process.env.STATUS ?? "ENABLED"));
  const snap: any[] = [];
  for (const c of camps) {
    const adGroups = (await all<any>(asa, `/campaigns/${c.id}/adgroups`)).filter((g) => !g.deleted);
    for (const g of adGroups) {
      g.keywords = (await all<any>(asa, `/campaigns/${c.id}/adgroups/${g.id}/targetingkeywords`)).filter((k) => !k.deleted);
      g.negatives = (await all<any>(asa, `/campaigns/${c.id}/adgroups/${g.id}/negativekeywords`)).filter((k) => !k.deleted);
    }
    const negatives = (await all<any>(asa, `/campaigns/${c.id}/negativekeywords`)).filter((k) => !k.deleted);
    snap.push({ id: c.id, name: c.name, countries: c.countriesOrRegions, daily: c.dailyBudgetAmount?.amount, supply: c.supplySources, adGroups, negatives });
    process.stdout.write(".");
  }
  writeFileSync(OUT, JSON.stringify(snap, null, 1));
  console.log(`\n${snap.length} campaigns -> ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
