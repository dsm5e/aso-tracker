#!/usr/bin/env node
/**
 * Ossidex PPO drafts, one treatment at a time (owner 2026-09-26: different templates,
 * colours and layout per treatment; the copy of B/C/D stays).
 *   node cli/setup-ossidex-ppo.mjs --ppo 1 [--locales en-US,ru] [--hero-only]
 *
 * PPO-1 «Clinical light»: ice-white page, big navy headline left-aligned, silver
 * device standing bottom-right and cropped by the edge, three white fact cards
 * floating on the left (Apple-Health-like calm).
 */
import path from 'node:path';
import { VARIANTS } from './ossidex-copy.mjs';

const API = process.env.ASO_API ?? 'http://localhost:5173/studio-api';
const BASE = '/studio/uploads/ossidex';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const PPO = arg('ppo', '1');
const LOCALES = arg('locales', 'en-US,ru').split(',');
const heroOnly = process.argv.includes('--hero-only');
const LANG = (c) => (c === 'ru' ? 'ru' : 'en');
const FILE = { arch: 'arch-grid', mpr: 'mpr', '3d': 'full-3d', measure: 'measure', library: 'library', import: 'import', '2d': '2d' };

const FACTS = {
  en: ['CT · MRI · CBCT', '15+ file formats', 'Any scanner'],
  ru: ['КТ · МРТ · КЛКТ', '15+ форматов', 'Любой томограф'],
};

const TEMPLATES = {
  1: {
    copy: 'B',
    preset: 'ossidex-light',
    bg: 'radial-gradient(90% 60% at 80% 70%, #FFFFFF 0%, #F1F5FB 55%, #E6EDF7 100%)',
    align: 'left',
    device: { iphone: { scale: 0.92, x: 0.1, y: 0.3 }, ipad: { scale: 0.82, x: 0.2, y: 0.09 } },
    text: { iphone: { titlePx: 168, subPx: 62, yFrac: 0.065 }, ipad: { titlePx: 180, subPx: 68, yFrac: 0.055 } },
    decor: (dev, lang, hero) => {
      if (!hero) return [];
      // iPad: a column of fact cards left of the device. iPhone: two rows under the subline.
      const pos = dev === 'ipad'
        ? [[0.17, 0.46], [0.17, 0.56], [0.17, 0.66]]
        : [[0.2, 0.262], [0.5, 0.262], [0.8, 0.262]];
      return FACTS[lang].map((t, i) => ({ kind: 'bubble', chip: true, xFrac: pos[i][0], yFrac: pos[i][1], widthFrac: dev === 'ipad' ? 0.3 : 0.31,
        layer: 'top', text: t, bg: '#FFFFFF', color: '#0B1B33', fontPx: dev === 'ipad' ? 54 : 38, tail: 'none' }));
    },
  },
};

const T = TEMPLATES[PPO];
if (!T) throw new Error(`no template for PPO-${PPO}`);
const frames = VARIANTS.en[T.copy].slice(0, heroOnly ? 1 : 6);
const screenshots = [];
for (const dev of ['iphone', 'ipad']) {
  frames.forEach(([frame, head, sub], i) => {
    const dv = T.device[dev]; const tx = T.text[dev]; const W = dev === 'ipad' ? 2064 : 1320;
    screenshots.push({
      id: `oxp${PPO}-${dev}-${frame}`, filename: `${dev}-${FILE[frame]}.png`, device: dev, kind: 'regular', sourceLayout: 'device',
      presetId: T.preset, sourceUrl: `${BASE}/${dev}-${FILE[frame]}.png`, enhancedUrl: null, backgroundOverride: T.bg,
      textAlignOverride: T.align, deviceBezelColor: 'silver', deviceAnchor: 'free',
      headline: { verb: head, descriptor: sub, subhead: '' }, font: 'Inter', fontSize: tx.titlePx, titlePx: tx.titlePx, subPx: tx.subPx,
      textYFraction: tx.yFrac, textX: 0, textY: 0, deviceX: Math.round(dv.x * W), deviceY: Math.round(dv.y * W), deviceScale: dv.scale,
      tiltDeg: 0, tiltX: 0, tiltY: 0, breakout: false, pulseScreen: 0, enhanceState: 'idle',
      decor: T.decor(dev, 'en', i === 0),
    });
  });
}
const NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
const locales = LOCALES.map((code) => {
  const lang = LANG(code); const copy = VARIANTS[lang][T.copy];
  const translations = {}; const decorTranslations = {};
  for (const s of screenshots) {
    const frame = s.id.split('-').slice(2).join('-');
    const [verb, descriptor] = copy.find(([f]) => f === frame).slice(1);
    translations[s.id] = { verb, descriptor, subhead: '' };
    decorTranslations[s.id] = T.decor(s.device, lang, s.decor.length > 0).map((it) => it.text ?? null);
  }
  return { id: code, code, name: NAMES.of(code), flag: '', translations, decorTranslations, variant: `P${PPO}` };
});
const state = await fetch(`${API}/studio-state`).then((r) => r.json());
const next = { ...state, appName: 'Ossidex', appColor: '#0B1B33', devices: 'both', iphoneModel: 'iphone-17-pro-max', ipadModel: 'ipad-pro-12.9',
  sourceLocale: 'en-US', selectedPresetId: T.preset, screenshots, locales, activeLocaleId: LOCALES[0], localizedSources: null,
  layoutVariants: [{ id: `P${PPO}`, title: `PPO-${PPO}`, slotIds: screenshots.map((s) => s.id) }],
  outputFolder: path.join(process.env.HOME, 'Desktop', 'Ossidex-release'), activeScreenshotId: screenshots[0].id, ppo: null };
const res = await fetch(`${API}/studio-state/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
console.log(res.status, await res.text(), `${screenshots.length} slots PPO-${PPO}`);
