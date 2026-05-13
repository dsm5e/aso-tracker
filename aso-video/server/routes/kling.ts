// fal-jobs.ts owns fal client config + the resilient queue + poller, so we
// import nothing fal-related here; we just hand it modelPath + input.
import { Router } from 'express';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { submitFalJob, adoptFalJob, cancelFalJob, fetchWithRetry } from '../lib/fal-jobs.js';
import { toFalUrl } from '../lib/fal-upload.js';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const VIDEO_DIR = join(ROOT, 'output', 'videos');

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

    if (!node_id) {
      return res.status(400).json({ ok: false, error: 'node_id required (resilient queue uses it for tracking + recovery)' });
    }

    // Submit to fal queue + persistent tracker. The tracker captures the
    // request_id, polls in the background, and even survives a server
    // restart — the job is rehydrated from disk and continues to be polled
    // until COMPLETED, at which point onComplete fires and we save the mp4.
    let savedFilename = '';
    let savedPath = '';
    let returnedCost: number = totalDur * (aud ? 0.168 : 0.112);
    await submitFalJob<{ data?: unknown }>(modelPath, input, {
      nodeId: node_id,
      onComplete: async (result) => {
        const data = (result as { data?: any }).data ?? result;
        const videoUrl = data.video?.url ?? data.video_url ?? data.url;
        if (!videoUrl) throw new Error('no video url in kling response');

        const buf = await fetchWithRetry(videoUrl, 4);
        const ts = Date.now();
        savedFilename = `kling-${m}-${ts}.mp4`;
        savedPath = join(VIDEO_DIR, savedFilename);
        writeFileSync(savedPath, buf);

        const estimated = totalDur * (aud ? 0.168 : 0.112);
        const actual = (data as { metrics?: { cost?: number }; cost?: number }).metrics?.cost ?? (data as { cost?: number }).cost;
        returnedCost = typeof actual === 'number' ? actual : estimated;

        // Update the node directly so the UI lands on `done` even if the
        // internal fetch from graph.runNode timed out. (Kling 4-5 min runs
        // routinely outlive Node's default fetch timeout, after which
        // runNode would mark the node as 'error: fetch failed' even though
        // the file is being saved fine in the background.)
        try {
          const { updateNode } = await import('../lib/graphStore.js');
          updateNode(node_id, {
            data: {
              status: 'done',
              outputUrl: `/output/videos/${savedFilename}`,
              cost: returnedCost,
              elapsed: (Date.now() - t0) / 1000,
              error: undefined,
              stage: undefined,
              progress: undefined,
            },
          });
        } catch (e) {
          console.warn('[kling] node update from onComplete failed:', (e as Error).message);
        }
      },
    });

    const elapsed = (Date.now() - t0) / 1000;
    res.json({
      ok: true,
      url: `/output/videos/${savedFilename}`,
      path: savedPath,
      model: 'kling-v3-pro',
      mode: m,
      duration: totalDur,
      shots: shots?.length ?? 1,
      audio: aud,
      cost: returnedCost,
      elapsed_seconds: elapsed,
    });
  } catch (e) {
    const err = e as Error & { body?: unknown; status?: number };
    // JSON.stringify so nested `detail` array surfaces in the log (Node's
    // default console.log collapses deep objects into `[Object]`).
    console.error('[kling] fal error:', JSON.stringify({
      message: err.message,
      status: err.status,
      body: err.body,
    }, null, 2));
    const detail = err.body ? JSON.stringify(err.body) : err.message;
    res.status(500).json({ ok: false, error: detail });
  }
});

// Cancel — stop an in-flight fal job for a node so we don't pay for compute
// we no longer want. Used by the "⏹ Stop" / "↻ Regenerate" buttons in the UI.
router.post('/api/video/kling/cancel', async (req, res) => {
  const { node_id } = req.body ?? {};
  if (!node_id) return res.status(400).json({ ok: false, error: 'node_id required' });
  const result = await cancelFalJob(node_id);
  res.json({ ok: result.cancelled, ...result });
});

// Recovery — attach to a previously submitted fal request_id and pull the
// result down. Useful when fal.ai shows the job as completed in their
// dashboard but our state lost track (network blip / server restart that
// missed the rehydrate window / wrong node mapping).
router.post('/api/video/kling/recover', async (req, res) => {
  const { node_id, request_id, mode } = req.body ?? {};
  if (!node_id || !request_id) {
    return res.status(400).json({ ok: false, error: 'node_id + request_id required' });
  }
  const m = mode === 'text' ? 'text' : 'image';
  const modelPath = m === 'image' ? I2V_MODEL : T2V_MODEL;
  const t0 = Date.now();
  try {
    mkdirSync(VIDEO_DIR, { recursive: true });
    let savedFilename = '';
    let savedPath = '';
    let returnedCost: number | undefined;
    await adoptFalJob<{ data?: unknown }>(modelPath, request_id, {
      nodeId: node_id,
      onComplete: async (result) => {
        const data = (result as { data?: any }).data ?? result;
        const videoUrl = data.video?.url ?? data.video_url ?? data.url;
        if (!videoUrl) throw new Error('no video url in kling response');
        const buf = await fetchWithRetry(videoUrl, 4);
        const ts = Date.now();
        savedFilename = `kling-recover-${ts}.mp4`;
        savedPath = join(VIDEO_DIR, savedFilename);
        writeFileSync(savedPath, buf);
        const actual = (data as { metrics?: { cost?: number }; cost?: number }).metrics?.cost ?? (data as { cost?: number }).cost;
        returnedCost = typeof actual === 'number' ? actual : undefined;
      },
    });
    // Recovery flow doesn't go through graph.runNode, so we have to commit
    // status: done + outputUrl onto the node ourselves — otherwise the UI
    // stays stuck on "Interrupted by server restart" even though the file
    // is on disk.
    try {
      const { updateNode } = await import('../lib/graphStore.js');
      updateNode(node_id, {
        data: {
          status: 'done',
          outputUrl: `/output/videos/${savedFilename}`,
          cost: returnedCost ?? 0.84,
          error: undefined,
          stage: undefined,
          progress: undefined,
        },
      });
    } catch (e) {
      console.warn('[kling.recover] node update failed:', (e as Error).message);
    }
    res.json({
      ok: true,
      url: `/output/videos/${savedFilename}`,
      path: savedPath,
      recovered_request_id: request_id,
      cost: returnedCost,
      elapsed_seconds: (Date.now() - t0) / 1000,
    });
  } catch (e) {
    const err = e as Error & { body?: unknown; status?: number };
    console.error('[kling.recover] error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
