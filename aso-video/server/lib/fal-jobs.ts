// Persistent fal.ai job tracker + background poller.
//
// Why this exists:
// fal.subscribe() opens a single long-lived socket that polls fal.ai for us
// and returns the result. If the socket dies (network blip, tsx restart,
// browser close) — fal keeps generating and charging us, but we lose track
// of the request_id and the result never lands.
//
// This module replaces that with a manual queue.submit + persistent poller:
// 1. submitFalJob() submits to fal queue, captures request_id, persists to
//    disk + writes it onto the node's data so the UI can show it.
// 2. A 6s background poller checks every in-flight job. On COMPLETED it
//    fetches the result, calls onComplete (kling.ts downloads the video
//    + updates the node), removes from tracker.
// 3. On boot the tracker rehydrates from disk so jobs that were running
//    when the server died are picked back up automatically.
// 4. Lets routes block on a job (await waitForJob()) the same way they used
//    to await fal.subscribe — but via the resilient channel.

import { fal } from '@fal-ai/client';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getKey } from './keys.js';
import { updateNode } from './graphStore.js';

interface FalJob {
  nodeId: string;
  modelPath: string;
  requestId: string;
  startedAt: number;
}

interface JobWaiter {
  resolve: (result: unknown) => void;
  reject: (e: Error) => void;
}

const ROOT = join(homedir(), '.aso-studio', 'video');
const JOBS_FILE = join(ROOT, 'fal-jobs.json');
mkdirSync(ROOT, { recursive: true });

let configured = false;
function configure() {
  if (configured) return;
  const key = getKey('FAL_API_KEY');
  console.log(`[fal-jobs] configuring fal client with key ${key.slice(0, 8)}…`);
  fal.config({ credentials: key });
  configured = true;
}

// Map<nodeId, FalJob> — single in-flight job per node. New submits cancel
// old waiters for that node (we don't track multiple parallel runs per node).
const inflight = new Map<string, FalJob>();
// One waiter per node (the route currently awaiting completion).
const waiters = new Map<string, JobWaiter>();
// onComplete handlers to call when a job finishes — set by submitFalJob.
const onCompleteHandlers = new Map<string, (result: unknown) => Promise<void>>();

function persist(): void {
  try {
    const arr = [...inflight.values()];
    writeFileSync(JOBS_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.warn('[fal-jobs] persist failed:', (e as Error).message);
  }
}

function rehydrate(): void {
  if (!existsSync(JOBS_FILE)) return;
  try {
    const raw = readFileSync(JOBS_FILE, 'utf8');
    const arr = JSON.parse(raw) as FalJob[];
    for (const j of arr) {
      if (j && j.nodeId && j.requestId && j.modelPath) {
        inflight.set(j.nodeId, j);
      }
    }
    if (inflight.size > 0) {
      console.log(`[fal-jobs] rehydrated ${inflight.size} in-flight job(s) from disk`);
    }
  } catch (e) {
    console.warn('[fal-jobs] rehydrate failed:', (e as Error).message);
  }
}
rehydrate();

/**
 * Submit a new fal job, persist its request_id, and return a promise that
 * resolves with the result when the background poller marks it COMPLETED.
 *
 * The route can `await` this exactly like the old `fal.subscribe()` call —
 * but the underlying request is now resilient: if the route dies / server
 * restarts, the poller picks the job back up on next boot and the result
 * still lands on the node via the registered onComplete handler.
 */
export async function submitFalJob<T = unknown>(
  modelPath: string,
  input: Record<string, unknown>,
  opts: { nodeId: string; onComplete: (result: T) => Promise<void> },
): Promise<T> {
  console.log(`[fal-jobs] submitFalJob ENTER node=${opts.nodeId} model=${modelPath}`);
  configure();
  const { nodeId, onComplete } = opts;

  // If a job is already in flight for this node, refuse — earlier we
  // overwrote it, which orphaned the running fal job (still ran, still
  // billed, but our state lost the request_id). Operator must explicitly
  // Stop / Regenerate to cancel it first.
  if (inflight.has(nodeId)) {
    const existing = inflight.get(nodeId)!;
    throw new Error(`a fal job is already in flight for this node (request_id ${existing.requestId}). Stop it first or use Regenerate.`);
  }

  console.log(`[fal-jobs] submit ${modelPath} (input keys: ${Object.keys(input).join(',')})`);
  let submission: { request_id: string };
  try {
    submission = await fal.queue.submit(modelPath, { input }) as { request_id: string };
  } catch (e) {
    const err = e as Error & { body?: unknown; status?: number };
    console.error(`[fal-jobs] submit failed: status=${err.status} body=${JSON.stringify(err.body)} message=${err.message}`);
    throw err;
  }
  const requestId = submission.request_id;
  if (!requestId) throw new Error('fal queue.submit did not return request_id');
  console.log(`[fal-jobs] submitted ${modelPath} → ${requestId}`);

  const job: FalJob = { nodeId, modelPath, requestId, startedAt: Date.now() };
  inflight.set(nodeId, job);
  persist();

  // Surface request_id on the node so the UI can show it + so a manual
  // "recover from request_id" round-trip is possible if everything else
  // breaks.
  try {
    updateNode(nodeId, { data: { falRequestId: requestId, falModelPath: modelPath, status: 'loading', stage: 'queued', error: undefined } });
  } catch {}

  onCompleteHandlers.set(nodeId, onComplete as (r: unknown) => Promise<void>);

  return new Promise<T>((resolve, reject) => {
    waiters.set(nodeId, {
      resolve: (r) => resolve(r as T),
      reject,
    });
  });
}

/**
 * Attach to an existing fal request — for recovery when the user has a
 * request_id from the fal dashboard but our state lost it. Treats the
 * request as in-flight and lets the poller pick up the result.
 */
export async function adoptFalJob<T = unknown>(
  modelPath: string,
  requestId: string,
  opts: { nodeId: string; onComplete: (result: T) => Promise<void> },
): Promise<T> {
  configure();
  const { nodeId, onComplete } = opts;
  const oldWaiter = waiters.get(nodeId);
  if (oldWaiter) oldWaiter.reject(new Error('superseded by adoption'));

  const job: FalJob = { nodeId, modelPath, requestId, startedAt: Date.now() };
  inflight.set(nodeId, job);
  persist();
  try {
    updateNode(nodeId, { data: { falRequestId: requestId, falModelPath: modelPath, status: 'loading', stage: 'recovering', error: undefined } });
  } catch {}

  onCompleteHandlers.set(nodeId, onComplete as (r: unknown) => Promise<void>);
  return new Promise<T>((resolve, reject) => {
    waiters.set(nodeId, { resolve: (r) => resolve(r as T), reject });
  });
}

export function listInflight(): FalJob[] {
  return [...inflight.values()];
}

export function cancelTracking(nodeId: string): void {
  inflight.delete(nodeId);
  waiters.delete(nodeId);
  onCompleteHandlers.delete(nodeId);
  persist();
}

/**
 * Cancel an in-flight fal job for a node — calls fal.queue.cancel to stop
 * compute (so we don't keep paying), rejects the waiter so the route 500s,
 * clears tracker. No-op if there's nothing tracked.
 */
export async function cancelFalJob(nodeId: string): Promise<{ cancelled: boolean; requestId?: string; error?: string }> {
  configure();
  const job = inflight.get(nodeId);
  if (!job) return { cancelled: false, error: 'no in-flight job tracked for this node' };
  let cancelOk = false;
  try {
    await fal.queue.cancel(job.modelPath, { requestId: job.requestId });
    cancelOk = true;
  } catch (e) {
    const err = e as Error & { body?: { detail?: unknown }; status?: number };
    // ALREADY_COMPLETED is fine — request already done, just stop tracking.
    const detail = err.body?.detail as string | undefined;
    const text = typeof detail === 'string' ? detail : err.message;
    if (typeof text === 'string' && /completed|finished|not_in_queue|cannot_cancel/i.test(text)) {
      cancelOk = true;
    } else {
      console.warn(`[fal-jobs] cancel failed for ${job.requestId}: ${text}`);
    }
  }
  const waiter = waiters.get(nodeId);
  if (waiter) waiter.reject(new Error('cancelled by user'));
  try {
    updateNode(nodeId, { data: { status: 'idle', stage: undefined, progress: undefined, error: cancelOk ? undefined : 'cancel may have failed', falRequestId: undefined } });
  } catch {}
  cancelTracking(nodeId);
  return { cancelled: cancelOk, requestId: job.requestId };
}

const POLL_INTERVAL_MS = 6_000;
const HARD_TIMEOUT_MS = 1_200_000; // 20 min absolute ceiling

async function pollOne(job: FalJob): Promise<void> {
  configure();
  const age = Date.now() - job.startedAt;
  if (age > HARD_TIMEOUT_MS) {
    finishWithError(job.nodeId, new Error(`fal request exceeded ${HARD_TIMEOUT_MS / 1000}s hard timeout (request_id ${job.requestId})`));
    return;
  }
  let status: { status?: string; logs?: { message?: string }[]; queue_position?: number; progress?: number };
  try {
    status = await fal.queue.status(job.modelPath, { requestId: job.requestId, logs: true }) as never;
  } catch (e) {
    // Transient — surface but don't kill the job. Try again next tick.
    console.warn(`[fal-jobs] poll status failed (transient) ${job.modelPath}/${job.requestId}: ${(e as Error).message}`);
    return;
  }

  // Push progress / stage onto the node so the UI bar moves.
  try {
    const stage = stageFromStatus(status);
    const progress = readProgress(status);
    updateNode(job.nodeId, { data: { stage, progress } });
  } catch {}

  if (status.status === 'COMPLETED') {
    let result: unknown;
    try {
      result = await fal.queue.result(job.modelPath, { requestId: job.requestId });
    } catch (e) {
      finishWithError(job.nodeId, e as Error);
      return;
    }
    const handler = onCompleteHandlers.get(job.nodeId);
    if (handler) {
      try {
        await handler(result);
      } catch (e) {
        finishWithError(job.nodeId, e as Error);
        return;
      }
    }
    const waiter = waiters.get(job.nodeId);
    if (waiter) waiter.resolve(result);
    cancelTracking(job.nodeId);
  }
  // FAILED status surfaces via .error in the response body; check.
  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS' || status.status === 'COMPLETED') return;
  // anything else (FAILED, CANCELLED) → error
  finishWithError(job.nodeId, new Error(`fal job ${job.requestId} ended with status ${status.status ?? 'UNKNOWN'}`));
}

function stageFromStatus(s: { status?: string; queue_position?: number }): string {
  if (s.status === 'IN_QUEUE') {
    return typeof s.queue_position === 'number' ? `queued #${s.queue_position}` : 'queued';
  }
  if (s.status === 'IN_PROGRESS') return 'generating';
  if (s.status === 'COMPLETED') return 'done';
  return 'pending';
}

function readProgress(s: { progress?: number; logs?: { message?: string }[] }): number | undefined {
  if (typeof s.progress === 'number') return s.progress > 1 ? s.progress / 100 : s.progress;
  const logs = s.logs ?? [];
  for (let i = logs.length - 1; i >= 0; i--) {
    const msg = logs[i]?.message ?? '';
    const pct = msg.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pct) return Math.min(1, Math.max(0, Number(pct[1]) / 100));
    const flt = msg.match(/progress[:=]\s*(\d?\.\d+)/i);
    if (flt) return Math.min(1, Math.max(0, Number(flt[1])));
    const ratio = msg.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    if (ratio) {
      const cur = Number(ratio[1]); const tot = Number(ratio[2]);
      if (tot > 0) return Math.min(1, Math.max(0, cur / tot));
    }
  }
  return undefined;
}

function finishWithError(nodeId: string, err: Error): void {
  console.error(`[fal-jobs] ${nodeId} failed: ${err.message}`);
  try {
    updateNode(nodeId, { data: { status: 'error', error: err.message, stage: undefined, progress: undefined } });
  } catch {}
  const waiter = waiters.get(nodeId);
  if (waiter) waiter.reject(err);
  cancelTracking(nodeId);
}

// Background poll loop — single shared timer, walks every inflight job.
setInterval(async () => {
  if (inflight.size === 0) return;
  const jobs = [...inflight.values()];
  for (const job of jobs) {
    pollOne(job).catch((e) => {
      console.error(`[fal-jobs] pollOne crashed for ${job.nodeId}:`, (e as Error).message);
    });
  }
}, POLL_INTERVAL_MS).unref?.();
