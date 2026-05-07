// Graph REST + SSE + node runner. Talks to internal video routes via fetch.
import { Router } from 'express';
import {
  getGraph,
  replaceGraph,
  createNode,
  updateNode,
  deleteNode,
  createEdge,
  deleteEdge,
  addSseClient,
  removeSseClient,
  upstreamFor,
  upstreamsByPrefix,
  autoLayout,
  findNode,
  topoOrder,
  listWorkflows,
  saveWorkflow,
  loadWorkflow,
  deleteWorkflow,
  seedDefaultWorkflowIfMissing,
  type NodeType,
  type GraphNode,
} from '../lib/graphStore.js';

const router = Router();

const PORT = process.env.ASO_VIDEO_PORT || 5191;
const INTERNAL_BASE = `http://localhost:${PORT}`;

const VALID_TYPES = new Set<NodeType>([
  'reference-image',
  'reference-video',
  'flux-image',
  'video-gen',
  'tts-voice',
  'captions',
  'split-screen',
  'image-overlay',
  'end-card',
  'stitch',
  'transcribe',
  'group',
  'output',
]);

// Auto-seeding the bundled `default-dream-ad` workflow on every server boot
// resurrects it after the user explicitly deletes it — confusing behaviour.
// Disabled. The seed remains available via `seedDefaultWorkflowIfMissing()`
// if we ever want a manual reset endpoint.
// seedDefaultWorkflowIfMissing();

// ─── basic CRUD ───────────────────────────────────────────────────────────────

router.get('/api/graph', (_req, res) => {
  res.json(getGraph());
});

router.put('/api/graph', (req, res) => {
  try {
    const next = replaceGraph(req.body);
    res.json(next);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post('/api/graph/nodes', (req, res) => {
  const { type, position, data } = req.body ?? {};
  if (!VALID_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' });
  if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
    return res.status(400).json({ error: 'position {x,y} required' });
  }
  const node = createNode({ type, position, data });
  res.json(node);
});

router.patch('/api/graph/nodes/:id', (req, res) => {
  const updated = updateNode(req.params.id, req.body ?? {});
  if (!updated) return res.status(404).json({ error: 'node not found' });
  res.json(updated);
});

router.delete('/api/graph/nodes/:id', (req, res) => {
  const ok = deleteNode(req.params.id);
  if (!ok) return res.status(404).json({ error: 'node not found' });
  res.json({ ok: true });
});

router.post('/api/graph/edges', (req, res) => {
  const { source, sourceHandle, target, targetHandle } = req.body ?? {};
  if (!source || !target || !sourceHandle || !targetHandle) {
    return res.status(400).json({ error: 'source/target/handles required' });
  }
  const edge = createEdge({ source, sourceHandle, target, targetHandle });
  res.json(edge);
});

router.delete('/api/graph/edges/:id', (req, res) => {
  const ok = deleteEdge(req.params.id);
  if (!ok) return res.status(404).json({ error: 'edge not found' });
  res.json({ ok: true });
});

// ─── SSE ──────────────────────────────────────────────────────────────────────

router.get('/api/graph/stream', (req, res) => {
  addSseClient(res);
  req.on('close', () => removeSseClient(res));
});

// ─── Workflows ────────────────────────────────────────────────────────────────

router.get('/api/graph/workflows', (_req, res) => {
  res.json({ workflows: listWorkflows() });
});

router.post('/api/graph/save-workflow', (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  try {
    const file = saveWorkflow(name);
    res.json({ ok: true, file });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post('/api/graph/load-workflow', (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  try {
    const g = loadWorkflow(name);
    res.json(g);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.delete('/api/graph/workflows/:name', (req, res) => {
  const ok = deleteWorkflow(req.params.name);
  if (!ok) return res.status(404).json({ ok: false, error: 'workflow not found' });
  res.json({ ok: true });
});

// ─── Run a single node ───────────────────────────────────────────────────────

async function runNode(id: string): Promise<GraphNode> {
  const node = findNode(id);
  if (!node) throw new Error('node not found');

  // reference-image / reference-video / output / group are passive — no run.
  if (node.type === 'reference-image' || node.type === 'reference-video' || node.type === 'output' || node.type === 'group') {
    return node;
  }

  // Refuse to run if any upstream isn't yet `done`. Protects the chain from
  // picking up stale or absent outputs from upstream nodes. Reference uploads
  // are "done" once they have a `url` set.
  const graphSnap = getGraph();
  for (const e of graphSnap.edges) {
    if (e.target !== id) continue;
    const src = graphSnap.nodes.find((n) => n.id === e.source);
    if (!src) continue;
    const sd = src.data as { status?: string; label?: string; url?: string };
    const name = sd.label ?? src.type;
    if (src.type === 'reference-image' || src.type === 'reference-video') {
      if (!sd.url) throw new Error(`Upstream "${name}" has no upload yet.`);
      continue;
    }
    if (sd.status === 'loading') {
      throw new Error(`Upstream "${name}" is still running — wait for it to finish.`);
    }
    if (sd.status !== 'done') {
      throw new Error(`Upstream "${name}" hasn't been run yet — run it first.`);
    }
  }

  updateNode(id, { data: { status: 'loading', error: undefined } });

  try {
    if (node.type === 'flux-image') {
      const d = node.data as { prompt?: string; aspectRatio?: string; model?: string; quality?: string };
      if (!d.prompt) throw new Error('prompt required');
      const model = d.model ?? 'gpt-image-2';
      const endpoint = model === 'flux-1.1-pro' ? '/api/image/flux-pro' : '/api/image/gpt-image-2';
      const body: Record<string, unknown> = { prompt: d.prompt, aspect_ratio: d.aspectRatio ?? '9:16', node_id: id };
      if (model === 'gpt-image-2') body.quality = d.quality ?? 'auto';
      const r = await fetch(`${INTERNAL_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; url?: string; cost?: number };
      if (!data.ok) throw new Error(data.error ?? 'image gen failed');
      return updateNode(id, { data: { status: 'done', outputUrl: data.url, cost: data.cost ?? 0.04 } })!;
    }

    if (node.type === 'transcribe') {
      const up = upstreamFor(id, 'video');
      if (!up) throw new Error('transcribe: connect a video upstream');
      const videoUrl = (up.data as { outputUrl?: string; url?: string }).outputUrl ?? (up.data as { url?: string }).url;
      if (!videoUrl) throw new Error('transcribe: upstream has no video — run it first');
      // Reuse the captions transcript route; passes through video URL.
      const r = await fetch(`${INTERNAL_BASE}/api/captions/transcript`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoUrl }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; words?: { text: string; start: number; end: number }[]; cached?: boolean };
      if (!data.ok) throw new Error(data.error ?? 'transcribe failed');
      // Pass video through unchanged, store word list on the node so the UI
      // can render the inline transcript.
      return updateNode(id, { data: { status: 'done', outputUrl: videoUrl, words: data.words ?? [], cached: data.cached, cost: data.cached ? 0 : 0.02 } })!;
    }

    if (node.type === 'stitch') {
      const upA = upstreamFor(id, 'video_a');
      const upB = upstreamFor(id, 'video_b');
      if (!upA) throw new Error('stitch: connect a video to A input');
      if (!upB) throw new Error('stitch: connect a video to B input');
      const a = (upA.data as { outputUrl?: string; url?: string }).outputUrl ?? (upA.data as { url?: string }).url;
      const b = (upB.data as { outputUrl?: string; url?: string }).outputUrl ?? (upB.data as { url?: string }).url;
      if (!a) throw new Error('stitch: A has no video — run upstream first');
      if (!b) throw new Error('stitch: B has no video — run upstream first');
      const r = await fetch(`${INTERNAL_BASE}/api/compose/stitch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoUrlA: a, videoUrlB: b }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; url?: string };
      if (!data.ok) throw new Error(data.error ?? 'stitch failed');
      return updateNode(id, { data: { status: 'done', outputUrl: data.url, cost: 0 } })!;
    }

    if (node.type === 'end-card') {
      const d = node.data as { duration?: number; cta?: string; subtitle?: string; brand?: string };
      const upVideo = upstreamFor(id, 'video');
      if (!upVideo) throw new Error('end-card: connect a video upstream');
      const videoUrl = (upVideo.data as { outputUrl?: string; url?: string }).outputUrl ?? (upVideo.data as { url?: string }).url;
      if (!videoUrl) throw new Error('end-card: upstream has no video — run it first');
      const r = await fetch(`${INTERNAL_BASE}/api/compose/end-card`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          duration: d.duration ?? 3.0,
          cta: d.cta ?? 'Try Dream Free',
          subtitle: d.subtitle ?? 'Decode every dream',
          brand: d.brand ?? 'Dream',
        }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; url?: string };
      if (!data.ok) throw new Error(data.error ?? 'end-card failed');
      return updateNode(id, { data: { status: 'done', outputUrl: data.url, cost: 0 } })!;
    }

    if (node.type === 'image-overlay') {
      const d = node.data as { start?: number; end?: number; position?: string; fadeMs?: number; opacity?: number };
      const upVideo = upstreamFor(id, 'video');
      const upImage = upstreamFor(id, 'image');
      if (!upVideo) throw new Error('image-overlay: connect a video upstream');
      if (!upImage) throw new Error('image-overlay: connect an image upstream');
      const videoUrl = (upVideo.data as { outputUrl?: string; url?: string }).outputUrl ?? (upVideo.data as { url?: string }).url;
      const imageUrl = (upImage.data as { outputUrl?: string; url?: string }).outputUrl ?? (upImage.data as { url?: string }).url;
      if (!videoUrl) throw new Error('image-overlay: video has no output yet — run it first');
      if (!imageUrl) throw new Error('image-overlay: image has no output — generate or upload one');
      const r = await fetch(`${INTERNAL_BASE}/api/compose/image-overlay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          videoUrl, imageUrl,
          start: d.start ?? 2.0,
          end: d.end ?? 3.5,
          position: d.position ?? 'fullscreen',
          fadeMs: d.fadeMs ?? 200,
          opacity: d.opacity ?? 1.0,
        }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; url?: string };
      if (!data.ok) throw new Error(data.error ?? 'image-overlay failed');
      return updateNode(id, { data: { status: 'done', outputUrl: data.url, cost: 0 } })!;
    }

    if (node.type === 'split-screen') {
      const d = node.data as { ratio?: string; audioSource?: string };
      const upTop = upstreamFor(id, 'top');
      const upBot = upstreamFor(id, 'bottom');
      if (!upTop) throw new Error('split-screen: connect a video to TOP input');
      if (!upBot) throw new Error('split-screen: connect a video to BOTTOM input');
      const topUrl = (upTop.data as { outputUrl?: string; url?: string }).outputUrl ?? (upTop.data as { url?: string }).url;
      const bottomUrl = (upBot.data as { outputUrl?: string; url?: string }).outputUrl ?? (upBot.data as { url?: string }).url;
      if (!topUrl) throw new Error('split-screen: top has no video yet — run it first');
      if (!bottomUrl) throw new Error('split-screen: bottom has no video — upload one to Reference Video');
      const r = await fetch(`${INTERNAL_BASE}/api/compose/split-screen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topUrl, bottomUrl,
          ratio: d.ratio ?? '65/35',
          audioSource: d.audioSource ?? 'top',
        }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; url?: string };
      if (!data.ok) throw new Error(data.error ?? 'split-screen failed');
      return updateNode(id, { data: { status: 'done', outputUrl: data.url, cost: 0 } })!;
    }

    if (node.type === 'captions') {
      const d = node.data as { preset?: string; fontSize?: number; marginV?: number };
      const up = upstreamFor(id, 'video');
      if (!up) throw new Error('captions: connect a video upstream');
      const ud = up.data as { outputUrl?: string };
      if (!ud.outputUrl) throw new Error('captions: upstream video has no output yet — run it first');
      const r = await fetch(`${INTERNAL_BASE}/api/captions/burn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          videoUrl: ud.outputUrl,
          preset: d.preset ?? 'capcut-classic',
          fontSize: d.fontSize ?? 64,
          marginV: d.marginV ?? 280,
        }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; url?: string };
      if (!data.ok) throw new Error(data.error ?? 'captions failed');
      return updateNode(id, { data: { status: 'done', outputUrl: data.url, cost: 0.01 } })!;
    }

    if (node.type === 'tts-voice') {
      const d = node.data as { text?: string; voice?: string };
      if (!d.text) throw new Error('text required');
      const r = await fetch(`${INTERNAL_BASE}/api/voiceover/tiktok-tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: d.text, voice: d.voice ?? 'en_female_emotional' }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; url?: string };
      if (!data.ok) throw new Error(data.error ?? 'tts failed');
      return updateNode(id, { data: { status: 'done', outputUrl: data.url, cost: 0 } })!;
    }

    if (node.type === 'video-gen') {
      const d = node.data as {
        model: 'kling' | 'seedance' | 'happy-horse';
        mode: 'image' | 'text';
        resolution: '480p' | '720p' | '1080p';
        prompt?: string;
        duration: number;
        audio: boolean;
      };
      // Resolve image inputs via upstream edges if mode=image.
      // Handles: image_url, image_url_2, image_url_3, … — sorted ascending.
      let imageUrls: string[] = [];
      if (d.mode === 'image') {
        const ups = upstreamsByPrefix(id, 'image_url');
        for (const up of ups) {
          const ud = up.data as { outputUrl?: string; url?: string };
          const u = ud.outputUrl ?? ud.url;
          if (u) imageUrls.push(u);
        }
        if (imageUrls.length === 0) {
          throw new Error('image input required (connect a reference-image or image-gen node to image_url handle)');
        }
      }
      const imageUrl = imageUrls[0];
      // Resolve prompt via edge if connected, else use node prompt.
      let prompt = d.prompt;
      const promptUp = upstreamFor(id, 'prompt');
      if (promptUp) {
        const pd = promptUp.data as { prompt?: string; text?: string };
        prompt = pd.prompt ?? pd.text ?? prompt;
      }
      // In multi-shot mode the per-shot prompts replace the single prompt;
      // only require `prompt` for non-multi-shot runs.
      const multiShotData = (node.data as { multiShot?: boolean; shots?: { prompt: string }[] });
      const isMultiShot = !!multiShotData.multiShot && Array.isArray(multiShotData.shots) && multiShotData.shots.length > 0;
      if (!prompt && !isMultiShot) throw new Error('prompt required');

      let endpoint: string;
      let body: Record<string, unknown>;
      if (d.model === 'kling') {
        endpoint = '/api/video/kling';
        const multiShot = (node.data as { multiShot?: boolean }).multiShot;
        const shots = (node.data as { shots?: { prompt: string; duration: number }[] }).shots;
        const shotType = (node.data as { shotType?: string }).shotType ?? 'customize';
        body = {
          duration: d.duration, audio: d.audio, mode: d.mode,
          aspect_ratio: '9:16', node_id: id,
          ...(d.mode === 'image' ? { image_urls: imageUrls } : {}),
          ...(multiShot && Array.isArray(shots) && shots.length
            ? { multi_prompt: shots, shot_type: shotType }
            : { prompt }),
        };
      } else if (d.model === 'seedance') {
        endpoint = '/api/video/seedance';
        body = {
          prompt, duration: d.duration, resolution: d.resolution,
          aspect_ratio: '9:16', generate_audio: d.audio, mode: d.mode, node_id: id,
          ...(d.mode === 'image' ? { image_urls: imageUrls } : {}),
        };
      } else {
        endpoint = '/api/video/happy-horse';
        body = {
          prompt, duration: d.duration, resolution: d.resolution,
          aspect_ratio: '9:16', mode: d.mode, node_id: id,
          ...(d.mode === 'image' ? { image_urls: imageUrls } : {}),
        };
      }

      const r = await fetch(`${INTERNAL_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; url?: string; cost?: number; elapsed_seconds?: number };
      if (!data.ok) throw new Error(data.error ?? 'video gen failed');

      return updateNode(id, {
        data: {
          status: 'done',
          outputUrl: data.url,
          cost: data.cost,
          elapsed: data.elapsed_seconds,
        },
      })!;
    }
    return node;
  } catch (e) {
    const msg = (e as Error).message;
    updateNode(id, { data: { status: 'error', error: msg } });
    throw e;
  }
}

router.post('/api/graph/nodes/:id/run', async (req, res) => {
  try {
    const node = await runNode(req.params.id);
    res.json(node);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.post('/api/graph/auto-layout', (_req, res) => {
  autoLayout();
  res.json({ ok: true });
});

router.post('/api/graph/run-all', async (req, res) => {
  const force = !!(req.body && req.body.force);
  const order = topoOrder();
  const ran: string[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const id of order) {
    const n = findNode(id);
    if (!n) continue;
    if (n.type === 'reference-image' || n.type === 'output') continue;
    if (!force && (n.data as { status?: string }).status === 'done') continue;
    try {
      await runNode(id);
      ran.push(id);
    } catch (e) {
      errors.push({ id, error: (e as Error).message });
    }
  }
  res.json({ ok: errors.length === 0, ran, errors });
});

export default router;
