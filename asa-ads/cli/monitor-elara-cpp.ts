import "dotenv/config";
import { loadConfig } from "../server/config.ts";
import { AsaClient } from "../server/asa-client.ts";

const campaigns = [
  { id: 2144361718, intent: "pregnancy-core-default-page" },
  { id: 2144362055, intent: "calendar" },
  { id: 2144362650, intent: "kick" },
  { id: 2144362156, intent: "contractions" },
  { id: 2144363232, intent: "partner" },
];

const daysArg = Number(process.argv[2] ?? 7);
const days = Number.isFinite(daysArg) && daysArg > 0 ? Math.floor(daysArg) : 7;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const end = new Date();
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - days + 1);

const metric = (row: any, field: string) =>
  row?.total?.[field]?.amount === undefined
    ? Number(row?.total?.[field] ?? 0)
    : Number(row.total[field].amount);

async function main() {
  const asa = new AsaClient(loadConfig().asa);
  const rows = await asa.campaignReport(iso(start), iso(end));

  const summary = campaigns.map(({ id, intent }) => {
    const row = rows.find((candidate) => candidate.metadata?.campaignId === id);
    const spend = metric(row, "localSpend");
    const impressions = metric(row, "impressions");
    const taps = metric(row, "taps");
    const installs = metric(row, "totalInstalls");
    return {
      intent,
      campaignId: id,
      status: row?.metadata?.campaignStatus ?? "MISSING",
      serving: row?.metadata?.servingStatus ?? "MISSING",
      spend: spend.toFixed(2),
      impressions,
      taps,
      installs,
      ttr: impressions ? `${((taps / impressions) * 100).toFixed(1)}%` : "—",
      installRate: taps ? `${((installs / taps) * 100).toFixed(1)}%` : "—",
      cpi: installs ? `$${(spend / installs).toFixed(3)}` : "—",
    };
  });
  console.table(summary);

  for (const { id, intent } of campaigns) {
    const terms = await asa.searchTermReport(id, iso(start), iso(end));
    const aggregated = terms
      .map((row: any) => {
        const totals = (row.granularity ?? []).reduce(
          (acc: any, day: any) => {
            acc.spend += Number(day.localSpend?.amount ?? 0);
            acc.impressions += Number(day.impressions ?? 0);
            acc.taps += Number(day.taps ?? 0);
            acc.installs += Number(day.totalInstalls ?? 0);
            return acc;
          },
          { spend: 0, impressions: 0, taps: 0, installs: 0 },
        );
        return {
          source: row.metadata?.searchTermSource,
          match: row.metadata?.matchType,
          seed: row.metadata?.keyword,
          term: row.metadata?.searchTermText ?? "(other)",
          ...totals,
          cpi: totals.installs
            ? `$${(totals.spend / totals.installs).toFixed(3)}`
            : "—",
        };
      })
      .filter((row: any) => row.impressions || row.spend)
      .sort((a: any, b: any) => b.spend - a.spend);
    console.log(`\n${intent} search terms`);
    console.table(aggregated);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
