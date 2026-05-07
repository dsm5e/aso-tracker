/**
 * Client wrapper around the server's /api/translate/batch endpoint. Builds
 * the per-slot string list, calls OpenAI gpt-4o-mini via the server, writes
 * results back into the studio store under the matching locale entry.
 */

import { useStudio, type Headline, type LocaleEntry } from '../state/studio';
import { findLocaleSpec } from './locales';
import { getPreset } from './presets';
import { DEVICE_DIMS } from '../components/studio/DeviceFrame';
import { clog } from './clog';

const API_BASE = import.meta.env.BASE_URL === '/' ? '/api' : '/studio-api';

interface TranslateItem { key: string; text: string }
interface TranslateResponse { ok: boolean; items: Array<{ key: string; translation: string }>; targetLocale: string }

/** Translate every regular + hero slot's verb / descriptor / pill into the
 *  given locale and store the result on `state.locales[locale].translations`.
 *  Returns {translated: number, failed: number}. Pass `signal` to cancel
 *  mid-flight — fetch aborts immediately, side effects on Zustand are skipped. */
export async function translateLocale(localeCode: string, signal?: AbortSignal): Promise<{ translated: number; failed: number }> {
  const st = useStudio.getState();
  const slots = st.screenshots;
  if (!slots.length) return { translated: 0, failed: 0 };

  // English is the source language — copy originals directly, no API call needed.
  const SOURCE_LOCALES = new Set(['en', 'en-US', 'en-GB', 'en-AU', 'en-CA']);
  if (SOURCE_LOCALES.has(localeCode)) {
    const translationsRec: Record<string, Headline> = {};
    for (const s of slots) {
      translationsRec[s.id] = { verb: s.headline.verb, descriptor: s.headline.descriptor, subhead: s.headline.subhead ?? '' };
    }
    const spec = findLocaleSpec(localeCode);
    if (!st.locales.find((l) => l.code === localeCode)) {
      st.addLocale({ id: localeCode, code: localeCode, name: spec?.name ?? localeCode, flag: spec?.flag ?? '🏴󠁧󠁢󠁥󠁮󠁧󠁿', rtl: spec?.rtl, fontOverride: spec?.font });
    }
    st.setLocaleTranslations(localeCode, translationsRec);
    clog('translate', `${localeCode} is source language — copied originals, no API call`);
    return { translated: slots.length, failed: 0 };
  }

  // Build a flat (key → source) map. Keys: "<slotId>:verb", ":descriptor", ":pill".
  const items: TranslateItem[] = [];
  for (const s of slots) {
    if (s.headline.verb) items.push({ key: `${s.id}:verb`, text: s.headline.verb });
    if (s.headline.descriptor) items.push({ key: `${s.id}:descriptor`, text: s.headline.descriptor });
    if (s.pill) items.push({ key: `${s.id}:pill`, text: s.pill });
  }
  if (items.length === 0) return { translated: 0, failed: 0 };

  clog('translate', `→ ${localeCode}`, { count: items.length });
  const r = await fetch(`${API_BASE}/translate/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetLocale: localeCode,
      sourceLocale: 'en',
      appContext: st.appName ? `iOS app "${st.appName}". Target: App Store screenshots.` : 'iOS App Store screenshot strings.',
      items,
    }),
    signal,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`translate ${r.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await r.json()) as TranslateResponse;
  // Group results back by slot id.
  const perSlot: Record<string, Headline & { pill?: string }> = {};
  for (const it of data.items) {
    const [slotId, field] = it.key.split(':');
    if (!slotId || !field) continue;
    perSlot[slotId] = perSlot[slotId] ?? { verb: '', descriptor: '', subhead: '' };
    if (field === 'verb') perSlot[slotId].verb = it.translation;
    else if (field === 'descriptor') perSlot[slotId].descriptor = it.translation;
    else if (field === 'pill') (perSlot[slotId] as Headline & { pill?: string }).pill = it.translation;
  }

  // Find or create the locale entry, write translations.
  const spec = findLocaleSpec(localeCode);
  const existing = st.locales.find((l) => l.code === localeCode);
  if (!existing) {
    st.addLocale({
      id: localeCode,
      code: localeCode,
      name: spec?.name ?? localeCode,
      flag: spec?.flag ?? '🌐',
      rtl: spec?.rtl,
      fontOverride: spec?.font,
    });
  }
  // setLocaleTranslations expects Record<slotId, Headline> — drop pill into a
  // separate field on the locale (state schema doesn't carry pill on Headline,
  // so we stash it on translations[slot].subhead temporarily? No — let's just
  // add pill as a separate Record via direct updateScreenshot... actually the
  // cleanest is to extend the type. Keep pill on the headline obj for now —
  // the renderer can pick it up.) We pass the typed Headline only; pill
  // localisation is handled via a separate per-locale pill map below.
  const translationsRec: Record<string, Headline> = {};
  for (const [slotId, val] of Object.entries(perSlot)) {
    translationsRec[slotId] = { verb: val.verb, descriptor: val.descriptor, subhead: '' };
  }
  st.setLocaleTranslations(localeCode, translationsRec);

  // Pill translations live on a parallel map per-locale — see studio store.
  st.setLocalePillTranslations?.(localeCode, Object.fromEntries(
    Object.entries(perSlot)
      .filter(([_, v]) => (v as { pill?: string }).pill)
      .map(([slotId, v]) => [slotId, (v as { pill?: string }).pill!]),
  ));

  // Auto-fit pass — long translations (German, Russian, French) wrap onto
  // more lines than the source, pushing the headline block down past the
  // source's bottom edge and onto the device. Solve for the largest font
  // size where (a) the longest word still fits one line whole, and (b) the
  // target's total rendered height ≤ the source's at base font size.
  const isCJK = /^(ja|ko|zh)/i.test(localeCode);
  const charRatio = isCJK ? 0.95 : /^(ar|he)/i.test(localeCode) ? 0.5 : 0.68;
  for (const slot of slots) {
    const tr = perSlot[slot.id];
    if (!tr) continue;
    const device = slot.device ?? 'iphone';
    const BOX_WIDTH = (device === 'ipad' ? 2048 : 1290) - 120;
    const baseTitle = slot.titlePx ?? 220;
    const baseSub = slot.subPx ?? 100;
    const minTitle = isCJK ? 100 : 90;
    const minSub = isCJK ? 50 : 44;
    const preset = getPreset(slot.presetId ?? '');
    const availableH = computeAvailableH(
      device, slot.textYFraction ?? 0.07, baseTitle, baseSub,
      preset?.device?.offsetY ?? 0, slot.deviceY ?? 0,
      preset?.device?.rotateZ ?? 0, slot.tiltDeg ?? 0,
      preset?.device?.scale ?? 1, slot.deviceScale ?? 1,
    );
    const fitted = fitToAvailableH({
      titlePx: baseTitle, subPx: baseSub,
      titleText: tr.verb, subText: tr.descriptor,
      boxWidth: BOX_WIDTH, charRatio, availableH, minTitle, minSub,
    });
    const patch: { titlePx?: number; subPx?: number } = {};
    if (fitted.titlePx !== baseTitle) patch.titlePx = fitted.titlePx;
    if (fitted.subPx !== baseSub) patch.subPx = fitted.subPx;
    if (Object.keys(patch).length) {
      st.updateLocaleSlotAdjustment(localeCode, slot.id, patch);
    }
  }

  return { translated: items.length, failed: 0 };
}

/** Recompute auto-fit adjustments for a locale that already has translations,
 *  WITHOUT re-fetching from OpenAI. Useful after the auto-fit algorithm
 *  changes — runs locally, no API cost. */
export function refitLocale(localeCode: string): { adjusted: number } {
  const st = useStudio.getState();
  const loc = st.locales.find((l) => l.code === localeCode);
  if (!loc) return { adjusted: 0 };
  const slots = st.screenshots;
  const isCJK = /^(ja|ko|zh)/i.test(localeCode);
  const charRatio = isCJK ? 0.95 : /^(ar|he)/i.test(localeCode) ? 0.5 : 0.68;
  let adjusted = 0;
  clog('refit', `${localeCode} — ${slots.length} slots, ${Object.keys(loc.translations ?? {}).length} direct translations`);
  for (const slot of slots) {
    let tr = loc.translations?.[slot.id];
    let trSource = 'direct';
    if (!tr && slot.headline.verb) {
      const match = slots.find(
        (other) => other.id !== slot.id &&
          other.headline.verb === slot.headline.verb &&
          loc.translations?.[other.id],
      );
      if (match) { tr = loc.translations![match.id]; trSource = `fallback:${match.id}`; }
    }
    if (!tr) { clog('refit', `  slot ${slot.id} (${slot.device ?? 'iphone'}) — no translation, skip`); continue; }
    const device = slot.device ?? 'iphone';
    const BOX_WIDTH = (device === 'ipad' ? 2048 : 1290) - 120;
    const baseTitle = slot.titlePx ?? 220;
    const baseSub = slot.subPx ?? 100;
    const minTitle = isCJK ? 100 : 90;
    const minSub = isCJK ? 50 : 44;
    const preset = getPreset(slot.presetId ?? '');
    const availableH = computeAvailableH(
      device, slot.textYFraction ?? 0.07, baseTitle, baseSub,
      preset?.device?.offsetY ?? 0, slot.deviceY ?? 0,
      preset?.device?.rotateZ ?? 0, slot.tiltDeg ?? 0,
      preset?.device?.scale ?? 1, slot.deviceScale ?? 1,
    );
    const fitted = fitToAvailableH({
      titlePx: baseTitle, subPx: baseSub,
      titleText: tr.verb, subText: tr.descriptor,
      boxWidth: BOX_WIDTH, charRatio, availableH, minTitle, minSub,
    });
    clog('refit', `  slot ${slot.id} (${device}) tr=${trSource} base=${baseTitle}/${baseSub} → fitted=${fitted.titlePx}/${fitted.subPx} availH=${Math.round(availableH)}`);
    const patch: { titlePx?: number; subPx?: number } = {};
    if (fitted.titlePx !== baseTitle) patch.titlePx = fitted.titlePx;
    if (fitted.subPx !== baseSub) patch.subPx = fitted.subPx;
    st.updateLocaleSlotAdjustment(localeCode, slot.id, patch);
    if (fitted.titlePx !== baseTitle || fitted.subPx !== baseSub) adjusted++;
  }
  clog('refit', `${localeCode} done — ${adjusted} adjusted`);
  return { adjusted };
}

/** Simulate browser word-wrap: count lines a text renders at given charsPerLine. */
function linesWithWordWrap(text: string, charsPerLine: number): number {
  if (charsPerLine <= 0) return 999;
  const words = /\s/.test(text) ? text.split(/\s+/).filter(Boolean) : [text];
  if (words.length === 0) return 1;
  let lines = 1;
  let cur = 0;
  for (const w of words) {
    const wLen = w.length;
    const need = cur === 0 ? wLen : cur + 1 + wLen;
    if (need <= charsPerLine) cur = need;
    else { lines++; cur = wLen; }
  }
  return lines;
}

const HEADLINE_INNER_GAP = 24; // must match MockupCanvas
const TEXT_GAP = 80;           // gap between headline block and device top
const CANVAS_H_FOR = { iphone: 2796, ipad: 2732 } as const;
const BOUNDARY_MARGIN = 120;  // canvas px buffer below red line

/** Compute the available canvas-pixel height for the headline block, matching
 *  the red-line calculation in MockupCanvas (visualDeviceTop - headlineTop - margin).
 *  Uses base (English) font sizes for device Y so the boundary is stable. */
function computeAvailableH(
  device: 'iphone' | 'ipad',
  yFrac: number,
  baseTitle: number,
  baseSub: number,
  presetOffY: number,
  dy: number,
  presetRotZ: number,
  tiltDeg: number,
  presetScale: number,
  dscale: number,
): number {
  const D = DEVICE_DIMS[device];
  const CANVAS_H = CANVAS_H_FOR[device];
  const headlineTop = Math.round(yFrac * CANVAS_H);
  const deviceY = (yFrac < 0.5
    ? headlineTop + baseTitle + HEADLINE_INNER_GAP + baseSub + TEXT_GAP
    : headlineTop - TEXT_GAP - D.height)
    + presetOffY;
  const rotRad = ((presetRotZ + tiltDeg) * Math.PI) / 180;
  const effScale = presetScale * dscale;
  const centerY = deviceY + dy + D.height / 2;
  const visualDeviceTop = centerY - effScale * (
    D.width / 2 * Math.abs(Math.sin(rotRad)) +
    D.height / 2 * Math.abs(Math.cos(rotRad))
  );
  return visualDeviceTop - headlineTop - BOUNDARY_MARGIN;
}

/** Find the largest proportional scale for (titlePx, subPx) such that:
 *  1. Rendered block height ≤ availableH (fits before the device / red line)
 *  2. Longest word in each field fits on one line (no mid-word breaks)
 *  3. Scale ≤ MAX_SCALE (caps growth for already-short translations)
 *
 *  Bidirectional: shrinks if overflow, grows if space available. */
function fitToAvailableH(opts: {
  titlePx: number; subPx: number;
  titleText: string; subText: string;
  boxWidth: number; charRatio: number;
  availableH: number;
  minTitle: number; minSub: number;
}): { titlePx: number; subPx: number } {
  const { titlePx, subPx, titleText, subText, boxWidth, charRatio, availableH, minTitle, minSub } = opts;
  if (availableH <= 0 || !titleText) return { titlePx, subPx };

  const blockH = (tp: number, sp: number) => {
    const tLines = linesWithWordWrap(titleText, Math.max(1, Math.floor(boxWidth / (tp * charRatio))));
    const sLines = subText ? linesWithWordWrap(subText, Math.max(1, Math.floor(boxWidth / (sp * charRatio)))) : 0;
    return tLines * tp * 1.02 + HEADLINE_INNER_GAP + sLines * sp * 1.15;
  };

  // Word-fit ceiling: scale at which the longest word no longer fits on one line.
  const longestWord = (text: string) => (text.split(/\s+/).reduce((a, w) => Math.max(a, w.length), 1));
  const wordCeilingTitle = boxWidth / (longestWord(titleText) * charRatio * titlePx);
  const wordCeilingSub = subText ? boxWidth / (longestWord(subText) * charRatio * subPx) : Infinity;
  const wordCeiling = Math.min(wordCeilingTitle, wordCeilingSub);

  // Max scale: word-fit ceiling AND a 1.5× growth cap (prevents absurd sizes for very short translations).
  const maxScale = Math.min(wordCeiling, 1.5);
  const minScale = Math.max(0.15, minTitle / titlePx);

  if (maxScale < minScale) return { titlePx: minTitle, subPx: minSub };

  // Binary search for the largest scale in [minScale, maxScale] where block fits.
  let lo = minScale, hi = maxScale;
  while (hi - lo > 0.005) {
    const mid = (lo + hi) / 2;
    if (blockH(titlePx * mid, subPx * mid) <= availableH) lo = mid; else hi = mid;
  }
  const newTitle = Math.max(minTitle, Math.floor(titlePx * lo));
  const newSub = Math.max(minSub, Math.floor(subPx * lo));
  // Return unchanged if the difference is negligible (< 2px) to avoid noisy patches.
  if (Math.abs(newTitle - titlePx) < 2 && Math.abs(newSub - subPx) < 2) return { titlePx, subPx };
  return { titlePx: newTitle, subPx: newSub };
}

/** Find the largest font size where:
 *   1. the longest word in `targetText` fits on a single line (no character
 *      breaks inside a word — preserves readability),
 *   2. the target's total rendered height ≤ the source's at its base size
 *      (translation never extends past the source's headline bbox).
 *
 *  Binary search over [minPx, min(basePx, wordFitCeiling)]. Returns undefined
 *  when no shrink is needed (target already fits at base). */
function autoFitToSourceHeight(
  sourceText: string,
  targetText: string,
  basePx: number,
  boxWidth: number,
  charRatio: number,
  lineHeight: number,
  minPx: number,
): number | undefined {
  if (!targetText || !sourceText) return undefined;
  const renderedHeight = (text: string, fontSize: number) => {
    const charsPerLine = Math.max(1, Math.floor(boxWidth / (fontSize * charRatio)));
    const lines = Math.max(1, linesWithWordWrap(text, charsPerLine));
    return lines * fontSize * lineHeight;
  };
  // (1) Word-break ceiling — fontSize at which the longest word still fits one line.
  const tokens = /\s/.test(targetText) ? targetText.split(/\s+/) : [targetText];
  const longest = tokens.reduce((acc, t) => Math.max(acc, t.length), 1);
  const wordFitCeiling = Math.floor(boxWidth / (longest * charRatio));

  // (2) Source-height bound at base size.
  const sourceHeight = renderedHeight(sourceText, basePx);

  const upper = Math.min(basePx, Math.max(minPx, wordFitCeiling));

  if (renderedHeight(targetText, upper) <= sourceHeight + 1) {
    return upper < basePx ? upper : undefined;
  }
  // Binary search the max fontSize ≤ upper that respects sourceHeight.
  let lo = minPx;
  let hi = upper;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    if (renderedHeight(targetText, mid) <= sourceHeight) lo = mid;
    else hi = mid;
  }
  const result = Math.floor(lo);
  return result < basePx ? result : undefined;
}

/** Re-fit all translated locales in one shot — same algorithm as refitLocale,
 *  runs over every locale that has at least one translation. */
export function refitAllLocales(): { locales: number; adjusted: number } {
  const st = useStudio.getState();
  let totalLocales = 0;
  let totalAdjusted = 0;
  for (const loc of st.locales) {
    if (!loc.translations || Object.keys(loc.translations).length === 0) continue;
    const { adjusted } = refitLocale(loc.code);
    totalLocales++;
    totalAdjusted += adjusted;
  }
  clog('refit', `refitAll — ${totalLocales} locales, ${totalAdjusted} slots adjusted`);
  return { locales: totalLocales, adjusted: totalAdjusted };
}
