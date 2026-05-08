// Graph store — file-backed, atomic writes, SSE broadcast.
// State path: ~/.aso-studio/video/graph.json. Workflows: ~/.aso-studio/video/workflows/.
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  renameSync,
  chmodSync,
  unlinkSync,
  watch as fsWatch,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';

export type NodeType =
  | 'reference-image'
  | 'reference-video'
  | 'flux-image'
  | 'video-gen'
  | 'tts-voice'
  | 'captions'
  | 'split-screen'
  | 'image-overlay'
  | 'end-card'
  | 'stitch'
  | 'video-overlay'
  | 'transcribe'
  | 'group'
  | 'output';

export interface GraphNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface Graph {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: { updatedAt: number; totalCost: number };
}

const ROOT = join(homedir(), '.aso-studio', 'video');
const STATE_FILE = join(ROOT, 'graph.json');
const WORKFLOWS_DIR = join(ROOT, 'workflows');
const ACTIVE_NAME_FILE = join(ROOT, 'active-workflow');

mkdirSync(ROOT, { recursive: true });
mkdirSync(WORKFLOWS_DIR, { recursive: true });

function emptyGraph(): Graph {
  return {
    version: 1,
    nodes: [],
    edges: [],
    meta: { updatedAt: 0, totalCost: 0 },
  };
}

let graph: Graph = emptyGraph();
if (existsSync(STATE_FILE)) {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    if (raw.trim()) graph = JSON.parse(raw);
  } catch (e) {
    console.warn('[graph] failed to parse existing graph.json, starting empty:', (e as Error).message);
  }
} else {
  persist();
}

// On server boot, any node still marked as `loading` was interrupted (tsx
// restart, crash, deploy). Mark those as `error` so the UI doesn't spin
// forever — operator can hit Generate again to retry.
function recoverStuckNodes(): void {
  let touched = 0;
  for (const n of graph.nodes) {
    const d = n.data as Record<string, unknown>;
    // Spare nodes that have a live fal request — the fal-jobs poller
    // rehydrates from disk and will keep polling that request_id, so
    // marking the node as "error" here is wrong (it'd lie to the UI
    // while the resilient channel quietly resumes).
    if (d.status === 'loading' && !d.falRequestId) {
      d.status = 'error';
      d.error = 'Interrupted by server restart — click Generate to retry';
      d.progress = undefined;
      d.stage = undefined;
      touched += 1;
    }
  }
  if (touched > 0) {
    console.log(`[graph] recovered ${touched} stuck node(s) after restart`);
    persist();
  }
}
recoverStuckNodes();

function persist(): void {
  graph.meta.updatedAt = Date.now();
  graph.meta.totalCost = computeTotalCost(graph);
  const tmp = STATE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(graph, null, 2));
  renameSync(tmp, STATE_FILE);
  try { chmodSync(STATE_FILE, 0o600); } catch {}
}

function computeTotalCost(g: Graph): number {
  let total = 0;
  for (const n of g.nodes) {
    const c = (n.data as { cost?: number }).cost;
    if (typeof c === 'number') total += c;
  }
  return Math.round(total * 1000) / 1000;
}

// ─── SSE ──────────────────────────────────────────────────────────────────────

const sseClients = new Set<Response>();

// Heartbeat every 15s — keeps the EventSource alive through reverse proxies
// (vite dev server) and lets dead clients be GC'd via write failures.
const HEARTBEAT_MS = 15_000;
setInterval(() => {
  for (const r of sseClients) {
    try { r.write(`: keepalive ${Date.now()}\n\n`); }
    catch { sseClients.delete(r); }
  }
}, HEARTBEAT_MS).unref?.();

export function addSseClient(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`event: graph\ndata: ${JSON.stringify(graph)}\n\n`);
  sseClients.add(res);
}

export function removeSseClient(res: Response): void {
  sseClients.delete(res);
}

function broadcast(): void {
  const payload = `event: graph\ndata: ${JSON.stringify(graph)}\n\n`;
  for (const r of sseClients) {
    try {
      r.write(payload);
    } catch {
      sseClients.delete(r);
    }
  }
}

/** Hint clients that the next graph payload is from an external file edit (not their own action). */
function broadcastExternalReload(name: string): void {
  const payload = `event: external-reload\ndata: ${JSON.stringify({ name, ts: Date.now() })}\n\n`;
  for (const r of sseClients) {
    try { r.write(payload); }
    catch { sseClients.delete(r); }
  }
}

/** Public — used by routes that mutate the graph on Claude/agent's behalf to
 * trigger the same animated diff as a file edit would. */
export function broadcastExternalReloadPublic(name: string): void {
  broadcastExternalReload(name);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function getGraph(): Graph {
  return graph;
}

export function replaceGraph(next: Graph): Graph {
  graph = {
    version: 1,
    nodes: Array.isArray(next.nodes) ? next.nodes : [],
    edges: Array.isArray(next.edges) ? next.edges : [],
    meta: { updatedAt: Date.now(), totalCost: 0 },
  };
  persist();
  broadcast();
  return graph;
}

const DEFAULT_DATA: Record<NodeType, Record<string, unknown>> = {
  'reference-image': {},
  'flux-image': { prompt: '', aspectRatio: '9:16', model: 'gpt-image-2', quality: 'medium', usage: 'character', status: 'idle' },
  'video-gen': {
    model: 'kling',
    mode: 'image',
    resolution: 'auto',
    prompt: '',
    duration: 5,
    audio: true,
    status: 'idle',
  },
  'tts-voice': { text: '', voice: 'en_female_emotional', status: 'idle' },
  'captions': { preset: 'capcut-classic', fontSize: 140, marginV: 400, status: 'idle' },
  'reference-video': { url: '' },
  'split-screen': { ratio: '65/35', audioSource: 'top', status: 'idle' },
  'image-overlay': { start: 2.0, end: 3.5, position: 'card', fadeMs: 200, opacity: 1.0, status: 'idle' },
  'end-card': { duration: 3.0, cta: 'Try Dream Free', subtitle: 'Decode every dream', brand: 'Dream', status: 'idle' },
  'stitch': { status: 'idle' },
  'transcribe': { status: 'idle' },
  'group': { label: 'Group', color: '#A855F7' },
  output: { label: 'Output' },
};

export function createNode(input: {
  type: NodeType;
  position: { x: number; y: number };
  data?: Record<string, unknown>;
}): GraphNode {
  const node: GraphNode = {
    id: randomUUID(),
    type: input.type,
    position: input.position,
    data: { ...DEFAULT_DATA[input.type], ...(input.data ?? {}) },
  };
  graph.nodes.push(node);
  persist();
  broadcast();
  return node;
}

export function updateNode(id: string, patch: { position?: { x: number; y: number }; data?: Record<string, unknown> }): GraphNode | null {
  const n = graph.nodes.find((x) => x.id === id);
  if (!n) return null;
  if (patch.position) n.position = patch.position;
  if (patch.data) n.data = { ...n.data, ...patch.data };
  persist();
  broadcast();
  return n;
}

export function deleteNode(id: string): boolean {
  const before = graph.nodes.length;
  graph.nodes = graph.nodes.filter((n) => n.id !== id);
  if (graph.nodes.length === before) return false;
  graph.edges = graph.edges.filter((e) => e.source !== id && e.target !== id);
  persist();
  broadcast();
  return true;
}

export function createEdge(input: { source: string; sourceHandle: string; target: string; targetHandle: string }): GraphEdge {
  const edge: GraphEdge = { id: randomUUID(), ...input };
  graph.edges.push(edge);
  persist();
  broadcast();
  return edge;
}

export function deleteEdge(id: string): boolean {
  const before = graph.edges.length;
  graph.edges = graph.edges.filter((e) => e.id !== id);
  if (graph.edges.length === before) return false;
  persist();
  broadcast();
  return true;
}

// ─── Workflows ────────────────────────────────────────────────────────────────

const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function deleteWorkflow(name: string): boolean {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '_');
  if (!safe) return false;
  const file = join(WORKFLOWS_DIR, `${safe}.json`);
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Union of user-saved workflows + curated examples shipped in the repo.
 *  User saves win when names collide (their edits override the example). */
export function listWorkflows(): string[] {
  const names = new Set<string>();
  for (const dir of [WORKFLOWS_DIR, SEED_WORKFLOWS_DIR]) {
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.json')) names.add(f.replace(/\.json$/, ''));
      }
    } catch { /* dir may not exist — that's fine */ }
  }
  return [...names].sort();
}

export function saveWorkflow(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error('invalid workflow name');
  const file = join(WORKFLOWS_DIR, `${name}.json`);
  writeFileSync(file, JSON.stringify(graph, null, 2));
  return file;
}

export function loadWorkflow(name: string): Graph {
  if (!SAFE_NAME.test(name)) throw new Error('invalid workflow name');
  // Check user dir first — their saved override beats the shipped example.
  const userFile = join(WORKFLOWS_DIR, `${name}.json`);
  const seedFile = join(SEED_WORKFLOWS_DIR, `${name}.json`);
  const file = existsSync(userFile) ? userFile : seedFile;
  if (!existsSync(file)) throw new Error(`workflow not found: ${name}`);
  const next = JSON.parse(readFileSync(file, 'utf8')) as Graph;
  currentWorkflowName = name;
  persistActiveName();
  return replaceGraph(next);
}

/** Tracks the most-recently-loaded workflow name so the file watcher can hot-reload it. */
let currentWorkflowName: string | null = null;
// Persisted across server restarts so the watcher survives `tsx watch` reloads
// and Claude-driven edits keep working without the user having to click Load again.
try {
  if (existsSync(ACTIVE_NAME_FILE)) {
    const v = readFileSync(ACTIVE_NAME_FILE, 'utf8').trim();
    if (v && /^[A-Za-z0-9_-]{1,64}$/.test(v)) currentWorkflowName = v;
  }
} catch {}

function persistActiveName(): void {
  try {
    if (currentWorkflowName) writeFileSync(ACTIVE_NAME_FILE, currentWorkflowName);
    else if (existsSync(ACTIVE_NAME_FILE)) unlinkSync(ACTIVE_NAME_FILE);
  } catch {}
}

export function getCurrentWorkflowName(): string | null {
  return currentWorkflowName;
}

/**
 * Curated workflow examples shipped with the repo at `aso-video/workflows/`.
 * Anything placed there is automatically visible to every user after a git
 * pull — alongside their own `~/.aso-studio/video/workflows/` saves. User
 * names win on collision. Resolved from this file's runtime path so it works
 * in both `tsx` dev mode and built `dist/` (graphStore.ts lives at
 * aso-video/server/lib/, so 3 levels up gets us aso-video/, then `workflows/`).
 */
const SEED_WORKFLOWS_DIR = join(fileURLToPath(import.meta.url), '..', '..', '..', 'workflows');

// Bump when the default workflow shape changes — seeder will overwrite older versions.
const DEFAULT_WORKFLOW_VERSION = 2;

// Seed default workflow on first run, or re-seed if the on-disk version is older.
export function seedDefaultWorkflowIfMissing(): void {
  const file = join(WORKFLOWS_DIR, 'default-dream-ad.json');
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { _seedVersion?: number };
      if ((raw._seedVersion ?? 0) >= DEFAULT_WORKFLOW_VERSION) return;
    } catch {
      // fallthrough — overwrite corrupt file
    }
  }
  const ref = randomUUID();
  const img = randomUUID();
  const k = randomUUID();
  const s = randomUUID();
  const h = randomUUID();
  const outK = randomUUID();
  const outS = randomUUID();
  const outH = randomUUID();
  const seeded = {
    version: 1,
    _seedVersion: DEFAULT_WORKFLOW_VERSION,
    nodes: [
      { id: ref, type: 'reference-image', position: { x: 40, y: 60 }, data: {} },
      { id: img, type: 'flux-image', position: { x: 40, y: 360 }, data: { prompt: 'cinematic actress portrait, soft cinematic lighting, vertical 9:16', aspectRatio: '9:16', model: 'gpt-image-2', quality: 'medium', status: 'idle' } },
      { id: k, type: 'video-gen', position: { x: 480, y: 40 }, data: { model: 'kling', mode: 'image', resolution: '1080p', prompt: 'gentle parallax, cinematic motion', duration: 5, audio: true, status: 'idle' } },
      { id: s, type: 'video-gen', position: { x: 480, y: 360 }, data: { model: 'seedance', mode: 'image', resolution: '720p', prompt: 'gentle parallax, cinematic motion', duration: 5, audio: true, status: 'idle' } },
      { id: h, type: 'video-gen', position: { x: 480, y: 680 }, data: { model: 'happy-horse', mode: 'image', resolution: '720p', prompt: 'gentle parallax, cinematic motion', duration: 5, audio: false, status: 'idle' } },
      { id: outK, type: 'output', position: { x: 920, y: 40 }, data: { label: 'Output — Kling' } },
      { id: outS, type: 'output', position: { x: 920, y: 360 }, data: { label: 'Output — Seedance' } },
      { id: outH, type: 'output', position: { x: 920, y: 680 }, data: { label: 'Output — Happy Horse' } },
    ],
    edges: [
      { id: randomUUID(), source: img, sourceHandle: 'image', target: k, targetHandle: 'image_url' },
      { id: randomUUID(), source: img, sourceHandle: 'image', target: s, targetHandle: 'image_url' },
      { id: randomUUID(), source: img, sourceHandle: 'image', target: h, targetHandle: 'image_url' },
      { id: randomUUID(), source: k, sourceHandle: 'video', target: outK, targetHandle: 'video' },
      { id: randomUUID(), source: s, sourceHandle: 'video', target: outS, targetHandle: 'video' },
      { id: randomUUID(), source: h, sourceHandle: 'video', target: outH, targetHandle: 'video' },
    ],
    meta: { updatedAt: Date.now(), totalCost: 0 },
  };
  writeFileSync(file, JSON.stringify(seeded, null, 2));
}

// ─── Run resolution helpers ──────────────────────────────────────────────────

/**
 * Auto-arrange every node into a layered top-aligned layout based on the
 * graph's topology. Sources go in the leftmost column, descendants flow to
 * the right. Within each column, nodes are stacked top-to-bottom keeping
 * their relative y-order from before.
 */
export function autoLayout(opts: {
  marginX?: number; marginY?: number;
  colW?: number; rowH?: number;
} = {}): void {
  const colW = opts.colW ?? 380;
  const rowH = opts.rowH ?? 480;
  const x0 = opts.marginX ?? 40;
  const y0 = opts.marginY ?? 40;

  // Depth = longest path from any root (in-degree 0 node) to this node.
  const depth = new Map<string, number>();
  for (const n of graph.nodes) depth.set(n.id, 0);
  // Topo order so we can compute depth in one pass.
  const order = topoOrder();
  for (const id of order) {
    const here = depth.get(id) ?? 0;
    for (const e of graph.edges) {
      if (e.source === id) {
        const next = depth.get(e.target) ?? 0;
        if (here + 1 > next) depth.set(e.target, here + 1);
      }
    }
  }

  // Group nodes by depth, stable-sort within column by previous y.
  const cols = new Map<number, GraphNode[]>();
  for (const n of graph.nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d)!.push(n);
  }
  for (const [, nodes] of cols) {
    nodes.sort((a, b) => a.position.y - b.position.y);
  }

  // Assign new positions. Top-align all columns (start at y0).
  for (const [d, nodes] of cols) {
    nodes.forEach((n, i) => {
      n.position = { x: x0 + d * colW, y: y0 + i * rowH };
    });
  }

  persist();
  broadcast();
}

/** Find the upstream node connected to (target, targetHandle). */
export function upstreamFor(target: string, targetHandle: string): GraphNode | null {
  const edge = graph.edges.find((e) => e.target === target && e.targetHandle === targetHandle);
  if (!edge) return null;
  return graph.nodes.find((n) => n.id === edge.source) ?? null;
}

/** Find all upstream nodes whose targetHandle starts with prefix, ordered by handle suffix. */
export function upstreamsByPrefix(target: string, prefix: string): GraphNode[] {
  const edges = graph.edges
    .filter((e) => e.target === target && e.targetHandle.startsWith(prefix))
    .sort((a, b) => a.targetHandle.localeCompare(b.targetHandle));
  return edges
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .filter((n): n is GraphNode => !!n);
}

/** Topological order of nodes (Kahn). Returns ids in execution order. */
export function topoOrder(): string[] {
  const inDeg = new Map<string, number>();
  for (const n of graph.nodes) inDeg.set(n.id, 0);
  for (const e of graph.edges) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  const q: string[] = [];
  for (const [id, d] of inDeg) if (d === 0) q.push(id);
  const out: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    out.push(id);
    for (const e of graph.edges) {
      if (e.source === id) {
        const d = (inDeg.get(e.target) ?? 0) - 1;
        inDeg.set(e.target, d);
        if (d === 0) q.push(e.target);
      }
    }
  }
  return out;
}

export function findNode(id: string): GraphNode | null {
  return graph.nodes.find((n) => n.id === id) ?? null;
}

// Re-broadcast helper for run progress.
export function broadcastNow(): void {
  broadcast();
}

// Cleanup helper used for tests / local resets.
export function _resetForTests(): void {
  graph = emptyGraph();
  try { unlinkSync(STATE_FILE); } catch {}
}

// ─── File watcher: hot-reload current workflow when its JSON is edited externally ─────
// (e.g. Claude editing the workflow file directly). Debounced 200 ms because text
// editors often write multiple times in quick succession. Atomic-rename writes
// fire `rename` events on the dirname, so we re-stat each tick.
const RELOAD_DEBOUNCE_MS = 200;
const reloadTimers = new Map<string, NodeJS.Timeout>();

function scheduleReload(changedName: string): void {
  if (currentWorkflowName !== changedName) return;
  const existing = reloadTimers.get(changedName);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    reloadTimers.delete(changedName);
    try {
      // Re-load straight from disk and broadcast — clients will diff against
      // their previous snapshot and animate the changes.
      const userFile = join(WORKFLOWS_DIR, `${changedName}.json`);
      const seedFile = join(SEED_WORKFLOWS_DIR, `${changedName}.json`);
      const file = existsSync(userFile) ? userFile : seedFile;
      if (!existsSync(file)) return;
      const raw = readFileSync(file, 'utf8');
      if (!raw.trim()) return;
      const next = JSON.parse(raw) as Graph;
      // Hint goes BEFORE the graph payload so clients can stash the previous
      // snapshot and label the upcoming graph as external.
      broadcastExternalReload(changedName);
      replaceGraph(next);
      console.log(`[graph] hot-reloaded workflow "${changedName}" from disk`);
    } catch (e) {
      console.warn(`[graph] hot-reload failed for "${changedName}":`, (e as Error).message);
    }
  }, RELOAD_DEBOUNCE_MS);
}

for (const dir of [WORKFLOWS_DIR, SEED_WORKFLOWS_DIR]) {
  try {
    if (!existsSync(dir)) continue;
    fsWatch(dir, { persistent: false }, (_event, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      const name = filename.replace(/\.json$/, '');
      scheduleReload(name);
    });
  } catch (e) {
    console.warn(`[graph] could not watch ${dir}:`, (e as Error).message);
  }
}
