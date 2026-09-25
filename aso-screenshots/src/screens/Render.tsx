/**
 * Headless render target — one slot × locale at native App Store resolution.
 *
 * Why this exists next to the html-to-image export: that path serialises the
 * canvas into an SVG <foreignObject>, and Chromium does not run full complex-
 * script shaping there. Devanagari repha (दर्जनों → दजेनों) and other conjuncts
 * came out mis-ordered in the exported PNG while looking correct on screen.
 * Screenshotting the live DOM with Playwright uses the normal text pipeline, so
 * every script shapes the way the editor shows it — and no font has to be
 * inlined at all.
 *
 * Driven entirely by the query string so the CLI can drive it statelessly:
 *   /studio/render?slot=<screenshot id>&locale=<code>
 * `locale` may be omitted for the untranslated source.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { MockupCanvas } from '../components/studio/MockupCanvas';
import { useStudio } from '../state/studio';
import { applyLocaleToSlot } from '../lib/applyLocale';
import {
  APP_STORE_IPHONE_CANVAS,
  APP_STORE_IPHONE_MODEL,
  getIPadCanvas,
} from '../lib/deviceProfiles';

export function RenderScreen() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const slotId = params.get('slot') ?? '';
  const localeCode = params.get('locale');

  const screenshots = useStudio((s) => s.screenshots);
  const locales = useStudio((s) => s.locales);
  const iphoneModel = useStudio((s) => s.iphoneModel);
  const ipadModel = useStudio((s) => s.ipadModel);

  const slot = screenshots.find((s) => s.id === slotId);
  const locale = localeCode ? locales.find((l) => l.code === localeCode) ?? null : null;

  // The CLI drives this page by client-side navigation — one page load for a
  // whole batch, so the artwork stays in the browser's image cache instead of
  // being re-fetched per screenshot. `renderKey` is how it knows the DOM has
  // caught up with the URL it just pushed; `renderReady` alone would still read
  // '1' from the previous slot for a frame.
  const ready = Boolean(slot) && (!localeCode || Boolean(locale));
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.renderReady = ready ? '1' : '0';
    root.dataset.renderKey = ready ? `${slotId}|${localeCode ?? ''}` : '';
    root.dataset.renderError = slot
      ? (localeCode && !locale ? `unknown locale ${localeCode}` : '')
      : `unknown slot ${slotId}`;
  }, [ready, slot, locale, localeCode, slotId]);

  if (!slot) return <div data-render-missing>slot {slotId} not found</div>;

  const device = slot.device ?? 'iphone';
  const dims = device === 'ipad' ? getIPadCanvas(ipadModel) : APP_STORE_IPHONE_CANVAS;
  const localised = applyLocaleToSlot(slot, locale);

  return (
    <div
      data-render-root
      style={{ width: dims.w, height: dims.h, overflow: 'hidden', background: '#fff' }}
    >
      <MockupCanvas
        screenshot={localised}
        device={device}
        iphoneModel={device === 'iphone' ? APP_STORE_IPHONE_MODEL : iphoneModel}
        fitWidth={dims.w}
        fitHeight={dims.h}
        showDropZone={false}
        viewModeOverride={slot.action?.aiImageUrl ? 'enhanced' : 'scaffold'}
        localeMeta={locale ? { rtl: locale.rtl, fontOverride: locale.fontOverride, lang: locale.code } : undefined}
      />
    </div>
  );
}
