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
import { useHighlight } from '../state/highlight';

/** Which element ids changed between two states — drives the realtime flash. */
function diffChangedIds(
  prevShots: Screenshot[],
  prevPpo: unknown,
  nextShots: Screenshot[],
  nextPpo: unknown,
): string[] {
  const ids: string[] = [];
  const prevById = new Map(prevShots.map((s) => [s.id, s]));
  const sig = (s: Screenshot) =>
    JSON.stringify([s.headline, s.sourceUrl, s.kind, (s as { device?: string }).device,
      s.deviceX, s.deviceY, s.deviceScale, s.tiltDeg, s.action]);
  for (const s of nextShots) {
    const p = prevById.get(s.id);
    if (!p || sig(p) !== sig(s)) ids.push(s.id);
  }
  type Strat = { id: string; prompts?: Record<string, string>; generations?: Record<string, unknown> };
  const pp = prevPpo as { strategies?: Strat[] } | undefined;
  const np = nextPpo as { strategies?: Strat[] } | undefined;
  if (np?.strategies) {
    const prevStrat = new Map((pp?.strategies ?? []).map((s) => [s.id, s]));
    for (const st of np.strategies) {
      const ps = prevStrat.get(st.id);
      if (!ps) { ids.push(st.id); continue; }
      for (const sid of Object.keys(st.prompts ?? {})) {
        if ((ps.prompts ?? {})[sid] !== (st.prompts ?? {})[sid]) ids.push(`${st.id}:${sid}`);
      }
      for (const sid of Object.keys(st.generations ?? {})) {
        if (JSON.stringify((ps.generations ?? {})[sid]) !== JSON.stringify((st.generations ?? {})[sid]))
          ids.push(`${st.id}:${sid}`);
      }
    }
  }
  return ids;
}

const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';
const POST_DEBOUNCE_MS = 300;

let applyingFromServer = false;
let serverSyncedOnce = false;
let postTimer: number | null = null;

/** Skip ephemeral / non-persistable runtime fields when shipping state.
 *  These are derived UI state that shouldn't ride the wire. */
function projectableState(state: object): Record<string, unknown> {
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

/** Immediately persist the current store to the server, bypassing the 300ms
 *  debounce, and broadcast it to every open tab. Use after a destructive reset
 *  (archive / start-new) so a reload can't resurrect the stale active draft —
 *  the debounced post might not fire before navigation/unload. */
export async function pushStateNow(): Promise<void> {
  if (postTimer != null) { clearTimeout(postTimer); postTimer = null; }
  const data = projectableState(useStudio.getState());
  try {
    await fetch(`${API_BASE}/studio-state/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.warn('[state-sync] pushStateNow failed', e);
  }
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
  // ppo.device is a client-only VIEW filter (which device's screens are shown).
  // During generation the server keeps pushing progress with a possibly-stale
  // device → preserve the local choice so toggling iPhone/iPad doesn't jerk back.
  if (parsed.ppo && typeof parsed.ppo === 'object') {
    const localDevice = useStudio.getState().ppo?.device;
    if (localDevice) (parsed.ppo as { device?: 'iphone' | 'ipad' }).device = localDevice;
  }
  // Snapshot BEFORE applying so we can flash exactly what this push changed.
  const wasSynced = serverSyncedOnce;
  const prevShots = useStudio.getState().screenshots ?? [];
  const prevPpo = useStudio.getState().ppo;
  applyingFromServer = true;
  try {
    useStudio.setState(parsed as never, false);
  } finally {
    applyingFromServer = false;
    serverSyncedOnce = true;
  }
  // Realtime highlight of agent/external edits — skip the first canonical sync
  // (it would flash everything). Best-effort: never let it break apply.
  if (wasSynced) {
    try {
      const ns = useStudio.getState();
      const changed = diffChangedIds(prevShots, prevPpo, ns.screenshots ?? [], ns.ppo);
      if (changed.length) useHighlight.getState().flash(changed);
    } catch { /* highlight is decorative */ }
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
