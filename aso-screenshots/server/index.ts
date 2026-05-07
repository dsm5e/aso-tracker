import express from 'express';
import type { Response } from 'express';
import { writeFileSync, appendFileSync, mkdirSync, readFileSync, existsSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEV_LOG = '/tmp/aso-studio-dev.log';
function devLog(line: string) {
  const ts = new Date().toISOString().slice(11, 23);
  appendFileSync(DEV_LOG, `[${ts}] ${line}\n`);
}
import { heroGenerate } from './routes/hero';
import { translateBatch } from './routes/translate';
import { exportSavePng, exportEnsureFolder, exportPickFolder } from './routes/exportPng';
import { getKeysStatus, updateKey } from './routes/settings';
import { ppoGenerate, ppoResumeAll, ppoProxyImage } from './routes/ppo';

const app = express();
app.use(express.json({ limit: '20mb' }));

const SCREENSHOTS_ROOT = resolve(import.meta.dirname, '..');
const IMPORTED_DIR = join(SCREENSHOTS_ROOT, 'src', 'lib', 'presets', 'imported');

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'aso-studio', phase: 4 });
});

app.post('/api/client-log', (req, res) => {
  const { level = 'info', tag = '?', msg = '', meta } = req.body ?? {};
  const safe = typeof msg === 'string' ? msg.slice(0, 800) : JSON.stringify(msg).slice(0, 800);
  const metaStr = meta ? ' | ' + JSON.stringify(meta).slice(0, 400) : '';
  const line = `[client:${level}] ${tag}: ${safe}${metaStr}`;
  console.log(line);
  devLog(line);
  res.json({ ok: true });
});

app.get('/api/settings/keys', getKeysStatus);
app.post('/api/settings/keys', updateKey);

app.post('/api/screenshots/generate-hero', heroGenerate);
app.post('/api/ppo/generate', ppoGenerate);
app.get('/api/ppo/proxy-image', ppoProxyImage);
app.post('/api/translate/batch', translateBatch);
app.post('/api/export/save-png', exportSavePng);
app.post('/api/export/ensure-folder', exportEnsureFolder);
app.post('/api/export/pick-folder', exportPickFolder);

// Save the current Editor state as a template (preset). When `mode='update'` and the
// preset id matches an imported file, overwrite it. When `mode='new'`, write a new
// file under a slug derived from the supplied name. Vite's eager glob picks it up.
app.post('/api/templates/save', (req, res) => {
  const { mode, preset } = req.body ?? {};
  if (!preset || typeof preset !== 'object' || !preset.id || !preset.name) {
    res.status(400).json({ error: 'preset with id+name required' });
    return;
  }
  if (mode !== 'update' && mode !== 'new') {
    res.status(400).json({ error: 'mode must be update | new' });
    return;
  }
  try {
    mkdirSync(IMPORTED_DIR, { recursive: true });
    const file = join(IMPORTED_DIR, `${preset.id}.json`);
    writeFileSync(file, JSON.stringify(preset, null, 2) + '\n');
    res.json({ ok: true, file });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Studio state mirror — JSON file as source of truth.
// Client subscribes to Zustand changes and POSTs the whole state here; we
// persist it to ~/.aso-studio/state.json and broadcast over SSE to OTHER
// listeners. When the file is edited externally (e.g. by an agent via Edit /
// Write tools), fs.watch detects content drift and we push the update to the
// browser so changes apply with no reload.
// ─────────────────────────────────────────────────────────────────────────────

const STATE_DIR = join(homedir(), '.aso-studio');
const STATE_FILE = join(STATE_DIR, 'state.json');
mkdirSync(STATE_DIR, { recursive: true });

let inMemoryState = '{}';
if (existsSync(STATE_FILE)) {
  try {
    inMemoryState = readFileSync(STATE_FILE, 'utf8') || '{}';
  } catch {
    inMemoryState = '{}';
  }
} else {
  // Touch the file so fs.watch has something to bind to immediately.
  writeFileSync(STATE_FILE, inMemoryState);
}

const sseClients = new Set<Response>();
function broadcastState(json: string) {
  for (const r of sseClients) {
    try {
      r.write(`data: ${json}\n\n`);
    } catch {
      sseClients.delete(r);
    }
  }
}

// fs.watch fires on every write — including our own — so we compare content
// to the in-memory copy to distinguish external edits from echoes.
try {
  watch(STATE_FILE, { persistent: false }, () => {
    try {
      const fresh = readFileSync(STATE_FILE, 'utf8');
      if (fresh && fresh !== inMemoryState) {
        inMemoryState = fresh;
        broadcastState(fresh);
        console.log('[studio-state] external edit detected, broadcast', fresh.length, 'bytes');
      }
    } catch (e) {
      console.warn('[studio-state] watch read failed', (e as Error).message);
    }
  });
} catch (e) {
  // File may not exist yet — re-arm after first write.
  console.warn('[studio-state] watch init failed', (e as Error).message);
}

app.get('/api/studio-state', (_req, res) => {
  res.type('application/json').send(inMemoryState);
});

app.post('/api/studio-state', (req, res) => {
  try {
    const json = JSON.stringify(req.body);
    if (json === inMemoryState) {
      res.json({ ok: true, unchanged: true });
      return;
    }
    inMemoryState = json;
    writeFileSync(STATE_FILE, json);
    // Don't broadcast — sender already has this state. fs.watch will fire
    // for our own write but the content-equality check above will skip it.
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Agent push — always broadcasts to all open browser tabs, overriding whatever
// the browser has. Use this instead of POST /api/studio-state when an external
// agent wants to push a new project state without fighting the browser's debounced
// POST loop.
app.post('/api/studio-state/push', (req, res) => {
  try {
    const json = JSON.stringify(req.body);
    inMemoryState = json;
    writeFileSync(STATE_FILE, json);
    broadcastState(json);
    console.log('[studio-state] agent push broadcast', sseClients.size, 'clients');
    res.json({ ok: true, broadcast: sseClients.size });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/studio-state/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  // Send the current state as the first event so the client can sync immediately.
  res.write(`data: ${inMemoryState}\n\n`);
  sseClients.add(res);
  console.log('[studio-state] sse client connected, total:', sseClients.size);
  req.on('close', () => {
    sseClients.delete(res);
    console.log('[studio-state] sse client disconnected, total:', sseClients.size);
  });
});

// Serve CLAUDE.md as plain text for LLM context discovery (llmstxt.org standard).
// llms.txt (served by Vite static from /public) references this as the full docs URL.
app.get('/llms-full.txt', (_req, res) => {
  const claudeMd = join(SCREENSHOTS_ROOT, 'CLAUDE.md');
  if (!existsSync(claudeMd)) {
    res.status(404).type('text/plain').send('CLAUDE.md not found');
    return;
  }
  res.type('text/plain').send(readFileSync(claudeMd, 'utf8'));
});

const PORT = 5181;
app.listen(PORT, () => {
  console.log(`[aso-studio] api on :${PORT}`);
  // Resume any PPO generations that were in flight when the process last died.
  // No-op if state.json has no `generating` tiles or no fal key configured.
  void ppoResumeAll();
});
