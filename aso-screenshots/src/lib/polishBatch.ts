/**
 * Phase 5 — AI Polish for regular (non-hero) slots.
 *
 * Reuses the /screenshots/generate-hero endpoint with kind='polish'. Different
 * from hero: less creative, no ingredients, just photoreal device + light bg.
 * Style-anchor mode threads the first slot's result URL into image_urls[1] of
 * subsequent calls so the batch reads as a coherent series.
 */

import { toPng } from 'html-to-image';
import { useStudio, type ActionData } from '../state/studio';
import { PRESETS, getPreset } from './presets';
import { clog } from './clog';
import { buildIngredientsPromptBlock } from './heroIngredients';

async function blobUrlToDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

const POLISH_DEFAULT_ACTION: ActionData = {
  primary: '1K+ Ratings',
  secondary: '4.9 Average',
  showStars: true,
  hideDevice: false,
  themeHint: '',
  aiImageUrl: null,
  lastPrompt: null,
  generateState: 'idle',
};

const CAPTURE_DIMS = {
  iphone: { w: 1290, h: 2796, cw: 1280, ch: 2784 },
  ipad:   { w: 2048, h: 2732, cw: 1280, ch: 1707 },
};

async function captureScaffoldFor(slotId: string, device: 'iphone' | 'ipad' = 'iphone'): Promise<string> {
  // Target the hidden full-resolution scaffold canvas (data-scaffold-slot), NOT
  // the visible compact card canvas — compact canvas is too small and causes the
  // phone to appear misplaced when toPng renders at full 1290/2048px width.
  const scaffoldWrapper = document.querySelector<HTMLElement>(`[data-scaffold-slot="${slotId}"]`);
  const el = scaffoldWrapper?.querySelector<HTMLElement>('[data-mockup-canvas-inner]') ?? null;
  clog('capture', `slot=${slotId} device=${device} wrapperFound=${!!scaffoldWrapper} elFound=${!!el}`);
  if (!el) throw new Error(`MockupCanvas inner for slot ${slotId} not found in DOM`);

  // Log all images inside the canvas so we can see if any have broken URLs
  const imgs = Array.from(el.querySelectorAll<HTMLImageElement>('img'));
  imgs.forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    const ok = img.complete && img.naturalWidth > 0;
    clog('capture', `  img src=${src.slice(0, 80)} complete=${img.complete} naturalW=${img.naturalWidth} ok=${ok}`);
  });

  const prevTransform = el.style.transform;
  const prevOverflow = el.style.overflow;
  // The wrapper has visibility:hidden so it doesn't show in the UI. That
  // cascades into el and makes toPng render a blank white canvas. Temporarily
  // lift it to visible just for the capture, then restore.
  const prevWrapperVisibility = scaffoldWrapper ? scaffoldWrapper.style.visibility : '';
  if (scaffoldWrapper) scaffoldWrapper.style.visibility = 'visible';

  el.style.transform = 'none';
  el.style.overflow = 'hidden';

  const omitNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-capture-omit]'));
  const prevDisplays = omitNodes.map((n) => n.style.display);
  omitNodes.forEach((n) => { n.style.display = 'none'; });

  const d = CAPTURE_DIMS[device];
  clog('capture', `toPng dims: ${d.w}×${d.h} canvas: ${d.cw}×${d.ch}`);
  try {
    const dataUri = await toPng(el, {
      pixelRatio: d.cw / d.w,
      width: d.w,
      height: d.h,
      canvasWidth: d.cw,
      canvasHeight: d.ch,
      cacheBust: false,
      skipFonts: true,
      filter: (node) => {
        // Exclude only AI-generated result images (fal / openai CDN). Keep
        // everything else — including data:image/png which may be the user's
        // uploaded screenshot embedded inline in the scaffold.
        if (node instanceof HTMLImageElement && node.alt === '') {
          const src = node.getAttribute('src') || '';
          if (
            src.includes('oaiusercontent') ||
            src.includes('openai') ||
            src.includes('fal.media') ||
            src.includes('fal.run')
          ) {
            return false;
          }
        }
        return true;
      },
    });
    clog('capture', `toPng success, dataUri length=${dataUri.length}`);
    // Large scaffolds (>2 MB base64) cause fal.ai 408 timeouts. Re-encode as
    // JPEG at 0.88 quality — keeps visual fidelity while cutting 5–8× in size.
    if (dataUri.length > 2_000_000) {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = rej;
        img.src = dataUri;
      });
      // Half-res PNG — no JPEG banding artifacts on gradients, no white fill
      const cvs = document.createElement('canvas');
      cvs.width = Math.round(d.cw / 2);
      cvs.height = Math.round(d.ch / 2);
      const ctx = cvs.getContext('2d')!;
      ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
      const compressed = cvs.toDataURL('image/png');
      clog('capture', `compressed: ${dataUri.length} → ${compressed.length} bytes (half-res PNG)`);
      return compressed;
    }
    return dataUri;
  } finally {
    omitNodes.forEach((n, i) => { n.style.display = prevDisplays[i] ?? ''; });
    el.style.transform = prevTransform;
    el.style.overflow = prevOverflow;
    if (scaffoldWrapper) scaffoldWrapper.style.visibility = prevWrapperVisibility;
  }
}

/** Polish a single slot — captures its scaffold, calls the server, writes the
 *  result URL into the slot's action.aiImageUrl. Returns the polished URL. */
export async function polishSlot(slotId: string): Promise<string> {
  const st = useStudio.getState();
  const ss = st.screenshots.find((s) => s.id === slotId);
  if (!ss) throw new Error('slot not found');

  const preset = getPreset(ss.presetId) ?? PRESETS[0];
  const action: ActionData = ss.action ?? POLISH_DEFAULT_ACTION;
  st.updateScreenshot(slotId, { action: { ...action, generateState: 'generating', errorMessage: undefined } });

  try {
    clog('polish', `slot ${slotId} → capturing scaffold (device=${ss.device ?? 'iphone'})`);
    const scaffoldDataUri = await captureScaffoldFor(slotId, ss.device ?? 'iphone');

    const effectiveBackground =
      ss.backgroundOverride ?? st.appColor ?? preset.suggestedAccent ?? preset.background.css;
    const yFrac = ss.textYFraction ?? 0.07;
    const headlineZone: 'top' | 'bottom' | 'middle' =
      yFrac < 0.4 ? 'top' : yFrac > 0.55 ? 'bottom' : 'middle';

    const r = await fetch(`${API_BASE}/screenshots/generate-hero`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appName: st.appName || 'My App',
        appColor: st.appColor,
        device: ss.device ?? 'iphone',
        themeHint: action.themeHint || '',
        effectiveBackground,
        preset: {
          id: preset.id,
          name: preset.name,
          description: preset.description,
          kind: preset.kind,
          background: preset.background,
          text: preset.text,
          tiltDeg: preset.tiltDeg,
          breakout: preset.breakout,
          decorationsHint: preset.decorationsHint,
        },
        scaffoldDataUri,
        headlineZone,
        kind: ss.kind === 'action' ? 'hero' : 'polish',
        extraPromptBlock: ss.kind === 'action'
          ? buildIngredientsPromptBlock(action.ingredients, action.ingredientParams)
          : '',
        appIconDataUri: ss.kind === 'action' && action.ingredients?.appIcon && st.appIconUrl
          ? await blobUrlToDataUri(st.appIconUrl).catch(() => null)
          : null,
        customPrompt: ss.kind === 'action' && action.useCustomPrompt && action.customPrompt?.trim()
          ? action.customPrompt
          : null,
        hideDevice: ss.kind === 'action' ? !!action.hideDevice : false,
        polishCallout: !!ss.polishCallout,
        // Server persists the result into state.json under this id — keeps
        // polish progress alive across navigation between Studio and Tracker.
        slotId,
      }),
    });

    clog('polish', `fetch POST done, status=${r.status}`);
    // Read body as text first — then parse JSON. Calling r.json() then r.text()
    // on the same response fails because the body stream can only be consumed once.
    const rawText = await r.text().catch(() => '');
    let data: { ok?: boolean; url?: string; dataUri?: string; prompt?: string; error?: string; detail?: string } = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      const msg = `HTTP ${r.status}: ${rawText.slice(0, 400) || '<no body>'}`;
      clog.error('polish', msg);
      throw new Error(msg);
    }
    if (!r.ok) {
      const msg = data.error || `HTTP ${r.status}: ${data.detail || rawText.slice(0, 300)}`;
      clog.error('polish', msg);
      throw new Error(msg);
    }
    const url = data.dataUri || data.url || '';
    if (!url) throw new Error('Server returned no image URL');

    const finalUrl = url.startsWith('data:') ? url : `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    const prevHistory = action.aiHistory ?? [];
    const nextHistory = [...prevHistory, finalUrl].slice(-8);

    st.updateScreenshot(slotId, {
      action: {
        ...action,
        aiImageUrl: finalUrl,
        aiHistory: nextHistory,
        lastPrompt: data.prompt ?? null,
        generateState: 'done',
        errorMessage: undefined,
      },
    });
    st.bumpAiSpent(0.05);
    return finalUrl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? (e.stack ?? '').slice(0, 600) : '';
    clog.error('polish', `slot ${slotId} FAILED: ${msg}`, { stack });
    st.updateScreenshot(slotId, {
      action: { ...action, generateState: 'error', errorMessage: msg },
    });
    throw e;
  }
}

interface BatchOpts {
  /** Stop signal — set to true to abort scheduling further slots. In-flight
   *  fal.ai calls can't be cancelled; they finish but their results still
   *  land in state.json (server persists). */
  shouldStop?: () => boolean;
  /** Called after each slot finishes (regardless of success). */
  onSlotComplete?: (slotId: string, ok: boolean) => void;
  /** Max concurrent fal.ai calls. fal handles ≥4 fine; default is "all at
   *  once" since each polish is independent (no anchor / no shared state). */
  concurrency?: number;
}

/** Run polish on a list of slots with bounded concurrency. Default is 5
 *  simultaneous fal.ai calls — enough to keep throughput high without
 *  hammering DNS / hitting rate limits. Wall-clock time ≈ ceil(n/5) × ~30s. */
export async function polishBatch(slotIds: string[], opts: BatchOpts = {}): Promise<{ done: number; failed: number }> {
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  let done = 0;
  let failed = 0;
  const queue = [...slotIds];

  async function worker() {
    while (queue.length > 0) {
      if (opts.shouldStop?.()) {
        clog('polish-batch', `stopped — ${queue.length} slot(s) skipped`);
        queue.length = 0;
        return;
      }
      const id = queue.shift();
      if (!id) return;
      try {
        await polishSlot(id);
        done++;
        opts.onSlotComplete?.(id, true);
      } catch {
        failed++;
        opts.onSlotComplete?.(id, false);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, slotIds.length) }, () => worker()));
  return { done, failed };
}
