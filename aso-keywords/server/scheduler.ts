// Delta refresh + nightly schedule for keyword ranks.
//
// Tiers per (app, storefront, keyword):
//   daily  — last known position ≤ 50, or the keyword was added < 7 days ago
//            (first snapshot row < 7 days old / never measured), or it is in
//            the active App Store vs iTunes probe set;
//   weekly — everything else, spread evenly over the week by a stable hash of
//            keyword × storefront → weekday (the same search is shared by every
//            app tracking it in that storefront, so they refresh on one day).
//            A weekly pair not measured for > 7 days (missed nights) is caught
//            up, at most 1/7 of the weekly tier per night, oldest first.
//
// The nightly job runs the day's delta once per local day at or after
// `hour` (default 04:00, env KEYWORDS_NIGHTLY_HOUR): daily tier with gate
// priority `top`, weekly with `tail`. It waits while a manual snapshot is
// running, is resumable (skipExisting for today; a restart simply re-plans),
// and gives up for the day after 3 unsuccessful attempts ≥ 30 min apart.
// State lives in ~/.aso-studio/keywords/schedule.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.js';
import { loadApps, loadKeywords } from './config.js';
import { KEYWORDS_HOME, ensureKeywordsHome } from './paths.js';
import { activeProbeMatcher } from './rank-source.js';
import { DEFAULT_GATE_CONFIG, hostGate, type GatePriority } from './host-gate.js';

export type Tier = 'daily' | 'weekly';
export type DeltaReason = 'top50' | 'new' | 'probe' | 'weekday' | 'overdue';

export const DAILY_MAX_POSITION = 50;
export const NEW_KEYWORD_DAYS = 7;
export const WEEKLY_OVERDUE_DAYS = 7;
const DAY_MS = 86_400_000;

/** What we know about one tracked (app, storefront, keyword). */
export interface ComboInfo {
  app: string;
  locale: string;
  keyword: string;
  /** Latest successful position; null = not in results; undefined = never measured OK. */
  lastPosition?: number | null;
  /** First snapshot row (any outcome), YYYY-MM-DD. */
  firstDate?: string;
  /** Last successful snapshot, YYYY-MM-DD. */
  lastOkDate?: string;
  probe?: boolean;
}

export interface PlannedTask {
  key: string;
  app: string;
  locale: string;
  keyword: string;
  tier: Tier;
  reason: DeltaReason;
  priority: GatePriority;
}

export interface TierCounts {
  total: number;
  daily: number;
  weekly: number;
}

export interface DeltaPlan {
  date: string;
  weekday: number;
  tiers: TierCounts;
  tiersByApp: Record<string, TierCounts>;
  tasks: PlannedTask[];
  planned: { total: number; daily: number; weekly: number; overdue: number; byApp: Record<string, number> };
  /** Distinct (storefront, keyword) searches — what Apple actually sees. */
  requests: number;
}

export const comboKey = (app: string, locale: string, keyword: string) => `${app}|${locale}|${keyword}`;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD date (calendar, timezone-free). */
export function weekdayOfDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Stable weekday for a weekly-tier pair: FNV-1a of "storefront|keyword" mod 7. */
export function weekdayFor(keyword: string, storefront: string): number {
  const s = `${storefront.toLowerCase()}|${keyword.trim().toLowerCase()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 7;
}

export function tierOf(c: ComboInfo, today: string): { tier: Tier; reason: DeltaReason | null } {
  if (c.probe) return { tier: 'daily', reason: 'probe' };
  if (c.lastPosition != null && c.lastPosition <= DAILY_MAX_POSITION) return { tier: 'daily', reason: 'top50' };
  if (c.lastOkDate === undefined && c.firstDate === undefined) return { tier: 'daily', reason: 'new' };
  if (c.firstDate !== undefined && daysBetween(c.firstDate, today) < NEW_KEYWORD_DAYS) return { tier: 'daily', reason: 'new' };
  return { tier: 'weekly', reason: null };
}

/** Pure: which combos to refresh on `date`. */
export function planDelta(combos: ComboInfo[], date: string): DeltaPlan {
  const weekday = weekdayOfDate(date);
  const tiers: TierCounts = { total: 0, daily: 0, weekly: 0 };
  const tiersByApp: Record<string, TierCounts> = {};
  const tasks: PlannedTask[] = [];
  const overdue: Array<{ c: ComboInfo; age: number }> = [];
  let weeklyTotal = 0;

  for (const c of combos) {
    const { tier, reason } = tierOf(c, date);
    const byApp = (tiersByApp[c.app] ??= { total: 0, daily: 0, weekly: 0 });
    tiers.total++; byApp.total++;
    tiers[tier]++; byApp[tier]++;
    const base = { key: comboKey(c.app, c.locale, c.keyword), app: c.app, locale: c.locale, keyword: c.keyword, tier };
    if (tier === 'daily') {
      tasks.push({ ...base, reason: reason!, priority: 'top' });
      continue;
    }
    weeklyTotal++;
    if (weekdayFor(c.keyword, c.locale) === weekday) {
      tasks.push({ ...base, reason: 'weekday', priority: 'tail' });
    } else {
      const age = c.lastOkDate ? daysBetween(c.lastOkDate, date) : Infinity;
      if (age > WEEKLY_OVERDUE_DAYS) overdue.push({ c, age });
    }
  }

  // Catch-up for missed nights, bounded so one night never becomes a full run.
  const catchUp = Math.ceil(weeklyTotal / 7);
  overdue.sort((a, b) => b.age - a.age || a.c.locale.localeCompare(b.c.locale) || a.c.keyword.localeCompare(b.c.keyword));
  for (const { c } of overdue.slice(0, catchUp)) {
    tasks.push({ key: comboKey(c.app, c.locale, c.keyword), app: c.app, locale: c.locale, keyword: c.keyword, tier: 'weekly', reason: 'overdue', priority: 'tail' });
  }

  const byApp: Record<string, number> = {};
  for (const t of tasks) byApp[t.app] = (byApp[t.app] ?? 0) + 1;
  const requests = new Set(tasks.map((t) => `${t.locale}|${t.keyword.toLowerCase()}`)).size;
  return {
    date,
    weekday,
    tiers,
    tiersByApp,
    tasks,
    planned: {
      total: tasks.length,
      daily: tasks.filter((t) => t.tier === 'daily').length,
      weekly: tasks.filter((t) => t.reason === 'weekday').length,
      overdue: tasks.filter((t) => t.reason === 'overdue').length,
      byApp,
    },
    requests,
  };
}

/**
 * Minutes to send `requests` searches with AIMD growth (+step per 50 successes,
 * up to max) starting from `ratePerMin`, spread over `lanes` equal lanes.
 */
export function estimateMinutes(requests: number, ratePerMin: number, lanes = 1, cfg = DEFAULT_GATE_CONFIG): number {
  if (requests <= 0) return 0;
  const perLane = Math.ceil(requests / Math.max(1, lanes));
  let rate = Math.max(1, ratePerMin);
  let left = perLane;
  let minutes = 0;
  while (left > 0) {
    const chunk = Math.min(left, cfg.successesPerStep);
    minutes += chunk / rate;
    left -= chunk;
    rate = Math.min(cfg.maxPerMin, rate + cfg.stepPerMin);
  }
  return minutes;
}

// --- Data --------------------------------------------------------------------

/** Tracked combos with their history, optionally narrowed to apps/storefronts. */
export function loadCombos(filter: { appIds?: string[]; locales?: string[] } = {}): ComboInfo[] {
  const apps = loadApps().filter((a) => !filter.appIds || filter.appIds.includes(a.id));
  if (apps.length === 0) return [];
  const ids = apps.map((a) => a.id);
  const ph = ids.map(() => '?').join(',');
  const hist = new Map<string, { first: string; lastOk: string | null }>();
  for (const r of db.prepare(`
    SELECT app, locale, keyword, MIN(date) AS first, MAX(CASE WHEN error IS NULL THEN date END) AS lastOk
      FROM snapshots WHERE app IN (${ph}) GROUP BY app, locale, keyword
  `).all(...ids) as Array<{ app: string; locale: string; keyword: string; first: string; lastOk: string | null }>) {
    hist.set(comboKey(r.app, r.locale, r.keyword), { first: r.first, lastOk: r.lastOk });
  }
  const pos = new Map<string, number | null>();
  for (const r of db.prepare(`
    SELECT s.app, s.locale, s.keyword, s.position FROM snapshots s
      JOIN (SELECT MAX(id) AS id FROM snapshots WHERE app IN (${ph}) AND error IS NULL
             GROUP BY app, locale, keyword) l ON l.id = s.id
  `).all(...ids) as Array<{ app: string; locale: string; keyword: string; position: number | null }>) {
    pos.set(comboKey(r.app, r.locale, r.keyword), r.position);
  }
  const isProbe = activeProbeMatcher();

  const out: ComboInfo[] = [];
  const seen = new Set<string>();
  for (const app of apps) {
    for (const [locale, list] of Object.entries(loadKeywords(app.id))) {
      if (filter.locales && !filter.locales.includes(locale)) continue;
      for (const raw of list) {
        const keyword = raw.trim();
        if (!keyword) continue;
        const key = comboKey(app.id, locale, keyword);
        if (seen.has(key)) continue;
        seen.add(key);
        const h = hist.get(key);
        out.push({
          app: app.id,
          locale,
          keyword,
          lastPosition: pos.has(key) ? pos.get(key) : undefined,
          firstDate: h?.first,
          lastOkDate: h?.lastOk ?? undefined,
          probe: isProbe?.({ app: app.id, locale, keyword }) ?? false,
        });
      }
    }
  }
  return out;
}

/** Snapshot rows are dated in UTC (snapshot.ts); the delta plan uses the same day. */
export const snapshotDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function buildDeltaPlan(filter: { appIds?: string[]; locales?: string[] } = {}, atMs = Date.now()): DeltaPlan {
  return planDelta(loadCombos(filter), snapshotDate(atMs));
}

/** Map for runSnapshot({ only }): combo key → gate priority. */
export function planToOnly(plan: DeltaPlan): Map<string, GatePriority> {
  return new Map(plan.tasks.map((t) => [t.key, t.priority]));
}

// --- Schedule state ------------------------------------------------------------

export interface ScheduleConfig {
  enabled: boolean;
  /** Local hour 0–23. */
  hour: number;
}

export interface ScheduleRun {
  trigger: 'nightly' | 'run-now';
  /** Local calendar day the nightly slot belongs to. */
  day: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  planned: number;
  daily: number;
  weekly: number;
  overdue: number;
  requests: number;
  completed: number;
  errors: number;
  status: 'running' | 'ok' | 'aborted' | 'failed';
  reason?: string;
}

export interface ScheduleState {
  config: ScheduleConfig;
  /** Local day of the last completed nightly run. */
  lastNightlyDay: string | null;
  attempts: { day: string; count: number; lastAt: number } | null;
  lastSkip: { day: string; at: number; reason: string } | null;
  runs: ScheduleRun[];
}

export const SCHEDULE_PATH = join(KEYWORDS_HOME, 'schedule.json');
const MAX_RUNS = 20;
export const MAX_ATTEMPTS_PER_DAY = 3;
export const RETRY_GAP_MS = 30 * 60_000;

export function defaultHour(env: NodeJS.ProcessEnv = process.env): number {
  const h = Number(env.KEYWORDS_NIGHTLY_HOUR);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 4;
}

export function defaultState(): ScheduleState {
  return { config: { enabled: true, hour: defaultHour() }, lastNightlyDay: null, attempts: null, lastSkip: null, runs: [] };
}

export function loadScheduleState(path = SCHEDULE_PATH): ScheduleState {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ScheduleState>;
    const def = defaultState();
    return {
      config: {
        enabled: typeof raw.config?.enabled === 'boolean' ? raw.config.enabled : def.config.enabled,
        hour: Number.isInteger(raw.config?.hour) && raw.config!.hour >= 0 && raw.config!.hour <= 23 ? raw.config!.hour : def.config.hour,
      },
      lastNightlyDay: raw.lastNightlyDay ?? null,
      attempts: raw.attempts ?? null,
      lastSkip: raw.lastSkip ?? null,
      runs: Array.isArray(raw.runs) ? raw.runs.slice(-MAX_RUNS) : [],
    };
  } catch {
    return defaultState();
  }
}

export function saveScheduleState(state: ScheduleState, path = SCHEDULE_PATH) {
  if (path === SCHEDULE_PATH) ensureKeywordsHome();
  writeFileSync(path, JSON.stringify({ ...state, runs: state.runs.slice(-MAX_RUNS) }, null, 2));
}

/** Local calendar day for a timestamp. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type NightlyDecision = 'disabled' | 'done-today' | 'not-due' | 'busy' | 'gave-up' | 'retry-wait' | 'run';

/** Pure decision for the minute tick. */
export function nightlyDecision(state: ScheduleState, nowMs: number, snapshotRunning: boolean): NightlyDecision {
  if (!state.config.enabled) return 'disabled';
  const day = localDay(nowMs);
  if (state.lastNightlyDay === day) return 'done-today';
  if (new Date(nowMs).getHours() < state.config.hour) return 'not-due';
  const a = state.attempts?.day === day ? state.attempts : null;
  if (a && a.count >= MAX_ATTEMPTS_PER_DAY) return 'gave-up';
  if (snapshotRunning) return 'busy';
  if (a && nowMs - a.lastAt < RETRY_GAP_MS) return 'retry-wait';
  return 'run';
}

/** Next time the nightly job will start (now, if it is due and idle). */
export function nextRunAt(state: ScheduleState, nowMs: number): number | null {
  if (!state.config.enabled) return null;
  const at = (dayOffset: number) => {
    const d = new Date(nowMs);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(state.config.hour, 0, 0, 0);
    return d.getTime();
  };
  const today = localDay(nowMs);
  const todayDone = state.lastNightlyDay === today
    || (state.attempts?.day === today && state.attempts.count >= MAX_ATTEMPTS_PER_DAY);
  if (!todayDone) {
    const slot = at(0);
    if (slot > nowMs) return slot;
    const retry = state.attempts?.day === today ? state.attempts.lastAt + RETRY_GAP_MS : nowMs;
    return Math.max(nowMs, retry);
  }
  return at(1);
}

// --- Scheduler -----------------------------------------------------------------

export interface DeltaRunResult {
  completed: number;
  errors: number;
  aborted: boolean;
  abortReason?: string;
}

export interface SchedulerDeps {
  now: () => number;
  isSnapshotRunning: () => boolean;
  /** Start a delta snapshot; resolves when it ends. null = could not start (busy). */
  runDelta: (plan: DeltaPlan, trigger: ScheduleRun['trigger']) => Promise<DeltaRunResult> | null;
  plan: (atMs: number) => DeltaPlan;
  load: () => ScheduleState;
  save: (s: ScheduleState) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
}

export class NightlyScheduler {
  private current: ScheduleRun | null = null;
  private timer: unknown = null;

  constructor(private readonly deps: SchedulerDeps) {}

  get running(): ScheduleRun | null {
    return this.current;
  }

  start(everyMs = 60_000) {
    if (this.timer) return;
    // First boot with no history: the first nightly slot is the next one, never
    // an immediate catch-up run for a day that already passed its hour.
    const initial = this.deps.load();
    if (initial.lastNightlyDay == null && initial.runs.length === 0) {
      initial.lastNightlyDay = localDay(this.deps.now());
      this.deps.save(initial);
    }
    const si = this.deps.setInterval ?? ((fn, ms) => {
      const h = setInterval(fn, ms);
      (h as { unref?: () => void }).unref?.();
      return h;
    });
    this.timer = si(() => { void this.tick(); }, everyMs);
    // First check shortly after boot (catch-up after sleep/restart).
    void this.tick();
  }

  /** One scheduler step; returns the decision (tests drive this with a fake clock). */
  async tick(): Promise<NightlyDecision> {
    if (this.current) return 'busy';
    const now = this.deps.now();
    const state = this.deps.load();
    const decision = nightlyDecision(state, now, this.deps.isSnapshotRunning());
    const day = localDay(now);
    if (decision === 'busy' && state.lastSkip?.day !== day) {
      state.lastSkip = { day, at: now, reason: 'ручное обновление ещё идёт — ночной прогон ждёт его окончания' };
      this.deps.save(state);
    }
    if (decision !== 'run') return decision;
    await this.execute('nightly');
    return 'run';
  }

  /** Run the delta now (API). Returns null when a snapshot is already running. */
  runNow(): Promise<ScheduleRun> | null {
    if (this.current || this.deps.isSnapshotRunning()) return null;
    return this.execute('run-now');
  }

  private async execute(trigger: ScheduleRun['trigger']): Promise<ScheduleRun> {
    const startedAt = this.deps.now();
    const day = localDay(startedAt);
    const plan = this.deps.plan(startedAt);
    const run: ScheduleRun = {
      trigger,
      day,
      startedAt,
      endedAt: null,
      durationMs: null,
      planned: plan.planned.total,
      daily: plan.planned.daily,
      weekly: plan.planned.weekly,
      overdue: plan.planned.overdue,
      requests: plan.requests,
      completed: 0,
      errors: 0,
      status: 'running',
    };
    this.current = run;

    const state = this.deps.load();
    if (trigger === 'nightly') {
      const prev = state.attempts?.day === day ? state.attempts.count : 0;
      state.attempts = { day, count: prev + 1, lastAt: startedAt };
    }
    state.runs.push(run);
    this.deps.save(state);

    const finalize = (patch: Partial<ScheduleRun>) => {
      Object.assign(run, patch);
      run.endedAt = this.deps.now();
      run.durationMs = run.endedAt - run.startedAt;
      const s = this.deps.load();
      const i = s.runs.findIndex((r) => r.startedAt === run.startedAt && r.trigger === run.trigger);
      if (i >= 0) s.runs[i] = { ...run }; else s.runs.push({ ...run });
      if (trigger === 'nightly' && run.status === 'ok') s.lastNightlyDay = day;
      this.deps.save(s);
      this.current = null;
    };

    try {
      const started = this.deps.runDelta(plan, trigger);
      if (!started) {
        finalize({ status: 'failed', reason: 'snapshot already running' });
        return run;
      }
      const res = await started;
      finalize({
        completed: res.completed,
        errors: res.errors,
        status: res.aborted ? 'aborted' : 'ok',
        reason: res.abortReason,
      });
    } catch (e) {
      finalize({ status: 'failed', reason: (e as Error).message });
    }
    return run;
  }
}

/** Aggregate request rate for rank searches (direct + enabled egress lanes). */
export function currentSearchRate(): { ratePerMin: number; lanes: number } {
  const st = hostGate('search.itunes.apple.com').status();
  const now = Date.now();
  const lanes = st.lanes.filter((l) => l.disabledUntil == null || l.disabledUntil <= now);
  const rate = lanes.length ? Math.min(...lanes.map((l) => l.effectivePerMin)) : st.effectivePerMin;
  return { ratePerMin: rate, lanes: Math.max(1, lanes.length) };
}
