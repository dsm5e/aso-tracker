import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GATE_CONFIG,
  EGRESS_DISABLE_MS,
  EGRESS_SECRET_HEADER,
  GateHttpError,
  HostGate,
  egressesFromEnv,
  type GateClock,
  type GateEvent,
  type GateVia,
} from './host-gate.js';

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

const EGRESSES = [
  { url: 'https://e1.example.workers.dev/', secret: 's3cret' },
  { url: 'https://e2.example.workers.dev/', secret: 's3cret' },
];

/** Records every outgoing request and answers with the status for that origin. */
function fakeFetch(statusFor: (origin: string) => number = () => 200) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response('{}', { status: statusFor(new URL(url).origin) });
  }) as typeof fetch;
  return { calls, impl };
}

const viaTask = (lanes: string[], url = 'https://search.itunes.apple.com/x?term=a') =>
  async (via: GateVia) => {
    lanes.push(via.lane);
    const res = await via.fetch(url, { headers: { 'X-Apple-Store-Front': '143441,29' } });
    if (!res.ok) throw new GateHttpError(res.status);
    return res.status;
  };

test('no egress configured → one direct lane, behaviour unchanged', async () => {
  const clock = new FakeClock();
  const { calls, impl } = fakeFetch();
  const gate = new HostGate('search.itunes.apple.com', DEFAULT_GATE_CONFIG, clock, [], impl);
  const lanes: string[] = [];
  const jobs = [1, 2, 3].map(() => gate.run(viaTask(lanes)));
  await clock.advance(10_000);
  await Promise.all(jobs);
  assert.deepEqual(lanes, ['direct', 'direct', 'direct']);
  assert.ok(calls.every((c) => c.url.startsWith('https://search.itunes.apple.com/')));
  assert.equal(gate.status().lanes.length, 1);
  assert.equal(gate.status().totalPerMin, 24);
});

test('requests rotate round-robin across direct + egresses, each with its own budget', async () => {
  const clock = new FakeClock();
  const { calls, impl } = fakeFetch();
  const gate = new HostGate('search.itunes.apple.com', DEFAULT_GATE_CONFIG, clock, EGRESSES, impl);
  const lanes: string[] = [];
  const started: number[] = [];
  const jobs = Array.from({ length: 6 }, () => gate.run(async (via: GateVia) => {
    started.push(clock.now());
    return viaTask(lanes)(via);
  }));
  await clock.advance(10_000);
  await Promise.all(jobs);
  assert.deepEqual(lanes, ['direct', 'egress1', 'egress2', 'direct', 'egress1', 'egress2']);
  // Three lanes × 24/min: the first three leave at once, the next three one bucket period later.
  assert.deepEqual(started, [0, 0, 0, 2500, 2500, 2500]);
  assert.equal(gate.status().totalPerMin, 72);

  const viaEgress = calls.filter((c) => c.url.startsWith('https://e1.example.workers.dev/'));
  assert.equal(viaEgress.length, 2);
  const proxied = new URL(viaEgress[0].url);
  assert.equal(proxied.searchParams.get('url'), 'https://search.itunes.apple.com/x?term=a');
  assert.equal(viaEgress[0].headers.get(EGRESS_SECRET_HEADER), 's3cret');
  assert.equal(viaEgress[0].headers.get('X-Apple-Store-Front'), '143441,29');
  assert.equal(calls.filter((c) => c.url.startsWith('https://search.itunes.apple.com/'))[0].headers.get(EGRESS_SECRET_HEADER), null,
    'the secret never goes to Apple');
});

test('tasks without the via parameter always go direct', async () => {
  const clock = new FakeClock();
  const { impl } = fakeFetch();
  const gate = new HostGate('itunes.apple.com', DEFAULT_GATE_CONFIG, clock, EGRESSES, impl);
  const started: number[] = [];
  const jobs = [1, 2, 3].map(() => gate.run(() => { started.push(clock.now()); return Promise.resolve(); }));
  await clock.advance(10_000);
  await Promise.all(jobs);
  assert.deepEqual(started, [0, 2500, 5000], 'paced by the direct lane only');
  assert.deepEqual(gate.status().lanes.map((l) => l.counters.ok), [3, 0, 0]);
});

test('an egress answering 403/429/5xx three times in a row is disabled for 30 min', async () => {
  const clock = new FakeClock();
  const { impl } = fakeFetch((origin) => (origin === 'https://e1.example.workers.dev' ? 502 : 200));
  const gate = new HostGate('search.itunes.apple.com', DEFAULT_GATE_CONFIG, clock, [EGRESSES[0]], impl);
  const events: GateEvent[] = [];
  gate.onEvent((e) => events.push(e));
  const lanes: string[] = [];
  const results = Array.from({ length: 12 }, () => gate.run(viaTask(lanes)).catch((e: GateHttpError) => e.status));
  await clock.advance(60_000);
  await Promise.all(results);

  const disabled = events.find((e) => e.type === 'egress-disabled');
  assert.ok(disabled, 'egress-disabled event emitted');
  assert.equal(lanes.filter((l) => l === 'egress1').length, 3, 'no traffic to the egress after 3 bad answers');
  const lane = gate.status().lanes.find((l) => l.id === 'egress1')!;
  assert.ok(lane.disabledUntil != null && lane.disabledUntil > clock.now());
  assert.equal(gate.status().totalPerMin, 24, 'a disabled egress adds no budget');
  // 5xx is not a rate limit: the egress rate is untouched, direct unaffected.
  assert.equal(lane.ratePerMin, 24);
  assert.equal(gate.status().lanes[0].counters.errors, 0);

  // After 30 min the egress is back in rotation.
  await clock.advance(EGRESS_DISABLE_MS);
  const after: string[] = [];
  const more = [1, 2].map(() => gate.run(viaTask(after)).catch(() => null));
  await clock.advance(10_000);
  await Promise.all(more);
  assert.ok(after.includes('egress1'), `lanes after re-enable: ${after}`);
});

test('a 429 through an egress halves only that egress lane and pauses it', async () => {
  const clock = new FakeClock();
  const { impl } = fakeFetch((origin) => (origin === 'https://e1.example.workers.dev' ? 429 : 200));
  const gate = new HostGate('search.itunes.apple.com', DEFAULT_GATE_CONFIG, clock, [EGRESSES[0]], impl);
  const lanes: string[] = [];
  const results = [1, 2].map(() => gate.run(viaTask(lanes)).catch((e: GateHttpError) => e.status));
  await clock.advance(1_000);
  assert.deepEqual(await Promise.all(results), [200, 429]);
  const st = gate.status();
  assert.equal(st.lanes[0].ratePerMin, 24);
  assert.equal(st.lanes[1].ratePerMin, 12);
  assert.ok(st.lanes[1].pausedUntil != null);
  assert.equal(st.pausedUntil, null, 'direct keeps working');
  assert.equal(gate.isPaused(), false);
});

test('egressesFromEnv: needs a secret and https URLs', () => {
  assert.deepEqual(egressesFromEnv({}), []);
  assert.deepEqual(egressesFromEnv({ KEYWORDS_EGRESS_URLS: 'https://a.workers.dev' }), []);
  const got = egressesFromEnv({
    KEYWORDS_EGRESS_URLS: 'https://a.workers.dev, http://plain.example.com ,https://b.workers.dev/p',
    KEYWORDS_EGRESS_SECRET: 'x',
  });
  assert.deepEqual(got.map((e) => e.url), ['https://a.workers.dev/', 'https://b.workers.dev/p']);
});
