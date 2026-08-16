import { Router } from 'express';
import { fal } from '@fal-ai/client';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getKey } from '../lib/keys.js';
import { falSubscribeWithProgress } from '../lib/fal-progress.js';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const IMG_DIR = join(ROOT, 'output', 'images');

let configured = false;
function configure() {
  if (configured) return;
  fal.config({ credentials: getKey('FAL_API_KEY') });
  configured = true;
}

// Map common aspect ratios to Flux image_size enum.
// fal.ai Flux 1.1 Pro accepts both enum strings and {width, height} objects.
function mapImageSize(aspect_ratio?: string): any {
  const ar = (aspect_ratio || '9:16').trim();
  if (ar === '9:16') return 'portrait_16_9';
  if (ar === '16:9') return 'landscape_16_9';
  if (ar === '1:1') return 'square';
  if (ar === '4:3') return 'landscape_4_3';
  if (ar === '3:4') return 'portrait_4_3';
  // Custom — pass {width, height}. Default to 1080×1920 vertical.
  return { width: 1080, height: 1920 };
}

// gpt-image-2 — OpenAI-style model on fal.ai, image_size + quality control.
function mapGpt2ImageSize(aspect_ratio?: string): any {
  const ar = (aspect_ratio || '9:16').trim();
  if (ar === '9:16') return { width: 1024, height: 1792 };
  if (ar === '16:9') return { width: 1792, height: 1024 };
  if (ar === '1:1') return 'square_hd';
  return { width: 1024, height: 1792 };
}

const GPT2_PRICE: Record<string, number> = { low: 0.011, medium: 0.04, high: 0.17, auto: 0.04 };

function localImageAsDataUri(url: string): string {
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url;
  const relative = url.startsWith('/video/')
    ? join('public', url.slice('/video/'.length))
    : url.startsWith('/output/')
      ? url.slice(1)
      : '';
  if (!relative) throw new Error(`unsupported local image URL: ${url}`);
  const path = join(ROOT, relative);
  if (!existsSync(path)) throw new Error(`input image not found: ${url}`);
  const ext = path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg') ? 'jpeg'
    : path.toLowerCase().endsWith('.webp') ? 'webp' : 'png';
  return `data:image/${ext};base64,${readFileSync(path).toString('base64')}`;
}

router.post('/api/image/gpt-image-2', async (req, res) => {
  const { prompt, aspect_ratio, quality, num_images, node_id } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ ok: false, error: 'prompt required' });
  }
  const q = (quality && ['low', 'medium', 'high', 'auto'].includes(quality)) ? quality : 'medium';
  const n = Math.min(4, Math.max(1, Number(num_images) || 1));
  try {
    configure();
    mkdirSync(IMG_DIR, { recursive: true });
    const result = await falSubscribeWithProgress('openai/gpt-image-2', {
      prompt,
      image_size: mapGpt2ImageSize(aspect_ratio),
      quality: q,
      num_images: n,
      output_format: 'png',
    }, { nodeId: node_id });
    const data = (result as { data?: any }).data ?? result;
    const imgUrl = data.images?.[0]?.url;
    if (!imgUrl) throw new Error('no image url in gpt-image-2 response');

    const r = await fetch(imgUrl);
    if (!r.ok) throw new Error(`image fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ts = Date.now();
    const filename = `gpt2-${ts}.png`;
    const path = join(IMG_DIR, filename);
    writeFileSync(path, buf);

    res.json({
      ok: true,
      url: `/output/images/${filename}`,
      path,
      cost: GPT2_PRICE[q] ?? 0.04,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post('/api/image/edit', async (req, res) => {
  const { prompt, image_url, model, quality, node_id } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ ok: false, error: 'prompt required' });
  if (!image_url || typeof image_url !== 'string') return res.status(400).json({ ok: false, error: 'image_url required' });
  const selected = model === 'gpt-image-2-edit'
    ? 'gpt-image-2-edit'
    : model === 'nano-banana-2-edit'
      ? 'nano-banana-2-edit'
      : 'flux-kontext-pro';
  const q = quality && ['low', 'medium', 'high', 'auto'].includes(quality) ? quality : 'medium';
  try {
    configure();
    mkdirSync(IMG_DIR, { recursive: true });
    const source = localImageAsDataUri(image_url);
    const endpoint = selected === 'gpt-image-2-edit'
      ? 'openai/gpt-image-2/edit'
      : selected === 'nano-banana-2-edit'
        ? 'fal-ai/nano-banana-2/edit'
        : 'fal-ai/flux-pro/kontext';
    const input = selected === 'gpt-image-2-edit'
      ? { prompt, image_urls: [source], image_size: 'auto', quality: q, num_images: 1, output_format: 'png' }
      : selected === 'nano-banana-2-edit'
        ? { prompt, image_urls: [source], aspect_ratio: '9:16', output_format: 'png' }
        : { prompt, image_url: source, num_images: 1, output_format: 'png' };
    const result = await falSubscribeWithProgress(endpoint, input, { nodeId: node_id });
    const data = (result as { data?: any }).data ?? result;
    const imgUrl = data.images?.[0]?.url;
    if (!imgUrl) throw new Error('image edit returned no image');
    const download = await fetch(imgUrl);
    if (!download.ok) throw new Error(`image download failed: ${download.status}`);
    const filename = `hair-edit-${Date.now()}.png`;
    const path = join(IMG_DIR, filename);
    writeFileSync(path, Buffer.from(await download.arrayBuffer()));
    res.json({
      ok: true,
      url: `/output/images/${filename}`,
      path,
      cost: selected === 'flux-kontext-pro' ? 0.04 : (GPT2_PRICE[q] ?? 0.04),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post('/api/image/flux-pro', async (req, res) => {
  const { prompt, aspect_ratio, node_id } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ ok: false, error: 'prompt required' });
  }
  try {
    configure();
    mkdirSync(IMG_DIR, { recursive: true });
    const result = await falSubscribeWithProgress('fal-ai/flux-pro/v1.1', {
      prompt, image_size: mapImageSize(aspect_ratio),
    }, { nodeId: node_id });
    const data = (result as { data?: any }).data ?? result;
    const imgUrl = data.images?.[0]?.url;
    if (!imgUrl) throw new Error('no image url in flux response');

    const r = await fetch(imgUrl);
    if (!r.ok) throw new Error(`image fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ts = Date.now();
    const filename = `flux-${ts}.jpg`;
    const path = join(IMG_DIR, filename);
    writeFileSync(path, buf);

    res.json({
      ok: true,
      url: `/output/images/${filename}`,
      path,
      cost: 0.04,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
