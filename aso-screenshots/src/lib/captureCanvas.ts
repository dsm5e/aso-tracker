import { toPng } from 'html-to-image';
import { clog } from './clog';
import { getCaptureDimensions, type IPhoneModel } from './deviceProfiles';

interface CaptureCanvasOpts {
  slotId?: string;
  device?: 'iphone' | 'ipad';
  iphoneModel?: IPhoneModel;
  wrapper?: HTMLElement | null;
  timeoutMs?: number;
  logTag: string;
  filter?: (node: HTMLElement) => boolean;
}

function shortSrc(src: string): string {
  if (!src) return '<empty>';
  return src.length > 120 ? `${src.slice(0, 120)}...` : src;
}

async function blobUrlToDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function waitForImages(el: HTMLElement, timeoutMs: number, logTag: string): Promise<void> {
  const imgs = Array.from(el.querySelectorAll<HTMLImageElement>('img'));
  if (imgs.length === 0) return;

  clog(logTag, `waiting for ${imgs.length} image(s) before capture`);

  await Promise.race([
    Promise.all(imgs.map(async (img, index) => {
      if (img.complete && img.naturalWidth > 0) {
        try { await img.decode(); } catch {}
        return;
      }
      await new Promise<void>((resolve) => {
        let done = false;
        let timer: number | null = null;
        const finish = () => {
          if (done) return;
          done = true;
          if (timer != null) window.clearTimeout(timer);
          img.removeEventListener('load', onDone);
          img.removeEventListener('error', onDone);
          resolve();
        };
        const onDone = () => finish();
        img.addEventListener('load', onDone, { once: true });
        img.addEventListener('error', onDone, { once: true });
        timer = window.setTimeout(() => {
          clog(logTag, `image wait timeout #${index + 1}: ${shortSrc(img.currentSrc || img.src || '')}`);
          finish();
        }, timeoutMs);
      });
      if (img.complete && img.naturalWidth > 0) {
        try { await img.decode(); } catch {}
      }
    })),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);

  const broken = imgs.filter((img) => !(img.complete && img.naturalWidth > 0));
  if (broken.length > 0) {
    const details = broken
      .slice(0, 3)
      .map((img) => shortSrc(img.currentSrc || img.src || ''))
      .join(', ');
    throw new Error(`capture blocked: ${broken.length} image(s) not renderable (${details})`);
  }

  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function inlineBlobImages(el: HTMLElement, logTag: string): Promise<Array<{ img: HTMLImageElement; src: string }>> {
  const imgs = Array.from(el.querySelectorAll<HTMLImageElement>('img'));
  const changed: Array<{ img: HTMLImageElement; src: string }> = [];

  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('blob:')) continue;
    const dataUri = await blobUrlToDataUri(src);
    changed.push({ img, src });
    img.setAttribute('src', dataUri);
    clog(logTag, `inlined blob image for capture: ${shortSrc(src)}`);
  }

  if (changed.length > 0) {
    await waitForImages(el, 5000, logTag);
  }

  return changed;
}

export async function captureCanvasToPng(
  el: HTMLElement,
  {
    slotId,
    device = 'iphone',
    iphoneModel,
    wrapper,
    timeoutMs = 5000,
    logTag,
    filter,
  }: CaptureCanvasOpts,
): Promise<string> {
  const prevTransform = el.style.transform;
  const prevOverflow = el.style.overflow;
  const prevWrapperVisibility = wrapper?.style.visibility ?? '';

  if (wrapper) wrapper.style.visibility = 'visible';
  el.style.transform = 'none';
  el.style.overflow = 'hidden';

  const omitNodes = Array.from(el.querySelectorAll<HTMLElement>('[data-capture-omit]'));
  const prevDisplays = omitNodes.map((n) => n.style.display);
  omitNodes.forEach((n) => { n.style.display = 'none'; });
  let inlinedBlobImgs: Array<{ img: HTMLImageElement; src: string }> = [];

  const d = getCaptureDimensions(device, iphoneModel);
  clog(logTag, `capture start slot=${slotId ?? '-'} dims=${d.w}×${d.h} canvas=${d.cw}×${d.ch}`);

  try {
    await waitForImages(el, timeoutMs, logTag);
    inlinedBlobImgs = await inlineBlobImages(el, logTag);
    const dataUri = await toPng(el, {
      pixelRatio: d.cw / d.w,
      width: d.w,
      height: d.h,
      canvasWidth: d.cw,
      canvasHeight: d.ch,
      cacheBust: false,
      skipFonts: true,
      filter,
    });
    clog(logTag, `capture success slot=${slotId ?? '-'} bytes=${dataUri.length}`);
    return dataUri;
  } finally {
    for (const { img, src } of inlinedBlobImgs) {
      img.setAttribute('src', src);
    }
    omitNodes.forEach((n, i) => { n.style.display = prevDisplays[i] ?? ''; });
    el.style.transform = prevTransform;
    el.style.overflow = prevOverflow;
    if (wrapper) wrapper.style.visibility = prevWrapperVisibility;
  }
}
