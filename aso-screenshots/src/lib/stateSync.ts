/**
 * Two-way bridge between the Zustand store and a JSON file on the API server.
 * - Local edits in the editor → debounced POST → server writes ~/.aso-studio/state.json
 * - External edits to that file → fs.watch on the server → SSE → applied to Zustand
 *
 * Lets an agent (or me) read / edit the full project state by touching one
 * JSON file, with changes propagated live without a browser reload.
 */

import { useStudio, type Screenshot } from '../state/studio';
import { loadScreenshotBlob } from './screenshotStore';

const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';
const POST_DEBOUNCE_MS = 300;

let applyingFromServer = false;
let serverSyncedOnce = false;
let postTimer: number | null = null;

/** Skip ephemeral / non-persistable runtime fields when shipping state.
 *  These are derived UI state that shouldn't ride the wire. */
function projectableState(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    if (typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
}

function postState() {
  postTimer = null;
  if (applyingFromServer || !serverSyncedOnce) return;
  const data = projectableState(useStudio.getState());
  fetch(`${API_BASE}/studio-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch((e) => console.warn('[state-sync] post failed', e));
}

function schedulePost() {
  if (applyingFromServer || !serverSyncedOnce) return;
  if (postTimer != null) clearTimeout(postTimer);
  postTimer = window.setTimeout(postState, POST_DEBOUNCE_MS);
}

async function rehydrateBlobs() {
  const { screenshots, updateScreenshot } = useStudio.getState();
  for (const s of screenshots) {
    // Skip slots that already have a valid, non-blob sourceUrl (e.g. https AI renders).
    if (s.sourceUrl && !s.sourceUrl.startsWith('blob:')) continue;
    // For null OR stale blob: URLs — try IDB regardless.
    try {
      const rec = await loadScreenshotBlob(s.id);
      if (rec) {
        updateScreenshot(s.id, { sourceUrl: URL.createObjectURL(rec.blob), filename: rec.filename });
      } else if (s.sourceUrl?.startsWith('blob:')) {
        updateScreenshot(s.id, { sourceUrl: null });
      }
    } catch {
      if (s.sourceUrl?.startsWith('blob:')) updateScreenshot(s.id, { sourceUrl: null });
    }
  }
}

function applyServerState(raw: string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[state-sync] could not parse server state');
    return;
  }
  // Skip empty / placeholder payloads — would wipe the editor on first connect
  // before the user has done anything.
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
    serverSyncedOnce = true;
    return;
  }
  // blob: URLs in the server's state.json are always stale (they're per-session).
  // Null them out before applying so rehydration below can restore them from IDB.
  if (Array.isArray(parsed.screenshots)) {
    parsed.screenshots = (parsed.screenshots as Screenshot[]).map((s) =>
      s.sourceUrl?.startsWith('blob:') ? { ...s, sourceUrl: null } : s,
    );
  }
  // viewMode and previewDevice are client-only UI state — never let the server
  // snapshot overwrite them (causes "stuck on scaffold" after generate completes
  // because the SSE with the result lands after setViewMode('enhanced') fires).
  delete parsed.viewMode;
  delete parsed.previewDevice;
  applyingFromServer = true;
  try {
    useStudio.setState(parsed as never, false);
  } finally {
    applyingFromServer = false;
    serverSyncedOnce = true;
  }
  // Re-run IDB rehydration after each server state push — the server state
  // nulled out blob: URLs above; now restore them from IndexedDB.
  void rehydrateBlobs();
}

export function startStudioStateSync() {
  // Open SSE first; the first message is the canonical server state and wins
  // over whatever localStorage hydrated.
  const stream = new EventSource(`${API_BASE}/studio-state/stream`);
  stream.onmessage = (ev) => applyServerState(ev.data);
  stream.onerror = (e) => {
    // EventSource auto-reconnects — log only, don't tear down. Mark synced anyway
    // so local edits start posting even when the stream is briefly down.
    console.warn('[state-sync] sse error', e);
    serverSyncedOnce = true;
  };

  // Mirror every Zustand update upstream (debounced).
  useStudio.subscribe(schedulePost);
}
