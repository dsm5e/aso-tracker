import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "../server/config.ts";
import { AsaClient } from "../server/asa-client.ts";

// Applies data/medscan-redesign-2026-09-18/ops.json in order; journals every call. Pass --apply to write.
const D = "data/medscan-redesign-2026-09-18";
const apply = process.argv.includes("--apply");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").map(Number);
const ops: any[] = JSON.parse(readFileSync(process.env.OPS ?? `${D}/ops.json`, "utf8")).filter((_: any, i: number) => !only || only.includes(i));

function route(o: any): [("PUT" | "POST" | "DELETE"), string, unknown] {
  switch (o.op) {
    case "campaign": return ["PUT", `/campaigns/${o.id}`, o.body];
    case "kw_update": return ["PUT", `/campaigns/${o.campaign}/adgroups/${o.adGroup}/targetingkeywords/bulk`, o.body];
    case "kw_create": return ["POST", `/campaigns/${o.campaign}/adgroups/${o.adGroup}/targetingkeywords/bulk`, o.body];
    case "adgroup": return ["PUT", `/campaigns/${o.campaign}/adgroups/${o.adGroup}`, o.body];
    case "neg_create": return ["POST", `/campaigns/${o.campaign}/negativekeywords/bulk`, o.body];
    case "campaign_delete": return ["DELETE", `/campaigns/${o.id}`, undefined];
    case "kw_delete": return ["POST", `/campaigns/${o.campaign}/adgroups/${o.adGroup}/targetingkeywords/delete/bulk`, o.body];
    case "neg_delete": return ["POST", `/campaigns/${o.campaign}/negativekeywords/delete/bulk`, o.body];
  }
  throw new Error(`unknown op ${o.op}`);
}

async function main() {
  const asa = new AsaClient(loadConfig().asa);
  const journal: any[] = [];
  let failed = 0;
  for (const [i, o] of ops.entries()) {
    const [method, path, body] = route(o);
    if (!apply) { journal.push({ i, method, path, n: Array.isArray(body) ? body.length : 1 }); continue; }
    try {
      const r: any = await asa.req(method, path, { body });
      const errs = (r?.data ?? []).filter?.((x: any) => x?.error || x?.errors) ?? [];
      journal.push({ i, method, path, ok: true, partialErrors: errs, countries: r?.data?.countriesOrRegions?.length, budget: r?.data?.dailyBudgetAmount?.amount, status: r?.data?.status });
      if (errs.length) failed++;
    } catch (e: any) {
      failed++;
      journal.push({ i, method, path, ok: false, error: String(e.message).slice(0, 400) });
    }
    process.stdout.write(journal.at(-1).ok === false ? "x" : ".");
  }
  writeFileSync(`${D}/journal-${process.env.OPS ? process.env.OPS.split("/").pop()!.replace(".json", "") + "-" : ""}${apply ? "apply" : "dry"}${only ? "-" + only.join("_") : ""}.json`, JSON.stringify({ at: new Date().toISOString(), journal }, null, 1));
  console.log(`\n${apply ? "APPLIED" : "DRY"}: ${ops.length} ops, ${failed} with errors`);
}
main().catch((e) => { console.error(e); process.exit(1); });
