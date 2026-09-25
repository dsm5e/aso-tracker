import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// meta-store.ts opens SQLite on import; keep tests off the real database.
process.env.ASO_STUDIO_HOME = mkdtempSync(join(tmpdir(), 'aso-lookup-test-'));
const { LOOKUP_CHUNK, lookupBatch, searchAppStore } = await import('./itunes.js');
const { readSerp, writeSerp, readAppMeta } = await import('./meta-store.js');
const { hasFreshStoreSerp, serpFromIds, STORE_DEPTH } = await import('./competitor-spy.js');

type Call = { url: URL };
const realFetch = globalThis.fetch;
function mockFetch(handler: (url: URL) => unknown): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url });
    return new Response(JSON.stringify(handler(url)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

/** iTunes lookup answer: every requested id except the ones in `drop`. */
const lookupAnswer = (drop = new Set<string>()) => (url: URL) => ({
  results: (url.searchParams.get('id') ?? '').split(',').filter((id) => !drop.has(id))
    .map((id) => ({ trackId: Number(id), trackName: `App ${id}`, artistName: 'Dev', bundleId: `com.x.${id}`, description: 'long text' })),
});

test('lookupBatch splits into ≤150-id requests, caches 24 h, stores misses', { timeout: 20_000 }, async () => {
  const ids = Array.from({ length: 200 }, (_, i) => String(1_000_000 + i));
  const calls = mockFetch(lookupAnswer(new Set(['1000007'])));
  try {
    const out = await lookupBatch(ids, 'us');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.url.searchParams.get('id')!.split(',').length), [LOOKUP_CHUNK, 50]);
    assert.ok(calls.every((c) => c.url.pathname === '/lookup' && c.url.searchParams.get('country') === 'us'));
    assert.equal(out.size, 199);
    assert.equal(out.get('1000001')?.trackName, 'App 1000001');
    assert.equal((out.get('1000001') as unknown as Record<string, unknown>).description, undefined, 'heavy fields stripped');
    // The miss is cached as null (1 h) so it is not re-requested.
    assert.equal(readAppMeta('us', ['1000007']).get('1000007'), null);

    const again = await lookupBatch([...ids, '1000007'], 'us');
    assert.equal(calls.length, 2, 'second call served from cache');
    assert.equal(again.size, 199);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('lookupBatch coalesces overlapping concurrent batches per id', { timeout: 20_000 }, async () => {
  const calls = mockFetch(lookupAnswer());
  try {
    const a = ['2000001', '2000002', '2000003'];
    const b = ['2000002', '2000003', '2000004'];
    const [ra, rb] = await Promise.all([lookupBatch(a, 'de'), lookupBatch(b, 'de')]);
    const requested = calls.flatMap((c) => c.url.searchParams.get('id')!.split(','));
    assert.deepEqual(requested.sort(), ['2000001', '2000002', '2000003', '2000004']);
    assert.equal(ra.size, 3);
    assert.equal(rb.size, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('searchAppStore persists the full ordered id list to serp_cache; the spy reuses it', { timeout: 20_000 }, async () => {
  const ids = Array.from({ length: 246 }, (_, i) => String(3_000_000 + i));
  const calls = mockFetch(() => ({ pageData: { bubbles: [{ name: 'software', results: ids.map((id) => ({ id })) }] }, storePlatformData: {} }));
  try {
    const res = await searchAppStore('us', '  DICOM  Viewer ');
    assert.equal(res.source, 'appstore');
    assert.equal(calls.length, 1);
    let row = readSerp('us', 'dicom viewer');
    for (let i = 0; !row && i < 50; i++) { await new Promise((r) => setTimeout(r, 10)); row = readSerp('us', 'dicom viewer'); }
    assert.ok(row, 'serp row written');
    assert.equal(row.source, 'appstore');
    assert.deepEqual(row.ids, ids);
    assert.equal(hasFreshStoreSerp('us', 'Dicom Viewer'), true);
    assert.equal(hasFreshStoreSerp('us', 'dicom viewer', Date.now() + 13 * 3600_000), false, '12 h TTL');

    // A 246-long list is the whole result set: absence is final up to 250.
    const serp = serpFromIds('dicom viewer', row.source, row.ids, row.fetchedAt, new Map([[ids[0], { trackId: Number(ids[0]), trackName: 'IDV' }]]));
    assert.equal(serp.source, 'store');
    assert.equal(serp.depth, STORE_DEPTH);
    assert.equal(serp.apps[0].name, 'IDV');
    assert.equal(serp.apps[1].tid, Number(ids[1]));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('an iTunes list never replaces a fresh App Store list in serp_cache', () => {
  const now = Date.now();
  writeSerp('gb', 'ct viewer', 'appstore', ['1', '2'], now);
  writeSerp('gb', 'ct viewer', 'itunes', ['9'], now + 1000);
  assert.deepEqual(readSerp('gb', 'ct viewer')?.ids, ['1', '2']);
  writeSerp('gb', 'ct viewer', 'itunes', ['9'], now + 13 * 3600_000);
  assert.deepEqual(readSerp('gb', 'ct viewer')?.ids, ['9'], 'stale App Store list is replaced');
  writeSerp('gb', 'ct viewer', 'appstore', ['3'], now + 14 * 3600_000);
  assert.equal(readSerp('gb', 'ct viewer')?.source, 'appstore');
});
