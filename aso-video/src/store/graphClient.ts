// Graph client — REST + SSE subscription. Server is source of truth.
import type { GraphPayload } from './types';

// When the app is served via the keywords vite (:5173/video/), `/api` would
// hit the wrong service — keywords' own backend. The vite proxy on :5173
// exposes our backend as `/video-api`. Detect that by looking at base URL.
const isProxied = typeof window !== 'undefined' && window.location.port === '5173';
export const API = isProxied ? '/video-api' : '/api';

export async function fetchGraph(): Promise<GraphPayload> {
  const r = await fetch(`${API}/graph`);
  if (!r.ok) throw new Error(`GET /api/graph → ${r.status}`);
  return (await r.json()) as GraphPayload;
}

export async function createNode(input: { type: string; position: { x: number; y: number }; data?: Record<string, unknown> }) {
  const r = await fetch(`${API}/graph/nodes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`POST nodes → ${r.status}`);
  return r.json();
}

export async function patchNode(id: string, patch: { position?: { x: number; y: number }; data?: Record<string, unknown> }) {
  const r = await fetch(`${API}/graph/nodes/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`PATCH node → ${r.status}`);
  return r.json();
}

export async function deleteNode(id: string) {
  const r = await fetch(`${API}/graph/nodes/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE node → ${r.status}`);
  return r.json();
}

export async function createEdge(input: { source: string; sourceHandle: string; target: string; targetHandle: string }) {
  const r = await fetch(`${API}/graph/edges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`POST edges → ${r.status}`);
  return r.json();
}

export async function deleteEdge(id: string) {
  const r = await fetch(`${API}/graph/edges/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE edge → ${r.status}`);
  return r.json();
}

export async function runNode(id: string) {
  const r = await fetch(`${API}/graph/nodes/${id}/run`, { method: 'POST' });
  return r.json();
}

export async function runAll(force = false) {
  const r = await fetch(`${API}/graph/run-all`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  return r.json();
}

export async function listWorkflows(): Promise<string[]> {
  const r = await fetch(`${API}/graph/workflows`);
  const j = await r.json();
  return (j.workflows ?? []) as string[];
}

export async function saveWorkflow(name: string) {
  const r = await fetch(`${API}/graph/save-workflow`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return r.json();
}

export async function loadWorkflow(name: string) {
  const r = await fetch(`${API}/graph/load-workflow`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return r.json();
}

export async function deleteWorkflow(name: string) {
  const r = await fetch(`${API}/graph/workflows/${encodeURIComponent(name)}`, { method: 'DELETE' });
  return r.json();
}

export async function autoLayout() {
  const r = await fetch(`${API}/graph/auto-layout`, { method: 'POST' });
  return r.json();
}

// ─── Influencers — saved prompt+image presets ────────────────────────────────

export interface Influencer {
  name: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  quality?: string;
  imageUrl: string;
  savedAt: number;
}

export async function listInfluencers(): Promise<Influencer[]> {
  const r = await fetch(`${API}/influencers`);
  const j = await r.json();
  return (j.items ?? []) as Influencer[];
}

export async function deleteInfluencer(name: string) {
  await fetch(`${API}/influencers/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

/**
 * Subscribe to graph SSE. Auto-reconnects with exponential backoff if the
 * connection drops (tsx server restart, network blip, vite proxy reset).
 * Falls back to a fresh REST fetch on every reconnect so we don't miss
 * updates that happened while disconnected. Returns disposer.
 */
export function subscribe(
  onGraph: (g: GraphPayload) => void,
  onExternalReload?: (info: { name: string; ts: number }) => void,
): () => void {
  let es: EventSource | null = null;
  let attempt = 0;
  let stopped = false;

  function connect() {
    if (stopped) return;
    es = new EventSource(`${API}/graph/stream`);
    es.addEventListener('graph', (ev) => {
      attempt = 0; // reset backoff once a real message arrives
      try { onGraph(JSON.parse((ev as MessageEvent).data) as GraphPayload); } catch {}
    });
    // External-reload hint fires when a workflow JSON is edited on disk
    // (e.g. Claude). Arrives BEFORE the next `graph` event so the consumer
    // can stash the previous snapshot and animate the diff.
    es.addEventListener('external-reload', (ev) => {
      try {
        const info = JSON.parse((ev as MessageEvent).data) as { name: string; ts: number };
        onExternalReload?.(info);
      } catch {}
    });
    es.onmessage = (ev) => {
      attempt = 0;
      try { onGraph(JSON.parse(ev.data) as GraphPayload); } catch {}
    };
    es.onerror = () => {
      // EventSource will retry on its own, but if readyState=CLOSED we have
      // to recreate. Always close + back off + recreate to be safe.
      es?.close();
      es = null;
      if (stopped) return;
      attempt = Math.min(attempt + 1, 6);
      const delay = Math.min(30_000, 500 * 2 ** attempt);
      setTimeout(async () => {
        // Pull state via REST so we don't show a stale graph after reconnect.
        try {
          const fresh = await fetchGraph();
          onGraph(fresh);
        } catch {}
        connect();
      }, delay);
    };
  }

  connect();
  return () => { stopped = true; es?.close(); };
}
