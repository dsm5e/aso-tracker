import { RateLimited, findPosition, searchItunes } from './itunes.js';
import { loadApps, loadKeywords, type AppConfig } from './config.js';
import { insertSnapshotsBatch, type SnapshotRow, db } from './db.js';

export interface SnapshotProgress {
  type: 'start' | 'locale' | 'keyword' | 'done' | 'abort';
  total?: number;
  completed?: number;
  locale?: string;
  keyword?: string;
  position?: number | null;
  error?: string;
  reason?: string;
}

export interface SnapshotOptions {
  appIds?: string[];
  locales?: string[];
  workers?: number;
  sleepMs?: number;
  /** Skip (app, locale, keyword) combos that already have a successful snapshot today. */
  skipExisting?: boolean;
  onProgress?: (p: SnapshotProgress) => void;
  isCancelled?: () => boolean;
}

/**
 * Run a snapshot across apps × locales × keywords.
 * Ported conservative defaults from rank.py: 2 workers, 500ms sleep per thread,
 * abort on persistent 502.
 */
export async function runSnapshot(opts: SnapshotOptions = {}) {
  const { appIds, locales, workers = 2, sleepMs = 500, skipExisting = false, onProgress, isCancelled } = opts;

  const allApps = loadApps();
  const apps: AppConfig[] = appIds ? allApps.filter((a) => appIds.includes(a.id)) : allApps;
  const today = new Date().toISOString().slice(0, 10);

  // Build set of already-done combos for today if resuming
  const alreadyDone = new Set<string>();
  if (skipExisting && apps.length > 0) {
    const placeholders = apps.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT app, locale, keyword FROM snapshots
          WHERE date = ? AND app IN (${placeholders}) AND error IS NULL
          GROUP BY app, locale, keyword`
      )
      .all(today, ...apps.map((a) => a.id)) as Array<{ app: string; locale: string; keyword: string }>;
    for (const r of rows) alreadyDone.add(`${r.app}|${r.locale}|${r.keyword}`);
  }

  interface Task {
    app: AppConfig;
    locale: string;
    keyword: string;
  }
  const byLocale = new Map<string, Task[]>();
  for (const app of apps) {
    const kws = loadKeywords(app.id);
    for (const [loc, list] of Object.entries(kws)) {
      if (locales && !locales.includes(loc)) continue;
      for (const kw of list) {
        if (alreadyDone.has(`${app.id}|${loc}|${kw}`)) continue;
        if (!byLocale.has(loc)) byLocale.set(loc, []);
        byLocale.get(loc)!.push({ app, locale: loc, keyword: kw });
      }
    }
  }

  const totalCombos = Array.from(byLocale.values()).reduce((a, b) => a + b.length, 0);
  if (totalCombos === 0) {
    onProgress?.({ type: 'done', total: 0, completed: 0 });
    return { records: [], aborted: false };
  }

  onProgress?.({ type: 'start', total: totalCombos });

  const records: SnapshotRow[] = [];
  let completed = 0;
  let aborted = false;
  let abortReason: string | undefined;

  const sortedLocales = Array.from(byLocale.keys()).sort();

  for (const locale of sortedLocales) {
    if (aborted) break;
    if (isCancelled?.()) {
      aborted = true;
      abortReason = 'Cancelled by user';
      break;
    }
    onProgress?.({ type: 'locale', locale });

    const tasks = byLocale.get(locale)!;
    let pointer = 0;

    async function worker() {
      while (!aborted) {
        if (isCancelled?.()) { aborted = true; abortReason = 'Cancelled by user'; return; }
        const myIdx = pointer++;
        if (myIdx >= tasks.length) return;
        const task = tasks[myIdx];
        try {
          const results = await searchItunes(task.locale, task.keyword, { sleepMs });
          const { position, total, top5 } = findPosition(results, task.app.bundle);
          const rec: SnapshotRow = {
            date: today,
            app: task.app.id,
            locale: task.locale,
            keyword: task.keyword,
            position,
            total,
            top5,
          };
          records.push(rec);
          completed++;
          onProgress?.({
            type: 'keyword',
            completed,
            total: totalCombos,
            locale: task.locale,
            keyword: task.keyword,
            position,
          });
        } catch (e) {
          if (e instanceof RateLimited) {
            aborted = true;
            abortReason = e.message;
            return;
          }
          const rec: SnapshotRow = {
            date: today,
            app: task.app.id,
            locale: task.locale,
            keyword: task.keyword,
            position: null,
            total: 0,
            top5: [],
            error: (e as Error).message || 'unknown',
          };
          records.push(rec);
          completed++;
          onProgress?.({
            type: 'keyword',
            completed,
            total: totalCombos,
            locale: task.locale,
            keyword: task.keyword,
            error: rec.error,
          });
        }
      }
    }

    // Fan out N workers inside this locale.
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }

  if (records.length) insertSnapshotsBatch(records);

  if (aborted) {
    onProgress?.({ type: 'abort', reason: abortReason, completed, total: totalCombos });
  } else {
    onProgress?.({ type: 'done', completed, total: totalCombos });
  }

  return { records, aborted, abortReason };
}
