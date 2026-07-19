import type { Request, Response } from 'express';
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
  'pt-br': 'Brazilian Portuguese', pt: 'Portuguese',
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
    const key = getOpenAIKey();
    const prompt = buildPrompt(body);
    console.log('[translate] →', body.targetLocale, body.items.length, 'items');
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
      console.error('[translate] openai error', r.status, text.slice(0, 400));
      res.status(502).json({ error: `openai ${r.status}`, detail: text.slice(0, 400) });
      return;
    }
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      res.status(502).json({ error: 'no content in openai response' });
      return;
    }
    let parsed: { items?: Array<{ key: string; translation: string }> };
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error('[translate] non-JSON response:', content.slice(0, 200));
      res.status(502).json({ error: 'openai returned non-JSON', raw: content.slice(0, 400) });
      return;
    }
    const items = parsed.items ?? [];
    console.log('[translate] ✓', body.targetLocale, items.length, 'translations');
    res.json({ ok: true, items, targetLocale: body.targetLocale });
  } catch (e) {
    console.error('[translate] error:', e instanceof Error ? e.message : e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
