import { RateLimited, findPosition, searchItunes } from './itunes.js';
import { loadApps, loadKeywords, type AppConfig } from './config.js';
import { insertSnapshotsBatch, type SnapshotRow, db } from './db.js';

export interface SnapshotProgress {
  type: 'start' | 'locale' | 'keyword' | 'done' | 'abort' | 'throttle' | 'speed';
  total?: number;
  completed?: number;
  locale?: string;
  keyword?: string;
  position?: number | null;
  error?: string;
  reason?: string;
  /** For 'throttle' / 'speed' events */
  sleepMs?: number;
  workers?: number;
  cooldownSec?: number;
  source?: 'auto' | 'user';
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

interface LiveRuntime {
  sleepMs: number;
  workers: number;
  /** User-selected pacing — what we recover toward after a throttle cools down. */
  baselineSleepMs: number;
  baselineWorkers: number;
  /** True while pacing is auto-elevated above baseline; recovery decays it back. */
  throttled: boolean;
  cooldownUntil: number;
  consecutiveThrottles: number;
  successesSinceThrottle: number;
  emit: (p: SnapshotProgress) => void;
}

let liveRuntime: LiveRuntime | null = null;

/** Returns the current runtime for any in-flight snapshot, or null. */
export function getLiveRuntime(): { sleepMs: number; workers: number } | null {
  if (!liveRuntime) return null;
  return { sleepMs: liveRuntime.sleepMs, workers: liveRuntime.workers };
}

/**
 * Mutate the running snapshot's pacing. Workers takes effect at the next locale boundary;
 * sleepMs takes effect on the very next iTunes request.
 * Returns false if no snapshot is running.
 */
export function setLiveSpeed(opts: { sleepMs?: number; workers?: number; source?: 'auto' | 'user' }): boolean {
  if (!liveRuntime) return false;
  let changed = false;
  if (typeof opts.sleepMs === 'number' && opts.sleepMs !== liveRuntime.sleepMs) {
    liveRuntime.sleepMs = Math.max(0, opts.sleepMs);
    if (opts.source !== 'auto') liveRuntime.baselineSleepMs = liveRuntime.sleepMs;
    changed = true;
  }
  if (typeof opts.workers === 'number' && opts.workers !== liveRuntime.workers) {
    liveRuntime.workers = Math.max(1, Math.min(8, Math.round(opts.workers)));
    if (opts.source !== 'auto') liveRuntime.baselineWorkers = liveRuntime.workers;
    changed = true;
  }
  if (opts.source !== 'auto' && changed) {
    // User manually adjusted pacing — clear throttle state so auto-recovery doesn't fight them.
    liveRuntime.throttled = false;
    liveRuntime.successesSinceThrottle = 0;
    liveRuntime.consecutiveThrottles = 0;
  }
  if (changed) {
    liveRuntime.emit({
      type: 'speed',
      sleepMs: liveRuntime.sleepMs,
      workers: liveRuntime.workers,
      source: opts.source ?? 'user',
    });
  }
  return true;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a snapshot across apps × locales × keywords.
 * Conservative defaults: 2 workers, 500ms sleep. Auto-throttles down on iTunes rate limit
 * instead of aborting — only gives up after consecutive failures at the slowest preset.
 */
export async function runSnapshot(opts: SnapshotOptions = {}) {
  const { appIds, locales, workers = 2, sleepMs = 500, skipExisting = false, onProgress, isCancelled } = opts;

  const allApps = loadApps();
  const apps: AppConfig[] = appIds ? allApps.filter((a) => appIds.includes(a.id)) : allApps;
  const today = new Date().toISOString().slice(0, 10);

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
  const seenTasks = new Set<string>();
  for (const app of apps) {
    const kws = loadKeywords(app.id);
    for (const [loc, list] of Object.entries(kws)) {
      if (locales && !locales.includes(loc)) continue;
      for (const kw of list) {
        const normalized = kw.trim();
        if (!normalized) continue;
        const key = `${app.id}|${loc}|${normalized}`;
        if (seenTasks.has(key)) continue;
        seenTasks.add(key);
        if (alreadyDone.has(key)) continue;
        if (!byLocale.has(loc)) byLocale.set(loc, []);
        byLocale.get(loc)!.push({ app, locale: loc, keyword: normalized });
      }
    }
  }

  const totalCombos = Array.from(byLocale.values()).reduce((a, b) => a + b.length, 0);
  if (totalCombos === 0) {
    onProgress?.({ type: 'done', total: 0, completed: 0 });
    return { records: [], aborted: false };
  }

  const emit: (p: SnapshotProgress) => void = (p) => onProgress?.(p);

  // Install live runtime so /api/snapshot/speed can mutate it during the run.
  liveRuntime = {
    sleepMs,
    workers,
    baselineSleepMs: sleepMs,
    baselineWorkers: workers,
    throttled: false,
    cooldownUntil: 0,
    consecutiveThrottles: 0,
    successesSinceThrottle: 0,
    emit,
  };

  emit({ type: 'start', total: totalCombos, sleepMs, workers });

  const records: SnapshotRow[] = [];
  let completed = 0;
  let aborted = false;
  let abortReason: string | undefined;

  /** Hard ceiling on auto-throttle escalations before we give up entirely. */
  const MAX_CONSECUTIVE_THROTTLES = 6;
  /** Max sleepMs we'll auto-escalate to (5s/req). */
  const MAX_AUTO_SLEEP_MS = 5000;
  /** Cooldown duration when iTunes is hot. */
  const COOLDOWN_SEC = 60;
  /** After this many consecutive successful keywords, step pacing back toward baseline. */
  const RECOVERY_SUCCESS_THRESHOLD = 30;

  function recoverStep(): void {
    if (!liveRuntime || !liveRuntime.throttled) return;
    if (liveRuntime.successesSinceThrottle < RECOVERY_SUCCESS_THRESHOLD) return;
    const atBaseline =
      liveRuntime.sleepMs <= liveRuntime.baselineSleepMs &&
      liveRuntime.workers >= liveRuntime.baselineWorkers;
    if (atBaseline) {
      liveRuntime.throttled = false;
      liveRuntime.successesSinceThrottle = 0;
      return;
    }
    // Halve sleep toward baseline; bring workers up by 1 toward baseline.
    const newSleep = Math.max(liveRuntime.baselineSleepMs, Math.floor(liveRuntime.sleepMs / 2));
    const newWorkers = Math.min(liveRuntime.baselineWorkers, liveRuntime.workers + 1);
    liveRuntime.sleepMs = newSleep;
    liveRuntime.workers = newWorkers;
    liveRuntime.successesSinceThrottle = 0;
    liveRuntime.emit({ type: 'speed', sleepMs: newSleep, workers: newWorkers, source: 'auto' });
  }

  async function autoThrottle(reason: string): Promise<void> {
    if (!liveRuntime) return;
    liveRuntime.consecutiveThrottles += 1;
    liveRuntime.successesSinceThrottle = 0;
    if (liveRuntime.consecutiveThrottles > MAX_CONSECUTIVE_THROTTLES) {
      aborted = true;
      abortReason = `Persistent rate limit even at slowest speed: ${reason}`;
      return;
    }
    // Escalate pacing: slow down + drop to 1 worker (next-locale enforcement)
    const newSleep = Math.min(MAX_AUTO_SLEEP_MS, Math.max(1000, liveRuntime.sleepMs * 2));
    const newWorkers = 1;
    liveRuntime.sleepMs = newSleep;
    liveRuntime.workers = newWorkers;
    liveRuntime.throttled = true;
    liveRuntime.cooldownUntil = Date.now() + COOLDOWN_SEC * 1000;
    emit({
      type: 'throttle',
      sleepMs: newSleep,
      workers: newWorkers,
      cooldownSec: COOLDOWN_SEC,
      reason,
      source: 'auto',
    });
    // Sleep through the cooldown (interruptible by cancel)
    const deadline = liveRuntime.cooldownUntil;
    while (Date.now() < deadline && !aborted) {
      if (isCancelled?.()) {
        aborted = true;
        abortReason = 'Cancelled by user';
        return;
      }
      await sleep(1000);
    }
  }

  const sortedLocales = Array.from(byLocale.keys()).sort();

  for (const locale of sortedLocales) {
    if (aborted) break;
    if (isCancelled?.()) {
      aborted = true;
      abortReason = 'Cancelled by user';
      break;
    }
    emit({ type: 'locale', locale });

    const tasks = byLocale.get(locale)!.slice(); // mutable copy — we re-push throttled tasks
    let pointer = 0;

    async function worker() {
      while (!aborted) {
        if (isCancelled?.()) { aborted = true; abortReason = 'Cancelled by user'; return; }

        // Honour active cooldown before pulling next task.
        if (liveRuntime && Date.now() < liveRuntime.cooldownUntil) {
          await sleep(500);
          continue;
        }

        const myIdx = pointer++;
        if (myIdx >= tasks.length) return;
        const task = tasks[myIdx];

        try {
          const currentSleep = liveRuntime?.sleepMs ?? sleepMs;
          const results = await searchItunes(task.locale, task.keyword, { sleepMs: currentSleep });
          const { position, total, top5 } = findPosition(results, task.app.bundle);
          if (liveRuntime) {
            liveRuntime.consecutiveThrottles = 0;
            if (liveRuntime.throttled) {
              liveRuntime.successesSinceThrottle += 1;
              recoverStep();
            }
          }
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
          emit({
            type: 'keyword',
            completed,
            total: totalCombos,
            locale: task.locale,
            keyword: task.keyword,
            position,
          });
        } catch (e) {
          if (e instanceof RateLimited) {
            // Auto-throttle path: re-queue the task, slow down, cooldown, retry. Only one
            // worker actually escalates — others see updated cooldownUntil and pause too.
            await autoThrottle((e as Error).message);
            if (aborted) return;
            tasks.push(task); // requeue
            continue;
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
          emit({
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

    // Workers count is read fresh at each locale boundary so live changes apply.
    const localeWorkerCount = liveRuntime?.workers ?? workers;
    await Promise.all(Array.from({ length: localeWorkerCount }, () => worker()));
  }

  liveRuntime = null;

  if (records.length) insertSnapshotsBatch(records);

  if (aborted) {
    emit({ type: 'abort', reason: abortReason, completed, total: totalCombos });
  } else {
    emit({ type: 'done', completed, total: totalCombos });
  }

  return { records, aborted, abortReason };
}

/**
 * Refresh a single (app, locale, keyword) combo on demand. Inserts a new row
 * with today's date so the rankings table picks it up on next fetch.
 */
export async function refreshKeyword(
  appId: string,
  locale: string,
  keyword: string
): Promise<SnapshotRow> {
  const app = loadApps().find((a) => a.id === appId);
  if (!app) throw new Error(`unknown app ${appId}`);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const results = await searchItunes(locale, keyword, { sleepMs: 0 });
    const { position, total, top5 } = findPosition(results, app.bundle);
    const rec: SnapshotRow = {
      date: today,
      app: app.id,
      locale,
      keyword,
      position,
      total,
      top5,
    };
    insertSnapshotsBatch([rec]);
    return rec;
  } catch (e) {
    const rec: SnapshotRow = {
      date: today,
      app: app.id,
      locale,
      keyword,
      position: null,
      total: 0,
      top5: [],
      error: (e as Error).message || 'unknown',
    };
    insertSnapshotsBatch([rec]);
    throw e;
  }
}
