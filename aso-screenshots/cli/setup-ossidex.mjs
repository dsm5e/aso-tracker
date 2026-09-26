#!/usr/bin/env node
/**
 * Ossidex (ex-MedScan, DICOM / CBCT viewer) — builds the Studio project: 6 frames
 * per variant for iPhone + iPad on the `ossidex-clinical` preset.
 *   A — main set; B/C/D — PPO treatments (copy in cli/ossidex-copy.mjs).
 * Every variant has its own slots (same captures, own captions), and a layout
 * variant lists them in order, so `render-export --variants A,B,C,D` renders all.
 *
 *   node cli/setup-ossidex.mjs [--locales en-US,en-GB]
 *
 * Sources: public/uploads/ossidex/<device>-<frame>.png — raw frames from the app's
 * StoreScreenshotsE2ETests (real anonymised CBCT). Decor: public/uploads/ossidex/decor.
 */
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COMPAT, QUOTE, VARIANTS } from './ossidex-copy.mjs';

const API = process.env.ASO_API ?? 'http://localhost:5173/studio-api';
const BASE = '/studio/uploads/ossidex';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const LOCALES = arg('locales', 'en-US').split(',');
const LOCALE_COPY = { 'en-US': 'en', 'en-GB': 'en', 'en-AU': 'en', 'en-CA': 'en', ru: 'ru' };

const FRAME_FILE = { arch: 'arch', mpr: 'mpr', '3d': 'full-3d', measure: 'measure', library: 'library', import: 'import' };
const DEVICE = {
  iphone: { titlePx: 124, subPx: 56, yFrac: 0.055, heroYFrac: 0.15, scale: 1 },
  ipad: { titlePx: 150, subPx: 66, yFrac: 0.045, heroYFrac: 0.13, scale: 1 },
};
const BG = 'radial-gradient(120% 70% at 50% 62%, #1B3A7A 0%, #0E1A33 45%, #070A10 100%)';
// Visual theory per variant (owner 2026-09-26: same copy, test colours and layout).
const STYLE = {
  A: { preset: 'ossidex-clinical', bg: BG, band: 'band', press: 'press', quoteBg: 'rgba(14,26,51,.94)', quoteFg: '#FFFFFF' },
  B: { preset: 'ossidex-light', bg: 'linear-gradient(180deg,#FFFFFF 0%,#EEF3FA 60%,#DCE7F7 100%)', band: 'band-light', press: 'press-dark',
       quoteBg: '#FFFFFF', quoteFg: '#0B1B33', laurel: '#8A5E0F', bezel: 'silver' },
  C: { preset: 'ossidex-blue', bg: 'linear-gradient(160deg,#3D8BFD 0%,#1D4ED8 55%,#1E3A8A 100%)', band: 'band-blue', press: 'press-white',
       quoteBg: 'rgba(8,20,60,.9)', quoteFg: '#FFFFFF', laurel: '#FFFFFF', tilt: 6, bezel: 'silver', scale: 0.94 },
  D: { preset: 'ossidex-editorial', bg: '#05070C', band: 'band-black', press: 'press', quoteBg: 'rgba(255,255,255,.08)', quoteFg: '#FFFFFF',
       align: 'left', frame: 'frameless', scale: 1.1, dy: { iphone: 60, ipad: 50 } },
};

function heroDecor(dev, lang, v = 'A') {
  const st = STYLE[v];
  const [eyebrow, vendors] = COMPAT[lang] ?? COMPAT.en;
  const ip = dev === 'ipad';
  const ink = st.preset === 'ossidex-light' ? ['#5B6B84', '#0B1B33'] : ['#8FA3BF', '#FFFFFF'];
  return [
    { kind: 'bubble', xFrac: 0.5, yFrac: ip ? 0.036 : 0.045, widthFrac: 0.9, layer: 'top', text: eyebrow,
      bg: 'transparent', color: ink[0], fontPx: ip ? 30 : 26, tail: 'none', shadow: false },
    { kind: 'bubble', xFrac: 0.5, yFrac: ip ? 0.066 : 0.078, widthFrac: 0.94, layer: 'top', text: vendors,
      bg: 'transparent', color: ink[1], fontPx: ip ? 44 : 40, tail: 'none', shadow: false },
    { kind: 'image', src: `${BASE}/decor/${st.band}.png`, xFrac: 0.5, yFrac: ip ? 0.93 : 0.925, widthFrac: 1.02, layer: 'top', shadow: false },
    { kind: 'bubble', xFrac: ip ? 0.74 : 0.66, yFrac: ip ? 0.78 : 0.76, widthFrac: ip ? 0.34 : 0.56, rotate: -3, layer: 'top',
      text: QUOTE[lang] ?? QUOTE.en, bg: st.quoteBg, color: st.quoteFg, fontPx: ip ? 44 : 42, tail: 'none' },
    { kind: 'image', src: `${BASE}/decor/${st.press}.png`, xFrac: 0.5, yFrac: 0.962, widthFrac: ip ? 0.6 : 0.86, layer: 'top', shadow: false, opacity: 1 },
  ];
}

function slot(variant, dev, frame, idx, head, sub) {
  const d = DEVICE[dev];
  const hero = idx === 0;
  const st = STYLE[variant];
  const tilt = st.tilt ? (idx % 2 ? -st.tilt : st.tilt) : 0;
  return {
    id: `ox-${variant}-${dev}-${frame}`,
    filename: `${dev}-${FRAME_FILE[frame]}.png`,
    device: dev,
    kind: 'regular',
    sourceLayout: 'device',
    presetId: st.preset,
    sourceUrl: `${BASE}/${dev}-${FRAME_FILE[frame]}.png`,
    enhancedUrl: null,
    backgroundOverride: st.bg,
    ...(st.align ? { textAlignOverride: st.align } : {}),
    ...(st.frame ? { deviceFrameStyle: st.frame } : {}),
    ...(st.bezel ? { deviceBezelColor: st.bezel } : {}),
    headline: { verb: head, descriptor: sub, subhead: '' },
    font: 'Inter',
    fontSize: d.titlePx,
    titlePx: d.titlePx,
    subPx: d.subPx,
    textYFraction: hero ? d.heroYFrac : d.yFrac,
    textX: 0, textY: 0, deviceX: 0, deviceY: st.dy?.[dev] ?? 0,
    deviceScale: (hero ? 0.84 : d.scale) * (st.scale ?? 1),
    tiltDeg: tilt, tiltX: 0, tiltY: 0,
    breakout: false, pulseScreen: 0, enhanceState: 'idle',
    ...(hero ? { decor: heroDecor(dev, 'en', variant) } : {}),
  };
}

const screenshots = [];
const layoutVariants = [];
for (const v of Object.keys(VARIANTS.en)) {
  const ids = [];
  for (const dev of ['iphone', 'ipad']) {
    VARIANTS.en[v].forEach(([frame, head, sub], i) => {
      const s = slot(v, dev, frame, i, head, sub);
      screenshots.push(s);
      ids.push(s.id);
    });
  }
  layoutVariants.push({ id: v, title: { A: 'Main', B: 'No laptop', C: 'Any scanner', D: 'In seconds' }[v], slotIds: ids });
}

const NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
const locales = LOCALES.map((code) => {
  const lang = LOCALE_COPY[code] ?? 'en';
  const copy = VARIANTS[lang] ?? VARIANTS.en;
  const translations = {};
  const decorTranslations = {};
  for (const v of Object.keys(copy)) {
    for (const dev of ['iphone', 'ipad']) {
      copy[v].forEach(([frame, head, sub], i) => {
        const id = `ox-${v}-${dev}-${frame}`;
        translations[id] = { verb: head, descriptor: sub, subhead: '' };
        if (i === 0) decorTranslations[id] = heroDecor(dev, lang, v).map((it) => it.text ?? null);
      });
    }
  }
  return { id: code, code, name: NAMES.of(code), flag: '', translations, decorTranslations, variant: 'A' };
});

const state = await fetch(`${API}/studio-state`).then((r) => r.json());
const next = {
  ...state,
  appName: 'Ossidex',
  appColor: '#0E1A33',
  appIconUrl: null,
  bundleId: 'com.medscan.dicom.ct.mri.radiology.scan.viewer',
  devices: 'both',
  iphoneModel: 'iphone-17-pro-max',
  ipadModel: 'ipad-pro-13',
  sourceLocale: 'en-US',
  selectedPresetId: 'ossidex-clinical',
  screenshots,
  layoutVariants,
  locales,
  activeLocaleId: 'en-US',
  localizedSources: (() => {
    // Per-language UI captures: public/uploads/ossidex/<lang>/<device>-<frame>.png
    const up = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'uploads', 'ossidex');
    const files = {};
    for (const lang of ['ru']) if (existsSync(path.join(up, lang))) files[lang] = readdirSync(path.join(up, lang)).filter((f) => f.endsWith('.png')).sort();
    return Object.keys(files).length ? { dir: 'ossidex', rootLang: 'en', files, localeMap: { ru: 'ru' }, fallback: ['en'], defaultLang: 'en' } : null;
  })(),
  outputFolder: path.join(process.env.HOME, 'Desktop', 'Ossidex-release'),
  activeScreenshotId: screenshots[0].id,
  ppo: null,
};
const res = await fetch(`${API}/studio-state/push`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
});
console.log(res.status, await res.text());
console.log(`${screenshots.length} slots, variants ${layoutVariants.map((v) => v.id).join('/')}, locales ${LOCALES.join(',')}`);
