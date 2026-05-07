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

const REF_MODEL = 'alibaba/happy-horse/reference-to-video';
const T2V_MODEL = 'alibaba/happy-horse/text-to-video';

router.post('/api/video/happy-horse', async (req, res) => {
  const { prompt, image_urls, duration, resolution, aspect_ratio, mode, node_id } = req.body ?? {};
  const m = mode === 'text' ? 'text' : 'image';

  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ ok: false, error: 'prompt required' });
  if (typeof prompt === 'string' && prompt.length > 2500)
    return res.status(400).json({ ok: false, error: 'prompt max 2500 chars' });

  const refImgs: string[] = Array.isArray(image_urls) ? image_urls.filter((u) => typeof u === 'string') : [];
  if (m === 'image' && refImgs.length === 0)
    return res.status(400).json({ ok: false, error: 'image_urls (non-empty array) required when mode=image' });
  if (refImgs.length > 9) return res.status(400).json({ ok: false, error: 'max 9 reference images' });

  const dur = typeof duration === 'number' && duration >= 3 && duration <= 15 ? duration : 5;
  const reso = ['720p', '1080p'].includes(resolution) ? resolution : '720p';
  const ar = aspect_ratio && ['9:16', '16:9', '1:1', '4:3', '3:4'].includes(aspect_ratio) ? aspect_ratio : '9:16';
  const t0 = Date.now();

  try {
    configure();
    mkdirSync(VIDEO_DIR, { recursive: true });

    const input: any = {
      prompt,
      duration: dur,
      resolution: reso,
      aspect_ratio: ar,
    };
    let modelPath: string;
    if (m === 'image') {
      input.image_urls = await toFalUrls(refImgs.map((u) => absoluteUrl(u, req)));
      modelPath = REF_MODEL;
    } else {
      modelPath = T2V_MODEL;
    }

    const result = await falSubscribeWithProgress(modelPath, input, { nodeId: node_id });
    const data = (result as { data?: any }).data ?? result;
    const videoUrl = data.video?.url ?? data.video_url ?? data.url;
    if (!videoUrl) throw new Error('no video url in happy-horse response');

    const r = await fetch(videoUrl);
    if (!r.ok) throw new Error(`video fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ts = Date.now();
    const filename = `happy-horse-${m}-${ts}.mp4`;
    const path = join(VIDEO_DIR, filename);
    writeFileSync(path, buf);

    const perSec = reso === '1080p' ? 0.28 : 0.14;
    const estimated = dur * perSec;
    const actual = data.metrics?.cost ?? data.cost;
    const cost = typeof actual === 'number' ? actual : estimated;
    const elapsed = (Date.now() - t0) / 1000;

    res.json({
      ok: true,
      url: `/output/videos/${filename}`,
      path,
      model: 'happy-horse',
      mode: m,
      duration: dur,
      resolution: reso,
      cost,
      elapsed_seconds: elapsed,
    });
  } catch (e) {
    const err = e as Error & { body?: unknown; status?: number };
    console.error('[happy-horse] fal error:', { message: err.message, status: err.status, body: err.body });
    const detail = err.body ? JSON.stringify(err.body) : err.message;
    res.status(500).json({ ok: false, error: detail });
  }
});

export default router;
