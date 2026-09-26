#!/usr/bin/env node
/**
 * Ossidex main store set = the 1.10 store design with fresh UI (owner 2026-09-26):
 * blue hero with the original X-ray decorations, «As seen in» row and the Dr. R. quote,
 * then five frames on the dark-navy glow. Copy: cli/ossidex-legacy-copy.mjs.
 *
 *   node cli/setup-ossidex-legacy.mjs [--locales en-US,ru|asc]
 *
 * Sources: public/uploads/ossidex/<device>-<frame>.png (en UI) and
 * public/uploads/ossidex/<lang>/… (UI captured in the languages with purchases).
 * Hero backgrounds: uploads/ossidex/decor/legacy-hero-bg-{iphone,ipad}.png — the live
 * hero with its phone, headline and quote removed (the rest of the art kept).
 */
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FRAMES, LEGACY, LOCALE_COPY, PAIN, VENDORS } from './ossidex-legacy-copy.mjs';

const API = process.env.ASO_API ?? 'http://localhost:5173/studio-api';
const BASE = '/studio/uploads/ossidex';
const UPLOADS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'uploads', 'ossidex');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const ASC = ['ar-SA', 'bn-BD', 'ca', 'cs', 'da', 'de-DE', 'el', 'en-AU', 'en-CA', 'en-GB', 'en-US', 'es-ES', 'es-MX', 'fi',
  'fr-CA', 'fr-FR', 'gu-IN', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn-IN', 'ko', 'ml-IN', 'mr-IN', 'ms', 'nl-NL', 'no',
  'or-IN', 'pa-IN', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl-SI', 'sv', 'ta-IN', 'te-IN', 'th', 'tr', 'uk', 'ur-PK', 'vi',
  'zh-Hans', 'zh-Hant'];
const wanted = arg('locales', 'en-US');
const LOCALES = wanted === 'asc' ? ASC : wanted.split(',');

const FILE = { arch: 'arch-grid', mpr: 'mpr', '3d': 'full-3d', measure: 'measure', library: 'library', '2d': '2d' };
const DEVICE = {
  iphone: { titlePx: 132, subPx: 58, yFrac: 0.052, W: 1320 },
  ipad: { titlePx: 150, subPx: 64, yFrac: 0.04, W: 2064 },
};
// Sampled from the live frames: navy top, blue glow behind the device, near-black floor.
const GLOW = 'radial-gradient(95% 55% at 50% 34%, #2F5BA6 0%, #1A3566 42%, #0F1C33 72%, #0A0F17 100%)';

function heroDecor(dev, lang) {
  const ip = dev === 'ipad';
  return [
    // Pain line + hand-drawn arrow where «Open a case» was.
    { kind: 'bubble', xFrac: ip ? 0.3 : 0.3, yFrac: ip ? 0.205 : 0.215, widthFrac: ip ? 0.5 : 0.56, rotate: -5, layer: 'top',
      text: PAIN[lang] ?? PAIN.en, bg: 'transparent', color: '#9CC8FF', fontPx: ip ? 72 : 62, tail: 'none', shadow: false },
    { kind: 'doodle', shape: 'arrow-curly', xFrac: ip ? 0.6 : 0.66, yFrac: ip ? 0.225 : 0.235, widthFrac: ip ? 0.08 : 0.13, rotate: 35, layer: 'top', color: '#9CC8FF' },
    // Vendors, just above the «As seen in» footer.
    { kind: 'bubble', xFrac: 0.5, yFrac: ip ? 0.885 : 0.9, widthFrac: 0.96, layer: 'top', text: VENDORS,
      bg: 'transparent', color: 'rgba(220,233,255,.92)', fontPx: ip ? 40 : 34, tail: 'none', shadow: false },
  ];
}

function slot(dev, frame, idx) {
  const d = DEVICE[dev];
  const hero = idx === 0;
  const [head, sub] = LEGACY.en[frame];
  return {
    id: `oxl-${dev}-${frame}`,
    filename: `${dev}-${FILE[frame]}.png`,
    device: dev,
    kind: 'regular',
    sourceLayout: hero ? 'full-bleed' : 'device',
    presetId: 'ossidex-clinical',
    sourceUrl: hero ? `${BASE}/decor/hero-final-${dev}.png` : `${BASE}/${dev}-${FILE[frame]}.png`,
    ...(hero ? { sourceScale: 1, sourceOffsetX: 0, sourceOffsetY: 0 } : {}),
    enhancedUrl: null,
    backgroundOverride: hero ? `#1E4FD8 url("${BASE}/decor/legacy-hero-bg-${dev}.png") center / cover no-repeat` : GLOW,
    headline: { verb: head, descriptor: sub, subhead: '' },
    font: 'Inter',
    fontSize: d.titlePx, titlePx: hero ? d.titlePx * 1.12 : d.titlePx, subPx: d.subPx,
    textYFraction: d.yFrac,
    textX: 0, textY: 0, deviceX: hero ? Math.round(d.W * 0.03) : 0, deviceY: 0,
    deviceScale: hero ? 0.72 : (dev === 'ipad' ? 0.95 : 0.78),
    subtitleColorOverride: '#FFFFFF',
    // The live hero device leans a little to the right.
    tiltDeg: hero ? 5 : 0, tiltX: 0, tiltY: 0,
    breakout: false, pulseScreen: 0, enhanceState: 'idle',
    ...(hero ? { decor: heroDecor(dev, 'en') } : {}),
  };
}

const screenshots = [];
for (const dev of ['iphone', 'ipad']) FRAMES.forEach((f, i) => screenshots.push(slot(dev, f, i)));
const layoutVariants = [{ id: 'L', title: 'Main (1.10 design, new UI)', slotIds: screenshots.map((s) => s.id) }];

const SCRIPT = {
  'ar-SA': { rtl: true, font: 'Noto Sans Arabic' }, 'ur-PK': { rtl: true, font: 'Noto Sans Arabic' },
  he: { rtl: true, font: 'Noto Sans Hebrew' }, ja: { font: 'Noto Sans JP' }, ko: { font: 'Noto Sans KR' },
  'zh-Hans': { font: 'Noto Sans SC' }, 'zh-Hant': { font: 'Noto Sans TC' }, th: { font: 'Noto Sans Thai' },
  hi: { font: 'Noto Sans Devanagari' },
};
const NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
const locales = LOCALES.map((code) => {
  const lang = LOCALE_COPY[code] ?? 'en';
  const copy = LEGACY[lang] ?? LEGACY.en;
  const translations = {};
  const decorTranslations = {};
  for (const s of screenshots) {
    const frame = s.id.split('-').slice(2).join('-');
    const [verb, descriptor] = copy[frame];
    translations[s.id] = { verb, descriptor, subhead: '' };
    if (FRAMES.indexOf(frame) === 0) decorTranslations[s.id] = heroDecor(s.device, lang).map((it) => it.text ?? null);
  }
  const meta = SCRIPT[code] ?? {};
  return { id: code, code, name: NAMES.of(code), flag: '', ...(meta.rtl ? { rtl: true } : {}), ...(meta.font ? { fontOverride: meta.font } : {}),
    translations, decorTranslations, variant: 'L' };
});

const state = await fetch(`${API}/studio-state`).then((r) => r.json());
const next = {
  ...state,
  appName: 'Ossidex', appColor: '#1E4FD8', appIconUrl: null,
  bundleId: 'com.medscan.dicom.ct.mri.radiology.scan.viewer',
  devices: 'both', iphoneModel: 'iphone-17-pro-max', ipadModel: 'ipad-pro-12.9',
  sourceLocale: 'en-US', selectedPresetId: 'ossidex-clinical',
  screenshots, layoutVariants, locales, activeLocaleId: LOCALES[0],
  localizedSources: null,   // UI captured in English only (owner 2026-09-26); copy is localized
  outputFolder: path.join(process.env.HOME, 'Desktop', 'Ossidex-release'),
  activeScreenshotId: screenshots[0].id, ppo: null,
};
const res = await fetch(`${API}/studio-state/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
console.log(res.status, await res.text());
console.log(`${screenshots.length} slots, ${locales.length} locales, UI: en`);
