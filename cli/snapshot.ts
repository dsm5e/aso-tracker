#!/usr/bin/env tsx
import { runSnapshot } from '../server/snapshot.js';
import { loadApps } from '../server/config.js';

function parseArgs() {
  const out: { apps?: string[]; locales?: string[] } = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--app=')) out.apps = arg.slice(6).split(',');
    else if (arg.startsWith('--locales=')) out.locales = arg.slice(10).split(',');
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage:
  npm run snapshot -- [--app=<id[,id]>] [--locales=<code[,code]>]

Examples:
  npm run snapshot -- --app=dream
  npm run snapshot -- --app=dream --locales=us,tr,de
  npm run snapshot                             # all apps × all locales

Snapshot progress streams line-by-line. Aborts on persistent iTunes 502.
`);
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const { apps, locales } = parseArgs();
  const allApps = loadApps();
  if (allApps.length === 0) {
    console.error('No apps configured. Add one via the UI or edit config/apps.json.');
    process.exit(1);
  }

  const filtered = apps ? allApps.filter((a) => apps.includes(a.id)) : allApps;
  if (filtered.length === 0) {
    console.error(`No matching apps. Available: ${allApps.map((a) => a.id).join(', ')}`);
    process.exit(1);
  }

  let currentLocale = '';
  await runSnapshot({
    appIds: apps,
    locales,
    onProgress: (p) => {
      if (p.type === 'start') {
        console.log(`Fetching ${p.total} keyword×locale combos...`);
      } else if (p.type === 'locale' && p.locale !== currentLocale) {
        currentLocale = p.locale!;
        console.log(`\n── ${p.locale?.toUpperCase()} ──`);
      } else if (p.type === 'keyword') {
        const pos = p.error ? `ERROR: ${p.error.slice(0, 40)}` : p.position ? `#${p.position}` : 'no results';
        console.log(`  ${p.keyword?.padEnd(34)} ${pos}`);
      } else if (p.type === 'done') {
        console.log(`\n✓ Done — ${p.completed}/${p.total} combos written to data/rankings.db`);
      } else if (p.type === 'abort') {
        console.log(`\n⛔  ABORTED: ${p.reason}`);
        console.log(`    Partial data (${p.completed}/${p.total}) saved.`);
        console.log(`    iTunes rate-limited your IP. Wait 2-3 minutes and retry.`);
        process.exitCode = 1;
      }
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
