import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_ATTEMPTS_PER_DAY,
  NightlyScheduler,
  RETRY_GAP_MS,
  defaultHour,
  defaultState,
  estimateMinutes,
  loadScheduleState,
  localDay,
  nextRunAt,
  nightlyDecision,
  planDelta,
  saveScheduleState,
  tierOf,
  weekdayFor,
  weekdayOfDate,
  type ComboInfo,
  type DeltaPlan,
  type DeltaRunResult,
  type ScheduleState,
} from './scheduler.js';

const TODAY = '2026-09-25'; // Friday

test('tiers: top-50, new (<7 days / never measured) and probe are daily; the rest weekly', () => {
  const base: ComboInfo = { app: 'medscan', locale: 'us', keyword: 'dicom viewer', firstDate: '2026-08-01', lastOkDate: '2026-09-24' };
  assert.deepEqual(tierOf({ ...base, lastPosition: 50 }, TODAY), { tier: 'daily', reason: 'top50' });
  assert.deepEqual(tierOf({ ...base, lastPosition: 51 }, TODAY), { tier: 'weekly', reason: null });
  assert.deepEqual(tierOf({ ...base, lastPosition: null }, TODAY), { tier: 'weekly', reason: null });
  assert.deepEqual(tierOf({ ...base, lastPosition: 120, probe: true }, TODAY), { tier: 'daily', reason: 'probe' });
  assert.deepEqual(tierOf({ app: 'medscan', locale: 'us', keyword: 'fresh' }, TODAY), { tier: 'daily', reason: 'new' });
  // Added 6 days ago → still new; 7 days ago → regular.
  assert.equal(tierOf({ ...base, lastPosition: null, firstDate: '2026-09-19' }, TODAY).reason, 'new');
  assert.equal(tierOf({ ...base, lastPosition: null, firstDate: '2026-09-18' }, TODAY).tier, 'weekly');
});

test('weekday hash is stable, storefront-sensitive, app-independent and spreads evenly', () => {
  assert.equal(weekdayFor('dicom viewer', 'us'), weekdayFor('  DICOM Viewer ', 'US'));
  const buckets = new Array(7).fill(0);
  const N = 7000;
  for (let i = 0; i < N; i++) buckets[weekdayFor(`keyword ${i}`, ['us', 'de', 'ae', 'jp'][i % 4])]++;
  for (const b of buckets) assert.ok(Math.abs(b - N / 7) < N / 7 * 0.08, `bucket ${b} vs ${N / 7}`);
  assert.equal(weekdayOfDate('2026-09-25'), 5);
  assert.equal(weekdayOfDate('2026-09-27'), 0);
});

test('planDelta: daily every day, each weekly pair exactly once per 7 days', () => {
  const combos: ComboInfo[] = [];
  for (let i = 0; i < 700; i++) {
    combos.push({ app: 'elara', locale: i % 2 ? 'us' : 'de', keyword: `kw ${i}`, lastPosition: i < 100 ? 10 : 200, firstDate: '2026-06-01', lastOkDate: '2026-09-24' });
  }
  const seen = new Map<string, number>();
  const perDay: number[] = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.UTC(2026, 8, 25 + d)).toISOString().slice(0, 10);
    const plan = planDelta(combos, date);
    assert.equal(plan.tiers.daily, 100);
    assert.equal(plan.tiers.weekly, 600);
    assert.equal(plan.planned.daily, 100);
    assert.equal(plan.planned.overdue, 0, 'nothing is overdue when measured yesterday');
    perDay.push(plan.planned.weekly);
    for (const t of plan.tasks) {
      if (t.tier === 'weekly') seen.set(t.key, (seen.get(t.key) ?? 0) + 1);
      assert.equal(t.priority, t.tier === 'daily' ? 'top' : 'tail');
    }
  }
  assert.equal(seen.size, 600);
  assert.ok([...seen.values()].every((n) => n === 1));
  for (const n of perDay) assert.ok(n > 60 && n < 115, `weekly per day ${perDay}`);
});

test('planDelta: overdue weekly pairs are caught up, at most 1/7 of the tier per night, oldest first', () => {
  const combos: ComboInfo[] = [];
  for (let i = 0; i < 70; i++) {
    combos.push({ app: 'medscan', locale: 'us', keyword: `tail ${i}`, lastPosition: null, firstDate: '2026-06-01', lastOkDate: i === 0 ? '2026-07-01' : '2026-09-01' });
  }
  const plan = planDelta(combos, TODAY);
  const weekday = weekdayOfDate(TODAY);
  const dueToday = combos.filter((c) => weekdayFor(c.keyword, c.locale) === weekday).length;
  assert.equal(plan.planned.weekly, dueToday);
  assert.equal(plan.planned.overdue, 10);
  const overdue = plan.tasks.filter((t) => t.reason === 'overdue');
  if (weekdayFor('tail 0', 'us') !== weekday) assert.equal(overdue[0].keyword, 'tail 0', 'oldest first');
  assert.equal(new Set(plan.tasks.map((t) => t.key)).size, plan.tasks.length, 'no duplicates');
});

test('planDelta: requests count distinct storefront×keyword searches across apps', () => {
  const plan = planDelta([
    { app: 'a', locale: 'us', keyword: 'Pregnancy', lastPosition: 3, firstDate: '2026-01-01', lastOkDate: TODAY },
    { app: 'b', locale: 'us', keyword: 'pregnancy', lastPosition: 30, firstDate: '2026-01-01', lastOkDate: TODAY },
    { app: 'b', locale: 'de', keyword: 'pregnancy', lastPosition: 30, firstDate: '2026-01-01', lastOkDate: TODAY },
  ], TODAY);
  assert.equal(plan.planned.total, 3);
  assert.equal(plan.requests, 2);
});

test('estimateMinutes follows AIMD growth and splits across lanes', () => {
  assert.equal(estimateMinutes(0, 24), 0);
  assert.ok(Math.abs(estimateMinutes(50, 24) - 50 / 24) < 1e-9);
  assert.ok(Math.abs(estimateMinutes(100, 24) - (50 / 24 + 50 / 26)) < 1e-9);
  assert.ok(estimateMinutes(600, 24, 3) < estimateMinutes(600, 24, 1) / 2);
  assert.ok(estimateMinutes(2000, 40) <= 2000 / 40 + 1e-9);
});

// --- nightly decision / scheduler with a fake clock -------------------------------

const at = (day: string, hh: number, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime();

function state(patch: Partial<ScheduleState> = {}): ScheduleState {
  return { ...defaultState(), config: { enabled: true, hour: 4 }, ...patch };
}

test('nightlyDecision: waits for the hour, runs once per local day, skips while a manual snapshot runs', () => {
  const s = state();
  assert.equal(nightlyDecision(s, at(TODAY, 3, 59), false), 'not-due');
  assert.equal(nightlyDecision(s, at(TODAY, 4, 0), true), 'busy');
  assert.equal(nightlyDecision(s, at(TODAY, 4, 0), false), 'run');
  assert.equal(nightlyDecision(s, at(TODAY, 15, 0), false), 'run', 'catch-up later that day (Mac was asleep)');
  assert.equal(nightlyDecision({ ...s, lastNightlyDay: TODAY }, at(TODAY, 5, 0), false), 'done-today');
  assert.equal(nightlyDecision({ ...s, config: { enabled: false, hour: 4 } }, at(TODAY, 5, 0), false), 'disabled');
  const tried = { ...s, attempts: { day: TODAY, count: 1, lastAt: at(TODAY, 4, 0) } };
  assert.equal(nightlyDecision(tried, at(TODAY, 4, 10), false), 'retry-wait');
  assert.equal(nightlyDecision(tried, at(TODAY, 4, 0) + RETRY_GAP_MS, false), 'run');
  const exhausted = { ...s, attempts: { day: TODAY, count: MAX_ATTEMPTS_PER_DAY, lastAt: at(TODAY, 6, 0) } };
  assert.equal(nightlyDecision(exhausted, at(TODAY, 9, 0), false), 'gave-up');
});

test('nextRunAt: today\'s slot, now when overdue, tomorrow when done', () => {
  const s = state();
  assert.equal(nextRunAt(s, at(TODAY, 1, 0)), at(TODAY, 4, 0));
  assert.equal(nextRunAt(s, at(TODAY, 9, 0)), at(TODAY, 9, 0));
  assert.equal(nextRunAt({ ...s, lastNightlyDay: TODAY }, at(TODAY, 9, 0)), at('2026-09-26', 4, 0));
  assert.equal(nextRunAt({ ...s, config: { enabled: false, hour: 4 } }, at(TODAY, 1, 0)), null);
});

function harness(initial: ScheduleState, opts: { running?: boolean; result?: DeltaRunResult } = {}) {
  let saved: ScheduleState = structuredClone(initial);
  const clock = { t: at(TODAY, 3, 0) };
  const calls: Array<{ trigger: string; plan: DeltaPlan }> = [];
  let manualRunning = opts.running ?? false;
  const plan: DeltaPlan = planDelta([{ app: 'a', locale: 'us', keyword: 'k', lastPosition: 1, firstDate: '2026-01-01', lastOkDate: TODAY }], TODAY);
  const sched = new NightlyScheduler({
    now: () => clock.t,
    isSnapshotRunning: () => manualRunning,
    runDelta: (p, trigger) => {
      if (manualRunning) return null;
      calls.push({ trigger, plan: p });
      clock.t += 20 * 60_000; // the run takes 20 min
      return Promise.resolve(opts.result ?? { completed: p.planned.total, errors: 0, aborted: false });
    },
    plan: () => plan,
    load: () => structuredClone(saved),
    save: (s) => { saved = structuredClone(s); },
    setInterval: () => 0,
  });
  return { sched, clock, calls, get saved() { return saved; }, setManual: (v: boolean) => { manualRunning = v; } };
}

test('scheduler: first boot never runs a missed slot immediately', async () => {
  const h = harness(state());
  h.clock.t = at(TODAY, 10, 0);
  h.sched.start();
  await Promise.resolve();
  assert.equal(h.calls.length, 0);
  assert.equal(h.saved.lastNightlyDay, localDay(h.clock.t));
});

test('scheduler: runs at the hour, records the run, then not again that day', async () => {
  const h = harness(state({ lastNightlyDay: '2026-09-24', runs: [] }));
  assert.equal(await h.sched.tick(), 'not-due');
  h.clock.t = at(TODAY, 4, 0);
  assert.equal(await h.sched.tick(), 'run');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].trigger, 'nightly');
  const run = h.saved.runs.at(-1)!;
  assert.equal(run.status, 'ok');
  assert.equal(run.durationMs, 20 * 60_000);
  assert.equal(run.completed, 1);
  assert.equal(h.saved.lastNightlyDay, TODAY);
  h.clock.t = at(TODAY, 5, 0);
  assert.equal(await h.sched.tick(), 'done-today');
  assert.equal(h.calls.length, 1);
});

test('scheduler: a manual snapshot delays the nightly run (skip noted once), then it runs', async () => {
  const h = harness(state({ lastNightlyDay: '2026-09-24' }), { running: true });
  h.clock.t = at(TODAY, 4, 0);
  assert.equal(await h.sched.tick(), 'busy');
  assert.equal(await h.sched.tick(), 'busy');
  assert.equal(h.calls.length, 0);
  assert.equal(h.saved.lastSkip?.day, localDay(h.clock.t));
  h.setManual(false);
  h.clock.t = at(TODAY, 4, 40);
  assert.equal(await h.sched.tick(), 'run');
  assert.equal(h.calls.length, 1);
});

test('scheduler: an aborted run retries after 30 min, at most 3 attempts per day', async () => {
  const h = harness(state({ lastNightlyDay: '2026-09-24' }), { result: { completed: 3, errors: 0, aborted: true, abortReason: 'limit' } });
  h.clock.t = at(TODAY, 4, 0);
  assert.equal(await h.sched.tick(), 'run');
  assert.equal(h.saved.runs.at(-1)!.status, 'aborted');
  assert.equal(h.saved.lastNightlyDay, '2026-09-24');
  assert.equal(await h.sched.tick(), 'retry-wait');
  h.clock.t += RETRY_GAP_MS;
  assert.equal(await h.sched.tick(), 'run');
  h.clock.t += RETRY_GAP_MS;
  assert.equal(await h.sched.tick(), 'run');
  h.clock.t += RETRY_GAP_MS;
  assert.equal(await h.sched.tick(), 'gave-up');
  assert.equal(h.calls.length, 3);
});

test('scheduler: runNow refuses while a snapshot is running', async () => {
  const h = harness(state({ lastNightlyDay: TODAY }), { running: true });
  assert.equal(h.sched.runNow(), null);
  h.setManual(false);
  const run = await h.sched.runNow()!;
  assert.equal(run.trigger, 'run-now');
  assert.equal(h.saved.lastNightlyDay, TODAY);
});

test('schedule state persists to JSON; env hour is the default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sched-'));
  try {
    const path = join(dir, 'schedule.json');
    assert.equal(loadScheduleState(path).config.enabled, true);
    const s = state({ config: { enabled: false, hour: 6 }, lastNightlyDay: TODAY });
    saveScheduleState(s, path);
    const back = loadScheduleState(path);
    assert.deepEqual(back.config, { enabled: false, hour: 6 });
    assert.equal(back.lastNightlyDay, TODAY);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(defaultHour({}), 4);
  assert.equal(defaultHour({ KEYWORDS_NIGHTLY_HOUR: '2' }), 2);
  assert.equal(defaultHour({ KEYWORDS_NIGHTLY_HOUR: '25' }), 4);
});
