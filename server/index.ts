import express from 'express';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getAppsWithStats, getLocaleStatsByApp, getRankings } from './queries.js';
import { loadApps, saveApps, loadKeywords, saveKeywords, type AppConfig } from './config.js';
import { db } from './db.js';
import { runSnapshot, refreshKeyword } from './snapshot.js';
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
    const kwPath = join(process.cwd(), 'config', 'keywords', `${id}.json`);
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

// --- Snapshot with SSE progress stream ---
app.post('/api/snapshot', (req, res) => {
  const { appIds, locales, workers, sleepMs, skipExisting } = req.body || {};
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let cancelled = false;
  // Use res.on('close') (not req.on) — Express 5 / Node emits `req.close` right after
  // flushHeaders() even while the client is still connected. `res.on('close')` fires
  // only on real disconnect or after we've ended the response ourselves.
  res.on('close', () => {
    if (res.writableEnded || cancelled) return;
    cancelled = true;
  });

  const send = (event: object) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Heartbeat every 15s — SSE comment lines don't trigger onEvent but keep the connection
  // alive and let the client detect a dead server (no heartbeat → watchdog fires).
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
  }, 15_000);
  res.on('close', () => clearInterval(heartbeat));

  runSnapshot({
    appIds,
    locales,
    workers: typeof workers === 'number' ? workers : undefined,
    sleepMs: typeof sleepMs === 'number' ? sleepMs : undefined,
    skipExisting: skipExisting === true,
    onProgress: send,
    isCancelled: () => cancelled,
  })
    .then(() => {
      if (!res.writableEnded) {
        res.write('event: end\ndata: {}\n\n');
        res.end();
      }
    })
    .catch((e) => {
      send({ type: 'abort', reason: (e as Error).message });
      if (!res.writableEnded) res.end();
    });
});

const PORT = Number(process.env.PORT) || 5174;
app.listen(PORT, () => {
  console.log(`ASO Tracker API listening on http://localhost:${PORT}`);
});
