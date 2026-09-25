#!/usr/bin/env node
/**
 * Import per-language app screenshots (localized app UI) into the Studio and
 * refresh the project's `localizedSources` manifest.
 *
 *   node cli/import-sources.mjs --app liveaquarium --from ~/Developer/screenshots/LiveAquarium/source-l10n
 *   node cli/import-sources.mjs --app liveaquarium --scan        # only rescan what is already in uploads
 *
 * Input layout:   <from>/<lang>/<device>/0N-<name>.png          (device = iphone | ipad)
 * Output layout:  public/uploads/<app>/<lang>/<device>-0N-<name>.png
 *
 * The manifest (state.localizedSources = { dir, rootLang, files }) lists, per
 * language folder, the files that also exist in the root folder — that is what
 * the renderer resolves against (see src/lib/localizedSources.ts). It is pushed
 * to the running API (live, no reload); with the API down, state.json is
 * written directly.
 *
 * Options:
 *   --langs en,de        import only these language folders
 *   --root-lang ru       language of the root files (default: existing value → state.sourceLocale)
 *   --dry                print the plan, copy / write nothing
 */
import { copyFile, mkdir, readdir, readFile, writeFile, stat, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'http://localhost:5181';
const STATE_FILE = path.join(os.homedir(), '.aso-studio', 'state.json');
const UPLOADS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'uploads');
const KNOWN_LANGS = new Set(['ru', 'en', 'de', 'fr', 'es', 'it', 'pt-BR', 'nl', 'sv', 'da', 'nb', 'fi',
  'ja', 'ko', 'zh-Hans', 'zh-Hant', 'pl', 'tr']);
const DEVICES = ['iphone', 'ipad'];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);
const expand = (p) => (p?.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const app = arg('app');
if (!app || app.includes('/')) {
  console.error('usage: node cli/import-sources.mjs --app <uploads dir> (--from <folder> | --scan) [--langs en,de] [--root-lang ru] [--dry]');
  process.exit(2);
}
const from = expand(arg('from'));
const scanOnly = flag('scan');
const dry = flag('dry');
const onlyLangs = arg('langs') ? new Set(arg('langs').split(',').map((s) => s.trim())) : null;
if (!from && !scanOnly) {
  console.error('pass --from <folder> or --scan');
  process.exit(2);
}

const appDir = path.join(UPLOADS, app);
const isDir = async (p) => (await stat(p).catch(() => null))?.isDirectory() ?? false;
if (!(await isDir(appDir))) throw new Error(`no such uploads folder: ${appDir}`);

/** PNG width×height from the IHDR chunk (null for non-PNG). */
async function pngSize(file) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(24);
    await fh.read(buf, 0, 24, 0);
    if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
    return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
  } finally {
    await fh.close();
  }
}

const rootFiles = new Set((await readdir(appDir, { withFileTypes: true }))
  .filter((d) => d.isFile() && !d.name.startsWith('.')).map((d) => d.name));

// ── 1. copy ────────────────────────────────────────────────────────────────
if (from) {
  if (!(await isDir(from))) throw new Error(`no such folder: ${from}`);
  let copied = 0;
  for (const lang of (await readdir(from)).sort()) {
    if (lang.startsWith('.') || !(await isDir(path.join(from, lang)))) continue;
    if (onlyLangs && !onlyLangs.has(lang)) continue;
    if (!KNOWN_LANGS.has(lang)) console.warn(`! ${lang}: not one of the app languages (${[...KNOWN_LANGS].join(' ')}) — imported anyway`);
    for (const dev of DEVICES) {
      const srcDir = path.join(from, lang, dev);
      if (!(await isDir(srcDir))) continue;
      for (const name of (await readdir(srcDir)).sort()) {
        if (!/^\d\d-.+\.png$/i.test(name)) continue;
        const target = `${dev}-${name}`;
        if (!rootFiles.has(target)) console.warn(`! ${lang}/${dev}/${name}: no root ${target} — no slot will pick it up`);
        const src = path.join(srcDir, name);
        const [a, b] = await Promise.all([pngSize(src), rootFiles.has(target) ? pngSize(path.join(appDir, target)) : null]);
        if (a && b && a !== b) console.warn(`! ${lang}/${target}: ${a} vs root ${b}`);
        if (!dry) {
          await mkdir(path.join(appDir, lang), { recursive: true });
          await copyFile(src, path.join(appDir, lang, target));
        }
        copied += 1;
      }
    }
  }
  console.log(`${dry ? 'would copy' : 'copied'} ${copied} file(s) → ${appDir}/<lang>/`);
}

// ── 2. scan → manifest ─────────────────────────────────────────────────────
// A sub-folder counts as a language when it holds files that mirror root files
// (so `decor/` and friends never qualify).
const files = {};
for (const d of await readdir(appDir, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const names = (await readdir(path.join(appDir, d.name))).filter((n) => rootFiles.has(n)).sort();
  if (names.length) files[d.name] = names;
}
if (dry && from) {
  // Show the manifest as it would be after the copy.
  for (const lang of (await readdir(from)).filter((l) => !onlyLangs || onlyLangs.has(l))) {
    for (const dev of DEVICES) {
      const srcDir = path.join(from, lang, dev);
      if (!(await isDir(srcDir))) continue;
      for (const name of await readdir(srcDir)) {
        const t = `${dev}-${name}`;
        if (!rootFiles.has(t)) continue;
        files[lang] = [...new Set([...(files[lang] ?? []), t])].sort();
      }
    }
  }
}

const rootSlotFiles = [...rootFiles].filter((n) => /^(iphone|ipad)-/.test(n));
for (const [lang, names] of Object.entries(files).sort()) {
  const missing = rootSlotFiles.filter((n) => !names.includes(n));
  console.log(`  ${lang.padEnd(8)} ${String(names.length).padStart(2)} file(s)${missing.length ? `  — missing ${missing.join(', ')} (falls back)` : ''}`);
}
if (!Object.keys(files).length) console.log('  (no language folders yet — every locale uses the root sources)');

// ── 3. state ───────────────────────────────────────────────────────────────
let live = true;
const state = await fetch(`${API}/api/studio-state`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .catch(async () => { live = false; return JSON.parse(await readFile(STATE_FILE, 'utf8')); });

const usesDir = (state.screenshots ?? []).some((s) => s.sourceUrl?.includes(`/uploads/${app}/`));
if (!usesDir) console.warn(`! the active project has no slot under /uploads/${app}/ — manifest saved anyway`);

const prev = state.localizedSources?.dir === app ? state.localizedSources : {};
const localizedSources = {
  ...prev,
  dir: app,
  rootLang: arg('root-lang') ?? prev.rootLang ?? state.sourceLocale ?? 'en',
  files,
};
console.log(`localizedSources: dir=${app} rootLang=${localizedSources.rootLang} langs=[${Object.keys(files).join(', ')}]`);
if (dry) process.exit(0);

const next = { ...state, localizedSources };
if (live) {
  const res = await fetch(`${API}/api/studio-state/push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
  });
  console.log(`pushed to the running Studio: ${res.status} ${await res.text()}`);
} else {
  await writeFile(STATE_FILE, JSON.stringify(next, null, 2));
  console.log(`API offline — wrote ${STATE_FILE}`);
}
