#!/usr/bin/env node
/**
 * Live Aquarium (kids) — builds the Studio project from data: a pool of slots
 * for iPhone + iPad on the `liveaquarium-lagoon` preset, their decor layers
 * (kids, mascot, paper drawing, doodles, speech bubbles) and four PPO layout
 * variants. Everything stays a normal Studio slot, so the locale pipeline
 * translates headlines, pills and bubble copy without special cases.
 *
 *   node cli/setup-liveaquarium.mjs          # push into the running Studio
 *   node cli/setup-liveaquarium.mjs --dry    # print the slot table only
 *
 * Keeps every other project field (archivedProjects, locales, …) untouched;
 * only the active project's slots / variants / device settings are replaced.
 * Existing `locales` translations stay keyed by the same stable slot ids.
 */
const API = 'http://localhost:5181';
const BASE = 'http://localhost:5180/studio/uploads/liveaquarium';
const DECOR = `${BASE}/decor`;
const dry = process.argv.includes('--dry');

// Screen catalogue — the source capture, copy and the composition of each frame.
// Geometry is authored for iPhone (fractions of the canvas); iPad derives from it.
const SCREENS = {
  birth: {
    file: '05-birth.png',
    verb: 'ОЖИВИ\nРИСУНОК',
    descriptor: 'Рисунок станет живой 3D-рыбкой',
    device: { dx: 0.13, scale: 0.84, tilt: 5 },
    decor: [
      { kind: 'image', src: 'kid-girl-drawing.png', xFrac: 0.25, yFrac: 0.79, widthFrac: 0.56 },
      { kind: 'doodle', shape: 'arrow-curly', xFrac: 0.22, yFrac: 0.52, widthFrac: 0.2, rotate: -8, stroke: '#FFFFFF', shadow: true },
      { kind: 'doodle', shape: 'sparkle', xFrac: 0.09, yFrac: 0.43, widthFrac: 0.07, stroke: '#FFE27A', layer: 'top' },
      { kind: 'doodle', shape: 'sparkle', xFrac: 0.93, yFrac: 0.33, widthFrac: 0.05, stroke: '#FFE27A', layer: 'top' },
      { kind: 'bubble', text: 'Моя рыбка\nожила!', xFrac: 0.27, yFrac: 0.37, widthFrac: 0.46, tail: 'bottom-left', rotate: -4, layer: 'top' },
    ],
  },
  paint: {
    file: '04-workshop.png',
    verb: 'РАСКРАСЬ\nРЫБКУ',
    descriptor: 'Заливка, штампы, радуга',
    device: { dx: -0.05, scale: 0.9, tilt: -4 },
    decor: [
      { kind: 'image', src: 'crayons.png', xFrac: 0.2, yFrac: 0.93, widthFrac: 0.44, rotate: 14 },
      { kind: 'image', src: 'kid-boy-pointing.png', xFrac: 0.8, yFrac: 0.81, widthFrac: 0.5 },
      { kind: 'doodle', shape: 'scribble', xFrac: 0.1, yFrac: 0.5, widthFrac: 0.16, rotate: -20, stroke: '#FFE27A', shadow: true },
      { kind: 'doodle', shape: 'star', xFrac: 0.92, yFrac: 0.4, widthFrac: 0.07, stroke: '#FFC21A', layer: 'top' },
      { kind: 'doodle', shape: 'heart', xFrac: 0.08, yFrac: 0.64, widthFrac: 0.07, stroke: '#FF6B8B', rotate: -12, layer: 'top' },
    ],
  },
  photo: {
    file: '07-photo.png',
    verb: 'СФОТОГРАФИРУЙ\nРИСУНОК',
    descriptor: 'Любой рисунок с бумаги оживёт',
    device: { dx: 0.12, scale: 0.84, tilt: 6 },
    decor: [
      { kind: 'image', src: 'paper-fish.png', xFrac: 0.27, yFrac: 0.66, widthFrac: 0.5, rotate: -9 },
      { kind: 'doodle', shape: 'arrow', xFrac: 0.3, yFrac: 0.48, widthFrac: 0.22, rotate: -18, stroke: '#FFFFFF', shadow: true, layer: 'top' },
      { kind: 'doodle', shape: 'sparkle', xFrac: 0.1, yFrac: 0.5, widthFrac: 0.06, stroke: '#FFE27A', layer: 'top' },
      { kind: 'doodle', shape: 'star', xFrac: 0.14, yFrac: 0.86, widthFrac: 0.07, stroke: '#FFC21A', rotate: -12, layer: 'top' },
    ],
  },
  name: {
    file: '06-naming.png',
    verb: 'ДАЙ ИМЯ\nРЫБКЕ',
    descriptor: 'Каждая рыбка — питомец',
    device: { dx: -0.04, scale: 0.9, tilt: -3 },
    decor: [
      { kind: 'image', src: 'mascot.png', xFrac: 0.8, yFrac: 0.36, widthFrac: 0.38, rotate: 8 },
      { kind: 'bubble', text: 'Привет!\nЯ — Бублик!', xFrac: 0.32, yFrac: 0.35, widthFrac: 0.46, tail: 'right', rotate: -3, layer: 'top' },
      { kind: 'doodle', shape: 'heart', xFrac: 0.9, yFrac: 0.55, widthFrac: 0.08, stroke: '#FF6B8B', rotate: 12, layer: 'top' },
      { kind: 'doodle', shape: 'heart', xFrac: 0.08, yFrac: 0.6, widthFrac: 0.06, stroke: '#FF6B8B', rotate: -10, layer: 'top' },
    ],
  },
  care: {
    file: '02-focus.png',
    verb: 'КОРМИ\nИ ГЛАДЬ',
    descriptor: 'Рыбки растут и радуются',
    device: {},
    decor: [
      { kind: 'image', src: 'kid-girl-peek.png', xFrac: 0.5, yFrac: 0.968, widthFrac: 0.62 },
      { kind: 'doodle', shape: 'heart', xFrac: 0.1, yFrac: 0.52, widthFrac: 0.09, stroke: '#FF6B8B', rotate: -14, layer: 'top' },
      { kind: 'doodle', shape: 'heart', xFrac: 0.91, yFrac: 0.45, widthFrac: 0.07, stroke: '#FF6B8B', rotate: 12, layer: 'top' },
      { kind: 'doodle', shape: 'sparkle', xFrac: 0.88, yFrac: 0.62, widthFrac: 0.06, stroke: '#FFE27A', layer: 'top' },
    ],
  },
  world: {
    file: '01-aquarium.png',
    secondary: '02-focus.png',
    verb: 'СВОЙ ЖИВОЙ\nАКВАРИУМ',
    descriptor: 'Корабль, замок и морские жители',
    device: { dx: 0.05, scale: 0.86, dy: 0.02 },
    decor: [
      { kind: 'image', src: 'mascot.png', xFrac: 0.18, yFrac: 0.9, widthFrac: 0.34, rotate: -8 },
      { kind: 'doodle', shape: 'sparkle', xFrac: 0.9, yFrac: 0.3, widthFrac: 0.06, stroke: '#FFE27A', layer: 'top' },
    ],
  },
  collect: {
    file: '03-collection.png',
    verb: 'СОБЕРИ\nКОЛЛЕКЦИЮ',
    descriptor: 'Все рыбки ребёнка в одном месте',
    device: { dx: -0.06, scale: 0.9, tilt: -3 },
    decor: [
      { kind: 'image', src: 'kid-boy-thumbs.png', xFrac: 0.8, yFrac: 0.85, widthFrac: 0.48 },
      { kind: 'doodle', shape: 'star', xFrac: 0.1, yFrac: 0.5, widthFrac: 0.08, stroke: '#FFC21A', rotate: -10, layer: 'top' },
      { kind: 'doodle', shape: 'star', xFrac: 0.92, yFrac: 0.42, widthFrac: 0.06, stroke: '#FFE27A', rotate: 14, layer: 'top' },
      { kind: 'doodle', shape: 'burst', xFrac: 0.8, yFrac: 0.66, widthFrac: 0.2, stroke: '#FFE27A', layer: 'top' },
    ],
  },
  fantasy: {
    file: '05-birth.png',
    verb: 'РАЗВИВАЕТ\nФАНТАЗИЮ',
    descriptor: 'Рисует сам — и видит, как оживает',
    pill: 'БЕЗ РЕКЛАМЫ · 6–8 ЛЕТ',
    device: { dx: 0.13, scale: 0.84, tilt: 5 },
    decor: [
      { kind: 'image', src: 'kid-girl-crayon.png', xFrac: 0.24, yFrac: 0.8, widthFrac: 0.54 },
      { kind: 'doodle', shape: 'burst', xFrac: 0.13, yFrac: 0.54, widthFrac: 0.16, stroke: '#FFE27A', layer: 'top' },
      { kind: 'doodle', shape: 'swirl', xFrac: 0.4, yFrac: 0.56, widthFrac: 0.12, stroke: '#FFFFFF', shadow: true, layer: 'top' },
      { kind: 'bubble', text: 'Смотри,\nона плывёт!', xFrac: 0.28, yFrac: 0.4, widthFrac: 0.46, tail: 'bottom-left', rotate: -4, layer: 'top' },
    ],
  },
};

// Hero copies of a screen carry the badge; the plain screen stays pill-free.
const HEROES = {
  birthHero: { base: 'birth', pill: 'БЕЗ РЕКЛАМЫ' },
  paintHero: { base: 'paint', pill: 'БЕЗ РЕКЛАМЫ' },
  worldHero: { base: 'world', pill: 'БЕЗ РЕКЛАМЫ' },
};

// PPO treatments — identical to compose/render.cjs (V).
const VARIANTS = [
  { id: 'A', title: 'Магия', keys: ['birthHero', 'paint', 'photo', 'name', 'care', 'world', 'collect'] },
  { id: 'B', title: 'Раскраска', keys: ['paintHero', 'birth', 'photo', 'name', 'care', 'world', 'collect'] },
  { id: 'C', title: 'Для родителей', keys: ['fantasy', 'paint', 'photo', 'birth', 'name', 'care', 'collect'] },
  { id: 'D', title: 'Мир', keys: ['worldHero', 'birth', 'paint', 'photo', 'name', 'care', 'collect'] },
];

const DEVICE = {
  iphone: { W: 1320, titlePx: 205, subPx: 100, yFrac: 0.045, bubblePx: null, kidScale: 1 },
  ipad: { W: 2064, titlePx: 227, subPx: 116, yFrac: 0.035, bubblePx: 3.5, kidScale: 0.64 },
};

function decorFor(items, dev) {
  const d = DEVICE[dev];
  return items.map((it) => {
    const out = { ...it };
    if (it.src) out.src = `${DECOR}/${it.src}`;
    if (dev === 'ipad') {
      // iPad canvas is far less tall relative to its width: shrink overlays and
      // pull them towards the side gutters so they frame the wider tablet.
      out.widthFrac = +(it.widthFrac * (it.kind === 'bubble' ? 0.8 : d.kidScale)).toFixed(3);
      out.xFrac = +(0.5 + (it.xFrac - 0.5) * 1.04).toFixed(3);
      if (it.kind === 'bubble') out.fontPx = Math.round((d.bubblePx * d.W) / 100);
    }
    return out;
  });
}

function slot(key, dev) {
  const hero = HEROES[key];
  const sc = SCREENS[hero ? hero.base : key];
  const d = DEVICE[dev];
  const pill = hero ? hero.pill : sc.pill;
  return {
    id: `la-${dev}-${key}`,
    filename: sc.file,
    device: dev,
    kind: 'regular',
    sourceLayout: 'device',
    presetId: 'liveaquarium-lagoon',
    sourceUrl: `${BASE}/${dev}-${sc.file}`,
    secondaryUrl: sc.secondary ? `${BASE}/${dev}-${sc.secondary}` : undefined,
    enhancedUrl: null,
    backgroundOverride: null,
    headline: { verb: sc.verb, descriptor: sc.descriptor, subhead: '' },
    ...(pill ? { pill } : {}),
    font: 'Nunito',
    fontSize: d.titlePx,
    titlePx: d.titlePx,
    subPx: d.subPx,
    textYFraction: d.yFrac,
    textX: 0,
    textY: 0,
    deviceX: Math.round((sc.device.dx ?? 0) * d.W),
    deviceY: Math.round((sc.device.dy ?? 0) * d.W),
    deviceScale: sc.device.scale ?? 1,
    tiltDeg: sc.device.tilt ?? 0,
    tiltX: 0,
    tiltY: 0,
    breakout: false,
    pulseScreen: 0,
    enhanceState: 'idle',
    decor: decorFor(sc.decor, dev),
  };
}

const state = await fetch(`${API}/api/studio-state`).then((r) => r.json());

const poolKeys = ['birthHero', 'paintHero', 'worldHero', 'fantasy', 'birth', 'paint', 'photo', 'name', 'care', 'world', 'collect'];
const screenshots = [];
for (const dev of ['iphone', 'ipad']) for (const k of poolKeys) screenshots.push(slot(k, dev));

const layoutVariants = VARIANTS.map((v) => ({
  id: v.id,
  title: v.title,
  slotIds: ['iphone', 'ipad'].flatMap((dev) => v.keys.map((k) => `la-${dev}-${k}`)),
}));

if (dry) {
  for (const s of screenshots) console.log(s.id.padEnd(22), s.headline.verb.replace('\n', ' '), s.pill ?? '');
  console.log(layoutVariants.map((v) => `${v.id}: ${v.slotIds.length}`).join('  '));
  process.exit(0);
}

const next = {
  ...state,
  appName: 'LiveAquarium',
  appColor: '#FFC21A',
  devices: 'both',
  iphoneModel: 'iphone-17-pro-max',
  ipadModel: 'ipad-pro-13',
  sourceLocale: 'ru',
  selectedPresetId: 'liveaquarium-lagoon',
  screenshots,
  layoutVariants,
  activeScreenshotId: screenshots[0].id,
  ppo: state.ppo ?? null,
};

const res = await fetch(`${API}/api/studio-state/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(next),
});
console.log(res.status, await res.text());
console.log(`${screenshots.length} slots, variants ${layoutVariants.map((v) => v.id).join(',')}`);
