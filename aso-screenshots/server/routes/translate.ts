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
    `You are a senior App Store marketing copywriter specializing in localization. Your job is to ADAPT screenshot headlines from ${source} to ${target} — not translate them word-for-word.`,
    body.appContext ? `App context: ${body.appContext}` : '',
    'Rules:',
    '- ADAPT, do not translate literally. These are punchy marketing headlines on App Store screenshots — find the idiomatic equivalent that carries the same emotional punch in the target language, not a word-for-word rendering.',
    '- Preserve the marketing intent even if the wording changes significantly. A good adaptation sounds native, not translated.',
    '- Keep the length close to the source — these strings live on small phone screenshots.',
    '- Preserve punctuation style and emoji.',
    '- Keep ALL-CAPS if the source is ALL-CAPS.',
    '- Do NOT translate: proper nouns, brand/app names, industry-standard acronyms, or technical protocol names. Leave them verbatim. Only translate the surrounding descriptive words.',
    '- For RTL languages (Arabic, Hebrew) translate naturally — the renderer flips direction itself.',
    '- For CJK languages (Japanese, Chinese, Korean) prefer concise idiomatic phrasing.',
    '- Never add quotes or markdown around your output.',
    '',
    'Return a JSON object with shape: { "items": [{ "key": "<id>", "translation": "<text>" }, ...] }. Match every input key exactly. No extra commentary.',
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
        temperature: 0.3,
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
    } catch (e) {
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
