// Shared wrapper around fal.subscribe that streams queue/progress updates
// back to a graph node so the UI can render a progress bar.
//
// Usage from a route:
//   const result = await falSubscribeWithProgress(modelPath, input, { nodeId });
import { fal } from '@fal-ai/client';
import { updateNode } from './graphStore.js';

interface ProgressOpts {
  /** If set, progress/stage are written into the node's data.progress / data.stage. */
  nodeId?: string;
}

interface FalLog {
  message?: string;
  level?: string;
  timestamp?: string;
}

interface FalQueueUpdate {
  status?: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
  queue_position?: number;
  logs?: FalLog[];
  // Some models also emit `progress` directly as a number 0..1 or 0..100
  progress?: number;
}

/**
 * Extract a 0..1 progress value from a fal queue update.
 *
 * Different fal-hosted models log progress in wildly different formats; this
 * walks logs in reverse and matches whichever pattern hits first:
 *   - explicit `progress` field on the update
 *   - "12.5 %" / "12%" / "progress: 0.45"
 *   - "step 12/50" / "frame 100/240" (any X/Y form)
 *   - tqdm bars: "12/50 [00:42<...]"
 */
function readProgress(update: FalQueueUpdate): number | undefined {
  if (typeof update.progress === 'number') {
    return update.progress > 1 ? update.progress / 100 : update.progress;
  }
  const logs = update.logs ?? [];
  for (let i = logs.length - 1; i >= 0; i--) {
    const msg = logs[i]?.message ?? '';
    // Direct percentage
    const pct = msg.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pct) return Math.min(1, Math.max(0, Number(pct[1]) / 100));
    // Floating progress 0..1
    const flt = msg.match(/progress[:=]\s*(\d?\.\d+)/i);
    if (flt) return Math.min(1, Math.max(0, Number(flt[1])));
    // step/frame X/Y or tqdm "X/Y"
    const ratio = msg.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (ratio) {
      const cur = Number(ratio[1]); const tot = Number(ratio[2]);
      if (tot > 0) return Math.min(1, Math.max(0, cur / tot));
    }
  }
  return undefined;
}

function readStage(update: FalQueueUpdate): string {
  if (update.status === 'IN_QUEUE') {
    const pos = update.queue_position;
    return typeof pos === 'number' ? `queued #${pos}` : 'queued';
  }
  if (update.status === 'IN_PROGRESS') return 'generating';
  if (update.status === 'COMPLETED') return 'done';
  return 'pending';
}

/**
 * Best-effort extraction of a useful error message from whatever the fal
 * client throws. The client wraps a 422 in `ApiError` whose useful payload
 * (validation details) lives inside `.body.detail` — but the property is
 * non-enumerable on some versions, so plain JSON.stringify drops it.
 */
function extractFalError(err: unknown): string {
  if (!err) return 'unknown error';
  const e = err as { message?: string; status?: number; body?: any; response?: any };
  // Surface validation detail array as one-liner if present
  const body = e.body ?? e.response;
  if (body) {
    if (Array.isArray(body.detail)) {
      return body.detail.map((d: any) => d.msg ?? JSON.stringify(d)).join('; ');
    }
    if (typeof body.detail === 'string') return body.detail;
    if (typeof body === 'string') return body;
    try { return JSON.stringify(body); } catch {}
  }
  // Walk all own + inherited props to grab anything useful
  const props: Record<string, unknown> = {};
  for (const k of Object.getOwnPropertyNames(e)) props[k] = (e as any)[k];
  return e.message
    ? `${e.message}${e.status ? ` (HTTP ${e.status})` : ''}`
    : JSON.stringify(props);
}

// Watchdog window: if fal sends no queue updates for this long while a job
// is in-flight, we consider it stalled and abort with an explicit error
// instead of letting the route hang on `await fal.subscribe`.
//
// Real Kling 15s renders take 3-7 min and stream queue updates throughout,
// so 5 min of silence is a strong signal the job is stuck — but we leave
// room for slower deep-inference moments.
const STALE_TIMEOUT_MS = 300_000;     // 5 min silence → fail
const HARD_TIMEOUT_MS = 900_000;      // 15 min absolute ceiling

export async function falSubscribeWithProgress<T = unknown>(
  modelPath: string,
  input: Record<string, unknown>,
  opts: ProgressOpts = {},
): Promise<T> {
  let lastUpdateAt = Date.now();
  const startedAt = Date.now();
  let stalledTimer: NodeJS.Timeout | null = null;
  let stalled = false;

  // Promise wrapper that races fal.subscribe against the watchdog.
  const watchdog = new Promise<never>((_, reject) => {
    const tick = () => {
      const sinceUpdate = Date.now() - lastUpdateAt;
      const total = Date.now() - startedAt;
      if (total > HARD_TIMEOUT_MS) {
        stalled = true;
        return reject(new Error(`fal request exceeded ${HARD_TIMEOUT_MS / 1000}s hard timeout`));
      }
      if (sinceUpdate > STALE_TIMEOUT_MS) {
        stalled = true;
        return reject(new Error(`fal silent for ${Math.round(sinceUpdate / 1000)}s — job appears stalled`));
      }
      stalledTimer = setTimeout(tick, 5_000);
    };
    stalledTimer = setTimeout(tick, 5_000);
  });

  try {
    const subscribePromise = fal.subscribe(modelPath, {
      input,
      logs: true,
      onQueueUpdate: (update: FalQueueUpdate) => {
        lastUpdateAt = Date.now();
        const lastLog = update.logs?.[update.logs.length - 1]?.message;
        if (lastLog) console.log(`[fal-progress ${modelPath.split('/').slice(-2).join('/')}] ${lastLog.slice(0, 160)}`);

        if (!opts.nodeId) return;
        const progress = readProgress(update);
        const stage = readStage(update);
        try {
          updateNode(opts.nodeId, { data: { progress, stage } });
        } catch {
          // updateNode throws if node is gone — silently ignore.
        }
      },
    });
    const result = await Promise.race([subscribePromise, watchdog]);
    if (stalledTimer) clearTimeout(stalledTimer);
    if (opts.nodeId) {
      try { updateNode(opts.nodeId, { data: { progress: undefined, stage: undefined } }); } catch {}
    }
    return result as T;
  } catch (e) {
    if (stalledTimer) clearTimeout(stalledTimer);
    const detail = stalled ? (e as Error).message : extractFalError(e);
    console.error(`[fal-error ${modelPath}] ${detail}`);
    const wrapped = new Error(detail);
    (wrapped as any).original = e;
    throw wrapped;
  }
}
