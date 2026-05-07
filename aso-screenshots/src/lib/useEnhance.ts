import { toPng } from 'html-to-image';
import { useState, useCallback } from 'react';
import { PRESETS, getPreset } from './presets';
import { useStudio, type ActionData } from '../state/studio';
import { buildIngredientsPromptBlock } from './heroIngredients';
import { clog } from './clog';

// /api when app is hit on its own port; /studio-api when proxied via Keywords origin.
const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

/** Convert a blob:/object URL to a data URI so it can be JSON-shipped to the server. */
async function blobUrlToDataUri(url: string): Promise<string> {
  const r = await fetch(url);
  const blob = await r.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

const CANVAS_CAPTURE_DIMS = {
  iphone: { w: 1290, h: 2796, cw: 1280, ch: 2784 },
  // iPad logical canvas is 2048×2732, but fal.ai rejects images that large.
  // Capture at ~62.5% scale → 1280×1707 output, same file-size ballpark as iPhone scaffold.
  ipad:   { w: 2048, h: 2732, cw: 1280, ch: 1707 },
};

async function captureScaffold(device: 'iphone' | 'ipad' = 'iphone'): Promise<string | null> {
  const el = document.querySelector('[data-mockup-canvas-inner]') as HTMLElement | null;
  if (!el) throw new Error('MockupCanvas element not found in DOM');

  clog('enhance', `captureScaffold device=${device} el=${el.tagName} offsetW=${el.offsetWidth}`);

  const prevTransform = el.style.transform;
  const prevOverflow = el.style.overflow;
  el.style.transform = 'none';
  el.style.overflow = 'hidden';

  const omitNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-capture-omit]'));
  const previousDisplay = omitNodes.map((n) => n.style.display);
  omitNodes.forEach((n) => { n.style.display = 'none'; });

  const d = CANVAS_CAPTURE_DIMS[device];
  clog('enhance', `toPng dims=${d.w}×${d.h} canvas=${d.cw}×${d.ch}`);
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
        if (node instanceof HTMLImageElement && node.alt === '') {
          const src = node.getAttribute('src') || '';
          if (
            src.startsWith('data:image/png') ||
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
    clog('enhance', `captureScaffold done, length=${dataUri.length}`);
    return dataUri;
  } finally {
    omitNodes.forEach((n, i) => { n.style.display = previousDisplay[i] ?? ''; });
    el.style.transform = prevTransform;
    el.style.overflow = prevOverflow;
  }
}

const DEFAULT_ACTION: ActionData = {
  primary: '1K+ Ratings',
  secondary: '4.9 Average',
  showStars: true,
  hideDevice: false,
  themeHint: '',
  aiImageUrl: null,
  lastPrompt: null,
  generateState: 'idle',
};

export function useEnhance() {
  const { screenshots, activeScreenshotId, updateScreenshot, appName, appColor, appIconUrl, setViewMode, bumpAiSpent } = useStudio();
  const ss = screenshots.find((s) => s.id === activeScreenshotId);
  const [error, setError] = useState<string | null>(null);

  const isGenerating = ss?.action?.generateState === 'generating';
  const canEnhance = !!ss && !isGenerating;

  // No stale-generating guard anymore: the server now writes the final result
  // (aiImageUrl + 'done' OR 'error') into ~/.aso-studio/state.json on its own,
  // so a 'generating' state on mount means a real in-flight fal.ai call that
  // SSE will resolve when it lands. Resetting here would wipe the loader for
  // returning users (Studio → Tracker → back) before the server finishes.

  const enhance = useCallback(async () => {
    if (!ss) return;
    setError(null);

    const action: ActionData = ss.action ?? DEFAULT_ACTION;
    updateScreenshot(ss.id, { action: { ...action, generateState: 'generating' } });

    // If we're showing the previous AI render, the canvas has the AI image
    // baked in and the HTML phone hidden — capturing this would feed the
    // model its own output and lose the user's scaffold layout. Flip to
    // 'scaffold' for the duration of the capture; restored in finally.
    const setViewMode = useStudio.getState().setViewMode;
    const prevViewMode = useStudio.getState().viewMode;
    const switchedView = prevViewMode === 'enhanced';
    if (switchedView) {
      setViewMode('scaffold');
      // Two RAF ticks gives React a render + the browser a paint to settle
      // the new DOM before html-to-image walks it.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    }

    try {
      const preset = getPreset(ss.presetId) ?? PRESETS[0];
      const device = ss.device ?? 'iphone';
      clog('enhance', `click → capturing scaffold, slotId=${ss.id} device=${device} kind=${ss.kind}`);
      const scaffoldDataUri = await captureScaffold(device);
      if (!scaffoldDataUri) throw new Error('Could not capture canvas');
      clog('enhance', 'scaffold captured', { bytes: scaffoldDataUri.length, device });

      // Send the user's actual accent (appColor) as the palette anchor — for parametric
      // mountain presets the scaffold's rendered tones are derived from accent, not from
      // preset.background.css (which is just a fallback solid color the user never sees).
      // Sending the static fallback would tell the AI "use sand" even when the user picked blue.
      const effectiveBackground =
        ss.backgroundOverride ?? appColor ?? preset.suggestedAccent ?? preset.background.css;
      clog('enhance', 'sending request', {
        preset: preset.name,
        bg: effectiveBackground.slice(0, 60),
        themeHint: action.themeHint,
      });
      // Headline reserved zone — semantic + numeric fraction.
      // Calculate actual headline bottom as % of canvas height so the AI
      // doesn't hardcode 25% when the user has a large 2-line title.
      const yFrac = ss.textYFraction ?? 0.07;
      const headlineZone: 'top' | 'bottom' | 'middle' =
        yFrac < 0.4 ? 'top' : yFrac > 0.55 ? 'bottom' : 'middle';
      // Approximate headline height: titlePx (canvas logical px) × lines × 1.25 line-height.
      // Canvas logical height: iPhone=2796, iPad=2732.
      const captureH = device === 'ipad' ? 2732 : 2796;
      const titlePx = (ss as { titlePx?: number }).titlePx ?? 220;
      const lineCount = [ss.headline.verb, ss.headline.descriptor, ss.headline.subhead]
        .filter(Boolean).length || 2;
      const headlineBottomPx = yFrac * captureH + titlePx * lineCount * 1.3 + 80;
      const headlinePct = Math.min(Math.round((headlineBottomPx / captureH) * 100), 50);

      const r = await fetch(`${API_BASE}/screenshots/generate-hero`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: appName || 'My App',
          appColor,
          device,
          themeHint: action.themeHint || '',
          effectiveBackground,
          headlinePct,
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
          // Action-slots use the rich hero prompt (theme illustrations, social proof);
          // regular slots use the minimal polish prompt (just photoreal phone).
          kind: ss.kind === 'action' ? 'hero' : 'polish',
          // User-selected hero ingredients pre-rendered as a prompt block (server-side
          // can't import client modules, so we build the text here and ship it).
          extraPromptBlock:
            ss.kind === 'action'
              ? buildIngredientsPromptBlock(ss.action?.ingredients, ss.action?.ingredientParams)
              : '',
          // App icon — when "App icon" ingredient is on AND user uploaded one, fetch the
          // blob and ship as base64 so the server can include it in fal's image_urls.
          appIconDataUri:
            ss.kind === 'action' && ss.action?.ingredients?.appIcon && appIconUrl
              ? await blobUrlToDataUri(appIconUrl).catch(() => null)
              : null,
          // Per-slot custom prompt — when toggle is on AND text non-empty, server uses
          // it verbatim instead of buildHeroPrompt / buildPolishPrompt. Lets each preset
          // own its visual-style prompt and lets the user edit it freely.
          customPrompt:
            ss.action?.useCustomPrompt && ss.action.customPrompt?.trim()
              ? ss.action.customPrompt
              : null,
          // hideDevice — UI hides the phone from the scaffold; we also need to tell
          // the AI not to recompose a device back in, otherwise it ignores us.
          hideDevice: ss.kind === 'action' ? !!ss.action?.hideDevice : false,
          // Server writes the final result back to state.json keyed by this id,
          // so the render survives browser navigation / tab close.
          slotId: ss.id,
        }),
      });
      clog('enhance', 'response', { status: r.status });
      let data: { ok?: boolean; dataUri?: string; url?: string; prompt?: string; error?: string; detail?: string };
      try {
        data = await r.json();
      } catch {
        const text = await r.text().catch(() => '<no body>');
        const msg = `HTTP ${r.status}: ${text.slice(0, 400)}`;
        clog.error('enhance', msg);
        throw new Error(msg);
      }
      if (!r.ok) {
        const msg = data.error || `HTTP ${r.status}: ${data.detail || JSON.stringify(data).slice(0, 300)}`;
        clog.error('enhance', msg);
        throw new Error(msg);
      }
      const url: string = data.dataUri || data.url || '';
      if (!url) throw new Error('Server returned no image URL');
      // Cache-buster ensures the <img> reloads even if a previous URL had the same path
      // (prevents stale "old enhanced" from sticking around after Re-enhance).
      const fresh = url.includes('?') ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`;
      const finalUrl = url.startsWith('data:') ? url : fresh;
      const prevHistory = action.aiHistory ?? [];
      // Append to history; cap at 8 (oldest dropped) so localStorage doesn't bloat.
      const nextHistory = [...prevHistory, finalUrl].slice(-8);
      updateScreenshot(ss.id, {
        action: {
          ...action,
          aiImageUrl: finalUrl,
          aiHistory: nextHistory,
          lastPrompt: data.prompt ?? null,
          generateState: 'done',
        },
      });
      // gpt-image-2 medium quality at 768×1664 ≈ $0.05/render. Bump the counter so
      // the topbar widget stays in sync without polling fal.ai's billing API.
      bumpAiSpent(0.05);
      setViewMode('enhanced'); // auto-flip toolbar toggle so user sees the result
    } catch (e) {
      let msg: string;
      if (e instanceof Error) {
        msg = e.message;
      } else if (e instanceof Event) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase() ?? '?';
        const src = (target as HTMLImageElement)?.src ?? '';
        msg = `image load failed (${tag} ${src.slice(0, 100)})`;
      } else {
        msg = JSON.stringify(e) || String(e);
      }
      const stack = e instanceof Error ? (e.stack ?? '').slice(0, 600) : '';
      clog.error('enhance', 'FAILED: ' + msg, { stack });
      setError(msg);
      updateScreenshot(ss.id, {
        action: { ...action, generateState: 'error', errorMessage: msg },
      });
    } finally {
      // Restore viewMode if we forced it, but only when the success path
      // didn't already flip to 'enhanced' for the new render.
      if (switchedView && useStudio.getState().viewMode === 'scaffold') {
        setViewMode(prevViewMode);
      }
    }
  }, [ss, appName, appColor, updateScreenshot]);

  const discard = useCallback(() => {
    if (!ss) return;
    const action: ActionData = ss.action ?? DEFAULT_ACTION;
    updateScreenshot(ss.id, {
      action: { ...action, aiImageUrl: null, lastPrompt: null, generateState: 'idle', errorMessage: undefined },
    });
    setViewMode('scaffold'); // flip toolbar back so user sees the source
    setError(null);
  }, [ss, updateScreenshot, setViewMode]);

  return {
    enhance,
    discard,
    canEnhance,
    isGenerating,
    error,
    hasResult: !!ss?.action?.aiImageUrl,
  };
}
