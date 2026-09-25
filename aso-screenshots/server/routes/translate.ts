import type { Request, Response } from 'express';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getKey } from '../lib/keys.js';

function getOpenAIKey(): string {
  return getKey('OPENAI_API_KEY');
}

export interface TranslateItem {
  /** Stable id so the client can map results back. */
  key: string;
  /** Source string to translate. */
  text: string;
}

export interface TranslateBatchBody {
  /** BCP-47 locale code (e.g. ru, de, ja, ar, pt-br, zh-Hans). */
  targetLocale: string;
  /** Source locale, default 'en'. */
  sourceLocale?: string;
  /** Free-form context about the app to keep tone consistent. */
  appContext?: string;
  items: TranslateItem[];
}

const LOCALE_NAME: Record<string, string> = {
  en: 'English', 'en-US': 'English (US)', 'en-GB': 'English (UK)',
  ru: 'Russian', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian',
  ja: 'Japanese', ko: 'Korean', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese',
  'pt-br': 'Brazilian Portuguese', pt: 'Portuguese', 'pt-BR': 'Brazilian Portuguese', 'pt-PT': 'European Portuguese',
  'en-AU': 'English (Australia)', 'en-CA': 'English (Canada)', 'es-ES': 'Spanish (Spain)', 'es-MX': 'Spanish (Mexico)',
  'fr-FR': 'French (France)', 'fr-CA': 'Canadian French', 'de-DE': 'German', 'nl-NL': 'Dutch', 'ar-SA': 'Arabic',
  el: 'Greek', hu: 'Hungarian', sk: 'Slovak', ro: 'Romanian', hr: 'Croatian', ms: 'Malay', ca: 'Catalan',
  ar: 'Arabic', he: 'Hebrew', tr: 'Turkish', pl: 'Polish', nl: 'Dutch',
  sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish',
  cs: 'Czech', uk: 'Ukrainian', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian',
  hi: 'Hindi',
};

function buildPrompt(body: TranslateBatchBody): string {
  const target = LOCALE_NAME[body.targetLocale] ?? body.targetLocale;
  const source = LOCALE_NAME[body.sourceLocale ?? 'en'] ?? body.sourceLocale ?? 'English';
  return [
    `You are a world-class App Store LOCALIZATION specialist for the ${target} market. You TRANSCREATE marketing copy — you never translate.`,
    body.appContext ? `App context: ${body.appContext}` : '',
    `Task: take each ${source} screenshot headline and rewrite it so it reads as if a native ${target} marketer wrote it from scratch to sell this exact benefit. The result must feel ORIGINAL in ${target} — never like a translation.`,
    'For every item:',
    '1. Identify the real promise/benefit the headline makes (what the user gains, the emotional hook).',
    `2. Express that promise the way the top-grossing app in this category would phrase it in the ${target} App Store — natural idiom, local register, genuine marketing punch.`,
    '3. Re-read it: if it sounds even slightly like a literal translation, a calque, or machine output — rewrite it from scratch.',
    'Rules:',
    '- TRANSCREATE, never word-for-word. Meaning + emotion + punch beat literal wording — a great result often shares few words with the source.',
    '- Use the exact term a LOCAL PROFESSIONAL actually uses for any domain/clinical concept (not a literal gloss). Keep internationally-standard acronyms exactly as locals write them (e.g. CBCT, MPR, CT, MRI, 3D, DICOM, OPG).',
    '- Keep it SHORT — these are large on-screen captions. If a faithful adaptation runs long, choose a tighter native phrase that keeps the core promise. Aim for ≤ the source length.',
    '- Match the source register: punchy, confident, premium. No stiffness, no over-explaining, no awkward loanword order, no robotic tone.',
    '- Preserve ALL-CAPS when the source is ALL-CAPS, the punctuation rhythm (including "·" separators), and any emoji.',
    '- Preserve explicit line breaks ("\\n"): return the same number of lines, breaking at a natural phrase boundary, each line short enough to stay large on a phone screen. Single-line sources stay single-line.',
    '- Do NOT translate brand / app / product names.',
    '- RTL (Arabic, Hebrew): write naturally; the renderer handles direction.',
    '- CJK (Japanese, Chinese, Korean): concise, idiomatic, native register — not a char-by-char rendering.',
    '- Keep terminology consistent across the whole set: the same concept maps to the same word everywhere.',
    '',
    'Return ONLY a JSON object: { "items": [{ "key": "<id>", "translation": "<text>" }, ...] }. Match every input key exactly. No commentary, no quotes or markdown around the values.',
    '',
    'Source items:',
    JSON.stringify(body.items, null, 2),
  ]
    .filter(Boolean)
    .join('\n');
}

type Provider = 'openai' | 'codex';

/** Models sometimes emit raw line breaks / tabs inside JSON strings (valid
 *  for humans, invalid JSON). Escape control characters that sit inside a
 *  string literal, leave the structure untouched. */
function repairJson(raw: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of raw) {
    if (inStr) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === '\\') { esc = true; out += ch; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

async function callOpenAI(prompt: string): Promise<string> {
  const key = getOpenAIKey();
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.5,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    const text = await r.text();
    const err = new Error(`openai ${r.status}`) as Error & { detail?: string; status?: number };
    err.detail = text.slice(0, 400);
    err.status = r.status;
    throw err;
  }
  const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('no content in openai response');
  return content;
}

/** Local Codex CLI (ChatGPT subscription quota — no API key). Used when the
 *  OpenAI key is missing/revoked, or forced with TRANSLATE_PROVIDER=codex. */
async function callCodex(prompt: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'aso-translate-'));
  const out = join(dir, 'answer.json');
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.env.CODEX_BIN || 'codex',
        ['exec', '--skip-git-repo-check', '-s', 'read-only', '-C', dir, '-o', out,
          `${prompt}\n\nAnswer with the JSON object only. Do not run any commands or edit files.`],
        { timeout: 240_000, maxBuffer: 16 * 1024 * 1024 },
        (err) => (err ? reject(err) : resolve()),
      ).stdin?.end();
    });
    const raw = await readFile(out, 'utf8');
    // Tolerate a fenced block around the JSON.
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('codex returned no JSON');
    return m[0];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function translateBatch(req: Request, res: Response) {
  const body = req.body as TranslateBatchBody;
  if (!body?.targetLocale || !Array.isArray(body.items) || body.items.length === 0) {
    res.status(400).json({ error: 'targetLocale + non-empty items[] required' });
    return;
  }
  // Hard cap so a runaway client can't burn through tokens.
  if (body.items.length > 200) {
    res.status(400).json({ error: 'too many items in one batch (max 200)' });
    return;
  }
  try {
    const prompt = buildPrompt(body);
    const forced = (process.env.TRANSLATE_PROVIDER as Provider | undefined) ?? (req.query.provider as Provider | undefined);
    let provider: Provider = forced ?? 'openai';
    console.log('[translate] →', body.targetLocale, body.items.length, 'items via', provider);
    let content: string;
    try {
      content = provider === 'codex' ? await callCodex(prompt) : await callOpenAI(prompt);
    } catch (e) {
      if (forced) throw e;
      // Missing / revoked / rate-limited OpenAI key → fall back to Codex CLI.
      const err = e as Error & { detail?: string };
      console.warn('[translate] openai failed, falling back to codex:', err.message, err.detail?.slice(0, 120) ?? '');
      provider = 'codex';
      content = await callCodex(prompt);
    }
    let parsed: { items?: Array<{ key: string; translation: string }> };
    try {
      try { parsed = JSON.parse(content); } catch { parsed = JSON.parse(repairJson(content)); }
    } catch {
      console.error('[translate] non-JSON response:', content.slice(0, 200));
      res.status(502).json({ error: 'translator returned non-JSON', raw: content.slice(0, 400) });
      return;
    }
    const items = parsed.items ?? [];
    console.log('[translate] ✓', body.targetLocale, items.length, 'translations via', provider);
    res.json({ ok: true, items, targetLocale: body.targetLocale, provider });
  } catch (e) {
    console.error('[translate] error:', e instanceof Error ? e.message : e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
