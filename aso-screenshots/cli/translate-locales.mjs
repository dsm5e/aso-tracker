#!/usr/bin/env node
/**
 * Headless counterpart of the Locales screen "Translate" button: transcreates
 * every slot's headline, subtitle, pill and speech-bubble copy through the
 * Studio's own /api/translate/batch (OpenAI, or the Codex CLI fallback) and
 * writes the results into state.locales — the same fields the editor uses.
 *
 *   node cli/translate-locales.mjs --locales de-DE,fr-FR
 *   node cli/translate-locales.mjs --locales all          # every curated locale
 *   node cli/translate-locales.mjs --locales asc --asc-locales "ar-SA,bn-BD,…"
 *   [--force] [--concurrency 4] [--context "…"] [--provider codex]
 *
 * Identical strings (iPhone + iPad copies of a slot) are translated once, so a
 * phrase reads the same on every device. Locales in the project's source
 * language copy the originals. Already translated locales are skipped unless
 * --force. State is pushed after each locale, so an interrupted run resumes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pathMod from 'node:path';

const API = 'http://localhost:5181';
const here = pathMod.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const force = process.argv.includes('--force');
const concurrency = Math.max(1, Number(arg('concurrency', '4')));
const provider = arg('provider');

// Locale catalogue (code, name, flag, rtl, font) parsed from src/lib/locales.ts
// so the CLI never drifts from the editor.
const catalogue = [...readFileSync(pathMod.join(here, '../src/lib/locales.ts'), 'utf8')
  .matchAll(/\{\s*code:\s*'([^']+)',\s*name:\s*'([^']+)',\s*flag:\s*'([^']+)',[^}]*?\}/g)]
  .map((m) => ({
    code: m[1], name: m[2], flag: m[3],
    rtl: /rtl:\s*true/.test(m[0]),
    font: m[0].match(/font:\s*'([^']+)'/)?.[1],
  }));

const getState = () => fetch(`${API}/api/studio-state`).then((r) => r.json());
let state = await getState();
const sourceLocale = state.sourceLocale || 'en';
const lang = (c) => c.toLowerCase().split('-')[0];

const want = arg('locales');
if (!want) throw new Error('--locales required (list | all | asc)');
const codes = want === 'all'
  ? catalogue.map((l) => l.code)
  : want === 'asc'
    ? (arg('asc-locales') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    : want.split(',').map((s) => s.trim());

const context = arg('context',
  `iOS app "${state.appName}". App Store screenshot captions. Keep the tone of the source.`);

// Unique source strings → keys.
const slots = state.screenshots;
const texts = new Map(); // text -> key
const keyOf = (t) => {
  if (!texts.has(t)) texts.set(t, `t${texts.size + 1}`);
  return texts.get(t);
};
for (const s of slots) {
  if (s.headline?.verb) keyOf(s.headline.verb);
  if (s.headline?.descriptor) keyOf(s.headline.descriptor);
  if (s.pill) keyOf(s.pill);
  (s.decor ?? []).forEach((d) => { if (d.kind === 'bubble' && d.text) keyOf(d.text); });
}
const items = [...texts.entries()].map(([text, key]) => ({ key, text }));
console.log(`${items.length} unique strings × ${codes.length} locales (source ${sourceLocale})`);

function buildEntry(code, dict) {
  const spec = catalogue.find((l) => l.code === code) ?? { code, name: code, flag: '🌐' };
  const tr = (t) => (t ? dict.get(t) ?? t : t);
  const translations = {};
  const pillTranslations = {};
  const decorTranslations = {};
  for (const s of slots) {
    translations[s.id] = { verb: tr(s.headline.verb), descriptor: tr(s.headline.descriptor), subhead: '' };
    if (s.pill) pillTranslations[s.id] = tr(s.pill);
    if ((s.decor ?? []).some((d) => d.kind === 'bubble' && d.text)) {
      decorTranslations[s.id] = s.decor.map((d) => (d.kind === 'bubble' && d.text ? tr(d.text) : null));
    }
  }
  const prev = state.locales?.find((l) => l.code === code);
  return {
    ...(prev ?? {}),
    id: prev?.id ?? code,
    code,
    name: spec.name,
    flag: spec.flag,
    rtl: spec.rtl || undefined,
    fontOverride: spec.font,
    translations,
    pillTranslations,
    decorTranslations,
    aiTranslated: true,
  };
}

async function translate(code) {
  if (lang(code) === lang(sourceLocale)) return new Map([...texts.keys()].map((t) => [t, t]));
  const r = await fetch(`${API}/api/translate/batch${provider ? `?provider=${provider}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetLocale: code, sourceLocale, appContext: context, items }),
  });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(`${code}: ${data.error ?? r.status} ${data.detail ?? ''}`);
  const byKey = new Map(data.items.map((it) => [it.key, it.translation]));
  const missing = items.filter((it) => !byKey.get(it.key));
  if (missing.length) throw new Error(`${code}: missing ${missing.map((m) => m.key).join(',')}`);
  return new Map(items.map((it) => [it.text, byKey.get(it.key)]));
}

// Serialise state writes: re-read, merge this locale, push.
let chain = Promise.resolve();
function save(entry) {
  chain = chain.then(async () => {
    state = await getState();
    const others = (state.locales ?? []).filter((l) => l.code !== entry.code);
    state.locales = [...others, entry];
    const r = await fetch(`${API}/api/studio-state/push`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
    });
    if (!r.ok) throw new Error(`push ${r.status}`);
  });
  return chain;
}

const queue = codes.filter((c) => force || !(state.locales ?? []).some((l) => l.code === c && l.aiTranslated));
const failures = [];
let done = 0;
async function worker() {
  for (;;) {
    const code = queue.shift();
    if (!code) return;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const dict = await translate(code);
        await save(buildEntry(code, dict));
        done += 1;
        console.log(`  ✓ ${code} (${done})`);
        break;
      } catch (e) {
        if (attempt === 2) { failures.push(code); console.log(`  ✗ ${code}: ${e.message.slice(0, 160)}`); }
      }
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
await chain;
console.log(`\n${done} locales written, ${failures.length} failed${failures.length ? `: ${failures.join(',')}` : ''}`);
process.exit(failures.length ? 1 : 0);
