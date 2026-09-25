#!/usr/bin/env node
/**
 * Luna Dream (dream.nomly.com) — builds the Studio project from data: 7 frames
 * for iPhone + iPad on the `dream-night` preset, 50 store locales with captions
 * from cli/dream-copy.mjs, per-language app UI (localizedSources) and two
 * frame orders:
 *   A — default (vault ASO audit §8)
 *   T — tradition-first markets (ar/tr/ur/id/ms/bn): symbol frame at position 2
 *
 *   node cli/setup-dream.mjs          # push into the running Studio
 *   node cli/setup-dream.mjs --dry    # print the slot / locale table only
 *
 * Sources: public/uploads/dream/<device>-0N-<name>.png (root = en UI) and
 * public/uploads/dream/<lang>/… for de fr pt tr ar hi ja ko zh ru.
 * Backgrounds: public/uploads/dream/decor/bg-{iphone,ipad}.png (procedural).
 * Per-locale frame swaps: public/uploads/dream/variants/ (sourceOverrides).
 *
 * API: the gateway serves the Studio on :5173 (`/studio-api`); override with
 * ASO_API for the standalone dev server (http://localhost:5181/api).
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COPY, HERO, LOCALE_COPY, TRADITION_FIRST } from './dream-copy.mjs';

const API = process.env.ASO_API ?? 'http://localhost:5173/studio-api';
const DIR = 'dream';
const BASE = `/studio/uploads/${DIR}`;
const UPLOADS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'uploads', DIR);
const dry = process.argv.includes('--dry');

// Frame catalogue — source capture + composition tweaks (fractions of canvas width).
const FRAMES = {
  result: { file: '01-result_done.png' },
  voice: { file: '02-voice.png' },
  interp: { file: '03-interpretation.png' },
  symbol: { file: '04-symbol.png' },
  chat: { file: '05-chat.png' },
  image: { file: '06-image.png', scale: { iphone: 1.3, ipad: 1.15 } },
  // iPad: the dual mockup's fixed offsets are iPhone-sized, so iPad shows Insights alone.
  insights: { file: '07-insights.png', secondary: { iphone: '08-journal.png' }, scale: { iphone: 0.86, ipad: 1 }, dx: { iphone: 0.03 } },
  // Hero (frame 1, concept A): Journal in front, Insights behind on iPhone; on iPad
  // Journal alone plus a "Luna noticed" card cut from the localized Insights screen.
  // AI background (fal gpt-image-2 edit, medium), laurels with product facts,
  // symbol tiles cut from the real result screen, lavender glow.
  hero: { file: '08-journal.png', secondary: { iphone: '07-insights.png' }, scale: { iphone: 0.8, ipad: 0.86 }, dx: { iphone: 0.03 }, hero: true },
};

const DECOR = `${BASE}/decor`;
const HERO_DECOR = {
  iphone: {
    yFrac: 0.13,
    items: [
      { kind: 'laurel', xFrac: 0.28, yFrac: 0.064, widthFrac: 0.42, fontPx: 44, layer: 'top' },
      { kind: 'laurel', xFrac: 0.72, yFrac: 0.064, widthFrac: 0.42, fontPx: 44, layer: 'top' },
      { kind: 'image', src: `${DECOR}/glow.png`, xFrac: 0.5, yFrac: 0.62, widthFrac: 1.35, layer: 'back', shadow: false, opacity: 0.85 },
      { kind: 'image', src: `${DECOR}/chip-moon.png`, xFrac: 0.1, yFrac: 0.45, widthFrac: 0.15, rotate: -10, layer: 'top' },
      { kind: 'image', src: `${DECOR}/chip-water.png`, xFrac: 0.92, yFrac: 0.6, widthFrac: 0.13, rotate: 9, layer: 'top' },
      { kind: 'image', src: `${DECOR}/chip-horse.png`, xFrac: 0.1, yFrac: 0.76, widthFrac: 0.16, rotate: 7, layer: 'top' },
    ],
  },
  ipad: {
    yFrac: 0.125,
    items: [
      { kind: 'laurel', xFrac: 0.34, yFrac: 0.058, widthFrac: 0.3, fontPx: 58, layer: 'top' },
      { kind: 'laurel', xFrac: 0.66, yFrac: 0.058, widthFrac: 0.3, fontPx: 58, layer: 'top' },
      { kind: 'image', src: `${DECOR}/glow.png`, xFrac: 0.5, yFrac: 0.62, widthFrac: 1.1, layer: 'back', shadow: false, opacity: 0.85 },
      { kind: 'image', src: `${BASE}/ipad-09-insightscard.png`, xFrac: 0.76, yFrac: 0.7, widthFrac: 0.44, rotate: 3, layer: 'top' },
      { kind: 'image', src: `${DECOR}/chip-moon.png`, xFrac: 0.08, yFrac: 0.46, widthFrac: 0.1, rotate: -10, layer: 'top' },
      { kind: 'image', src: `${DECOR}/chip-water.png`, xFrac: 0.93, yFrac: 0.42, widthFrac: 0.09, rotate: 9, layer: 'top' },
      { kind: 'image', src: `${DECOR}/chip-horse.png`, xFrac: 0.1, yFrac: 0.8, widthFrac: 0.11, rotate: 7, layer: 'top' },
    ],
  },
};
const ORDER_A = ['result', 'voice', 'interp', 'symbol', 'chat', 'image', 'insights'];
const ORDER_T = ['result', 'symbol', 'voice', 'interp', 'chat', 'image', 'insights'];
// iPhone (owner feedback 2026-09-25): the patterns pair opens the set, the rest keeps
// its relative order. FIRST = which phone of the pair stands in front.
// iPad follows the same order and hero (owner decision 2026-09-25).
const opener = (order) => ['hero', ...order.filter((k) => k !== 'insights')];
const ORDERS = {
  A: { iphone: opener(ORDER_A), ipad: opener(ORDER_A) },
  T: { iphone: opener(ORDER_T), ipad: opener(ORDER_T) },
};

const DEVICE = {
  iphone: { W: 1320, titlePx: 128, subPx: 60, yFrac: 0.06 },
  ipad: { W: 2064, titlePx: 168, subPx: 76, yFrac: 0.05 },
};

// Store locales: ASC list from the vault metadata (50).
const LOCALES = ['ar-SA', 'bn-BD', 'ca', 'cs', 'da', 'de-DE', 'el', 'en-AU', 'en-CA', 'en-GB', 'en-US',
  'es-ES', 'es-MX', 'fi', 'fr-CA', 'fr-FR', 'gu-IN', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn-IN',
  'ko', 'ml-IN', 'mr-IN', 'ms', 'nl-NL', 'no', 'or-IN', 'pa-IN', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru',
  'sk', 'sl-SI', 'sv', 'ta-IN', 'te-IN', 'th', 'tr', 'uk', 'ur-PK', 'vi', 'zh-Hans', 'zh-Hant'];

// Script metadata (mirrors src/lib/locales.ts — RTL + script font).
const SCRIPT = {
  'ar-SA': { rtl: true, font: 'Noto Sans Arabic' }, 'ur-PK': { rtl: true, font: 'Noto Sans Arabic' },
  he: { rtl: true, font: 'Noto Sans Hebrew' }, ja: { font: 'Noto Sans JP' }, ko: { font: 'Noto Sans KR' },
  'zh-Hans': { font: 'Noto Sans SC' }, 'zh-Hant': { font: 'Noto Sans TC' }, th: { font: 'Noto Sans Thai' },
  hi: { font: 'Noto Sans Devanagari' }, 'mr-IN': { font: 'Noto Sans Devanagari' },
  'bn-BD': { font: 'Noto Sans Bengali' }, 'gu-IN': { font: 'Noto Sans Gujarati' },
  'kn-IN': { font: 'Noto Sans Kannada' }, 'ml-IN': { font: 'Noto Sans Malayalam' },
  'or-IN': { font: 'Noto Sans Oriya' }, 'pa-IN': { font: 'Noto Sans Gurmukhi' },
  'ta-IN': { font: 'Noto Sans Tamil' }, 'te-IN': { font: 'Noto Sans Telugu' },
};
const NAMES = new Intl.DisplayNames(['en'], { type: 'language' });

// Store locale → app UI language folder (everything else: en root).
const LOCALE_MAP = {
  'de-DE': 'de', 'fr-FR': 'fr', 'fr-CA': 'fr', 'pt-BR': 'pt', 'pt-PT': 'pt', tr: 'tr', 'ar-SA': 'ar',
  hi: 'hi', ja: 'ja', ko: 'ko', 'zh-Hans': 'zh', 'zh-Hant': 'zh', ru: 'ru',
};

function slot(key, dev) {
  const f = FRAMES[key];
  const d = DEVICE[dev];
  return {
    id: `dr-${dev}-${key}`,
    filename: f.file,
    device: dev,
    kind: 'regular',
    sourceLayout: 'device',
    presetId: 'dream-night',
    sourceUrl: `${BASE}/${dev}-${f.file}`,
    secondaryUrl: f.secondary?.[dev] ? `${BASE}/${dev}-${f.secondary[dev]}` : undefined,
    enhancedUrl: null,
    backgroundOverride: `#12142B url("${BASE}/decor/${f.hero ? 'hero-bg' : 'bg'}-${dev}.png") center / cover no-repeat`,
    headline: f.hero
      ? { verb: HERO.en[0], descriptor: COPY.en.insights[1], subhead: '' }
      : { verb: COPY.en[f.copy ?? key][0], descriptor: COPY.en[f.copy ?? key][1], subhead: '' },
    font: 'Noto Serif Display',
    fontSize: d.titlePx,
    titlePx: d.titlePx,
    subPx: d.subPx,
    textYFraction: f.hero ? HERO_DECOR[dev].yFrac : d.yFrac,
    textX: 0,
    textY: 0,
    deviceX: Math.round((f.dx?.[dev] ?? 0) * d.W),
    deviceY: 0,
    deviceScale: f.scale?.[dev] ?? 1,
    tiltDeg: 0,
    tiltX: 0,
    tiltY: 0,
    breakout: false,
    pulseScreen: 0,
    enhanceState: 'idle',
    ...(f.hero ? { decor: HERO_DECOR[dev].items.map((it, i) => (i < 2 ? { ...it, text: HERO.en[i + 1] } : it)) } : {}),
  };
}

const screenshots = [];
for (const dev of ['iphone', 'ipad']) {
  for (const [k, f] of Object.entries(FRAMES)) if (!f.devices || f.devices.includes(dev)) screenshots.push(slot(k, dev));
}

const layoutVariants = [
  { id: 'A', title: 'Default' },
  { id: 'T', title: 'Tradition first' },
].map((v) => ({ id: v.id, title: v.title, slotIds: ['iphone', 'ipad'].flatMap((dev) => ORDERS[v.id][dev].map((k) => `dr-${dev}-${k}`)) }));

// en-UI tradition-first locales: the symbol frame opens on the Islamic tab
// (en capture with "Islamic Interpretation / Islamic (Ibn Sirin)" selected).
const ISLAMIC_EN_UI = ['ur-PK', 'id', 'ms', 'bn-BD'];
const islamicSymbol = Object.fromEntries(['iphone', 'ipad'].map((dev) => [
  `dr-${dev}-symbol`, `${BASE}/variants/${dev}-04-symbol-islamic.png`,
]));

const locales = LOCALES.map((code) => {
  const lang = LOCALE_COPY[code] ?? code;
  const copy = COPY[lang];
  if (!copy) throw new Error(`no copy for ${code} (${lang})`);
  const translations = {};
  for (const s of screenshots) {
    const key = s.id.split('-').pop();
    const [verb, descriptor] = FRAMES[key].hero ? [HERO[lang][0], copy.insights[1]] : copy[FRAMES[key].copy ?? key];
    translations[s.id] = { verb, descriptor, subhead: '' };
  }
  // Laurel copy = decor slots 0 and 1 of each hero slot.
  const decorTranslations = Object.fromEntries(['iphone', 'ipad'].map((dev) => [
    `dr-${dev}-hero`, HERO_DECOR[dev].items.map((_, i) => (i < 2 ? HERO[lang][i + 1] : null)),
  ]));
  const meta = SCRIPT[code] ?? {};
  return {
    id: code, code, name: NAMES.of(code), flag: '',
    ...(meta.rtl ? { rtl: true } : {}),
    ...(meta.font ? { fontOverride: meta.font } : {}),
    translations,
    decorTranslations,
    ...(ISLAMIC_EN_UI.includes(code) ? { sourceOverrides: islamicSymbol } : {}),
    // Bengali headline runs taller: shrink it a bit on the iPhone symbol frame so the
    // phone rises and the Islamic tab row stays inside the canvas.
    ...(code === 'bn-BD' ? { slotAdjustments: { 'dr-iphone-symbol': { titlePx: 112, subPx: 54 } } } : {}),
    variant: TRADITION_FIRST.includes(code) ? 'T' : 'A',
  };
});

// Localized UI manifest: language folders mirroring root files.
const rootFiles = new Set((await readdir(UPLOADS, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name));
const files = {};
for (const e of await readdir(UPLOADS, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name === 'decor' || e.name === 'variants') continue;
  files[e.name] = (await readdir(path.join(UPLOADS, e.name))).filter((n) => rootFiles.has(n)).sort();
}
const localizedSources = { dir: DIR, rootLang: 'en', files, localeMap: LOCALE_MAP, fallback: ['en'], defaultLang: 'en' };

if (dry) {
  for (const l of locales) console.log(l.code.padEnd(8), l.variant, (LOCALE_MAP[l.code] ?? 'en').padEnd(3), l.rtl ? 'RTL' : '   ', l.translations['dr-iphone-result'].verb.replace('\n', ' '));
  console.log(`langs: ${Object.keys(files).join(' ')}`);
  process.exit(0);
}

const state = await fetch(`${API}/studio-state`).then((r) => r.json());
const next = {
  ...state,
  appName: 'Luna Dream',
  appColor: '#12142B',
  appIconUrl: null,
  bundleId: 'dream.nomly.com',
  devices: 'both',
  iphoneModel: 'iphone-17-pro-max',
  ipadModel: 'ipad-pro-13',
  sourceLocale: 'en-US',
  selectedPresetId: 'dream-night',
  screenshots,
  layoutVariants,
  locales,
  activeLocaleId: 'en-US',
  localizedSources,
  outputFolder: path.join(process.env.HOME, 'Desktop', 'Dream-release'),
  activeScreenshotId: screenshots[0].id,
  ppo: null,
};
const res = await fetch(`${API}/studio-state/push`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
});
console.log(res.status, await res.text());
console.log(`${screenshots.length} slots, ${locales.length} locales, variants A/T; tradition-first: ${TRADITION_FIRST.join(',')}`);
