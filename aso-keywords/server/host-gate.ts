// Per-host request gate for Apple endpoints: a token bucket whose rate adapts
// with AIMD, a priority queue (interactive > top > tail), and coalescing of
// identical in-flight requests. Every Apple call in the rank pipeline goes
// through one gate per host, so snapshots, the UI and the spy share budgets.
//
// AIMD: start at 24 req/min, +2 req/min after every 50 consecutive successes up
// to 40 req/min. HTTP 403/429 halves the rate and pauses the host for 5 min.
//
// Optional second egress (KEYWORDS_EGRESS_URLS + KEYWORDS_EGRESS_SECRET): each
// egress (a Cloudflare Worker proxy, tools/egress-worker) is an extra "lane"
// with its own token bucket and AIMD state for this host. Requests rotate
// round-robin across direct + egress lanes that have budget. Only tasks that
// take the `via` argument (and call `via.fetch`) can leave through an egress;
// other tasks always go direct. An egress answering 401/403/429/5xx (or failing
// at the network level) 3 times in a row is disabled for 30 min.
// Without the env vars there is exactly one (direct) lane — behaviour unchanged.

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
  | { type: 'limit'; host: GateHost; status: number; ratePerMin: number; pausedUntil: number; lane?: string }
  | { type: 'rate'; host: GateHost; ratePerMin: number; lane?: string }
  | { type: 'resume'; host: GateHost; ratePerMin: number; lane?: string }
  | { type: 'egress-disabled'; host: GateHost; lane: string; until: number; reason: string };

/** An egress proxy: `url` receives `?url=<apple url>` with the shared secret header. */
export interface EgressConfig {
  url: string;
  secret: string;
}

export const EGRESS_SECRET_HEADER = 'x-egress-secret';
/** Consecutive bad egress answers before the lane is disabled. */
export const EGRESS_MAX_BAD = 3;
export const EGRESS_DISABLE_MS = 30 * 60_000;

/** Passed to gated tasks: `via.fetch` sends the request through the chosen lane. */
export interface GateVia {
  lane: string;
  egress: boolean;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export type GateTask<T> = (via: GateVia) => Promise<T>;

export interface GateLaneStatus {
  id: string;
  egress: boolean;
  ratePerMin: number;
  effectivePerMin: number;
  pausedUntil: number | null;
  disabledUntil: number | null;
  badStreak: number;
  inFlight: number;
  counters: { ok: number; limited: number; errors: number };
}

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
  /** Sum of effective rates over usable lanes (direct + enabled egresses). */
  totalPerMin: number;
  /** Direct lane first, then egresses (only when configured). */
  lanes: GateLaneStatus[];
}

interface Job {
  key: string | null;
  priority: GatePriority;
  state: 'queued' | 'running' | 'done';
  subscribers: number;
  task: GateTask<unknown>;
  /** Task takes `via` → may run through an egress lane. */
  acceptsVia: boolean;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  promise: Promise<unknown>;
}

function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

/** One way out for a host: direct, or one egress proxy. Own bucket + AIMD. */
class Lane {
  ratePerMin: number;
  pausedUntil = 0;
  disabledUntil = 0;
  consecutiveOk = 0;
  badStreak = 0;
  tokens: number;
  lastRefill: number;
  wasPaused = false;
  running = 0;
  readonly counters = { ok: 0, limited: 0, errors: 0 };

  constructor(
    readonly id: string,
    readonly egress: EgressConfig | null,
    readonly config: GateConfig,
    now: number
  ) {
    this.ratePerMin = config.startPerMin;
    this.tokens = config.burst;
    this.lastRefill = now;
  }

  effective(cap: number | null): number {
    return cap == null ? this.ratePerMin : Math.min(this.ratePerMin, cap);
  }

  refill(now: number, cap: number | null) {
    const from = Math.max(this.lastRefill, this.pausedUntil);
    if (now > from) {
      this.tokens = Math.min(this.config.burst, this.tokens + ((now - from) * this.effective(cap)) / 60_000);
    }
    this.lastRefill = now;
  }

  usable(now: number): boolean {
    return now >= this.pausedUntil && now >= this.disabledUntil;
  }
}

/** Egress lane ids are stable and never reveal the secret: `egress1`, `egress2`… */
export function egressLaneId(index: number): string {
  return `egress${index + 1}`;
}

export class HostGate {
  capPerMin: number | null = null;
  readonly counters = { ok: 0, limited: 0, errors: 0, coalesced: 0 };

  private readonly lanes: Lane[];
  private rr = 0;
  private readonly queues: Record<GatePriority, Job[]> = { interactive: [], top: [], tail: [] };
  private readonly inflight = new Map<string, Job>();
  private timer: unknown = null;
  private timerAt = 0;
  private readonly listeners = new Set<(e: GateEvent) => void>();

  constructor(
    readonly host: GateHost,
    readonly config: GateConfig = DEFAULT_GATE_CONFIG,
    private readonly clock: GateClock = realClock,
    egresses: EgressConfig[] = [],
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)
  ) {
    const now = clock.now();
    this.lanes = [
      new Lane('direct', null, config, now),
      ...egresses.map((e, i) => new Lane(egressLaneId(i), e, config, now)),
    ];
  }

  private get direct(): Lane {
    return this.lanes[0];
  }

  /** AIMD rate of the direct lane (kept for callers/tests that predate lanes). */
  get ratePerMin(): number {
    return this.direct.ratePerMin;
  }
  get pausedUntil(): number {
    return this.direct.pausedUntil;
  }
  get consecutiveOk(): number {
    return this.direct.consecutiveOk;
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
    return this.direct.effective(this.capPerMin);
  }

  /** Sum of effective rates across usable lanes (for duration estimates). */
  get totalPerMin(): number {
    const now = this.clock.now();
    return this.lanes
      .filter((l) => now >= l.disabledUntil)
      .reduce((sum, l) => sum + l.effective(this.capPerMin), 0);
  }

  /** The direct lane is paused (callers use this to pick a fallback host). */
  isPaused(): boolean {
    return this.clock.now() < this.direct.pausedUntil;
  }

  /** Optional ceiling (e.g. the «Бережная» speed preset) per lane; null removes it. */
  setCap(perMin: number | null) {
    this.refillAll();
    this.capPerMin = perMin == null ? null : Math.max(1, perMin);
    this.pump();
  }

  /**
   * Run `task` when this host has budget. Identical `key`s share one in-flight
   * request. Abort via `signal` drops this caller; the shared request is only
   * dropped while still queued and once every caller has aborted.
   * A task that declares the `via` parameter may be routed through an egress.
   */
  run<T>(task: GateTask<T>, opts: { key?: string; priority?: GatePriority; signal?: AbortSignal } = {}): Promise<T> {
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
      job = {
        key: opts.key ?? null,
        priority,
        state: 'queued',
        subscribers: 1,
        task: task as GateTask<unknown>,
        acceptsVia: task.length >= 1,
        resolve,
        reject,
        promise,
      };
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
    this.refillAll();
    const now = this.clock.now();
    const d = this.direct;
    return {
      host: this.host,
      ratePerMin: d.ratePerMin,
      capPerMin: this.capPerMin,
      effectivePerMin: this.effectivePerMin,
      queued: {
        interactive: this.queues.interactive.length,
        top: this.queues.top.length,
        tail: this.queues.tail.length,
      },
      inFlight: this.lanes.reduce((n, l) => n + l.running, 0),
      pausedUntil: now < d.pausedUntil ? d.pausedUntil : null,
      counters: { ...this.counters },
      consecutiveOk: d.consecutiveOk,
      totalPerMin: this.totalPerMin,
      lanes: this.lanes.map((l) => ({
        id: l.id,
        egress: l.egress != null,
        ratePerMin: l.ratePerMin,
        effectivePerMin: l.effective(this.capPerMin),
        pausedUntil: now < l.pausedUntil ? l.pausedUntil : null,
        disabledUntil: now < l.disabledUntil ? l.disabledUntil : null,
        badStreak: l.badStreak,
        inFlight: l.running,
        counters: { ...l.counters },
      })),
    };
  }

  /** Record the outcome of a request made outside `run` (e.g. a fallback probe). */
  reportSuccess(lane: Lane = this.direct) {
    this.counters.ok++;
    lane.counters.ok++;
    lane.consecutiveOk++;
    if (lane.consecutiveOk >= this.config.successesPerStep) {
      lane.consecutiveOk = 0;
      if (lane.ratePerMin < this.config.maxPerMin) {
        lane.refill(this.clock.now(), this.capPerMin);
        lane.ratePerMin = Math.min(this.config.maxPerMin, lane.ratePerMin + this.config.stepPerMin);
        this.emit({ type: 'rate', host: this.host, ratePerMin: lane.ratePerMin, ...this.laneTag(lane) });
      }
    }
  }

  reportLimited(status: number, lane: Lane = this.direct) {
    this.counters.limited++;
    lane.counters.limited++;
    lane.consecutiveOk = 0;
    const now = this.clock.now();
    lane.refill(now, this.capPerMin);
    lane.ratePerMin = Math.max(this.config.minPerMin, Math.floor(lane.ratePerMin / 2));
    lane.pausedUntil = now + this.config.pauseMs;
    lane.tokens = 0;
    lane.wasPaused = true;
    this.emit({ type: 'limit', host: this.host, status, ratePerMin: lane.ratePerMin, pausedUntil: lane.pausedUntil, ...this.laneTag(lane) });
    this.pump();
  }

  private laneTag(lane: Lane): { lane?: string } {
    return lane.egress ? { lane: lane.id } : {};
  }

  /** Track egress health from raw responses; 3 bad in a row → disabled 30 min. */
  private noteEgress(lane: Lane, bad: boolean, reason: string) {
    if (!bad) {
      lane.badStreak = 0;
      return;
    }
    lane.badStreak++;
    if (lane.badStreak >= EGRESS_MAX_BAD) {
      lane.badStreak = 0;
      lane.disabledUntil = this.clock.now() + EGRESS_DISABLE_MS;
      this.emit({ type: 'egress-disabled', host: this.host, lane: lane.id, until: lane.disabledUntil, reason });
      console.warn(`[gate] ${this.host} ${lane.id} disabled for 30 min: ${reason}`);
    }
  }

  private viaFor(lane: Lane): GateVia {
    const egress = lane.egress;
    if (!egress) return { lane: lane.id, egress: false, fetch: (url, init) => this.fetchImpl(url, init) };
    return {
      lane: lane.id,
      egress: true,
      fetch: async (url, init = {}) => {
        const target = new URL(egress.url);
        target.searchParams.set('url', url);
        const headers = new Headers(init.headers);
        headers.set(EGRESS_SECRET_HEADER, egress.secret);
        let res: Response;
        try {
          res = await this.fetchImpl(target.toString(), { ...init, headers });
        } catch (e) {
          if ((e as Error)?.name !== 'AbortError') this.noteEgress(lane, true, `network: ${(e as Error).message}`);
          throw e;
        }
        const bad = res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500;
        this.noteEgress(lane, bad, `HTTP ${res.status}`);
        return res;
      },
    };
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

  private refillAll() {
    const now = this.clock.now();
    for (const l of this.lanes) l.refill(now, this.capPerMin);
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

  /** Next lane (round-robin) that is usable, has a token and may carry the job. */
  private pickLane(job: Job, now: number): Lane | null {
    const n = this.lanes.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.rr + i) % n;
      const lane = this.lanes[idx];
      if (lane.egress && !job.acceptsVia) continue;
      if (!lane.usable(now) || lane.tokens < 1) continue;
      this.rr = (idx + 1) % n;
      return lane;
    }
    return null;
  }

  private pump() {
    const now = this.clock.now();
    for (const lane of this.lanes) {
      if (lane.wasPaused && now >= lane.pausedUntil) {
        lane.wasPaused = false;
        this.emit({ type: 'resume', host: this.host, ratePerMin: lane.ratePerMin, ...this.laneTag(lane) });
      }
    }
    this.refillAll();

    // Dispatch in priority order; a job no lane can take right now stays queued
    // (e.g. a direct-only job while only an egress has budget).
    for (const p of PRIORITIES) {
      const q = this.queues[p];
      for (let i = 0; i < q.length; ) {
        if (!this.lanes.some((l) => l.usable(now) && l.tokens >= 1)) break;
        const job = q[i];
        const lane = this.pickLane(job, now);
        if (!lane) { i++; continue; }
        q.splice(i, 1);
        lane.tokens -= 1;
        this.start(job, lane);
      }
    }

    if (!this.hasQueued()) return;
    // Wake up when the earliest lane that could serve a queued job gets a token.
    const viaQueued = PRIORITIES.some((p) => this.queues[p].some((j) => j.acceptsVia));
    let wake = Infinity;
    for (const lane of this.lanes) {
      if (lane.egress && !viaQueued) continue;
      if (now < lane.disabledUntil) { wake = Math.min(wake, lane.disabledUntil); continue; }
      if (now < lane.pausedUntil) { wake = Math.min(wake, lane.pausedUntil); continue; }
      if (lane.tokens >= 1) continue; // has budget but nothing it can carry
      const msPerToken = 60_000 / lane.effective(this.capPerMin);
      wake = Math.min(wake, now + Math.ceil((1 - lane.tokens) * msPerToken));
    }
    if (wake !== Infinity) this.schedule(wake);
  }

  private start(job: Job, lane: Lane) {
    job.state = 'running';
    lane.running++;
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(job.task(this.viaFor(lane)));
    } catch (e) {
      result = Promise.reject(e);
    }
    result.then(
      (value) => {
        lane.running--;
        this.finish(job);
        this.reportSuccess(lane);
        job.resolve(value);
        this.pump();
      },
      (error) => {
        lane.running--;
        this.finish(job);
        if (error instanceof GateHttpError && isGateLimitStatus(error.status)) this.reportLimited(error.status, lane);
        else if ((error as Error)?.name !== 'AbortError') {
          this.counters.errors++;
          lane.counters.errors++;
        }
        job.reject(error);
        this.pump();
      }
    );
  }
}

/** Egresses from env: KEYWORDS_EGRESS_URLS (comma list) + KEYWORDS_EGRESS_SECRET. */
export function egressesFromEnv(env: NodeJS.ProcessEnv = process.env): EgressConfig[] {
  const urls = (env.KEYWORDS_EGRESS_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return [];
  const secret = (env.KEYWORDS_EGRESS_SECRET ?? '').trim();
  if (!secret) {
    console.warn('[gate] KEYWORDS_EGRESS_URLS is set but KEYWORDS_EGRESS_SECRET is empty — egresses ignored');
    return [];
  }
  const out: EgressConfig[] = [];
  for (const url of urls) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw new Error('https required');
      out.push({ url: u.toString(), secret });
    } catch (e) {
      console.warn(`[gate] egress URL ignored (${(e as Error).message})`);
    }
  }
  return out;
}

const gates = new Map<GateHost, HostGate>();
let envEgresses: EgressConfig[] | null = null;

export function hostGate(host: GateHost): HostGate {
  let gate = gates.get(host);
  if (!gate) {
    envEgresses ??= egressesFromEnv();
    // search.itunes.apple.com gets a small burst so a UI suggestions request
    // (up to 12 hint seeds) is not spread over half a minute; the average rate
    // is still the AIMD rate.
    const config = host === 'search.itunes.apple.com' ? { ...DEFAULT_GATE_CONFIG, burst: 4 } : DEFAULT_GATE_CONFIG;
    gate = new HostGate(host, config, realClock, envEgresses);
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
