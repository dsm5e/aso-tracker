import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GATE_CONFIG, GateHttpError, HostGate, type GateClock, type GateEvent } from './host-gate.js';

/** Deterministic clock: timers fire only when the test advances time. */
class FakeClock implements GateClock {
  t = 0;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private seq = 0;
  now() { return this.t; }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      await flush();
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
    await flush();
  }
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const ok = <T>(v: T) => () => Promise.resolve(v);

test('token bucket paces requests at the start rate (24/min = 2.5 s)', async () => {
  const clock = new FakeClock();
  const gate = new HostGate('search.itunes.apple.com', DEFAULT_GATE_CONFIG, clock);
  const startedAt: number[] = [];
  const jobs = [1, 2, 3].map((n) => gate.run(() => { startedAt.push(clock.now()); return Promise.resolve(n); }));
  await clock.advance(10_000);
  assert.deepEqual(await Promise.all(jobs), [1, 2, 3]);
  assert.deepEqual(startedAt, [0, 2500, 5000]);
});

test('AIMD: +2/min after 50 successes, capped at 40/min', async () => {
  const clock = new FakeClock();
  const gate = new HostGate('itunes.apple.com', DEFAULT_GATE_CONFIG, clock);
  for (let i = 0; i < 50; i++) gate.reportSuccess();
  assert.equal(gate.ratePerMin, 26);
  for (let i = 0; i < 50 * 20; i++) gate.reportSuccess();
  assert.equal(gate.ratePerMin, 40);
});

test('403/429 halves the rate and pauses the host for 5 minutes', async () => {
  const clock = new FakeClock();
  const gate = new HostGate('search.itunes.apple.com', DEFAULT_GATE_CONFIG, clock);
  const events: GateEvent[] = [];
  gate.onEvent((e) => events.push(e));
  await assert.rejects(gate.run(() => Promise.reject(new GateHttpError(429))), GateHttpError);
  assert.equal(gate.ratePerMin, 12);
  assert.equal(gate.status().pausedUntil, 5 * 60_000);
  assert.equal(events[0].type, 'limit');

  let startedAt = -1;
  const next = gate.run(() => { startedAt = clock.now(); return Promise.resolve('x'); });
  await clock.advance(4 * 60_000);
  assert.equal(startedAt, -1, 'no request while paused');
  assert.equal(gate.status().queued.top, 1);
  await clock.advance(60_000 + 5_000);
  assert.equal(await next, 'x');
  assert.ok(startedAt >= 5 * 60_000, `started at ${startedAt}`);
  assert.ok(events.some((e) => e.type === 'resume'));
  assert.equal(gate.status().counters.limited, 1);
});

test('non-limit errors do not shrink the rate', async () => {
  const clock = new FakeClock();
  const gate = new HostGate('itunes.apple.com', DEFAULT_GATE_CONFIG, clock);
  await assert.rejects(gate.run(() => Promise.reject(new GateHttpError(503))));
  assert.equal(gate.ratePerMin, 24);
  assert.equal(gate.status().pausedUntil, null);
  assert.equal(gate.status().counters.errors, 1);
});

test('higher priority jumps the queue', async () => {
  const clock = new FakeClock();
  const gate = new HostGate('search.itunes.apple.com', DEFAULT_GATE_CONFIG, clock);
  const order: string[] = [];
  const mk = (name: string) => () => { order.push(name); return Promise.resolve(name); };
  const all = [
    gate.run(mk('t1'), { priority: 'tail' }),
    gate.run(mk('t2'), { priority: 'tail' }),
    gate.run(mk('top'), { priority: 'top' }),
    gate.run(mk('ui'), { priority: 'interactive' }),
  ];
  await clock.advance(20_000);
  await Promise.all(all);
  // t1 got the initial token synchronously; then the UI request, then top, then tail.
  assert.deepEqual(order, ['t1', 'ui', 'top', 't2']);
});

test('identical in-flight keys are coalesced into one request', async () => {
  const clock = new FakeClock();
  const gate = new HostGate('search.itunes.apple.com', DEFAULT_GATE_CONFIG, clock);
  let calls = 0;
  const task = () => { calls++; return Promise.resolve(['a']); };
  const blocker = gate.run(ok(0)); // consumes the initial token
  const a = gate.run(task, { key: 'us|horoscope', priority: 'tail' });
  const b = gate.run(task, { key: 'us|horoscope', priority: 'interactive' });
  assert.equal(gate.status().queued.interactive, 1, 'coalesced job upgraded to the higher priority');
  await clock.advance(5_000);
  await blocker;
  assert.deepEqual(await a, ['a']);
  assert.equal(await a, await b);
  assert.equal(calls, 1);
  assert.equal(gate.status().counters.coalesced, 1);
});

test('abort removes a queued request without running it', async () => {
  const clock = new FakeClock();
  const gate = new HostGate('apps.apple.com', DEFAULT_GATE_CONFIG, clock);
  await gate.run(ok(0));
  const ctrl = new AbortController();
  let ran = false;
  const p = gate.run(() => { ran = true; return Promise.resolve(1); }, { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, { name: 'AbortError' });
  await clock.advance(10_000);
  assert.equal(ran, false);
  assert.equal(gate.status().queued.top, 0);
});

test('cap lowers the effective rate', async () => {
  const clock = new FakeClock();
  const gate = new HostGate('itunes.apple.com', DEFAULT_GATE_CONFIG, clock);
  gate.setCap(12);
  const startedAt: number[] = [];
  const jobs = [1, 2].map(() => gate.run(() => { startedAt.push(clock.now()); return Promise.resolve(); }));
  await clock.advance(10_000);
  await Promise.all(jobs);
  assert.deepEqual(startedAt, [0, 5000]);
  assert.equal(gate.status().effectivePerMin, 12);
});
