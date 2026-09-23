#!/usr/bin/env node
/**
 * Native export: screenshot every (slot × locale) straight from the live DOM.
 *
 * Replaces the html-to-image path for localized runs. That path serialises the
 * canvas into an SVG <foreignObject>, where Chromium skips complex-script
 * shaping — Devanagari conjuncts and Indic reordering came out wrong in the PNG
 * while the editor showed them correctly. Playwright's element screenshot uses
 * the ordinary text pipeline, so every script renders as designed and no font
 * has to be base64-inlined.
 *
 * Reads the project from the running API, so it needs no argument:
 *   node cli/render-export.mjs [--out <folder>] [--locales ru,ja] [--slots 4,7]
 *                              [--concurrency 3]
 *
 * `--slots` takes 1-based slot numbers, so reworking one frame and pushing it to
 * every language is a single command:
 *   node cli/render-export.mjs --slots 4
 *
 * Output: <outputFolder>/<App-slug>/images[-ipad]/<locale>/<pattern>
 * Exits non-zero if any job failed, listing them.
 *
 * Layout variants (state.layoutVariants — named slot orderings such as PPO
 * treatments):
 *   node cli/render-export.mjs --variants A,B --out ~/export
 *   node cli/render-export.mjs --variants all --tree '{variant}/{device}' --pattern '{n}.{ext}'
 * Inside a variant `{n}` is the position among that device family's slots, so
 * iPhone and iPad both start at 01.
 *
 * `--tree` sets the folder template under --out. Placeholders: {app} {variant}
 * {device} (iphone|ipad) {images} (images|images-ipad) {locale}. Default:
 * `{app}/{images}/{locale}`, or `{app}/{variant}/{images}/{locale}` with variants.
 * `--pattern` overrides the project's filename pattern. The untranslated source
 * renders into state.sourceLocale (default 'en').
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import pathMod from 'node:path';

const API = 'http://localhost:5181';
const BASE = 'http://localhost:5180/studio';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const state = await fetch(`${API}/api/studio-state`).then((r) => {
  if (!r.ok) throw new Error(`state GET ${r.status}`);
  return r.json();
});

const outputFolder = arg('out', state.outputFolder);
if (!outputFolder) throw new Error('no output folder — pass --out or set one in the project');
const only = arg('locales');
const wanted = only ? new Set(only.split(',').map((s) => s.trim())) : null;
const slotArg = arg('slots');
const wantedSlots = slotArg ? new Set(slotArg.split(',').map((s) => Number(s.trim()))) : null;
const concurrency = Math.max(1, Number(arg('concurrency', '3')));
const pattern = arg('pattern', state.filenamePattern || '{n}-{app}.{ext}');
const sourceLocale = state.sourceLocale || 'en';
const ipadSize = state.ipadModel === 'ipad-pro-13' ? '2064x2752' : '2048x2732';
const variantArg = arg('variants');
const allVariants = state.layoutVariants ?? [];
const variants = variantArg
  ? (variantArg === 'all' ? allVariants : variantArg.split(',').map((id) => {
      const v = allVariants.find((x) => x.id === id.trim());
      if (!v) throw new Error(`unknown variant ${id} (have: ${allVariants.map((x) => x.id).join(', ') || 'none'})`);
      return v;
    }))
  : null;
const tree = arg('tree', variants ? '{app}/{variant}/{images}/{locale}' : '{app}/{images}/{locale}');
const appSlug = (state.appName || 'app').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');

const locales = (state.locales ?? []).filter((l) => !wanted || wanted.has(l.code));
const localeList = locales.length ? locales : [null];

const jobs = [];
const byId = new Map(state.screenshots.map((s) => [s.id, s]));
for (const loc of localeList) {
  if (variants) {
    for (const v of variants) {
      const counters = { iphone: 0, ipad: 0 };
      for (const id of v.slotIds) {
        const slot = byId.get(id);
        if (!slot) throw new Error(`variant ${v.id}: unknown slot ${id}`);
        const dev = slot.device ?? 'iphone';
        counters[dev] += 1;
        if (wantedSlots && !wantedSlots.has(counters[dev])) continue;
        jobs.push({ slot, locale: loc, n: counters[dev], variant: v.id });
      }
    }
    continue;
  }
  state.screenshots.forEach((slot, i) => {
    // Slot numbers stay tied to the project index, so a re-render of slot 4
    // overwrites exactly 04-*.png in every locale folder.
    if (wantedSlots && !wantedSlots.has(i + 1)) return;
    jobs.push({ slot, locale: loc, n: i + 1 });
  });
}
if (jobs.length === 0) throw new Error('nothing to render');

function filenameFor(job) {
  const dev = job.slot.device ?? 'iphone';
  const size = dev === 'ipad' ? ipadSize : '1320x2868';
  return pattern.replace(/\{(\w+)\}/g, (full, key) => {
    if (key === 'app') return appSlug;
    if (key === 'locale') return job.locale?.code ?? sourceLocale;
    if (key === 'variant') return job.variant ?? '';
    if (key === 'n') return String(job.n).padStart(2, '0');
    if (key === 'size') return size;
    if (key === 'ext') return 'png';
    return full;
  });
}

function dirFor(job) {
  const dev = job.slot.device ?? 'iphone';
  return tree.replace(/\{(\w+)\}/g, (full, key) => {
    if (key === 'app') return appSlug;
    if (key === 'variant') return job.variant ?? '';
    if (key === 'device') return dev;
    if (key === 'images') return dev === 'ipad' ? 'images-ipad' : 'images';
    if (key === 'locale') return job.locale?.code ?? sourceLocale;
    return full;
  });
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const failures = [];
let done = 0;

async function worker(queue) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[browser] ${m.text()}`); });

  // ONE page load per worker. A goto per screenshot tore down the React tree and
  // re-fetched every multi-MB artwork PNG — that, not the rendering, was the bulk
  // of the wall time. Client-side navigation keeps the app mounted and the images
  // in cache, which is what the in-app Export button was always doing.
  let loaded = false;

  for (;;) {
    const job = queue.shift();
    if (!job) break;
    const code = job.locale?.code ?? '';
    const path = `/studio/render?slot=${encodeURIComponent(job.slot.id)}`
      + (code ? `&locale=${encodeURIComponent(code)}` : '');
    const key = `${job.slot.id}|${code}`;
    try {
      if (!loaded) {
        await page.goto(`http://localhost:5180${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.evaluate(() => document.fonts.ready);
        loaded = true;
      } else {
        await page.evaluate((next) => {
          window.history.pushState({}, '', next);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, path);
      }
      await page.waitForFunction(
        (want) => document.documentElement.dataset.renderKey === want,
        key, { timeout: 30_000 },
      );
      const el = page.locator('[data-mockup-canvas-inner]');
      await el.waitFor({ timeout: 30_000 });
      // Locale fonts and any artwork not yet cached still load asynchronously,
      // and the headline fit pass re-runs when they land.
      await page.evaluate(async () => {
        await document.fonts.ready;
        const imgs = [...document.images].filter((i) => !i.complete);
        await Promise.all(imgs.map((i) => new Promise((r) => {
          i.addEventListener('load', r, { once: true });
          i.addEventListener('error', r, { once: true });
        })));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });

      const overflow = await page.evaluate(() => {
        const box = document.querySelector('[data-headline-box]');
        const title = document.querySelector('[data-headline-title]');
        const desc = document.querySelector('[data-headline-descriptor]');
        if (!box || !title) return null;
        const b = box.getBoundingClientRect(), t = title.getBoundingClientRect();
        const d = desc?.getBoundingClientRect();
        if (d && d.top < t.bottom - 1) return `title/descriptor collision (${(t.bottom - d.top).toFixed(1)}px)`;
        const bottom = d?.bottom ?? t.bottom;
        if (bottom > b.bottom + 1) return `headline exceeds safe zone by ${(bottom - b.bottom).toFixed(1)}px`;
        return null;
      });
      if (overflow) throw new Error(overflow);

      const buf = await el.screenshot({ type: 'png' });
      const dir = pathMod.join(outputFolder, dirFor(job));
      await mkdir(dir, { recursive: true });
      await writeFile(pathMod.join(dir, filenameFor(job)), buf);
      done += 1;
      if (done % 25 === 0 || done === jobs.length) console.log(`  ${done}/${jobs.length}`);
    } catch (e) {
      failures.push({ locale: code || sourceLocale, slot: `${job.variant ? job.variant + '/' : ''}${job.slot.device ?? 'iphone'} ${job.n}`, error: e.message.split('\n')[0] });
      // A failed job can leave the SPA on the wrong route; force a clean load.
      loaded = false;
    }
  }
  await page.close();
}

console.log(`rendering ${jobs.length} PNG (${variants ? `variants ${variants.map((v) => v.id).join(',')}` : `${wantedSlots ? wantedSlots.size : state.screenshots.length} slots`} × ${localeList.length} locales) → ${outputFolder}`);
const queue = jobs.slice();
await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));
await browser.close();

console.log(`\n${done} rendered, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f.locale} slot ${f.slot}: ${f.error}`);
process.exit(failures.length ? 1 : 0);
