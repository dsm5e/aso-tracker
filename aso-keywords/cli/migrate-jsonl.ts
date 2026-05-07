#!/usr/bin/env tsx
// One-shot: import existing rank.py jsonl into SQLite.
// Usage: npm run migrate-jsonl -- /path/to/aso-rankings.jsonl

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { insertSnapshotsBatch, type SnapshotRow } from '../server/db.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run migrate-jsonl -- /path/to/aso-rankings.jsonl');
  process.exit(1);
}

interface JsonlRow {
  date: string;
  app: string;
  locale: string;
  keyword: string;
  position: number | null;
  total_returned?: number;
  top5?: Array<{ name: string; id: string; dev: string }>;
  error?: string;
}

async function main() {
  const rl = createInterface({ input: createReadStream(path!), crlfDelay: Infinity });
  const batch: SnapshotRow[] = [];
  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as JsonlRow;
      batch.push({
        date: r.date,
        app: r.app,
        locale: r.locale,
        keyword: r.keyword,
        position: r.position ?? null,
        total: r.total_returned ?? 0,
        top5: r.top5 ?? [],
        error: r.error,
      });
      if (batch.length >= 500) {
        insertSnapshotsBatch(batch);
        count += batch.length;
        batch.length = 0;
        process.stdout.write(`\rimported ${count} rows…`);
      }
    } catch (e) {
      console.error(`\nBad line: ${line.slice(0, 60)}… ${(e as Error).message}`);
    }
  }
  if (batch.length) {
    insertSnapshotsBatch(batch);
    count += batch.length;
  }
  console.log(`\n✓ Imported ${count} rows into data/rankings.db`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
