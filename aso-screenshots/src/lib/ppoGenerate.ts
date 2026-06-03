/**
 * Client helpers for PPO generation. Mirrors the patterns in useEnhance.ts /
 * polishBatch.ts but without scaffold capture — the PPO flow always edits the
 * raw source screenshot the user uploaded.
 */
import { useStudio } from '../state/studio';
import type { PPOSourceScreen } from '../state/studio';

// Same pattern as useEnhance.ts / polishBatch.ts / stateSync.ts — stay consistent
// with the rest of the codebase. Vite proxy rewrites `/studio-api/*` → `:5181/api/*`.
const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

/** Sentinel strategyId the server maps to iconLab.variants[screenId] instead of
 *  a PPO strategy. Keep in sync with ICON_LAB_ID in server/routes/ppo.ts. */
const ICON_LAB_ID = '__iconlab__';

async function callPPOGenerate(payload: {
  strategyId: string;
  screenId: string;
  prompt: string;
  inputDataUri: string;
  device?: 'iphone' | 'ipad';
  kind?: 'screen' | 'icon';
}): Promise<{ aiImageUrl?: string; error?: string }> {
  try {
    const r = await fetch(`${API_BASE}/ppo/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await r.json().catch(() => ({}))) as { aiImageUrl?: string; error?: string; detail?: string };
    if (!r.ok) {
      return { error: data.error ?? `${r.status}: ${data.detail ?? r.statusText}` };
    }
    return { aiImageUrl: data.aiImageUrl };
  } catch (e) {
    return { error: (e as Error).message ?? 'network error' };
  }
}

/** Trigger generation for a single (strategy × source) cell. Updates state
 *  optimistically (sets generating → done/error) so the UI shows feedback even
 *  if the SSE bridge is briefly disconnected. */
export async function generateOne(
  strategyId: string,
  source: PPOSourceScreen,
  prompt: string,
): Promise<void> {
  if (!prompt.trim()) {
    console.warn('[ppo] empty prompt, skipping generation');
    return;
  }
  if (!source.previewUrl) {
    console.warn('[ppo] source has no previewUrl, cannot generate');
    return;
  }

  const setGen = useStudio.getState().ppoSetGeneration;
  setGen(strategyId, source.id, {
    generateState: 'generating',
    lastPrompt: prompt,
    errorMessage: undefined,
  });

  // Per-screen device — each source carries its own (iPhone 9:19.5 vs iPad 3:4),
  // so a mixed-device project generates every tile at the correct size. Falls
  // back to the experiment device, then iphone.
  const device = source.device ?? useStudio.getState().ppo?.device ?? 'iphone';
  const result = await callPPOGenerate({
    strategyId,
    screenId: source.id,
    prompt,
    inputDataUri: source.previewUrl,
    device,
  });

  if (result.error || !result.aiImageUrl) {
    setGen(strategyId, source.id, {
      generateState: 'error',
      errorMessage: result.error ?? 'unknown error',
    });
    return;
  }

  // Server has already persisted the result (incl. aiHistory) into state.json
  // and SSE will broadcast the patch. We also poke local state so the active
  // tab updates immediately without waiting for SSE round-trip.
  const state = useStudio.getState();
  const strat = state.ppo?.strategies.find((s) => s.id === strategyId);
  const prevHistory = strat?.generations[source.id]?.aiHistory ?? [];
  setGen(strategyId, source.id, {
    aiImageUrl: result.aiImageUrl,
    lastPrompt: prompt,
    generateState: 'done',
    errorMessage: undefined,
    aiHistory: [...prevHistory, result.aiImageUrl].slice(-8),
  });
  // Bump global AI spend counter — gpt-image-2 medium ≈ $0.05/call.
  state.bumpAiSpent(0.05);
}

/** Run generation for every screen in a strategy that has a non-empty prompt.
 *  Concurrency limited so we don't slam fal — gpt-image-2 takes 20-30s per call. */
export async function generateStrategy(
  strategyId: string,
  concurrency = 2,
  deviceFilter?: 'iphone' | 'ipad',
  onlyIds?: Set<string>,
): Promise<void> {
  const state = useStudio.getState();
  const ppo = state.ppo;
  if (!ppo) return;
  const strategy = ppo.strategies.find((s) => s.id === strategyId);
  if (!strategy) return;
  const sources = ppo.sourceScreens;

  const queue: Array<{ source: PPOSourceScreen; prompt: string }> = [];
  for (const screenId of Object.keys(strategy.prompts)) {
    const source = sources.find((s) => s.id === screenId);
    const prompt = strategy.prompts[screenId];
    if (!source || !prompt.trim()) continue;
    // When a device filter is set (the visible tab), only generate that device's
    // screens — so "Generate" runs the iPhone batch, then iPad after toggling.
    if (deviceFilter && (source.device ?? 'iphone') !== deviceFilter) continue;
    // When a selection allowlist is set, only generate the checked screens.
    if (onlyIds && !onlyIds.has(screenId)) continue;
    queue.push({ source, prompt });
  }

  const inFlight = new Set<Promise<void>>();
  for (const item of queue) {
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
    const p = generateOne(strategyId, item.source, item.prompt).finally(() => {
      inFlight.delete(p);
    });
    inFlight.add(p);
  }
  await Promise.all(inFlight);
}

/** Fire generation for every strategy at once, respecting per-strategy
 *  concurrency. Used by the global "Generate everything" button (Phase 5). */
export async function generateAllStrategies(concurrency = 2): Promise<void> {
  const ppo = useStudio.getState().ppo;
  if (!ppo) return;
  await Promise.all(ppo.strategies.map((s) => generateStrategy(s.id, concurrency)));
}

/** Generate the icon variant for one Icon Generator entry. Edits the variant's
 *  manually-uploaded base image into a 1024×1024 square iOS app icon. Routed
 *  through the same fal poller via the ICON_LAB_ID sentinel. */
export async function generateIcon(variantId: string): Promise<void> {
  const state = useStudio.getState();
  const variant = state.iconLab?.variants.find((v) => v.id === variantId);
  if (!variant) return;
  const prompt = (variant.prompt ?? '').trim();
  if (!prompt) {
    console.warn('[icon] empty prompt, skipping');
    return;
  }
  if (!variant.baseUrl) {
    console.warn('[icon] no base image, cannot generate');
    return;
  }

  const setGen = state.iconLabSetGeneration;
  setGen(variantId, { generateState: 'generating', lastPrompt: prompt, errorMessage: undefined });

  const result = await callPPOGenerate({
    strategyId: ICON_LAB_ID,
    screenId: variantId,
    prompt,
    inputDataUri: variant.baseUrl,
    kind: 'icon',
  });

  // The server is async: it returns 202 { requestId } and a background poller
  // writes the finished image back to state.json (delivered via SSE), flipping
  // generateState → 'done'. So a missing aiImageUrl here is EXPECTED, not an
  // error — only flip to 'error' when the submission itself failed. Leave the
  // 'generating' state in place otherwise; SSE completes it.
  if (result.error) {
    setGen(variantId, { generateState: 'error', errorMessage: result.error });
    return;
  }
  if (result.aiImageUrl) {
    // Rare synchronous path — record it immediately.
    const prevHistory = useStudio.getState().iconLab?.variants.find((v) => v.id === variantId)
      ?.generation.aiHistory ?? [];
    setGen(variantId, {
      aiImageUrl: result.aiImageUrl,
      generateState: 'done',
      errorMessage: undefined,
      aiHistory: [...prevHistory, result.aiImageUrl].slice(-8),
    });
  }
  // Job submitted to fal → count the spend (gpt-image-2 medium ≈ $0.05/call).
  state.bumpAiSpent(0.05);
}
