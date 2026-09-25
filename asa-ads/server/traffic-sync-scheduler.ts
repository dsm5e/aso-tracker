import type Database from "better-sqlite3";
import { parseTrafficQuery, type TrafficIntelligenceInput } from "./traffic-intelligence.ts";

type JsonRecord = Record<string, unknown>;

export interface TrafficCacheRefresher {
  get(input: TrafficIntelligenceInput): Promise<JsonRecord>;
}

export interface TrafficSyncTarget {
  appId: number;
  country: string;
  priority: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRunAt: number;
  failureCount: number;
}

export interface TrafficSyncStatus {
  enabled: boolean;
  active: boolean;
  scheduledFor: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  retries: number;
  current: Array<{ appId: number; country: string }>;
  targets: TrafficSyncTarget[];
}

export interface TrafficSyncSchedulerOptions {
  enabled?: boolean;
  concurrency?: number;
  prioritySpendThreshold?: number;
  priorityIntervalMs?: number;
  standardIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maxAttempts?: number;
  nightlyHourUtc?: number;
  pollMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface TargetRow {
  app_id: number;
  country: string;
  priority: number;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  next_run_at: number;
  failure_count: number;
}

interface DiscoveredTarget {
  appId: number;
  country: string;
  priority: number;
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const MAX_CONSECUTIVE_FAST_FAILURES = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

/**
 * Read-only cache warmer for the traffic map. Campaign geography is discovered
 * locally; all Apple traffic calls remain inside TrafficIntelligenceService.
 * A target gets at most `maxAttempts` per queue run, and the persisted next-run
 * timestamp prevents restart loops after rate limits or upstream failures.
 */
export class TrafficSyncScheduler {
  private readonly db: Database.Database;
  private readonly refresher: TrafficCacheRefresher;
  private readonly enabled: boolean;
  private readonly concurrency: number;
  private readonly prioritySpendThreshold: number;
  private readonly priorityIntervalMs: number;
  private readonly standardIntervalMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly maxAttempts: number;
  private readonly nightlyHourUtc: number;
  private readonly pollMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private timer: NodeJS.Timeout | null = null;
  private nightlyTimer: NodeJS.Timeout | null = null;
  private active = false;
  private scheduledFor: string | null = null;
  private lastStartedAt: string | null = null;
  private lastFinishedAt: string | null = null;
  private total = 0;
  private completed = 0;
  private succeeded = 0;
  private failed = 0;
  private retries = 0;
  private current: Array<{ appId: number; country: string }> = [];

  constructor(db: Database.Database, refresher: TrafficCacheRefresher, options: TrafficSyncSchedulerOptions = {}) {
    this.db = db;
    this.refresher = refresher;
    this.enabled = options.enabled ?? true;
    this.concurrency = Math.max(1, Math.min(2, Math.floor(options.concurrency ?? 1)));
    this.prioritySpendThreshold = Math.max(0, options.prioritySpendThreshold ?? 25);
    this.priorityIntervalMs = Math.max(HOUR, options.priorityIntervalMs ?? 6 * HOUR);
    this.standardIntervalMs = Math.max(this.priorityIntervalMs, options.standardIntervalMs ?? DAY);
    this.retryBaseMs = Math.max(1_000, options.retryBaseMs ?? 130_000);
    this.retryMaxMs = Math.max(this.retryBaseMs, options.retryMaxMs ?? 30 * 60_000);
    this.maxAttempts = Math.max(1, Math.min(2, Math.floor(options.maxAttempts ?? 2)));
    this.nightlyHourUtc = Math.max(0, Math.min(23, Math.floor(options.nightlyHourUtc ?? 2)));
    this.pollMs = Math.max(30_000, options.pollMs ?? 5 * 60_000);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? delay;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS traffic_sync_targets (
        app_id INTEGER NOT NULL,
        country TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        next_run_at INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (app_id, country)
      );
      CREATE INDEX IF NOT EXISTS idx_traffic_sync_due ON traffic_sync_targets(next_run_at, priority DESC);
    `);
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.pollMs);
    this.timer.unref();
    // A restart must resume only persisted, already-due retry work. It must not
    // turn an arbitrary daytime process restart into a full Apple sync.
    void this.tick();
    this.scheduleNightly();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.nightlyTimer) clearTimeout(this.nightlyTimer);
    this.timer = null;
    this.nightlyTimer = null;
    this.scheduledFor = null;
  }

  private scheduleNightly(): void {
    if (!this.enabled) return;
    const now = new Date(this.now());
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), this.nightlyHourUtc));
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    this.scheduledFor = next.toISOString();
    this.nightlyTimer = setTimeout(() => {
      this.nightlyTimer = null;
      void this.runNightly().finally(() => this.scheduleNightly());
    }, Math.max(0, next.getTime() - this.now()));
    this.nightlyTimer.unref();
  }

  private discoverTargets(): DiscoveredTarget[] {
    const start = new Date(this.now() - 7 * DAY).toISOString().slice(0, 10);
    return this.db.prepare(`
      SELECT c.app_id AS appId, UPPER(TRIM(c.country)) AS country,
             COALESCE(SUM(d.spend), 0) AS spend
        FROM asa_campaigns c
        LEFT JOIN asa_daily d ON d.campaign_id = c.id AND d.date >= ?
       WHERE c.status = 'ENABLED' AND TRIM(c.country) != ''
       GROUP BY c.app_id, UPPER(TRIM(c.country))
      HAVING country GLOB '[A-Z][A-Z]'
       ORDER BY spend DESC, appId, country
    `).all(start).map((row) => {
      const record = row as { appId: number; country: string; spend: number };
      return { appId: record.appId, country: record.country, priority: record.spend >= this.prioritySpendThreshold ? 1 : 0 };
    });
  }

  private registerTargets(targets: DiscoveredTarget[], immediate: boolean): void {
    const now = this.now();
    const upsert = this.db.prepare(`
      INSERT INTO traffic_sync_targets (app_id, country, priority, next_run_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(app_id, country) DO UPDATE SET priority = excluded.priority,
        next_run_at = CASE WHEN ? = 1 AND traffic_sync_targets.last_success_at IS NULL THEN excluded.next_run_at ELSE traffic_sync_targets.next_run_at END
    `);
    const run = this.db.transaction(() => {
      for (const target of targets) upsert.run(target.appId, target.country, target.priority, immediate ? now : Number.MAX_SAFE_INTEGER, immediate ? 1 : 0);
    });
    run();
  }

  private targetRows(dueOnly: boolean): TrafficSyncTarget[] {
    const where = dueOnly ? "WHERE next_run_at <= ?" : "";
    const rows = this.db.prepare(`
      SELECT app_id, country, priority, last_attempt_at, last_success_at, last_error, next_run_at, failure_count
        FROM traffic_sync_targets ${where}
       ORDER BY priority DESC, next_run_at, app_id, country
    `).all(...(dueOnly ? [this.now()] : [])) as TargetRow[];
    return rows.map((row) => ({
      appId: row.app_id,
      country: row.country,
      priority: row.priority === 1,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
      nextRunAt: row.next_run_at,
      failureCount: row.failure_count,
    }));
  }

  getStatus(): TrafficSyncStatus {
    return {
      enabled: this.enabled,
      active: this.active,
      scheduledFor: this.scheduledFor,
      lastStartedAt: this.lastStartedAt,
      lastFinishedAt: this.lastFinishedAt,
      total: this.total,
      completed: this.completed,
      succeeded: this.succeeded,
      failed: this.failed,
      retries: this.retries,
      current: [...this.current],
      targets: this.targetRows(false),
    };
  }

  async runNightly(): Promise<TrafficSyncStatus> {
    if (!this.enabled || this.active) return this.getStatus();
    this.registerTargets(this.discoverTargets(), true);
    return this.runDue();
  }

  async tick(): Promise<TrafficSyncStatus> {
    if (!this.enabled || this.active) return this.getStatus();
    return this.runDue();
  }

  private async runDue(): Promise<TrafficSyncStatus> {
    const targets = this.targetRows(true);
    if (!targets.length) return this.getStatus();
    this.active = true;
    this.lastStartedAt = iso(this.now());
    this.lastFinishedAt = null;
    this.total = targets.length;
    this.completed = 0;
    this.succeeded = 0;
    this.failed = 0;
    this.retries = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const target = targets[cursor];
        cursor += 1;
        if (!target) continue;
        this.current = [...this.current, { appId: target.appId, country: target.country }];
        try {
          const ok = await this.refreshTarget(target);
          if (ok) this.succeeded += 1;
          else this.failed += 1;
        } finally {
          this.current = this.current.filter((item) => item.appId !== target.appId || item.country !== target.country);
          this.completed += 1;
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(this.concurrency, targets.length) }, () => worker()));
    } finally {
      this.active = false;
      this.lastFinishedAt = iso(this.now());
    }
    return this.getStatus();
  }

  private isFresh(payload: JsonRecord): boolean {
    return payload.servedFromCache !== true && payload.stale !== true;
  }

  private retryDelay(attempt: number): number {
    const base = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** Math.max(0, attempt - 1));
    // Positive jitter avoids a fleet of restarted servers retrying in lockstep.
    return Math.round(base * (1 + this.random() * 0.2));
  }

  private nextRegularRun(target: TrafficSyncTarget): number {
    const interval = target.priority ? this.priorityIntervalMs : this.standardIntervalMs;
    return this.now() + interval + Math.round(interval * this.random() * 0.1);
  }

  private recordSuccess(target: TrafficSyncTarget): void {
    const now = this.now();
    this.db.prepare(`
      UPDATE traffic_sync_targets
         SET last_attempt_at = ?, last_success_at = ?, last_error = NULL,
             next_run_at = ?, failure_count = 0
       WHERE app_id = ? AND country = ?
    `).run(iso(now), iso(now), this.nextRegularRun(target), target.appId, target.country);
  }

  private recordFailure(target: TrafficSyncTarget, error: string): void {
    const nextFailures = target.failureCount + 1;
    // After three failed queue runs, wait for the normal cycle. This keeps a
    // broken credential or a persistent Apple outage from becoming a polling
    // loop while still allowing the next nightly pass to recover automatically.
    // The target already exhausted its short in-run attempts. Persist the next
    // try on a regular geo cadence so a long queue cannot make an early target
    // due again before the same run finishes.
    const penalty = nextFailures >= MAX_CONSECUTIVE_FAST_FAILURES
      ? this.standardIntervalMs
      : (target.priority ? this.priorityIntervalMs : this.standardIntervalMs);
    this.db.prepare(`
      UPDATE traffic_sync_targets
         SET last_attempt_at = ?, last_error = ?, next_run_at = ?, failure_count = ?
       WHERE app_id = ? AND country = ?
    `).run(iso(this.now()), error.slice(0, 500), this.now() + penalty + Math.round(penalty * this.random() * 0.2), nextFailures, target.appId, target.country);
  }

  private async refreshTarget(target: TrafficSyncTarget): Promise<boolean> {
    let lastError = "Traffic refresh returned stale data";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const input = parseTrafficQuery({ appId: String(target.appId), country: target.country, force: "true" }, new Date(this.now()));
        const payload = await this.refresher.get(input);
        if (this.isFresh(payload)) {
          this.recordSuccess(target);
          return true;
        }
        const partial = Array.isArray(payload.partialErrors) ? payload.partialErrors : [];
        lastError = partial.map((item) => (item && typeof item === "object" && "message" in item ? String(item.message) : "")).filter(Boolean).join(" · ") || lastError;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (attempt < this.maxAttempts) {
        this.retries += 1;
        await this.sleep(this.retryDelay(attempt));
      }
    }
    this.recordFailure(target, lastError);
    return false;
  }
}
