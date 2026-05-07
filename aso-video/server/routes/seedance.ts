import { Router } from 'express';
import { fal } from '@fal-ai/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getKey } from '../lib/keys.js';
import { falSubscribeWithProgress } from '../lib/fal-progress.js';
import { toFalUrls } from '../lib/fal-upload.js';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const VIDEO_DIR = join(ROOT, 'output', 'videos');

let configured = false;
function configure() {
  if (configured) return;
  fal.config({ credentials: getKey('FAL_API_KEY') });
  configured = true;
}

function absoluteUrl(image_url: string, req: any): string {
  if (image_url.startsWith('http://') || image_url.startsWith('https://')) return image_url;
  const host = req.get('host');
  const proto = req.protocol;
  return `${proto}://${host}${image_url}`;
}

const REF_MODEL = 'bytedance/seedance-2.0/reference-to-video';
const T2V_MODEL = 'bytedance/seedance-2.0/text-to-video';

// Token-based pricing: $0.014 per 1000 tokens.
// tokens = (h × w × duration × 24) / 1024
function dimsForResolution(reso: string): { w: number; h: number } {
  if (reso === '480p') return { w: 854, h: 480 };
  if (reso === '720p') return { w: 1280, h: 720 };
  return { w: 1920, h: 1080 };
}
function estimateSeedanceCost(reso: string, duration: number, hasVideoRef: boolean): number {
  const { w, h } = dimsForResolution(reso);
  const tokens = (w * h * duration * 24) / 1024;
  let cost = (tokens / 1000) * 0.014;
  if (hasVideoRef) cost *= 0.6;
  return cost;
}

router.post('/api/video/seedance', async (req, res) => {
  const { prompt, image_urls, video_urls, audio_urls, duration, resolution, aspect_ratio, mode, generate_audio, node_id } = req.body ?? {};
  const m = mode === 'text' ? 'text' : 'image';

  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ ok: false, error: 'prompt required' });

  const refImgs: string[] = Array.isArray(image_urls) ? image_urls.filter((u) => typeof u === 'string') : [];
  const refVids: string[] = Array.isArray(video_urls) ? video_urls.filter((u) => typeof u === 'string') : [];
  const refAuds: string[] = Array.isArray(audio_urls) ? audio_urls.filter((u) => typeof u === 'string') : [];

  if (m === 'image' && refImgs.length === 0 && refVids.length === 0)
    return res.status(400).json({ ok: false, error: 'image_urls or video_urls required when mode=image' });
  if (refImgs.length > 9) return res.status(400).json({ ok: false, error: 'max 9 image_urls' });
  if (refVids.length > 3) return res.status(400).json({ ok: false, error: 'max 3 video_urls' });
  if (refAuds.length > 3) return res.status(400).json({ ok: false, error: 'max 3 audio_urls' });

  const dur = typeof duration === 'number' && duration >= 4 && duration <= 15 ? duration : 5;
  const reso = ['480p', '720p', '1080p'].includes(resolution) ? resolution : '480p';
  const ar = aspect_ratio && ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(aspect_ratio) ? aspect_ratio : '9:16';
  const aud = generate_audio !== false;
  const t0 = Date.now();

  try {
    configure();
    mkdirSync(VIDEO_DIR, { recursive: true });

    const input: any = {
      prompt,
      resolution: reso,
      duration: String(dur),
      aspect_ratio: ar,
      generate_audio: aud,
    };
    let modelPath: string;
    if (m === 'image') {
      input.image_urls = await toFalUrls(refImgs.map((u) => absoluteUrl(u, req)));
      if (refVids.length) input.video_urls = await toFalUrls(refVids.map((u) => absoluteUrl(u, req)));
      if (refAuds.length) input.audio_urls = await toFalUrls(refAuds.map((u) => absoluteUrl(u, req)));
      modelPath = REF_MODEL;
    } else {
      modelPath = T2V_MODEL;
    }

    const result = await falSubscribeWithProgress(modelPath, input, { nodeId: node_id });
    const data = (result as { data?: any }).data ?? result;
    const videoUrl = data.video?.url ?? data.video_url ?? data.url;
    if (!videoUrl) throw new Error('no video url in seedance response');

    const r = await fetch(videoUrl);
    if (!r.ok) throw new Error(`video fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ts = Date.now();
    const filename = `seedance-${m}-${ts}.mp4`;
    const path = join(VIDEO_DIR, filename);
    writeFileSync(path, buf);

    const hasVideoRef = m === 'image' && refVids.length > 0;
    const estimated = estimateSeedanceCost(reso, dur, hasVideoRef);
    const actual = data.metrics?.cost ?? data.cost;
    const cost = typeof actual === 'number' ? actual : estimated;
    const elapsed = (Date.now() - t0) / 1000;

    res.json({
      ok: true,
      url: `/output/videos/${filename}`,
      path,
      model: 'seedance-2.0',
      mode: m,
      duration: dur,
      resolution: reso,
      cost,
      elapsed_seconds: elapsed,
    });
  } catch (e) {
    const err = e as Error & { body?: unknown; status?: number };
    console.error('[seedance] fal error:', { message: err.message, status: err.status, body: err.body });
    const detail = err.body ? JSON.stringify(err.body) : err.message;
    res.status(500).json({ ok: false, error: detail });
  }
});

export default router;
