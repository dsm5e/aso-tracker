/**
 * Phase 7 — render PNG per (slot × locale) at exact App Store dimensions.
 * iPhone: 1290×2796 (16 Pro Max — Apple auto-scales for smaller iPhones).
 * iPad:   2048×2732 (iPad Pro 12.9" 3rd gen — APP_IPAD_PRO_3GEN_129).
 * Uses ReactDOM.createRoot to render an off-screen MockupCanvas at native
 * resolution, captures via html-to-image, posts the PNG bytes to the server
 * for disk write.
 */

import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { toCanvas } from 'html-to-image';
import { useStudio, type LocaleEntry, type Screenshot } from '../state/studio';
import { MockupCanvas } from '../components/studio/MockupCanvas';
import { applyLocaleToSlot } from './applyLocale';
import { clog } from './clog';

const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

const CANVAS_DIMS = {
  iphone: { w: 1290, h: 2796 },
  ipad:   { w: 2048, h: 2732 },
};

export interface RenderJob {
  slot: Screenshot;
  /** null = source / English (no locale entry needed). */
  locale: LocaleEntry | null;
}

export interface RenderFailure {
  slotId: string;
  slotVerb: string;
  localeCode: string;
  error: string;
}

interface ExportOpts {
  outputFolder: string;
  filenamePattern: string;
  /** 'iphone' (default, 1290×2796) or 'ipad' (2048×2732 APP_IPAD_PRO_3GEN_129). */
  device?: 'iphone' | 'ipad';
  /** Per-locale subfolder (default true). */
  perLocaleFolder?: boolean;
  shouldStop?: () => boolean;
  onProgress?: (done: number, total: number, currentFilename: string) => void;
  /** When set, only render this exact set of (slot, locale) pairs — used by
   *  Retry to re-run failed jobs without re-rendering everything. */
  onlyJobs?: Array<{ slotId: string; localeCode: string | null }>;
}

export interface ExportResult {
  rendered: number;
  failed: number;
  files: string[];
  failures: RenderFailure[];
}


/** Poll for a child matching `selector` to appear inside `wrapper`. React 18's
 *  concurrent renderer commits on its own schedule; this avoids races with
 *  one-frame waits. */
async function waitForElement(wrapper: HTMLElement, selector: string, timeoutMs: number): Promise<HTMLElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = wrapper.querySelector<HTMLElement>(selector);
    if (found) return found;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  return null;
}

/** Wait until every <img> inside `el` has finished loading (or errored). The
 *  AI hero / inner screenshot URLs are remote; html-to-image's serialisation
 *  fails to inline them if they aren't decoded yet. */
async function waitForImages(el: HTMLElement, timeoutMs = 5000): Promise<void> {
  const imgs = Array.from(el.querySelectorAll('img'));
  if (imgs.length === 0) return;
  await Promise.race([
    Promise.all(imgs.map((img) => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => { img.removeEventListener('load', done); img.removeEventListener('error', done); resolve(); };
        img.addEventListener('load', done);
        img.addEventListener('error', done);
      });
    })),
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
  // One extra frame for layout + paint.
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/** Fill `{app}` `{locale}` `{n}` `{size}` `{ext}` placeholders. `n` is the
 *  slot's index in the screenshots array (1-based). */
function resolveFilename(pattern: string, vars: { app: string; locale: string; n: number; size: string; ext: string }): string {
  return pattern.replace(/\{(\w+)\}/g, (full, key) => {
    if (key === 'app') return vars.app.replace(/\s+/g, '-') || 'app';
    if (key === 'locale') return vars.locale;
    if (key === 'n') return String(vars.n).padStart(2, '0');
    if (key === 'size') return vars.size;
    if (key === 'ext') return vars.ext;
    return full;
  });
}

/** Render one slot+locale to PNG and POST to server. Returns saved filename. */
async function renderOne(
  slot: Screenshot,
  locale: LocaleEntry | null,
  slotIndex: number,
  opts: ExportOpts,
): Promise<string> {
  const st = useStudio.getState();
  // Per-slot device takes priority — iPad slot exports at 2048×2732, iPhone at 1290×2796.
  const dev = slot.device ?? opts.device ?? 'iphone';
  const { w: CANVAS_W, h: CANVAS_H } = CANVAS_DIMS[dev];
  const localeCode = locale?.code ?? 'en';
  const localised = applyLocaleToSlot(slot, locale);

  // Off-screen mount point for the React tree.
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `position:absolute; left:-99999px; top:0; width:${CANVAS_W}px; height:${CANVAS_H}px; pointer-events:none;`;
  document.body.appendChild(wrapper);

  let root: Root | null = null;
  try {
    root = createRoot(wrapper);
    root.render(
      createElement(MockupCanvas, {
        screenshot: localised,
        device: dev,
        fitWidth: CANVAS_W,
        fitHeight: CANVAS_H,
        showDropZone: false,
        viewModeOverride: slot.action?.aiImageUrl ? 'enhanced' : 'scaffold',
        localeMeta: locale ? { rtl: locale.rtl, fontOverride: locale.fontOverride } : undefined,
      }),
    );

    // React 18's createRoot commits asynchronously (concurrent mode), so a
    // single RAF isn't enough — poll until the inner canvas div materialises
    // in the DOM, then load images, then capture.
    const inner = await waitForElement(wrapper, '[data-mockup-canvas-inner]', 3000);
    if (!inner) throw new Error('canvas inner not found in off-screen render (React mount timeout)');
    await waitForImages(wrapper);
    // Drop the visual scale transform — capture at logical 1290×2796 native.
    const prevTransform = inner.style.transform;
    const prevOverflow = inner.style.overflow;
    inner.style.transform = 'none';
    inner.style.overflow = 'hidden';
    // Capture via toCanvas (returns canvas with default alpha buffer).
    const sourceCanvas = await toCanvas(inner, {
      pixelRatio: 1,
      width: CANVAS_W,
      height: CANVAS_H,
      canvasWidth: CANVAS_W,
      canvasHeight: CANVAS_H,
      cacheBust: false,
      skipFonts: true,
    });
    inner.style.transform = prevTransform;
    inner.style.overflow = prevOverflow;

    // Re-render onto an alpha:false canvas — produces PNG color-type=2 (RGB).
    // Apple ASC API rejects RGBA screenshots post-upload (red icon in UI).
    const rgbCanvas = document.createElement('canvas');
    rgbCanvas.width = CANVAS_W;
    rgbCanvas.height = CANVAS_H;
    const ctx = rgbCanvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Failed to acquire 2D context (alpha:false)');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(sourceCanvas, 0, 0);
    const dataUri = rgbCanvas.toDataURL('image/png');

    const sizeLabel = dev === 'ipad' ? '2048x2732' : '1290x2796';
    const filename = resolveFilename(opts.filenamePattern, {
      app: st.appName || 'app',
      locale: localeCode,
      n: slotIndex + 1,
      size: sizeLabel,
      ext: 'png',
    });
    // Output structure: <picked-folder>/<App-slug>/images[-ipad]/<locale>/<file.png>
    const appSlug = (st.appName || 'app').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
    const imagesDir = dev === 'ipad' ? 'images-ipad' : 'images';
    const subPath = opts.perLocaleFolder ?? true
      ? `${appSlug}/${imagesDir}/${localeCode}`
      : appSlug;

    const saveRes = await fetch(`${API_BASE}/export/save-png`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUri,
        filename,
        folder: opts.outputFolder,
        subPath,
      }),
    });
    if (!saveRes.ok) {
      const text = await saveRes.text().catch(() => '');
      throw new Error(`save ${saveRes.status}: ${text.slice(0, 200)}`);
    }
    const data = await saveRes.json();
    return data.path as string;
  } finally {
    root?.unmount();
    wrapper.remove();
  }
}

/** Render every (slot × locale) pair sequentially. Sequential keeps the DOM
 *  off-screen mount stable — concurrent renders on the same body create
 *  z-stacked wrappers that interfere with html-to-image. */
export async function renderAll(opts: ExportOpts): Promise<ExportResult> {
  const st = useStudio.getState();
  const slots = st.screenshots;
  const locales: (LocaleEntry | null)[] = st.locales.length > 0 ? st.locales : [null];

  // Pre-build the queue. When `onlyJobs` is set, filter to that exact set —
  // Retry path only re-runs failed pairs.
  let jobs: RenderJob[] = [];
  for (const loc of locales) {
    for (const slot of slots) {
      jobs.push({ slot, locale: loc });
    }
  }
  if (opts.onlyJobs && opts.onlyJobs.length > 0) {
    const want = new Set(opts.onlyJobs.map((j) => `${j.slotId}|${j.localeCode ?? ''}`));
    jobs = jobs.filter((j) => want.has(`${j.slot.id}|${j.locale?.code ?? ''}`));
  }
  const total = jobs.length;
  const files: string[] = [];
  const failures: RenderFailure[] = [];
  let done = 0;

  for (const job of jobs) {
    if (opts.shouldStop?.()) {
      clog('export', `stopped at ${done}/${total}`);
      break;
    }
    const slotIndex = slots.indexOf(job.slot);
    try {
      const path = await renderOne(job.slot, job.locale, slotIndex, opts);
      files.push(path);
      done++;
      opts.onProgress?.(done, total, path);
    } catch (e) {
      const msg = (e as Error).message;
      const slotVerb = job.locale?.translations?.[job.slot.id]?.verb || job.slot.headline.verb || '(empty)';
      failures.push({
        slotId: job.slot.id,
        slotVerb: slotVerb.slice(0, 40),
        localeCode: job.locale?.code ?? 'en',
        error: msg,
      });
      clog.error('export', `render failed [${job.slot.id} / ${job.locale?.code ?? 'en'}]: ${msg}`);
      opts.onProgress?.(done, total, `[failed] ${job.slot.id} ${job.locale?.code ?? ''}`);
    }
  }

  return { rendered: done, failed: failures.length, files, failures };
}

/** Open the native macOS folder picker on the server. Returns the chosen path
 *  or null when the user cancels. macOS-only — other platforms 501. */
export async function pickOutputFolder(): Promise<string | null> {
  const r = await fetch(`${API_BASE}/export/pick-folder`, { method: 'POST' });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`pick-folder ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = await r.json();
  if (data.cancelled) return null;
  return data.folder as string;
}
