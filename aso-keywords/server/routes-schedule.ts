// Nightly delta schedule API:
//   GET  /api/schedule                 config, next run, last runs, tier counts, estimate
//   PUT  /api/schedule                 { enabled?, hour? }
//   POST /api/schedule/run-now         start the delta now (409 if a snapshot runs)
//   POST /api/schedule/run-now?dryRun=1  planned list only — no Apple requests

import type express from 'express';
import {
  buildDeltaPlan,
  currentSearchRate,
  defaultHour,
  estimateMinutes,
  loadScheduleState,
  nextRunAt,
  saveScheduleState,
  snapshotDate,
  type NightlyScheduler,
  type ScheduleRun,
} from './scheduler.js';

export function registerScheduleRoutes(app: express.Express, scheduler: NightlyScheduler) {
  const summary = (brief: boolean) => {
    const now = Date.now();
    const state = loadScheduleState();
    const next = nextRunAt(state, now);
    const plan = buildDeltaPlan({}, next ?? now);
    const { ratePerMin, lanes } = currentSearchRate();
    const current = scheduler.running;
    // A run left "running" by a restart (tsx watch, crash) is shown as interrupted.
    const runs: ScheduleRun[] = state.runs
      .map((r) => (r.status === 'running' && !(current && current.startedAt === r.startedAt)
        ? { ...r, status: 'failed' as const, reason: r.reason ?? 'interrupted (server restarted)' }
        : r))
      .reverse();
    return {
      config: state.config,
      envDefaultHour: defaultHour(),
      nextRunAt: next,
      running: current,
      lastNightlyDay: state.lastNightlyDay,
      lastSkip: state.lastSkip,
      lastRun: runs[0] ?? null,
      lastRuns: brief ? runs.slice(0, 3) : runs.slice(0, 10),
      tiers: plan.tiers,
      tiersByApp: plan.tiersByApp,
      // What «Только изменяемые (дельта)» would refresh right now (per app).
      todayPlan: next != null && snapshotDate(next) === snapshotDate(now)
        ? { date: plan.date, total: plan.planned.total, byApp: plan.planned.byApp }
        : (() => { const p = buildDeltaPlan({}, now); return { date: p.date, total: p.planned.total, byApp: p.planned.byApp }; })(),
      nextPlan: {
        date: plan.date,
        weekday: plan.weekday,
        ...plan.planned,
        requests: plan.requests,
      },
      estimate: {
        ratePerMin,
        lanes,
        minutes: Math.ceil(estimateMinutes(plan.requests, ratePerMin, lanes)),
        note: 'distinct storefront×keyword searches at the current gate rate with AIMD growth',
      },
    };
  };

  app.get('/api/schedule', (req, res) => {
    try {
      res.json(summary(req.query.brief === '1'));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.put('/api/schedule', (req, res) => {
    const { enabled, hour } = req.body || {};
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be boolean' });
      return;
    }
    if (hour !== undefined && !(Number.isInteger(hour) && hour >= 0 && hour <= 23)) {
      res.status(400).json({ error: 'hour must be an integer 0–23' });
      return;
    }
    const state = loadScheduleState();
    if (enabled !== undefined) state.config.enabled = enabled;
    if (hour !== undefined) state.config.hour = hour;
    saveScheduleState(state);
    res.json(summary(false));
  });

  app.post('/api/schedule/run-now', (req, res) => {
    if (req.query.dryRun === '1' || req.query.dryRun === 'true') {
      const plan = buildDeltaPlan();
      const { ratePerMin, lanes } = currentSearchRate();
      res.json({
        dryRun: true,
        date: plan.date,
        weekday: plan.weekday,
        tiers: plan.tiers,
        tiersByApp: plan.tiersByApp,
        planned: plan.planned,
        requests: plan.requests,
        estimatedMinutes: Math.ceil(estimateMinutes(plan.requests, ratePerMin, lanes)),
        tasks: plan.tasks.map(({ app, locale, keyword, tier, reason, priority }) => ({ app, locale, keyword, tier, reason, priority })),
      });
      return;
    }
    const run = scheduler.runNow();
    if (!run) {
      res.status(409).json({ error: 'a snapshot is already running' });
      return;
    }
    run.catch(() => { /* recorded in schedule.json */ });
    res.status(202).json({ ok: true, running: scheduler.running });
  });
}
