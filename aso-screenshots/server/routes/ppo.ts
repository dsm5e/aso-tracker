import type { Request, Response } from 'express';
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fal } from '@fal-ai/client';
import sharp from 'sharp';
import { getKey } from '../lib/keys.js';

/** Mirror of the editor state the SSE bridge in server/index.ts watches. We
 *  poke it on success/failure so the result outlives a browser navigation
 *  AND a server restart (queue.submit returns a request_id we can resume). */
const STATE_FILE = join(homedir(), '.aso-studio', 'state.json');
const FAL_ENDPOINT = 'openai/gpt-image-2/edit' as const;
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS = 5 * 60 * 1000; // 5 minutes — fal usually finishes in 25-35s

interface PPOGenerationPatch {
  aiImageUrl?: string;
  lastPrompt?: string;
  generateState?: 'idle' | 'generating' | 'done' | 'error';
  errorMessage?: string | null;
  /** When set, append this URL to the slot's aiHistory (cap 8). */
  appendHistoryUrl?: string;
  /** null clears the field (used on done/error). */
  requestId?: string | null;
  requestEndpoint?: string | null;
  requestStartedAt?: string | null;
}

function persistPPOResult(strategyId: string, screenId: string, patch: PPOGenerationPatch): void {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(raw) as {
      ppo?: {
        strategies?: Array<{
          id: string;
          generations?: Record<string, Record<string, unknown>>;
        }>;
      };
    };
    const strategy = state.ppo?.strategies?.find((s) => s.id === strategyId);
    if (!strategy) {
      console.warn('[ppo] persist: strategy not found', strategyId);
      return;
    }
    const gens = strategy.generations ?? {};
    const prev = (gens[screenId] as Record<string, unknown> | undefined) ?? {};
    const next: Record<string, unknown> = { ...prev };
    if (patch.aiImageUrl !== undefined) next.aiImageUrl = patch.aiImageUrl;
    if (patch.lastPrompt !== undefined) next.lastPrompt = patch.lastPrompt;
    if (patch.generateState !== undefined) next.generateState = patch.generateState;
    if (patch.errorMessage !== undefined) next.errorMessage = patch.errorMessage ?? undefined;
    if (patch.requestId !== undefined) {
      if (patch.requestId === null) delete next.requestId;
      else next.requestId = patch.requestId;
    }
    if (patch.requestEndpoint !== undefined) {
      if (patch.requestEndpoint === null) delete next.requestEndpoint;
      else next.requestEndpoint = patch.requestEndpoint;
    }
    if (patch.requestStartedAt !== undefined) {
      if (patch.requestStartedAt === null) delete next.requestStartedAt;
      else next.requestStartedAt = patch.requestStartedAt;
    }
    if (patch.appendHistoryUrl) {
      const prevHist = (prev.aiHistory as string[] | undefined) ?? [];
      next.aiHistory = [...prevHist, patch.appendHistoryUrl].slice(-8);
    }
    gens[screenId] = next;
    strategy.generations = gens;
    writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e) {
    console.warn('[ppo] persist failed:', (e as Error).message);
  }
}

function stripDataUri(s: string): string {
  return s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
}

function clearTrackingFields(): PPOGenerationPatch {
  return { requestId: null, requestEndpoint: null, requestStartedAt: null };
}

/** Track-set so the same tile-task can't be resumed twice (boot recovery + a
 *  fresh /generate call would otherwise both poll the same requestId). Keyed
 *  as `${strategyId}:${screenId}`. */
const inFlightTiles = new Set<string>();

function tileKey(strategyId: string, screenId: string): string {
  return `${strategyId}:${screenId}`;
}

/** Background polling loop. Runs after we've already responded to the HTTP
 *  client — its only job is to write the eventual result back to state.json
 *  so the browser sees it via SSE. Survives browser navigation by definition;
 *  survives server restart via ppoResumeAll() on boot. */
async function pollPPORequest(
  strategyId: string,
  screenId: string,
  endpoint: string,
  requestId: string,
  startedAtMs: number,
): Promise<void> {
  const key = tileKey(strategyId, screenId);
  if (inFlightTiles.has(key)) {
    console.log('[ppo] poll already running for', key, '— skip duplicate');
    return;
  }
  inFlightTiles.add(key);

  try {
    while (true) {
      if (Date.now() - startedAtMs > MAX_POLL_MS) {
        console.error('[ppo] poll TIMEOUT for', key, requestId, '(>5min still pending)');
        persistPPOResult(strategyId, screenId, {
          generateState: 'error',
          errorMessage: 'timeout (>5min still pending on fal)',
          ...clearTrackingFields(),
        });
        return;
      }

      let status: { status?: string } = {};
      try {
        status = (await fal.queue.status(endpoint, { requestId })) as { status?: string };
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        // 404 from fal = the request was lost or expired — bail.
        if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
          persistPPOResult(strategyId, screenId, {
            generateState: 'error',
            errorMessage: `fal request lost: ${msg}`,
            ...clearTrackingFields(),
          });
          return;
        }
        console.warn('[ppo] poll status transient error:', msg, '— retry');
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      const s = (status.status ?? '').toUpperCase();
      console.log(`[ppo] poll ${key} → ${s}`);

      if (s === 'COMPLETED') {
        // Retry the result fetch — fal occasionally returns 5xx between
        // queue.status=COMPLETED and queue.result, even though the image is
        // already produced. 3 attempts with 2s/4s backoff covers most blips.
        let resultErr: string | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = (await fal.queue.result(endpoint, { requestId })) as {
              data?: { images?: Array<{ url: string }> };
            };
            const imageUrl = result.data?.images?.[0]?.url;
            if (imageUrl) {
              persistPPOResult(strategyId, screenId, {
                aiImageUrl: imageUrl,
                generateState: 'done',
                errorMessage: null,
                appendHistoryUrl: imageUrl,
                ...clearTrackingFields(),
              });
              return;
            }
            resultErr = 'no image in fal response';
            break;
          } catch (e) {
            resultErr = (e as Error).message ?? String(e);
            console.warn(`[ppo] ${key} result fetch attempt ${attempt}/3 failed: ${resultErr}`);
            if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
          }
        }
        console.error(`[ppo] ${key} result fetch FAILED after retries: ${resultErr}`);
        persistPPOResult(strategyId, screenId, {
          generateState: 'error',
          errorMessage: `result fetch: ${resultErr}`,
          ...clearTrackingFields(),
        });
        return;
      }

      if (s === 'FAILED' || s === 'CANCELED' || s === 'ERROR') {
        console.error(`[ppo] ${key} fal returned terminal status: ${s}`);
        persistPPOResult(strategyId, screenId, {
          generateState: 'error',
          errorMessage: `fal status: ${s}`,
          ...clearTrackingFields(),
        });
        return;
      }

      // IN_QUEUE / IN_PROGRESS — keep waiting.
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } finally {
    inFlightTiles.delete(key);
  }
}

/** POST /api/ppo/generate
 *  Body: { strategyId, screenId, prompt, inputDataUri, device? }
 *  Returns: 202 { requestId } as soon as the job is submitted to fal — the
 *           actual rendering happens off-request and the result is written to
 *           state.json (broadcast via SSE).
 */
export async function ppoGenerate(req: Request, res: Response): Promise<void> {
  const body = req.body as {
    strategyId?: string;
    screenId?: string;
    prompt?: string;
    inputDataUri?: string;
    device?: 'iphone' | 'ipad';
  };
  if (!body.strategyId || !body.screenId || !body.prompt || !body.inputDataUri) {
    res.status(400).json({ error: 'strategyId, screenId, prompt, inputDataUri required' });
    return;
  }
  const { strategyId, screenId } = body;
  const prompt = body.prompt;
  const device = body.device ?? 'iphone';

  // Optimistic state — UI will show spinner immediately.
  persistPPOResult(strategyId, screenId, {
    generateState: 'generating',
    lastPrompt: prompt,
    errorMessage: null,
  });

  let key: string;
  try {
    key = getKey('FAL_API_KEY');
  } catch {
    persistPPOResult(strategyId, screenId, {
      generateState: 'error',
      errorMessage: 'fal.ai API key missing — open Settings and paste it',
    });
    res.status(401).json({ error: 'FAL_API_KEY missing' });
    return;
  }
  fal.config({ credentials: key });

  let sourceUrl: string;
  try {
    const buf = Buffer.from(stripDataUri(body.inputDataUri), 'base64');
    const file = new File([buf], 'source.png', { type: 'image/png' });
    sourceUrl = await fal.storage.upload(file);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error('[ppo] source upload failed:', msg);
    persistPPOResult(strategyId, screenId, {
      generateState: 'error',
      errorMessage: `upload failed: ${msg}`,
    });
    res.status(502).json({ error: 'source upload failed', detail: msg });
    return;
  }

  const falInput = {
    prompt,
    image_urls: [sourceUrl],
    image_size: device === 'ipad' ? { width: 768, height: 1024 } : { width: 768, height: 1664 },
    quality: 'medium',
    output_format: 'png',
    num_images: 1,
  };

  let submission: { request_id: string };
  try {
    submission = (await fal.queue.submit(FAL_ENDPOINT, { input: falInput })) as { request_id: string };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error('[ppo] queue.submit failed:', msg);
    persistPPOResult(strategyId, screenId, {
      generateState: 'error',
      errorMessage: `submit failed: ${msg}`,
    });
    res.status(502).json({ error: 'submit failed', detail: msg });
    return;
  }

  const startedAt = new Date().toISOString();
  persistPPOResult(strategyId, screenId, {
    generateState: 'generating',
    requestId: submission.request_id,
    requestEndpoint: FAL_ENDPOINT,
    requestStartedAt: startedAt,
  });

  console.log(`[ppo] submitted ${tileKey(strategyId, screenId)} → ${submission.request_id}`);

  // Fire-and-forget poller. Response goes back immediately so the client isn't
  // tied to the lifetime of this fetch — a browser refresh or the request
  // being killed mid-flight no longer matters.
  void pollPPORequest(
    strategyId,
    screenId,
    FAL_ENDPOINT,
    submission.request_id,
    Date.parse(startedAt),
  );

  res.status(202).json({ requestId: submission.request_id });
}

/** GET /api/ppo/proxy-image?url=... — fetches a remote image (typically a fal
 *  CDN URL) and pipes the bytes through. Browser fetch on fal URLs may fail
 *  CORS depending on origin/cookies; this server-side proxy sidesteps it so
 *  the export ZIP can grab the image bytes reliably. Only image content-types
 *  are returned. URL allowlist: must be https. */
export async function ppoProxyImage(req: Request, res: Response): Promise<void> {
  const raw = req.query.url;
  const url = typeof raw === 'string' ? raw : '';
  if (!url || !/^https:\/\//i.test(url)) {
    res.status(400).json({ error: 'https url required' });
    return;
  }
  // Optional ?w=400 → resize to a thumbnail JPEG (q=75). Used by PPO tiles to
  // load fast — gpt-image-2 outputs are 768×1664 PNGs and rendering 20 of them
  // in the dashboard kills perf even at this size. Export uses ?exportSize=
  // (see below) instead.
  const wParam = typeof req.query.w === 'string' ? parseInt(req.query.w, 10) : NaN;
  const targetW = Number.isFinite(wParam) && wParam > 0 && wParam <= 2048 ? wParam : null;

  // Optional ?exportSize=appstore-iphone | appstore-ipad → upscale to exact
  // App Store Connect upload dimensions. gpt-image-2 returns 768×1664 (iPhone
  // 9:19.5 ratio) but ASC requires 1290×2796 / 2796×1290 / 1320×2868 / etc.
  // We always upscale to 1290×2796 (iPhone 6.9") or 2064×2752 (iPad 13") via
  // sharp (Lanczos), keeping PNG so quality stays intact for App Store review.
  const exportSize = typeof req.query.exportSize === 'string' ? req.query.exportSize : '';
  const ASC_DIMS: Record<string, { width: number; height: number }> = {
    'appstore-iphone': { width: 1290, height: 2796 },
    'appstore-ipad': { width: 2064, height: 2752 },
  };
  const ascTarget = ASC_DIMS[exportSize] ?? null;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
      return;
    }
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      res.status(415).json({ error: `not an image: ${contentType}` });
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (ascTarget) {
      // Force-fit to exact App Store dimensions. fit:'fill' ignores aspect
      // ratio — acceptable here because gpt-image-2's 768×1664 output is
      // ~0.04% off from ASC's 1290×2796 ratio (visually unnoticeable).
      const out = await sharp(buf)
        .resize({ width: ascTarget.width, height: ascTarget.height, fit: 'fill' })
        .png({ compressionLevel: 9 })
        .toBuffer();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(out);
      return;
    }
    if (targetW) {
      const thumb = await sharp(buf).resize({ width: targetW }).jpeg({ quality: 75 }).toBuffer();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(thumb);
      return;
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message ?? 'proxy fetch failed' });
  }
}

/** Boot-time recovery. Scans state.json for tiles still marked `generating`:
 *   - if they have a stored requestId → resume polling fal queue
 *   - if they don't (request never made it to fal before crash) → mark error
 *  Called from server/index.ts after listen(). */
export async function ppoResumeAll(): Promise<void> {
  if (!existsSync(STATE_FILE)) return;
  let raw: string;
  try {
    raw = readFileSync(STATE_FILE, 'utf8');
  } catch {
    return;
  }
  let state: {
    ppo?: {
      strategies?: Array<{
        id: string;
        generations?: Record<
          string,
          {
            generateState?: string;
            requestId?: string;
            requestEndpoint?: string;
            requestStartedAt?: string;
          }
        >;
      }>;
    };
  };
  try {
    state = JSON.parse(raw);
  } catch {
    return;
  }
  const strategies = state.ppo?.strategies ?? [];
  if (strategies.length === 0) return;

  let key: string;
  try {
    key = getKey('FAL_API_KEY');
  } catch {
    console.warn('[ppo] resume skipped: no FAL_API_KEY');
    return;
  }
  fal.config({ credentials: key });

  let resumed = 0;
  let stranded = 0;
  for (const strategy of strategies) {
    const gens = strategy.generations ?? {};
    for (const screenId of Object.keys(gens)) {
      const g = gens[screenId];
      if (g.generateState !== 'generating') continue;
      if (g.requestId && g.requestEndpoint) {
        const startedAtMs = g.requestStartedAt ? Date.parse(g.requestStartedAt) : Date.now();
        void pollPPORequest(strategy.id, screenId, g.requestEndpoint, g.requestId, startedAtMs);
        resumed += 1;
      } else {
        // Pre-submit crash — no requestId stored, can't recover. Mark stranded.
        persistPPOResult(strategy.id, screenId, {
          generateState: 'error',
          errorMessage: 'interrupted before fal submission — click Generate again',
        });
        stranded += 1;
      }
    }
  }
  if (resumed > 0 || stranded > 0) {
    console.log(`[ppo] boot recovery: resumed=${resumed} stranded=${stranded}`);
  }
}
