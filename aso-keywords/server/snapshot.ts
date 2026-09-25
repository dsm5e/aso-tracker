import { refreshOwnAppMeta } from './own-app-meta.js';
import { RateLimited, positionFromRank, searchRanked, type RankSource, type Top5Entry } from './itunes.js';
import { gateStatus, hostGate, onGateEvent, type GateHost, type GatePriority, type HostGateStatus } from './host-gate.js';
import { activeProbeMatcher, insertProbe, loadSnapshotSettings, measureProbe, otherSource } from './rank-source.js';
import { loadApps, loadKeywords, type AppConfig } from './config.js';
import { insertSnapshot, type SnapshotRow, db } from './db.js';

export interface SnapshotProgress {
  type: 'start' | 'locale' | 'keyword-start' | 'keyword' | 'retry' | 'done' | 'abort' | 'throttle' | 'speed';
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
  attempt?: number;
  maxAttempts?: number;
  top5?: Top5Entry[];
  /** Rank source that answered ('keyword') or the run's configured source ('start'). */
  rankSource?: RankSource;
  /** Request latency for 'keyword' events, ms. */
  ms?: number;
  /** Gate state of the host involved ('throttle' / 'speed' / 'start'). */
  gate?: HostGateStatus;
}

export interface SnapshotOptions {
  appIds?: string[];
  locales?: string[];
  workers?: number;
  /** Speed preset. ≤3250 ms = adaptive gate rate; slower presets cap the rate at 60000/sleepMs per minute. */
  sleepMs?: number;
  /** Override the stored rank source setting for this run. */
  rankSource?: RankSource;
  /** Skip (app, locale, keyword) combos that already have a successful snapshot today. */
  skipExisting?: boolean;
  onProgress?: (p: SnapshotProgress) => void;
  isCancelled?: () => boolean;
}

const RANK_HOSTS: GateHost[] = ['search.itunes.apple.com', 'itunes.apple.com'];
const hostOf = (s: RankSource): GateHost => (s === 'appstore' ? 'search.itunes.apple.com' : 'itunes.apple.com');

/** Speed preset → optional gate cap. The default preset leaves pacing to AIMD. */
function capFor(sleepMs: number): number | null {
  return sleepMs > 3250 ? Math.max(1, Math.round(60_000 / sleepMs)) : null;
}
function applyCap(sleepMs: number) {
  const cap = capFor(sleepMs);
  for (const h of RANK_HOSTS) hostGate(h).setCap(cap);
}

interface LiveRuntime {
  sleepMs: number;
  workers: number;
  emit: (p: SnapshotProgress) => void;
}

let liveRuntime: LiveRuntime | null = null;

/** Returns the current runtime for any in-flight snapshot, or null. */
export function getLiveRuntime(): { sleepMs: number; workers: number; gates: HostGateStatus[] } | null {
  if (!liveRuntime) return null;
  return { sleepMs: liveRuntime.sleepMs, workers: liveRuntime.workers, gates: gateStatus() };
}

/**
 * Change the running snapshot's pacing. `sleepMs` maps to a gate cap (next
 * request); `workers` applies at the next locale boundary.
 * Returns false if no snapshot is running.
 */
export function setLiveSpeed(opts: { sleepMs?: number; workers?: number; source?: 'auto' | 'user' }): boolean {
  if (!liveRuntime) return false;
  let changed = false;
  if (typeof opts.sleepMs === 'number' && opts.sleepMs !== liveRuntime.sleepMs) {
    liveRuntime.sleepMs = Math.max(0, opts.sleepMs);
    applyCap(liveRuntime.sleepMs);
    changed = true;
  }
  if (typeof opts.workers === 'number' && opts.workers !== liveRuntime.workers) {
    liveRuntime.workers = Math.max(1, Math.min(8, Math.round(opts.workers)));
    changed = true;
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

/** Latest known position per (app|locale|keyword), for queue priorities. */
function latestPositions(appIds: string[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (appIds.length === 0) return out;
  const placeholders = appIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT s.app, s.locale, s.keyword, s.position FROM snapshots s
      JOIN (SELECT MAX(id) AS id FROM snapshots WHERE app IN (${placeholders}) AND error IS NULL
             GROUP BY app, locale, keyword) l ON l.id = s.id
  `).all(...appIds) as Array<{ app: string; locale: string; keyword: string; position: number | null }>;
  for (const r of rows) out.set(`${r.app}|${r.locale}|${r.keyword}`, r.position);
  return out;
}

/**
 * Run a snapshot across apps × locales × keywords. Pacing, rate-limit pauses
 * and retries belong to the per-host gate; this loop only orders work, records
 * rows and reports progress. Probe pairs are also measured with the other source.
 */
export async function runSnapshot(opts: SnapshotOptions = {}) {
  const { appIds, locales, workers = 1, sleepMs = 3250, skipExisting = false, onProgress, isCancelled } = opts;
  const rankSource: RankSource = opts.rankSource ?? loadSnapshotSettings().rankSource;

  // Every refresh also pulls our apps' current icon/name/subtitle from the App Store,
  // so a new icon or title shows up with the new positions (best-effort, ~1–2 s per app).
  await refreshOwnAppMeta(appIds).catch(() => {});
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
  const lastPos = latestPositions(apps.map((a) => a.id));

  interface Task {
    app: AppConfig;
    locale: string;
    keyword: string;
    priority: GatePriority;
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
        const pos = lastPos.get(key);
        byLocale.get(loc)!.push({ app, locale: loc, keyword: normalized, priority: pos != null && pos <= 10 ? 'top' : 'tail' });
      }
    }
  }
  // Keywords we are in the top 10 for go first within each storefront.
  for (const list of byLocale.values()) list.sort((a, b) => Number(a.priority !== 'top') - Number(b.priority !== 'top'));

  const totalCombos = Array.from(byLocale.values()).reduce((a, b) => a + b.length, 0);
  if (totalCombos === 0) {
    onProgress?.({ type: 'done', total: 0, completed: 0 });
    return { records: [], aborted: false };
  }

  const emit: (p: SnapshotProgress) => void = (p) => onProgress?.(p);
  liveRuntime = { sleepMs, workers, emit };
  applyCap(sleepMs);

  const records: SnapshotRow[] = [];
  let completed = 0;
  let aborted = false;
  let abortReason: string | undefined;

  // Cancellation: one AbortController for every queued/in-flight request.
  const ctrl = new AbortController();
  const cancelPoll = setInterval(() => {
    if (isCancelled?.() && !ctrl.signal.aborted) {
      aborted = true;
      abortReason = 'Cancelled by user';
      ctrl.abort();
    }
  }, 300);

  // Gate state → SSE: a pause is a 'throttle', an AIMD step is a 'speed'.
  const offGate = onGateEvent((e) => {
    if (!RANK_HOSTS.includes(e.host)) return;
    const gate = hostGate(e.host).status();
    if (e.type === 'limit') {
      emit({
        type: 'throttle',
        completed,
        total: totalCombos,
        cooldownSec: Math.ceil((e.pausedUntil - Date.now()) / 1000),
        reason: `${e.host}: HTTP ${e.status} — пауза 5 мин, темп ${e.ratePerMin}/мин`,
        source: 'auto',
        gate,
      });
    } else {
      emit({ type: 'speed', completed, total: totalCombos, source: 'auto', sleepMs: liveRuntime?.sleepMs, workers: liveRuntime?.workers, gate });
    }
  });

  emit({ type: 'start', total: totalCombos, sleepMs, workers, rankSource, gate: hostGate(hostOf(rankSource)).status() });

  const isProbe = activeProbeMatcher();
  /** Both hosts limited this many times in a row → give up with a readable reason. */
  const MAX_CONSECUTIVE_LIMITS = 4;
  let consecutiveLimits = 0;
  const MAX_TASK_ATTEMPTS = 3;
  const taskAttempts = new Map<string, number>();

  const sortedLocales = Array.from(byLocale.keys()).sort();

  try {
    for (const locale of sortedLocales) {
      if (aborted) break;
      emit({ type: 'locale', locale });

      const tasks = byLocale.get(locale)!.slice(); // mutable copy — failed tasks are re-queued
      let pointer = 0;

      const worker = async () => {
        while (!aborted) {
          const myIdx = pointer++;
          if (myIdx >= tasks.length) return;
          const task = tasks[myIdx];
          const taskKey = `${task.app.id}|${task.locale}|${task.keyword}`;

          try {
            emit({
              type: 'keyword-start',
              completed,
              total: totalCombos,
              locale: task.locale,
              keyword: task.keyword,
              attempt: (taskAttempts.get(taskKey) ?? 0) + 1,
              maxAttempts: MAX_TASK_ATTEMPTS,
            });
            const res = await searchRanked(rankSource, task.locale, task.keyword, {
              priority: task.priority,
              signal: ctrl.signal,
              onRetry: ({ attempt, maxAttempts, reason }) => emit({
                type: 'retry',
                completed,
                total: totalCombos,
                locale: task.locale,
                keyword: task.keyword,
                attempt,
                maxAttempts,
                reason,
              }),
            });
            consecutiveLimits = 0;
            const { position, total, top5 } = positionFromRank(res, task.app);
            const rec: SnapshotRow = {
              date: today,
              app: task.app.id,
              locale: task.locale,
              keyword: task.keyword,
              position,
              total,
              top5,
              source: res.source,
            };
            records.push(rec);
            // Commit each successful keyword immediately. A browser close,
            // worker restart or later rate limit never discards prior progress.
            insertSnapshot(rec);
            completed++;
            emit({
              type: 'keyword',
              completed,
              total: totalCombos,
              locale: task.locale,
              keyword: task.keyword,
              position,
              top5,
              rankSource: res.source,
              ms: res.ms,
            });

            // Dual measurement for the probe set: also record the other source.
            const pair = { app: task.app.id, locale: task.locale, keyword: task.keyword };
            if (isProbe?.(pair)) {
              insertProbe({ ...pair, date: today, source: res.source, position, total, ms: res.ms });
              if (res.source === rankSource) {
                await measureProbe(pair, otherSource(rankSource), { priority: 'tail', signal: ctrl.signal, date: today })
                  .catch((e) => console.warn(`[probe] ${taskKey}: ${(e as Error).message}`));
              }
            }
          } catch (e) {
            if (aborted || (e as Error).name === 'AbortError') return;
            if (e instanceof RateLimited) {
              // The gate already paused the host for 5 minutes; the re-queued
              // task waits there (cancel still interrupts the wait).
              consecutiveLimits++;
              if (consecutiveLimits > MAX_CONSECUTIVE_LIMITS) {
                aborted = true;
                abortReason = `Apple держит лимит даже после пауз: ${(e as Error).message}`;
                ctrl.abort();
                return;
              }
              tasks.push(task);
              continue;
            }
            const attempt = (taskAttempts.get(taskKey) ?? 0) + 1;
            taskAttempts.set(taskKey, attempt);
            if (attempt < MAX_TASK_ATTEMPTS) {
              emit({
                type: 'retry',
                completed,
                total: totalCombos,
                locale: task.locale,
                keyword: task.keyword,
                error: (e as Error).message || 'unknown',
                attempt: attempt + 1,
                maxAttempts: MAX_TASK_ATTEMPTS,
              });
              tasks.push(task);
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
              source: rankSource,
            };
            records.push(rec);
            insertSnapshot(rec);
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
      };

      // Workers count is read fresh at each locale boundary so live changes apply.
      const localeWorkerCount = liveRuntime?.workers ?? workers;
      await Promise.all(Array.from({ length: localeWorkerCount }, () => worker()));
    }
  } finally {
    clearInterval(cancelPoll);
    offGate();
    applyCap(3250); // drop any preset cap
    liveRuntime = null;
  }

  if (aborted) {
    emit({ type: 'abort', reason: abortReason, completed, total: totalCombos });
  } else {
    emit({ type: 'done', completed, total: totalCombos });
  }

  return { records, aborted, abortReason };
}

/**
 * Refresh a single (app, locale, keyword) combo on demand (UI → interactive
 * priority). Inserts a new row with today's date.
 */
export async function refreshKeyword(
  appId: string,
  locale: string,
  keyword: string
): Promise<SnapshotRow> {
  const app = loadApps().find((a) => a.id === appId);
  if (!app) throw new Error(`unknown app ${appId}`);
  const today = new Date().toISOString().slice(0, 10);
  const rankSource = loadSnapshotSettings().rankSource;
  try {
    const res = await searchRanked(rankSource, locale, keyword, { priority: 'interactive' });
    const { position, total, top5 } = positionFromRank(res, app);
    const rec: SnapshotRow = {
      date: today,
      app: app.id,
      locale,
      keyword,
      position,
      total,
      top5,
      source: res.source,
    };
    insertSnapshot(rec);
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
      source: rankSource,
    };
    insertSnapshot(rec);
    throw e;
  }
}
