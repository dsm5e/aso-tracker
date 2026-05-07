import { Router } from 'express';
import { fal } from '@fal-ai/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getKey } from '../lib/keys.js';
import { falSubscribeWithProgress } from '../lib/fal-progress.js';
import { toFalUrl } from '../lib/fal-upload.js';

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

const I2V_MODEL = 'fal-ai/kling-video/v3/pro/image-to-video';
const T2V_MODEL = 'fal-ai/kling-video/v3/pro/text-to-video';

router.post('/api/video/kling', async (req, res) => {
  const { prompt, image_url, image_urls, duration, audio, mode, aspect_ratio, node_id,
    multi_prompt, shot_type } = req.body ?? {};
  const m = mode === 'text' ? 'text' : 'image';

  // Allow either a single `image_url` (start frame) or an array `image_urls`.
  // First url → start_image_url, the rest become `elements` referenced as
  // @Element1, @Element2, … in the prompt.
  const refs: string[] = Array.isArray(image_urls) && image_urls.length
    ? image_urls.filter((u) => typeof u === 'string')
    : (image_url ? [image_url] : []);

  // Validate multi_prompt if provided — array of {prompt: string; duration: number}
  // representing distinct shots Kling stitches into a single render.
  const shots = Array.isArray(multi_prompt)
    ? multi_prompt
        .filter((s: any) => s && typeof s.prompt === 'string')
        .map((s: any) => ({ prompt: s.prompt, duration: Number(s.duration) || 5 }))
    : null;

  if (!shots) {
    if (!prompt || typeof prompt !== 'string')
      return res.status(400).json({ ok: false, error: 'prompt required (or pass multi_prompt[])' });
  } else if (shots.length === 0) {
    return res.status(400).json({ ok: false, error: 'multi_prompt must have at least 1 shot' });
  }
  if (m === 'image' && refs.length === 0)
    return res.status(400).json({ ok: false, error: 'image_url(s) required when mode=image' });

  // Total duration: sum of shots if multi-shot, else `duration`. Capped 3-15 by Kling.
  const totalDur = shots
    ? shots.reduce((acc, s) => acc + s.duration, 0)
    : (typeof duration === 'number' && duration >= 3 && duration <= 15 ? duration : 5);
  const aud = audio !== false; // default true
  const ar = aspect_ratio && ['9:16', '16:9', '1:1'].includes(aspect_ratio) ? aspect_ratio : '9:16';
  const t0 = Date.now();

  try {
    configure();
    mkdirSync(VIDEO_DIR, { recursive: true });

    const input: any = {
      duration: String(totalDur),
      generate_audio: aud,
    };
    if (shots) {
      input.multi_prompt = shots.map((s) => ({ prompt: s.prompt, duration: String(s.duration) }));
      input.shot_type = (shot_type === 'intelligent' || shot_type === 'customize') ? shot_type : 'customize';
    } else {
      input.prompt = prompt;
    }
    let modelPath: string;
    if (m === 'image') {
      const falUrls = await Promise.all(refs.map((u) => toFalUrl(absoluteUrl(u, req))));
      input.start_image_url = falUrls[0];
      const extras = falUrls.slice(1);
      if (extras.length) {
        // KlingV3ComboElementInput requires BOTH frontal_image_url AND
        // reference_image_urls. With a single ref we use the same URL in
        // both fields. Reference in prompt as @Element1, @Element2, …
        input.elements = extras.map((u) => ({
          frontal_image_url: u,
          reference_image_urls: [u],
        }));
      }
      modelPath = I2V_MODEL;
    } else {
      input.aspect_ratio = ar;
      modelPath = T2V_MODEL;
    }

    const result = await falSubscribeWithProgress(modelPath, input, { nodeId: node_id });
    const data = (result as { data?: any }).data ?? result;
    const videoUrl = data.video?.url ?? data.video_url ?? data.url;
    if (!videoUrl) throw new Error('no video url in kling response');

    const r = await fetch(videoUrl);
    if (!r.ok) throw new Error(`video fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ts = Date.now();
    const filename = `kling-${m}-${ts}.mp4`;
    const path = join(VIDEO_DIR, filename);
    writeFileSync(path, buf);

    const estimated = totalDur * (aud ? 0.168 : 0.112);
    const actual = data.metrics?.cost ?? data.cost;
    const cost = typeof actual === 'number' ? actual : estimated;
    const elapsed = (Date.now() - t0) / 1000;

    res.json({
      ok: true,
      url: `/output/videos/${filename}`,
      path,
      model: 'kling-v3-pro',
      mode: m,
      duration: totalDur,
      shots: shots?.length ?? 1,
      audio: aud,
      cost,
      elapsed_seconds: elapsed,
    });
  } catch (e) {
    const err = e as Error & { body?: unknown; status?: number };
    console.error('[kling] fal error:', {
      message: err.message,
      status: err.status,
      body: err.body,
    });
    const detail = err.body ? JSON.stringify(err.body) : err.message;
    res.status(500).json({ ok: false, error: detail });
  }
});

export default router;
