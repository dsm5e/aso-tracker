import express from 'express';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { KEYWORDS_FILES_DIR } from './paths.js';
import { getAppsWithStats, getLocaleStatsByApp, getRankings } from './queries.js';
import { loadApps, saveApps, loadKeywords, saveKeywords, type AppConfig } from './config.js';
import { db } from './db.js';
import { runSnapshot, refreshKeyword, getLiveRuntime, setLiveSpeed } from './snapshot.js';
import { getMovers } from './analytics.js';
import { lookupItunes } from './itunes.js';
import { competitorInfo, competitorKeywords, topCompetitors } from './competitors.js';
import { getCompetitorPricing } from './pricing.js';
import { getCompetitorReviews } from './reviews.js';
import { keywordRelevance, buildClaudePrompt } from './relevance.js';

const app = express();
app.use(express.json());

// --- Apps ---
app.get('/api/apps', (_req, res) => {
  res.json(getAppsWithStats());
});

app.post('/api/apps', (req, res) => {
  const body = req.body as AppConfig;
  if (!body.id || !body.name || !body.bundle || !body.iTunesId) {
    res.status(400).json({ error: 'id, name, bundle, iTunesId required' });
    return;
  }
  const apps = loadApps();
  if (apps.some((a) => a.id === body.id)) {
    res.status(409).json({ error: 'app id already exists' });
    return;
  }
  apps.push(body);
  saveApps(apps);
  res.json({ ok: true, app: body });
});

app.delete('/api/apps/:id', (req, res) => {
  const id = req.params.id;
  const apps = loadApps().filter((a) => a.id !== id);
  saveApps(apps);

  // Delete keywords file
  try {
    const kwPath = join(KEYWORDS_FILES_DIR, `${id}.json`);
    if (existsSync(kwPath)) unlinkSync(kwPath);
  } catch {/* ignore */}

  // Delete snapshot history
  try { db.prepare('DELETE FROM snapshots WHERE app = ?').run(id); } catch {/* ignore */}

  res.json({ ok: true });
});

// --- Keywords ---
app.get('/api/apps/:id/keywords', (req, res) => {
  res.json(loadKeywords(req.params.id));
});

app.put('/api/apps/:id/keywords', (req, res) => {
  saveKeywords(req.params.id, req.body);
  res.json({ ok: true });
});

// --- Rankings table ---
app.get('/api/apps/:id/rankings', (req, res) => {
  const locale = req.query.locale as string | undefined;
  res.json(getRankings(req.params.id, locale));
});

// --- Locale stats (for the locale strip) ---
app.get('/api/apps/:id/locales', (req, res) => {
  res.json(getLocaleStatsByApp(req.params.id));
});

// --- Competitors ---
app.get('/api/apps/:id/competitors', (req, res) => {
  const limit = Number(req.query.limit) || 20;
  res.json(topCompetitors(req.params.id, limit));
});

app.get('/api/competitors/keywords', (req, res) => {
  const app = req.query.app as string;
  const bundleId = req.query.bundleId as string;
  if (!app || !bundleId) {
    res.status(400).json({ error: 'app and bundleId required' });
    return;
  }
  res.json(competitorKeywords(app, bundleId));
});

app.get('/api/competitors/info', async (req, res) => {
  const bundleId = req.query.bundleId as string;
  if (!bundleId) {
    res.status(400).json({ error: 'bundleId required' });
    return;
  }
  try {
    const info = await competitorInfo(bundleId);
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/apps/:id/keyword-relevance', async (req, res) => {
  const appId = req.params.id;
  const locale = (req.query.locale as string | undefined)?.toLowerCase();
  try {
    const data = await keywordRelevance(appId, locale);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/apps/:id/claude-prompt', async (req, res) => {
  const appId = req.params.id;
  const keyword = (req.query.keyword as string | undefined)?.trim();
  const locale = (req.query.locale as string | undefined)?.trim()?.toLowerCase();
  if (!keyword || !locale) {
    res.status(400).json({ error: 'keyword and locale required' });
    return;
  }
  try {
    const prompt = await buildClaudePrompt(appId, keyword, locale);
    if (!prompt) {
      res.status(404).json({ error: 'no data for this keyword/locale' });
      return;
    }
    res.json({ prompt });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/competitors/reviews', async (req, res) => {
  const iTunesId = (req.query.id as string || '').trim();
  const country = (req.query.country as string || 'us').toLowerCase();
  if (!iTunesId || !/^\d+$/.test(iTunesId)) {
    res.status(400).json({ error: 'numeric id required' });
    return;
  }
  try {
    const info = await getCompetitorReviews(iTunesId, country);
    if (!info) { res.status(404).json({ error: 'fetch failed' }); return; }
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/competitors/pricing', async (req, res) => {
  const iTunesId = (req.query.id as string || '').trim();
  const country = (req.query.country as string || 'us').toLowerCase();
  if (!iTunesId || !/^\d+$/.test(iTunesId)) {
    res.status(400).json({ error: 'numeric id required' });
    return;
  }
  try {
    const info = await getCompetitorPricing(iTunesId, country);
    if (!info) {
      res.status(404).json({ error: 'not found or fetch failed' });
      return;
    }
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- iTunes search (name / bundleId / numeric id) ---
app.get('/api/itunes/search', async (req, res) => {
  const term = (req.query.term as string || '').trim();
  const country = (req.query.country as string) || 'us';
  if (!term) { res.json([]); return; }

  try {
    // If the term is purely numeric, treat it as iTunes App ID
    if (/^\d+$/.test(term)) {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${term}&country=${country}`, { signal: AbortSignal.timeout(15_000) });
      const d = (await r.json()) as { results?: any[] };
      res.json(d.results || []);
      return;
    }
    // If it looks like a bundle id (has a dot, no space), lookup by bundleId
    if (/^[a-zA-Z0-9.\-_]+$/.test(term) && term.includes('.')) {
      const r = await fetch(`https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(term)}&country=${country}`, { signal: AbortSignal.timeout(15_000) });
      const d = (await r.json()) as { results?: any[] };
      if (d.results && d.results.length) { res.json(d.results); return; }
      // fall through to search if nothing found
    }
    // Otherwise, full-text search
    const params = new URLSearchParams({ term, country, media: 'software', entity: 'software', limit: '15' });
    const r = await fetch(`https://itunes.apple.com/search?${params}`, { signal: AbortSignal.timeout(15_000) });
    const d = (await r.json()) as { results?: any[] };
    res.json(d.results || []);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- iTunes lookup (for App Adder modal's "Test connection" button) ---
app.get('/api/itunes/lookup', async (req, res) => {
  const id = req.query.id as string;
  const country = (req.query.country as string) || 'us';
  if (!id) {
    res.status(400).json({ error: 'id required' });
    return;
  }
  try {
    const result = await lookupItunes(id, country);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Refresh a single keyword (on-demand from UI) ---
app.post('/api/apps/:id/refresh-keyword', async (req, res) => {
  const appId = req.params.id;
  const { locale, keyword } = req.body || {};
  if (!locale || !keyword) {
    res.status(400).json({ error: 'locale and keyword required' });
    return;
  }
  try {
    const rec = await refreshKeyword(appId, locale, keyword);
    res.json({ ok: true, position: rec.position, top5: rec.top5 });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Live speed control for an in-flight snapshot ---
app.get('/api/snapshot/speed', (_req, res) => {
  const r = getLiveRuntime();
  res.json({ running: r !== null, runtime: r });
});

app.post('/api/snapshot/speed', (req, res) => {
  const { sleepMs, workers } = req.body || {};
  if (typeof sleepMs !== 'number' && typeof workers !== 'number') {
    res.status(400).json({ error: 'sleepMs or workers required' });
    return;
  }
  const ok = setLiveSpeed({
    sleepMs: typeof sleepMs === 'number' ? sleepMs : undefined,
    workers: typeof workers === 'number' ? workers : undefined,
    source: 'user',
  });
  if (!ok) {
    res.status(409).json({ error: 'No snapshot is currently running' });
    return;
  }
  res.json({ ok: true, runtime: getLiveRuntime() });
});

// --- Analytics: movers across apps & periods ---
app.get('/api/analytics/movers', (req, res) => {
  const appId = req.query.app as string | undefined;
  const locale = req.query.locale as string | undefined;
  const period = (req.query.period as string | undefined) ?? 'week';
  if (period !== 'day' && period !== 'week' && period !== 'month') {
    res.status(400).json({ error: 'period must be day | week | month' });
    return;
  }
  const limit = Number(req.query.limit) || 15;
  try {
    res.json(getMovers({ appId, locale, period, limit }));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Snapshot — runs in the background as a singleton on the server. Browser
// navigation no longer kills the run; clients subscribe via SSE for live
// events and may reconnect at any time to see the buffered history + tail. ---

interface SnapshotEvent { type: string; [k: string]: unknown }
interface SnapshotRunState {
  running: boolean;
  startedAt: number | null;
  endedAt: number | null;
  /** Buffered events for cold reconnect. Capped to keep memory bounded. */
  events: SnapshotEvent[];
  /** Last "progress"-flavour event for quick rendering of a global indicator
   *  without replaying the whole buffer. */
  lastProgress: SnapshotEvent | null;
  /** Final outcome of the latest run (for clients arriving post-completion). */
  finalEvent: SnapshotEvent | null;
  cancelled: boolean;
  /** Active SSE subscribers. Disconnect → remove; does NOT abort the run. */
  subscribers: Set<express.Response>;
  /** Snapshot of options the run started with — useful for the UI capsule. */
  options: { appIds?: string[]; locales?: string[]; total: number } | null;
}

const snapshotState: SnapshotRunState = {
  running: false,
  startedAt: null,
  endedAt: null,
  events: [],
  lastProgress: null,
  finalEvent: null,
  cancelled: false,
  subscribers: new Set<express.Response>(),
  options: null,
};
const SNAPSHOT_BUFFER_CAP = 500;

function snapshotBroadcast(event: SnapshotEvent) {
  snapshotState.events.push(event);
  if (snapshotState.events.length > SNAPSHOT_BUFFER_CAP) {
    snapshotState.events.splice(0, snapshotState.events.length - SNAPSHOT_BUFFER_CAP);
  }
  if (event.type === 'progress' || event.type === 'app-start' || event.type === 'app-done') {
    snapshotState.lastProgress = event;
  }
  if (event.type === 'done' || event.type === 'abort') {
    snapshotState.finalEvent = event;
  }
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const r of snapshotState.subscribers) {
    try { r.write(payload); } catch { snapshotState.subscribers.delete(r); }
  }
}

function startSnapshot(opts: { appIds?: string[]; locales?: string[]; workers?: number; sleepMs?: number; skipExisting?: boolean }) {
  if (snapshotState.running) return false;
  snapshotState.running = true;
  snapshotState.startedAt = Date.now();
  snapshotState.endedAt = null;
  snapshotState.events = [];
  snapshotState.lastProgress = null;
  snapshotState.finalEvent = null;
  snapshotState.cancelled = false;
  snapshotState.options = {
    appIds: opts.appIds,
    locales: opts.locales,
    total: 0, // populated by first 'init' event from runSnapshot
  };
  snapshotBroadcast({ type: 'started', startedAt: snapshotState.startedAt });

  runSnapshot({
    appIds: opts.appIds,
    locales: opts.locales,
    workers: typeof opts.workers === 'number' ? opts.workers : undefined,
    sleepMs: typeof opts.sleepMs === 'number' ? opts.sleepMs : undefined,
    skipExisting: opts.skipExisting === true,
    onProgress: (ev) => {
      // Track total once we receive the init event so the capsule can show "X/Y".
      if (snapshotState.options && (ev as SnapshotEvent).type === 'init') {
        const total = (ev as { total?: number }).total;
        if (typeof total === 'number') snapshotState.options.total = total;
      }
      snapshotBroadcast(ev as SnapshotEvent);
    },
    isCancelled: () => snapshotState.cancelled,
  })
    .then(() => {
      snapshotState.running = false;
      snapshotState.endedAt = Date.now();
      snapshotBroadcast({ type: 'done', at: snapshotState.endedAt });
    })
    .catch((e) => {
      snapshotState.running = false;
      snapshotState.endedAt = Date.now();
      snapshotBroadcast({ type: 'abort', reason: (e as Error).message });
    });
  return true;
}

app.post('/api/snapshot', (req, res) => {
  if (snapshotState.running) {
    res.status(409).json({ error: 'snapshot already running', state: snapshotPublicState() });
    return;
  }
  const { appIds, locales, workers, sleepMs, skipExisting } = req.body || {};
  startSnapshot({ appIds, locales, workers, sleepMs, skipExisting });
  res.status(202).json({ ok: true, state: snapshotPublicState() });
});

app.post('/api/snapshot/abort', (_req, res) => {
  if (!snapshotState.running) {
    res.json({ ok: true, alreadyIdle: true });
    return;
  }
  snapshotState.cancelled = true;
  res.json({ ok: true });
});

function snapshotPublicState() {
  return {
    running: snapshotState.running,
    startedAt: snapshotState.startedAt,
    endedAt: snapshotState.endedAt,
    cancelled: snapshotState.cancelled,
    options: snapshotState.options,
    lastProgress: snapshotState.lastProgress,
    finalEvent: snapshotState.finalEvent,
  };
}

app.get('/api/snapshot/state', (_req, res) => {
  res.json(snapshotPublicState());
});

app.get('/api/snapshot/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay buffer so a client landing mid-run sees prior events (esp. 'init').
  for (const ev of snapshotState.events) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
  // If the run has ended already, replay the final event so the client knows.
  if (!snapshotState.running && snapshotState.finalEvent) {
    res.write(`data: ${JSON.stringify(snapshotState.finalEvent)}\n\n`);
  }

  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
  }, 15_000);

  snapshotState.subscribers.add(res);
  req.on('close', () => {
    snapshotState.subscribers.delete(res);
    clearInterval(heartbeat);
  });
});

const PORT = Number(process.env.PORT) || 5174;
app.listen(PORT, () => {
  console.log(`ASO Tracker API listening on http://localhost:${PORT}`);
});
