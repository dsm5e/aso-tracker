import express from 'express';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import tiktokTts from './routes/tiktok-tts.js';
import whisper from './routes/whisper.js';
import flux from './routes/flux.js';
import kling from './routes/kling.js';
import seedance from './routes/seedance.js';
import happyHorse from './routes/happy-horse.js';
import upload from './routes/upload.js';
import graph from './routes/graph.js';
import library from './routes/library.js';
import influencers from './routes/influencers.js';
import captions from './routes/captions.js';
import splitScreen from './routes/split-screen.js';
import imageOverlay from './routes/image-overlay.js';
import endCard from './routes/end-card.js';
import stitch from './routes/stitch.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = 5191;
const ROOT = resolve(import.meta.dirname, '..');

// Ensure output dirs exist
for (const sub of ['videos', 'images', 'uploads', 'audio', 'audio/voices']) {
  mkdirSync(join(ROOT, 'output', sub), { recursive: true });
}

// Static — generated audio/captions/videos/images live under output/
app.use('/output', express.static(resolve(ROOT, 'output')));

// Curated influencer preview images shipped in the repo at aso-video/influencer/.
// JSON metadata for each character (`<name>.json`) sits in the same folder and
// references its image as `/influencer/<name>.jpg` so this is the path that
// resolves it. Cached for a day — content only changes on git pull.
app.use('/influencer', express.static(resolve(ROOT, 'influencer'), { maxAge: '1d' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'aso-video', phase: 'V1.5' });
});

// V1 routes
app.use(tiktokTts);
app.use(whisper);

// V1.5 routes — image-to-video comparison
app.use(flux);
app.use(kling);
app.use(seedance);
app.use(happyHorse);
app.use(upload);

// V2 — node graph editor
app.use(graph);

// Library — surface output/* files for the UI sidebar.
app.use(library);

// Saved character presets ("influencers") — prompt + image pairs.
app.use(influencers);

// Captions — whisper + ffmpeg burn-in for TikTok-style subtitles.
app.use(captions);

// Split-screen compositor — stack talking head over filler/b-roll video.
app.use(splitScreen);

// Image overlay — burn an image onto a video for a time range w/ fade.
app.use(imageOverlay);

// End Card — Remotion-rendered branded outro concatenated to the video tail.
app.use(endCard);

// Stitch — concat two videos end-to-end (split-render workaround).
app.use(stitch);

// POST /api/render — kicks off CLI render of the DreamAd composition.
app.post('/api/render', (_req, res) => {
  const child = spawn('npm', ['run', 'render'], { cwd: ROOT, detached: true, stdio: 'ignore' });
  child.unref();
  res.json({ ok: true, message: `render spawned pid=${child.pid}` });
});

app.listen(PORT, () => {
  console.log(`[aso-video] api on :${PORT}`);
});
