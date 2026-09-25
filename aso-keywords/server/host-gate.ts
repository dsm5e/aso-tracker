// Per-host request gate for Apple endpoints: a token bucket whose rate adapts
// with AIMD, a priority queue (interactive > top > tail), and coalescing of
// identical in-flight requests. Every Apple call in the rank pipeline goes
// through one gate per host, so snapshots, the UI and the spy share budgets.
//
// AIMD: start at 24 req/min, +2 req/min after every 50 consecutive successes up
// to 40 req/min. HTTP 403/429 halves the rate and pauses the host for 5 min.

export type GateHost = 'search.itunes.apple.com' | 'itunes.apple.com' | 'apps.apple.com';
export type GatePriority = 'interactive' | 'top' | 'tail';

export const GATE_HOSTS: GateHost[] = ['search.itunes.apple.com', 'itunes.apple.com', 'apps.apple.com'];
const PRIORITIES: GatePriority[] = ['interactive', 'top', 'tail'];

/** Status codes that mean "this IP is over budget" — they shrink the rate. */
const LIMIT_STATUSES = new Set([403, 429]);

export interface GateClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: GateClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    // Idle gates must never keep the process (or a test run) alive.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface GateConfig {
  startPerMin: number;
  maxPerMin: number;
  minPerMin: number;
  stepPerMin: number;
  successesPerStep: number;
  pauseMs: number;
  /** Bucket capacity: how many requests may leave back to back after idling. */
  burst: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  startPerMin: 24,
  maxPerMin: 40,
  minPerMin: 6,
  stepPerMin: 2,
  successesPerStep: 50,
  pauseMs: 5 * 60_000,
  burst: 1,
};

/** Throw (or reject with) this from a gated task to report an HTTP status. */
export class GateHttpError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'GateHttpError';
  }
}

export function isGateLimitStatus(status: number): boolean {
  return LIMIT_STATUSES.has(status);
}

export type GateEvent =
  | { type: 'limit'; host: GateHost; status: number; ratePerMin: number; pausedUntil: number }
  | { type: 'rate'; host: GateHost; ratePerMin: number }
  | { type: 'resume'; host: GateHost; ratePerMin: number };

export interface HostGateStatus {
  host: GateHost;
  ratePerMin: number;
  /** User/preset ceiling below the AIMD rate, if any. */
  capPerMin: number | null;
  effectivePerMin: number;
  queued: Record<GatePriority, number>;
  inFlight: number;
  pausedUntil: number | null;
  counters: { ok: number; limited: number; errors: number; coalesced: number };
  consecutiveOk: number;
}

interface Job {
  key: string | null;
  priority: GatePriority;
  state: 'queued' | 'running' | 'done';
  subscribers: number;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  promise: Promise<unknown>;
}

function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

export class HostGate {
  ratePerMin: number;
  capPerMin: number | null = null;
  pausedUntil = 0;
  consecutiveOk = 0;
  readonly counters = { ok: 0, limited: 0, errors: 0, coalesced: 0 };

  private tokens: number;
  private lastRefill: number;
  private readonly queues: Record<GatePriority, Job[]> = { interactive: [], top: [], tail: [] };
  private readonly inflight = new Map<string, Job>();
  private running = 0;
  private timer: unknown = null;
  private timerAt = 0;
  private wasPaused = false;
  private readonly listeners = new Set<(e: GateEvent) => void>();

  constructor(
    readonly host: GateHost,
    readonly config: GateConfig = DEFAULT_GATE_CONFIG,
    private readonly clock: GateClock = realClock
  ) {
    this.ratePerMin = config.startPerMin;
    this.tokens = config.burst;
    this.lastRefill = clock.now();
  }

  onEvent(listener: (e: GateEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: GateEvent) {
    for (const l of this.listeners) {
      try { l(event); } catch { /* listener errors never break the gate */ }
    }
  }

  get effectivePerMin(): number {
    return this.capPerMin == null ? this.ratePerMin : Math.min(this.ratePerMin, this.capPerMin);
  }

  isPaused(): boolean {
    return this.clock.now() < this.pausedUntil;
  }

  /** Optional ceiling (e.g. the «Бережная» speed preset); null removes it. */
  setCap(perMin: number | null) {
    this.refill();
    this.capPerMin = perMin == null ? null : Math.max(1, perMin);
    this.pump();
  }

  /**
   * Run `task` when this host has budget. Identical `key`s share one in-flight
   * request. Abort via `signal` drops this caller; the shared request is only
   * dropped while still queued and once every caller has aborted.
   */
  run<T>(task: () => Promise<T>, opts: { key?: string; priority?: GatePriority; signal?: AbortSignal } = {}): Promise<T> {
    const priority = opts.priority ?? 'top';
    const { signal } = opts;
    if (signal?.aborted) return Promise.reject(abortError());

    let job = opts.key ? this.inflight.get(opts.key) : undefined;
    if (job) {
      this.counters.coalesced++;
      job.subscribers++;
      if (job.state === 'queued' && PRIORITIES.indexOf(priority) < PRIORITIES.indexOf(job.priority)) {
        this.removeQueued(job);
        job.priority = priority;
        this.queues[priority].push(job);
        this.pump();
      }
    } else {
      let resolve!: (v: unknown) => void;
      let reject!: (r: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
      promise.catch(() => { /* surfaced through subscriber promises */ });
      job = { key: opts.key ?? null, priority, state: 'queued', subscribers: 1, task, resolve, reject, promise };
      if (job.key) this.inflight.set(job.key, job);
      this.queues[priority].push(job);
      this.pump();
    }

    const shared = job;
    if (!signal) return shared.promise as Promise<T>;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(abortError());
        shared.subscribers--;
        if (shared.subscribers <= 0 && shared.state === 'queued') {
          this.removeQueued(shared);
          this.finish(shared);
          shared.reject(abortError());
          this.pump();
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(
        (v) => { signal.removeEventListener('abort', onAbort); resolve(v as T); },
        (e) => { signal.removeEventListener('abort', onAbort); reject(e); }
      );
    });
  }

  status(): HostGateStatus {
    this.refill();
    return {
      host: this.host,
      ratePerMin: this.ratePerMin,
      capPerMin: this.capPerMin,
      effectivePerMin: this.effectivePerMin,
      queued: {
        interactive: this.queues.interactive.length,
        top: this.queues.top.length,
        tail: this.queues.tail.length,
      },
      inFlight: this.running,
      pausedUntil: this.isPaused() ? this.pausedUntil : null,
      counters: { ...this.counters },
      consecutiveOk: this.consecutiveOk,
    };
  }

  /** Record the outcome of a request made outside `run` (e.g. a fallback probe). */
  reportSuccess() {
    this.counters.ok++;
    this.consecutiveOk++;
    if (this.consecutiveOk >= this.config.successesPerStep) {
      this.consecutiveOk = 0;
      if (this.ratePerMin < this.config.maxPerMin) {
        this.refill();
        this.ratePerMin = Math.min(this.config.maxPerMin, this.ratePerMin + this.config.stepPerMin);
        this.emit({ type: 'rate', host: this.host, ratePerMin: this.ratePerMin });
      }
    }
  }

  reportLimited(status: number) {
    this.counters.limited++;
    this.consecutiveOk = 0;
    this.refill();
    this.ratePerMin = Math.max(this.config.minPerMin, Math.floor(this.ratePerMin / 2));
    this.pausedUntil = this.clock.now() + this.config.pauseMs;
    this.tokens = 0;
    this.wasPaused = true;
    this.emit({ type: 'limit', host: this.host, status, ratePerMin: this.ratePerMin, pausedUntil: this.pausedUntil });
    this.pump();
  }

  private removeQueued(job: Job) {
    const q = this.queues[job.priority];
    const i = q.indexOf(job);
    if (i >= 0) q.splice(i, 1);
  }

  private finish(job: Job) {
    job.state = 'done';
    if (job.key && this.inflight.get(job.key) === job) this.inflight.delete(job.key);
  }

  private refill() {
    const now = this.clock.now();
    const from = Math.max(this.lastRefill, this.pausedUntil);
    if (now > from) {
      this.tokens = Math.min(this.config.burst, this.tokens + ((now - from) * this.effectivePerMin) / 60_000);
    }
    this.lastRefill = now;
  }

  private nextJob(): Job | undefined {
    for (const p of PRIORITIES) {
      const job = this.queues[p].shift();
      if (job) return job;
    }
    return undefined;
  }

  private hasQueued(): boolean {
    return PRIORITIES.some((p) => this.queues[p].length > 0);
  }

  private schedule(at: number) {
    if (this.timer != null && this.timerAt <= at) return;
    if (this.timer != null) this.clock.clearTimeout(this.timer);
    this.timerAt = at;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(0, at - this.clock.now()));
  }

  private pump() {
    const now = this.clock.now();
    if (now < this.pausedUntil) {
      if (this.hasQueued()) this.schedule(this.pausedUntil);
      return;
    }
    if (this.wasPaused) {
      this.wasPaused = false;
      this.emit({ type: 'resume', host: this.host, ratePerMin: this.ratePerMin });
    }
    this.refill();
    while (this.hasQueued() && this.tokens >= 1) {
      const job = this.nextJob()!;
      this.tokens -= 1;
      this.start(job);
    }
    if (this.hasQueued()) {
      const msPerToken = 60_000 / this.effectivePerMin;
      this.schedule(now + Math.ceil((1 - this.tokens) * msPerToken));
    }
  }

  private start(job: Job) {
    job.state = 'running';
    this.running++;
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(job.task());
    } catch (e) {
      result = Promise.reject(e);
    }
    result.then(
      (value) => {
        this.running--;
        this.finish(job);
        this.reportSuccess();
        job.resolve(value);
        this.pump();
      },
      (error) => {
        this.running--;
        this.finish(job);
        if (error instanceof GateHttpError && isGateLimitStatus(error.status)) this.reportLimited(error.status);
        else if ((error as Error)?.name !== 'AbortError') this.counters.errors++;
        job.reject(error);
        this.pump();
      }
    );
  }
}

const gates = new Map<GateHost, HostGate>();

export function hostGate(host: GateHost): HostGate {
  let gate = gates.get(host);
  if (!gate) {
    // search.itunes.apple.com gets a small burst so a UI suggestions request
    // (up to 12 hint seeds) is not spread over half a minute; the average rate
    // is still the AIMD rate.
    gate = new HostGate(host, host === 'search.itunes.apple.com' ? { ...DEFAULT_GATE_CONFIG, burst: 4 } : DEFAULT_GATE_CONFIG);
    gates.set(host, gate);
  }
  return gate;
}

export function gateStatus(): HostGateStatus[] {
  return GATE_HOSTS.map((h) => hostGate(h).status());
}

/** Subscribe to events from every host gate (SSE 'throttle' progress). */
export function onGateEvent(listener: (e: GateEvent) => void): () => void {
  const offs = GATE_HOSTS.map((h) => hostGate(h).onEvent(listener));
  return () => offs.forEach((off) => off());
}
