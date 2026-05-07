/**
 * Import a ButterKit template (.butterkit bundle) → our Preset format.
 *
 * Usage:
 *   npm run import-butterkit -- <path/to/Template.butterkit> [<presetId>] [<presetName>]
 *
 * Reads Document.json, picks iPhone+iPad artboards with content, copies their
 * background images to public/presets/<id>/, and writes a JSON preset file
 * to src/lib/presets/imported/<id>.json that the runtime auto-loads.
 *
 * We deliberately ignore device screen captures from the .butterkit — the user
 * supplies their own screenshot in the Editor; the imported preset only owns
 * layout (bg + text positions + font + sample headlines).
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'; // eslint-disable-line
import { join, basename, resolve } from 'node:path';

const SCREENSHOTS_ROOT = resolve(import.meta.dirname, '..');

interface ButterKitDoc {
  schemaVersion: number;
  baseLanguageCode: string;
  metadata: { name?: string };
  artboards: ButterKitArtboard[];
}

interface ButterKitArtboard {
  id: string;
  name: string;
  sizePresetID: string;
  size: [number, number];
  background: {
    image?: { fill?: string; ref: { name: string; type: string } };
    color?: string;
    gradient?: unknown;
  };
  textBlocks: ButterKitTextBlock[];
  models: ButterKitModel[];
  cameraProjection?: string;
  perspectiveFOVDeg?: number;
}

interface ButterKitTextBlock {
  id: string;
  role: string; // 'Title' | 'Subtitle' | 'Caption'
  string: string;
  fontFamily: string;
  weight: string; // 'black', 'bold', 'semibold', 'medium', 'regular', 'light'
  sizePt: number;
  colorHex: string; // '#RRGGBBAA'
  horizontalAlignment: 'left' | 'center' | 'right';
  paddingTop: number;
  paddingLeft: number;
  paddingRight: number;
}

interface ButterKitModel {
  assetName: string; // 'iPhone17ProMax', 'iPadPro129', 'Pixel10Pro'
  rotationEuler: [number, number, number];
  positionOffset: [number, number, number];
}

const WEIGHT_MAP: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, regular: 400, medium: 500,
  semibold: 600, bold: 700, extrabold: 800, black: 900,
};

function slug(s: string): string {
  return s.toLowerCase().replace(/\.butterkit$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hexToCss(h: string): string {
  // ButterKit uses #RRGGBBAA; CSS is happy with that in modern browsers, but to be safe convert to rgba
  if (!h.startsWith('#')) return h;
  const v = h.slice(1);
  if (v.length === 8) {
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    const a = parseInt(v.slice(6, 8), 16) / 255;
    return `rgba(${r},${g},${b},${a.toFixed(3)})`;
  }
  return h;
}

const argv = process.argv.slice(2);
const butterkitPath = argv[0];
const presetIdArg = argv[1];
const presetNameArg = argv[2];

if (!butterkitPath) {
  console.error('Usage: npm run import-butterkit -- <path/to/Template.butterkit> [<presetId>] [<presetName>]');
  process.exit(1);
}

const docPath = join(butterkitPath, 'Document.json');
const assetsDir = join(butterkitPath, 'Assets');
if (!existsSync(docPath)) {
  console.error(`Document.json not found in ${butterkitPath}`);
  process.exit(1);
}

const doc: ButterKitDoc = JSON.parse(readFileSync(docPath, 'utf-8'));
console.log(`📄 ${docPath}`);
console.log(`   schemaVersion=${doc.schemaVersion}, ${doc.artboards.length} artboards`);

const presetId = presetIdArg ?? slug(basename(butterkitPath));
const presetName = presetNameArg ?? presetId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Filter to iPhone+iPad artboards with both Title and Subtitle text (skip empty Intro/CTA frames).
const candidate = doc.artboards.filter((a) =>
  (a.sizePresetID === 'app_store_iphone' || a.sizePresetID === 'app_store_ipad') &&
  a.textBlocks.some((t) => t.role === 'Title' && t.string.trim().length > 0)
);

const iphoneArts = candidate.filter((a) => a.sizePresetID === 'app_store_iphone');
const ipadArts   = candidate.filter((a) => a.sizePresetID === 'app_store_ipad');
console.log(`   iPhone with content: ${iphoneArts.length}, iPad with content: ${ipadArts.length}`);

if (iphoneArts.length === 0) {
  console.error('No iPhone artboards with content found — aborting.');
  process.exit(1);
}

// Pick representative Title block (from the first iPhone artboard) for preset-level font/color defaults
const firstTitle = iphoneArts[0]!.textBlocks.find((t) => t.role === 'Title')!;

// Identify dominant iPhone background image — most common across iPhone artboards
const bgCounts = new Map<string, number>();
for (const a of iphoneArts) {
  const ref = a.background.image?.ref?.name;
  if (ref) bgCounts.set(ref, (bgCounts.get(ref) ?? 0) + 1);
}
const dominantBgIphone = [...bgCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
const ipadBgCounts = new Map<string, number>();
for (const a of ipadArts) {
  const ref = a.background.image?.ref?.name;
  if (ref) ipadBgCounts.set(ref, (ipadBgCounts.get(ref) ?? 0) + 1);
}
const dominantBgIpad = [...ipadBgCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

// Output dirs
const publicDir = join(SCREENSHOTS_ROOT, 'public', 'presets', presetId);
const importedDir = join(SCREENSHOTS_ROOT, 'src', 'lib', 'presets', 'imported');
mkdirSync(publicDir, { recursive: true });
mkdirSync(importedDir, { recursive: true });

// Read PNG dimensions straight from the IHDR chunk (bytes 16-23 of any PNG).
function readPngSize(path: string): { w: number; h: number } | undefined {
  try {
    const buf = readFileSync(path);
    if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return undefined;
    return {
      w: buf.readUInt32BE(16),
      h: buf.readUInt32BE(20),
    };
  } catch {
    return undefined;
  }
}

// Copy background images
const bgIphoneRel = dominantBgIphone ? `presets/${presetId}/bg-iphone.png` : undefined;
let bgIphoneSize: { w: number; h: number } | undefined;
if (dominantBgIphone) {
  const src = join(assetsDir, dominantBgIphone);
  copyFileSync(src, join(publicDir, 'bg-iphone.png'));
  bgIphoneSize = readPngSize(src);
  console.log(`   ✓ bg-iphone.png copied (from ${dominantBgIphone})${bgIphoneSize ? ` size=${bgIphoneSize.w}×${bgIphoneSize.h}` : ''}`);
}
const bgIpadRel = dominantBgIpad ? `presets/${presetId}/bg-ipad.png` : undefined;
if (dominantBgIpad && dominantBgIpad !== dominantBgIphone) {
  const src = join(assetsDir, dominantBgIpad);
  copyFileSync(src, join(publicDir, 'bg-ipad.png'));
  console.log(`   ✓ bg-ipad.png copied (from ${dominantBgIpad})`);
}

// Base offset that pushes the device away from the side where the headline lives.
// Canvas is 2796 px tall, device ~2200 px → centered top = 298. To clear room for a
// 380-px-ish text block at top OR bottom (with a comfortable gap), offset the device
// by ±380. Stays decoupled from text so user can drag text freely without dragging
// the device along.
const BASE_OFFSET_TEXT_AT_TOP = 380;     // push device DOWN
const BASE_OFFSET_TEXT_AT_BOTTOM = -380; // push device UP

// ButterKit's artboard `size` is in inches at 800 DPI for App Store iPhone preset.
// `positionOffset` is per-axis in scene units (inches). Our canvas-px conversion
// gives a fine-tune adjustment ON TOP of the base offset chosen by text position.
function makeSampleDevice(a: ButterKitArtboard, textYFraction: number) {
  if (!a.models?.length) return undefined;
  const m = a.models[0]!;
  const [w, h] = a.size;
  const pxPerUnit = Math.max(1290 / w, 2796 / h);
  const [ox, oy] = m.positionOffset;
  // ButterKit uses Y-up; canvas uses Y-down → invert Y.
  const offsetX = Math.round(ox * pxPerUnit);
  const fineY = Math.round(-oy * pxPerUnit);
  const baseOffsetY =
    textYFraction < 0.5 ? BASE_OFFSET_TEXT_AT_TOP : BASE_OFFSET_TEXT_AT_BOTTOM;
  const offsetY = baseOffsetY + fineY;
  // rotationEuler is in radians around Z (in-plane). Negate to match CSS rotate().
  const rotateZ = +(((-m.rotationEuler[2]) * 180) / Math.PI).toFixed(2);
  const scale = +m.scale[0].toFixed(3);
  const out: { offsetX?: number; offsetY?: number; rotateZ?: number; scale?: number } = {
    offsetY,
  };
  if (offsetX !== 0) out.offsetX = offsetX;
  if (rotateZ !== 0) out.rotateZ = rotateZ;
  if (scale !== 1) out.scale = scale;
  return out;
}

// Empirical font scale: ButterKit's sizePt 60 in Sahara reads as ~150px in our 1290px-wide
// canvas, where uppercase/Title-Case mid-length headlines fit on one line.
const PX_PER_PT = 2.5;

function makeTextLayout(a: ButterKitArtboard) {
  const title = a.textBlocks.find((t) => t.role === 'Title');
  if (!title) return undefined;
  const subBlock = a.textBlocks.find((t) => t.role === 'Subtitle');
  // ButterKit's Title.paddingTop ~= small (≤30 pt) when the title hugs the canvas top,
  // and a larger value (≥40 pt) when the title is anchored near the bottom. Use the
  // raw value as the signal; ignore artboard `name` (Feature/Intro) since templates
  // are inconsistent — Sahara has `Feature` artboards with text at top too.
  const yFraction = title.paddingTop < 30 ? 0.05 : 0.78;
  return {
    yFraction,
    titlePx: Math.round(title.sizePt * PX_PER_PT),
    subPx: subBlock ? Math.round(subBlock.sizePt * PX_PER_PT) : undefined,
  };
}

// Take ALL iPhone artboards with content (typical Sahara = 7 entries; some
// templates may have 8+).  Each artboard becomes one sample in the strip.
const samples = iphoneArts.map((a) => {
  const title = a.textBlocks.find((t) => t.role === 'Title')?.string ?? '';
  const sub   = a.textBlocks.find((t) => t.role === 'Subtitle')?.string ?? '';
  const sample: {
    verb: string;
    descriptor: string;
    device?: ReturnType<typeof makeSampleDevice>;
    text?: ReturnType<typeof makeTextLayout>;
  } = { verb: title, descriptor: sub };
  const device = makeSampleDevice(a);
  if (device) sample.device = device;
  const text = makeTextLayout(a);
  if (text) sample.text = text;
  return sample;
});

// Build preset
const preset = {
  id: presetId,
  name: presetName,
  kind: 'real' as const,
  description: `Imported from ${basename(butterkitPath)}.`,
  recommendedFor: 'lifestyle / outdoors',
  background: {
    type: 'image' as const,
    css: '#000', // fallback solid for if image fails to load
    imageSrc: bgIphoneRel,
    imageSrcIpad: bgIpadRel !== bgIphoneRel ? bgIpadRel : undefined,
    // Panoramic strip if width is at least 2× canvas — sample N crops [N×1290 .. (N+1)×1290].
    ...(bgIphoneSize && bgIphoneSize.w >= 2580
      ? { imageW: bgIphoneSize.w, imageH: bgIphoneSize.h }
      : {}),
  },
  text: {
    font: firstTitle.fontFamily,
    weight: WEIGHT_MAP[firstTitle.weight.toLowerCase()] ?? 700,
    color: hexToCss(firstTitle.colorHex),
    align: firstTitle.horizontalAlignment === 'center' ? 'center' as const : 'left' as const,
    // ButterKit headlines render in their original casing — don't auto-uppercase.
    uppercase: false,
  },
  tiltDeg: 0, // base layout untilted; per-screenshot user can adjust
  breakout: 'none' as const,
  isGradient: false,
  decorationsHint: `${presetName} aesthetic — match the imported background mood.`,
  device: { asset: 'iphone' as const, scale: 1 },
  samples,
};

const jsonPath = join(importedDir, `${presetId}.json`);
const force = argv.includes('--force');

if (existsSync(jsonPath) && !force) {
  // Detect manual edits the importer doesn't produce (groupId, custom samples,
  // saved positions). If any sample carries one, don't clobber the file silently.
  try {
    const existing = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const hasManualEdits = (existing.samples ?? []).some(
      (s: { groupId?: string; device?: { offsetX?: number } }) =>
        s.groupId || (s.device?.offsetX != null && Math.abs(s.device.offsetX) > 100),
    );
    if (hasManualEdits) {
      console.error(
        `\n⚠️  Refusing to overwrite ${jsonPath}\n` +
          `   It contains manual edits (groupId / cross-pair offsets) that the importer can't reproduce.\n` +
          `   Re-run with --force if you really want to throw those edits away.`,
      );
      process.exit(2);
    }
  } catch {
    /* corrupt file → just overwrite */
  }
}

writeFileSync(jsonPath, JSON.stringify(preset, null, 2) + '\n');
console.log(`   ✓ ${jsonPath}`);

console.log(`\n✅ Imported preset "${preset.name}" (id="${preset.id}") with ${samples.length} samples`);
console.log('   Restart the dev server (or just save any file) to pick up the new preset.');
