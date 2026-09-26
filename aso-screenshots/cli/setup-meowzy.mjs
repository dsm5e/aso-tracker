#!/usr/bin/env node
/**
 * Meowzy (ex-PAW, games for cats) — builds the Studio project from data: 6 frames
 * for iPhone + iPad on the `meowzy-pastel` preset (YAZIO-like: light pastel canvas,
 * rounded bold headline, Apple bezel, orange-cat mascot layered around the phone),
 * 50 store locales with copy from screens-copy.json.
 *
 *   node cli/setup-meowzy.mjs                 # push into the running Studio
 *   node cli/setup-meowzy.mjs --dry           # print the slot / locale table only
 *   node cli/setup-meowzy.mjs --copy <json>   # copy file (default: public/uploads/meowzy/screens-copy.json)
 *
 * Assets (gitignored, public/uploads/meowzy/):
 *   <device>-0N-<name>.png   app captures, root = en UI; <lang>/… for localized UI
 *   decor/<pose>.png         transparent mascot poses (trimmed)
 *
 * The Studio holds ONE active project: back up ~/.aso-studio/state.json before
 * running and restore the previous project when done.
 *
 * API: the gateway serves the Studio on :5173 (`/studio-api`); override with
 * ASO_API for the standalone dev server (http://localhost:5181/api).
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.ASO_API ?? 'http://localhost:5173/studio-api';
const DIR = 'meowzy';
const BASE = `/studio/uploads/${DIR}`;
const DECOR = `${BASE}/decor`;
const UPLOADS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'uploads', DIR);
const dry = process.argv.includes('--dry');
const ci = process.argv.indexOf('--copy');
const copyPath = ci > -1 ? process.argv[ci + 1] : path.join(UPLOADS, 'screens-copy.json');
const COPY_FILE = JSON.parse(await readFile(copyPath, 'utf8'));
const COPY = COPY_FILE.locales;
const CHIPS = COPY_FILE.chips;

// Layout v2 (owner feedback 2026-09-26, YAZIO composition): ONE light background for
// every frame, big heavy LEFT-aligned headline, the device UPRIGHT, large and bleeding
// off the bottom edge at the same place on every frame; the mascot stays on all six
// frames, peeking around the device edges; facts as rounded chips over the screen edge.
// All geometry is per device family (fractions of the canvas); `chip` = localized chip
// copy key (copy.chips[locale][key]).
const BG = 'radial-gradient(85% 48% at 50% 64%, #FFFFFF 0%, #F3F6FB 55%, #E9EEF6 100%)';
const CHIP = {
  blue: { bg: '#1E63F0', color: '#FFFFFF' },
  orange: { bg: '#F2770F', color: '#FFFFFF' },
  yellow: { bg: '#FFC21A', color: '#1B2340' },
};
const FRAMES = {
  hook: {
    file: '01-hook.png', padEnd: { iphone: 30, ipad: 28 },
    decor: {
      // Peek pose: its straight bottom cut sits on the device's top edge, right side.
      iphone: [{ kind: 'image', src: 'peek.png', xFrac: 0.8, yFrac: 0.186, widthFrac: 0.34, layer: 'front', shadow: false, mirrorRtl: true }],
      ipad: [{ kind: 'image', src: 'peek.png', xFrac: 0.8, yFrac: 0.15, widthFrac: 0.24, layer: 'front', shadow: false, mirrorRtl: true }],
    },
    chips: { iphone: [{ key: 'hook', ...CHIP.blue, xFrac: 0.28, yFrac: 0.44, rotate: -4 }],
             ipad: [{ key: 'hook', ...CHIP.blue, xFrac: 0.18, yFrac: 0.42, rotate: -4 }] },
  },
  fish: {
    file: '02-fish.png',
    decor: {
      iphone: [{ kind: 'image', src: 'chase-fish.png', xFrac: 0.2, yFrac: 0.87, widthFrac: 0.44, layer: 'front' }],
      ipad: [{ kind: 'image', src: 'chase-fish.png', xFrac: 0.14, yFrac: 0.86, widthFrac: 0.3, layer: 'front' }],
    },
  },
  laser: {
    file: '03-laser.png', padEnd: { iphone: 30, ipad: 26 },
    decor: {
      iphone: [{ kind: 'image', src: 'pounce.png', xFrac: 0.8, yFrac: 0.255, widthFrac: 0.42, layer: 'front', flipX: true, mirrorRtl: true }],
      ipad: [{ kind: 'image', src: 'pounce.png', xFrac: 0.85, yFrac: 0.225, widthFrac: 0.3, layer: 'front', flipX: true, mirrorRtl: true }],
    },
  },
  prey: {
    file: '04-prey.png',
    decor: {
      iphone: [{ kind: 'image', src: 'surprised.png', xFrac: 0.83, yFrac: 0.88, widthFrac: 0.34, layer: 'front' }],
      ipad: [{ kind: 'image', src: 'surprised.png', xFrac: 0.88, yFrac: 0.86, widthFrac: 0.22, layer: 'front' }],
    },
    chips: { iphone: [{ key: 'prey', ...CHIP.orange, xFrac: 0.34, yFrac: 0.8, rotate: -3 }],
             ipad: [{ key: 'prey', ...CHIP.orange, xFrac: 0.24, yFrac: 0.84, rotate: -3 }] },
  },
  lock: {
    file: '05-lock.png',
    decor: {
      iphone: [{ kind: 'image', src: 'sleeping.png', xFrac: 0.78, yFrac: 0.89, widthFrac: 0.4, layer: 'front' }],
      ipad: [{ kind: 'image', src: 'sleeping.png', xFrac: 0.87, yFrac: 0.87, widthFrac: 0.26, layer: 'front' }],
    },
    chips: { iphone: [{ key: 'lock', ...CHIP.yellow, xFrac: 0.42, yFrac: 0.76, rotate: -3 }],
             ipad: [{ key: 'lock', ...CHIP.yellow, xFrac: 0.3, yFrac: 0.8, rotate: -3 }] },
  },
  catcam: {
    file: '06-catcam.png', pill: 'catcamPill',
    decor: {
      iphone: [{ kind: 'image', src: 'paw-tap.png', xFrac: 0.17, yFrac: 0.88, widthFrac: 0.4, layer: 'front' }],
      ipad: [{ kind: 'image', src: 'paw-tap.png', xFrac: 0.12, yFrac: 0.87, widthFrac: 0.26, layer: 'front' }],
    },
  },
};
const ORDER = ['hook', 'fish', 'laser', 'prey', 'lock', 'catcam'];

// Same device placement on every frame: `free` anchor (the headline length never moves
// the device), fixed top, scale ≈ 80 % (iPhone) / 88 % (iPad) of the canvas width.
const DEVICE = {
  // top = the frame's absolute top (canvas px, `fixed` anchor): identical on all frames.
  iphone: { W: 1320, titlePx: 165, subPx: 64, yFrac: 0.05, safeBottom: 0.2, scale: 1.0, top: 640, chipPx: 60 },
  ipad: { W: 2064, titlePx: 175, subPx: 70, yFrac: 0.04, safeBottom: 0.19, scale: 1.08, top: 640, chipPx: 70 },
};

// Store locales: the 50 keys of the copy file (= meowzy-metadata-v1.json).
const LOCALES = Object.keys(COPY);

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

// Store locale → app UI language folder = the app's xcstrings language (38 in PAW 1.3).
// Only the prey picker (frame 4) carries UI text; the game frames are language-neutral,
// so a missing folder simply falls back to en. Locales the app lacks → en.
const LOCALE_MAP = {
  'ar-SA': 'ar', ca: 'ca', cs: 'cs', da: 'da', 'de-DE': 'de', el: 'el', 'en-AU': 'en-AU', 'en-CA': 'en-CA',
  'en-GB': 'en-GB', 'en-US': 'en', 'es-ES': 'es', 'es-MX': 'es-MX', fi: 'fi', 'fr-FR': 'fr', 'fr-CA': 'fr-CA',
  he: 'he', hi: 'hi', hr: 'hr', hu: 'hu', id: 'id', it: 'it', ja: 'ja', ko: 'ko', ms: 'ms', no: 'nb',
  'nl-NL': 'nl', pl: 'pl', 'pt-BR': 'pt-BR', 'pt-PT': 'pt-PT', ro: 'ro', ru: 'ru', sk: 'sk', sv: 'sv', th: 'th',
  tr: 'tr', uk: 'uk', vi: 'vi', 'zh-Hans': 'zh-Hans', 'zh-Hant': 'zh-Hant',
};

function decorFor(key, dev, chips) {
  const f = FRAMES[key];
  const items = (f.decor?.[dev] ?? []).map((it) => ({ ...it, src: `${DECOR}/${it.src}` }));
  for (const c of f.chips?.[dev] ?? []) {
    items.push({ kind: 'bubble', chip: true, tail: 'none', text: chips[c.key], bg: c.bg, color: c.color,
      xFrac: c.xFrac, yFrac: c.yFrac, widthFrac: 0.8, rotate: c.rotate ?? 0, fontPx: DEVICE[dev].chipPx, layer: 'top' });
  }
  return items;
}

function slot(key, dev) {
  const f = FRAMES[key];
  const d = DEVICE[dev];
  const [verb, descriptor] = COPY['en-US'][key];
  return {
    id: `mz-${dev}-${key}`,
    filename: f.file,
    device: dev,
    kind: 'regular',
    sourceLayout: 'device',
    presetId: 'meowzy-pastel',
    sourceUrl: `${BASE}/${dev}-${f.file}`,
    enhancedUrl: null,
    backgroundOverride: BG,
    headline: { verb, descriptor, subhead: '' },
    ...(f.pill ? { pill: CHIPS['en-US'][f.pill] } : {}),
    font: 'Nunito',
    fontSize: d.titlePx,
    titlePx: d.titlePx,
    subPx: d.subPx,
    textYFraction: d.yFrac,
    headlineSafeBottomFraction: d.safeBottom,
    ...(f.padEnd ? { headlinePadEndU: f.padEnd[dev] } : {}),
    textX: 0,
    textY: 0,
    deviceAnchor: 'fixed',
    deviceX: 0,
    deviceY: d.top,
    deviceScale: d.scale,
    tiltDeg: 0,
    tiltX: 0,
    tiltY: 0,
    breakout: false,
    pulseScreen: 0,
    enhanceState: 'idle',
    decor: decorFor(key, dev, CHIPS['en-US']),
  };
}

const screenshots = [];
for (const dev of ['iphone', 'ipad']) for (const k of ORDER) screenshots.push(slot(k, dev));

const layoutVariants = [{ id: 'A', title: 'Default', slotIds: ['iphone', 'ipad'].flatMap((dev) => ORDER.map((k) => `mz-${dev}-${k}`)) }];

const locales = LOCALES.map((code) => {
  const copy = COPY[code];
  const translations = {};
  for (const s of screenshots) {
    const key = s.id.split('-').pop();
    const [verb, descriptor] = copy[key];
    translations[s.id] = { verb, descriptor, subhead: '' };
  }
  const decorTranslations = {};
  const pillTranslations = {};
  for (const s of screenshots) {
    const key = s.id.split('-').pop();
    const f = FRAMES[key];
    decorTranslations[s.id] = decorFor(key, s.device, CHIPS[code]).map((it) => (it.kind === 'bubble' ? it.text : null));
    if (f.pill) pillTranslations[s.id] = CHIPS[code][f.pill];
  }
  const meta = SCRIPT[code] ?? {};
  return {
    id: code, code, name: NAMES.of(code), flag: '',
    decorTranslations,
    pillTranslations,
    ...(meta.rtl ? { rtl: true } : {}),
    ...(meta.font ? { fontOverride: meta.font } : {}),
    translations,
    variant: 'A',
  };
});

// Localized UI manifest: language folders mirroring root files.
const entries = await readdir(UPLOADS, { withFileTypes: true });
const rootFiles = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
const files = {};
for (const e of entries) {
  if (!e.isDirectory() || e.name === 'decor') continue;
  files[e.name] = (await readdir(path.join(UPLOADS, e.name))).filter((n) => rootFiles.has(n)).sort();
}
const localizedSources = { dir: DIR, rootLang: 'en', files, localeMap: LOCALE_MAP, fallback: ['en'], defaultLang: 'en' };

if (dry) {
  for (const l of locales) console.log(l.code.padEnd(8), (LOCALE_MAP[l.code] ?? 'en').padEnd(3), l.rtl ? 'RTL' : '   ', l.translations['mz-iphone-hook'].verb);
  console.log(`${screenshots.length} slots; UI langs: ${Object.keys(files).join(' ') || '(root en only)'}`);
  process.exit(0);
}

const state = await fetch(`${API}/studio-state`).then((r) => r.json());
const next = {
  ...state,
  appName: 'Meowzy',
  appColor: '#F2770F',
  appIconUrl: null,
  bundleId: 'com.nomly.paw',
  devices: 'both',
  iphoneModel: 'iphone-17-pro-max',
  ipadModel: 'ipad-pro-13',
  sourceLocale: 'en-US',
  selectedPresetId: 'meowzy-pastel',
  screenshots,
  layoutVariants,
  locales,
  activeLocaleId: 'en-US',
  localizedSources,
  outputFolder: path.join(process.env.HOME, 'Desktop', 'Meowzy-release'),
  activeScreenshotId: screenshots[0].id,
  ppo: null,
};
const res = await fetch(`${API}/studio-state/push`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
});
console.log(res.status, await res.text());
console.log(`${screenshots.length} slots, ${locales.length} locales`);
