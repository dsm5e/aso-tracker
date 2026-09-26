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
const COPY = JSON.parse(await readFile(copyPath, 'utf8')).locales;

// Frame catalogue — source capture, pastel tint and the composition (fractions of canvas width/height).
// Geometry is authored for iPhone; iPad derives from it in decorFor().
const FRAMES = {
  hook: {
    file: '01-hook.png', tint: '#FFE9D2',
    // Fixed (not headline-anchored) so the peek pose lines up with the phone's top
    // edge in every locale, whatever the headline wraps to.
    anchor: 'free',
    device: { dx: 0, scale: 0.9, dy: 0.256, dyIpad: 0.0935 },
    decor: [
      // Peek pose: straight bottom cut sits on the phone's top edge (paws over the bezel).
      { kind: 'image', src: 'peek.png', xFrac: 0.5, yFrac: 0.263, yFracIpad: 0.225, widthFrac: 0.44, layer: 'front', shadow: false },
      { kind: 'doodle', shape: 'sparkle', xFrac: 0.12, yFrac: 0.3, widthFrac: 0.07, stroke: '#FFC21A', layer: 'top' },
      { kind: 'doodle', shape: 'sparkle', xFrac: 0.9, yFrac: 0.26, widthFrac: 0.05, stroke: '#FFC21A', layer: 'top' },
    ],
  },
  fish: {
    file: '02-fish.png', tint: '#DDF3FF',
    device: { dx: 0.1, scale: 0.86, tilt: 4 },
    decor: [
      { kind: 'image', src: 'chase-fish.png', xFrac: 0.24, yFrac: 0.8, widthFrac: 0.54, layer: 'front' },
      { kind: 'doodle', shape: 'sparkle', xFrac: 0.1, yFrac: 0.56, widthFrac: 0.06, stroke: '#FFC21A', layer: 'top' },
    ],
  },
  laser: {
    file: '03-laser.png', tint: '#EFE8FF',
    device: { dx: -0.1, scale: 0.86, tilt: -4 },
    decor: [
      { kind: 'image', src: 'pounce.png', xFrac: 0.72, yFrac: 0.66, widthFrac: 0.6, layer: 'front', flipX: true },
      { kind: 'doodle', shape: 'burst', xFrac: 0.88, yFrac: 0.44, widthFrac: 0.12, stroke: '#FF5A7A', layer: 'top' },
    ],
  },
  prey: {
    file: '04-prey.png', tint: '#E3F6EA',
    device: { dx: -0.08, scale: 0.86, tilt: -3 },
    decor: [
      { kind: 'image', src: 'surprised.png', xFrac: 0.8, yFrac: 0.83, widthFrac: 0.44, layer: 'front' },
      { kind: 'doodle', shape: 'star', xFrac: 0.9, yFrac: 0.5, widthFrac: 0.07, stroke: '#FFC21A', layer: 'top' },
    ],
  },
  lock: {
    file: '05-lock.png', tint: '#FFF3C9',
    device: { dx: 0.1, scale: 0.86, tilt: 3 },
    decor: [
      { kind: 'image', src: 'sleeping.png', xFrac: 0.22, yFrac: 0.86, widthFrac: 0.48, layer: 'front' },
    ],
  },
  catcam: {
    file: '06-catcam.png', tint: '#FFE3EC',
    device: { dx: -0.08, scale: 0.86, tilt: -3 },
    decor: [
      { kind: 'image', src: 'paw-tap.png', xFrac: 0.78, yFrac: 0.82, widthFrac: 0.5, layer: 'front', flipX: true },
      { kind: 'doodle', shape: 'heart', xFrac: 0.9, yFrac: 0.52, widthFrac: 0.07, stroke: '#FF6B8B', rotate: 12, layer: 'top' },
    ],
  },
};
const ORDER = ['hook', 'fish', 'laser', 'prey', 'lock', 'catcam'];

const DEVICE = {
  iphone: { W: 1320, titlePx: 150, subPx: 66, yFrac: 0.055, decorScale: 1 },
  ipad: { W: 2064, titlePx: 150, subPx: 64, yFrac: 0.045, decorScale: 0.62 },
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

// Store locale → app UI language folder (everything else: en root). Filled once
// the fresh captures land; languages without a folder fall back to en.
const LOCALE_MAP = {
  'de-DE': 'de', 'fr-FR': 'fr', 'fr-CA': 'fr', 'es-MX': 'es', 'es-ES': 'es', 'pt-BR': 'pt', 'pt-PT': 'pt',
  it: 'it', ja: 'ja', ko: 'ko', 'zh-Hans': 'zh', 'zh-Hant': 'zh', ru: 'ru', uk: 'uk', tr: 'tr',
};

function decorFor(items, dev) {
  const d = DEVICE[dev];
  return items.map((it) => {
    const { yFracIpad, ...rest } = it;
    const out = { ...rest };
    if (it.src) out.src = `${DECOR}/${it.src}`;
    if (dev === 'ipad') {
      // The iPad canvas is far less tall relative to its width: shrink overlays and
      // pull them towards the side gutters so they frame the wider tablet.
      out.widthFrac = +(it.widthFrac * d.decorScale).toFixed(3);
      out.xFrac = +(0.5 + (it.xFrac - 0.5) * 1.12).toFixed(3);
      if (yFracIpad != null) out.yFrac = yFracIpad;
    }
    return out;
  });
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
    backgroundOverride: `radial-gradient(120% 62% at 50% 52%, #FFFFFF 0%, ${f.tint} 62%, ${f.tint} 100%)`,
    headline: { verb, descriptor, subhead: '' },
    font: 'Nunito',
    fontSize: d.titlePx,
    titlePx: d.titlePx,
    subPx: d.subPx,
    textYFraction: d.yFrac,
    textX: 0,
    textY: 0,
    deviceX: Math.round((f.device.dx ?? 0) * d.W),
    deviceY: Math.round(((dev === 'ipad' ? f.device.dyIpad : undefined) ?? f.device.dy ?? 0) * d.W),
    deviceScale: f.device.scale ?? 1,
    tiltDeg: f.device.tilt ?? 0,
    tiltX: 0,
    tiltY: 0,
    breakout: false,
    pulseScreen: 0,
    enhanceState: 'idle',
    ...(f.anchor ? { deviceAnchor: f.anchor } : {}),
    decor: decorFor(f.decor, dev),
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
  const meta = SCRIPT[code] ?? {};
  return {
    id: code, code, name: NAMES.of(code), flag: '',
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
