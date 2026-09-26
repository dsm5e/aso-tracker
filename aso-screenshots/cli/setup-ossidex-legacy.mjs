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
import { FRAMES, LEGACY, LOCALE_COPY, QUOTE, UI_LANG } from './ossidex-legacy-copy.mjs';

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
    { kind: 'bubble', xFrac: ip ? 0.77 : 0.7, yFrac: ip ? 0.8 : 0.79, widthFrac: ip ? 0.34 : 0.56, rotate: -3, layer: 'top',
      text: QUOTE[lang] ?? QUOTE.en, bg: 'rgba(14,26,51,.94)', color: '#FFFFFF', fontPx: ip ? 44 : 42, tail: 'none' },
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
    sourceLayout: 'device',
    presetId: 'ossidex-clinical',
    sourceUrl: `${BASE}/${dev}-${FILE[frame]}.png`,
    enhancedUrl: null,
    backgroundOverride: hero ? `#1E4FD8 url("${BASE}/decor/legacy-hero-bg-${dev}.png") center / cover no-repeat` : GLOW,
    headline: { verb: head, descriptor: sub, subhead: '' },
    font: 'Inter',
    fontSize: d.titlePx, titlePx: hero ? d.titlePx * 1.12 : d.titlePx, subPx: d.subPx,
    textYFraction: d.yFrac,
    textX: 0, textY: 0, deviceX: hero ? Math.round(d.W * 0.03) : 0, deviceY: 0,
    deviceScale: hero ? 0.72 : 0.78,
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
    if (FRAMES.indexOf(frame) === 0) decorTranslations[s.id] = heroDecor(s.device, lang === 'ru' ? 'ru' : 'en').map((it) => it.text ?? null);
  }
  const meta = SCRIPT[code] ?? {};
  return { id: code, code, name: NAMES.of(code), flag: '', ...(meta.rtl ? { rtl: true } : {}), ...(meta.font ? { fontOverride: meta.font } : {}),
    translations, decorTranslations, variant: 'L' };
});

// Localized UI captures: public/uploads/ossidex/<lang>/<device>-<frame>.png
const files = {};
for (const lang of new Set(Object.values(UI_LANG))) {
  const dir = path.join(UPLOADS, lang);
  if (existsSync(dir)) files[lang] = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
}
const localeMap = Object.fromEntries(ASC.map((c) => [c, UI_LANG[c] ?? 'en']));

const state = await fetch(`${API}/studio-state`).then((r) => r.json());
const next = {
  ...state,
  appName: 'Ossidex', appColor: '#1E4FD8', appIconUrl: null,
  bundleId: 'com.medscan.dicom.ct.mri.radiology.scan.viewer',
  devices: 'both', iphoneModel: 'iphone-17-pro-max', ipadModel: 'ipad-pro-12.9',
  sourceLocale: 'en-US', selectedPresetId: 'ossidex-clinical',
  screenshots, layoutVariants, locales, activeLocaleId: LOCALES[0],
  localizedSources: Object.keys(files).length ? { dir: 'ossidex', rootLang: 'en', files, localeMap, fallback: ['en'], defaultLang: 'en' } : null,
  outputFolder: path.join(process.env.HOME, 'Desktop', 'Ossidex-release'),
  activeScreenshotId: screenshots[0].id, ppo: null,
};
const res = await fetch(`${API}/studio-state/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
console.log(res.status, await res.text());
console.log(`${screenshots.length} slots, ${locales.length} locales, UI langs: ${Object.keys(files).join(' ') || 'en only'}`);
