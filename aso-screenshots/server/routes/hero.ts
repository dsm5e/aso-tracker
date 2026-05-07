import type { Request, Response } from 'express';
import { Buffer } from 'node:buffer';
import { getKey } from '../lib/keys.js';
import { writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fal } from '@fal-ai/client';

/** Path to the studio state mirror — same file the SSE bridge in server/index
 *  watches. We poke it directly on enhance success/failure so the result
 *  outlives a browser navigation: fs.watch fires → SSE broadcasts → any
 *  reconnected client (Tracker → Screenshots round-trip) sees the update. */
const STATE_FILE = join(homedir(), '.aso-studio', 'state.json');

interface SlotActionPatch {
  aiImageUrl?: string;
  lastPrompt?: string;
  generateState?: 'idle' | 'generating' | 'done' | 'error';
  errorMessage?: string | null;
  /** When set, append this URL to the slot's aiHistory (cap 8). */
  appendHistoryUrl?: string;
}

function persistSlotResult(slotId: string, patch: SlotActionPatch): void {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(raw) as { screenshots?: Array<{ id: string; action?: Record<string, unknown> }> };
    const ss = state.screenshots?.find((s) => s.id === slotId);
    if (!ss) return;
    const action = (ss.action as Record<string, unknown> | undefined) ?? {};
    const next: Record<string, unknown> = { ...action };
    if (patch.aiImageUrl !== undefined) next.aiImageUrl = patch.aiImageUrl;
    if (patch.lastPrompt !== undefined) next.lastPrompt = patch.lastPrompt;
    if (patch.generateState !== undefined) next.generateState = patch.generateState;
    if (patch.errorMessage !== undefined) next.errorMessage = patch.errorMessage ?? undefined;
    if (patch.appendHistoryUrl) {
      const prev = (action.aiHistory as string[] | undefined) ?? [];
      next.aiHistory = [...prev, patch.appendHistoryUrl].slice(-8);
    }
    ss.action = next;
    writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e) {
    console.warn('[hero] failed to persist slot result:', (e as Error).message);
  }
}

function getFalKey(): string {
  return getKey('FAL_API_KEY');
}

export interface PresetCtx {
  id: string;
  name: string;
  description: string;
  kind: 'real' | 'abstract';
  background: { type: string; css: string; grain?: boolean };
  text: { font: string; weight: number; color: string; uppercase?: boolean; align?: string };
  tiltDeg: number;
  breakout?: string;
  decorationsHint?: string;
}

export interface HeroGenerateBody {
  appName: string;
  appColor: string;
  themeHint: string;
  /** Effective background: user's override OR preset default. Sent verbatim to AI as palette anchor. */
  effectiveBackground: string;
  preset: PresetCtx;
  /** User's scaffold rendered as data URI (data:image/png;base64,...) */
  scaffoldDataUri: string;
  /** Where the headline lives — semantic fraction instead of pixels. Easier for
   *  gpt-image-2 to follow. 'top' / 'bottom' = headline reserves the top/bottom
   *  quarter of the canvas; 'middle' is rare. */
  headlineZone?: 'top' | 'bottom' | 'middle' | null;
  /** Calculated headline bottom as % of canvas height (e.g. 32 = top 32% reserved).
   *  Overrides the hardcoded 25% in buildHeroPrompt when provided. */
  headlinePct?: number;
  /** What kind of slot we're enhancing — picks the right prompt.
   *  'hero' = action/selling screen (first slot, social proof, theme illustrations);
   *  'polish' = regular slot (just photoreal device + light bg, no theme art). */
  kind?: 'hero' | 'polish';
  /** Pre-rendered prompt block from client-side hero ingredients toggles
   *  (CTA arrow, app icon, press quotes, etc.). Appended to the hero prompt. */
  extraPromptBlock?: string;
  /** App-icon image (data URI) sent when the "App icon (large)" hero ingredient
   *  is on. Server uploads to fal storage and adds to image_urls so gpt-image-2
   *  can faithfully reproduce the brand mark. */
  appIconDataUri?: string | null;
  /** Per-slot prompt. When non-empty, server uses it verbatim instead of the
   *  generic builder — lets each preset ship its own visual-style prompt. */
  customPrompt?: string | null;
  /** Mirrors the Inspector "Hide device" toggle for action slots. When true the
   *  scaffold already lacks a phone; we still need to instruct the AI not to
   *  re-add one, otherwise it follows the prompt's device-rendering language. */
  hideDevice?: boolean;
  /** Screenshot id this enhance belongs to. When provided, the server writes
   *  the final result into state.json itself — that way navigation away from
   *  the page (or a closed tab mid-call) doesn't lose the render. */
  slotId?: string;
  /** Device type — affects fal.ai output dimensions.
   *  'ipad' uses landscape-friendly 768×1024; 'iphone' (default) uses 768×1664. */
  device?: 'iphone' | 'ipad';
  /** Polish-only: when true, include the designer-style feature callout
   *  block in the prompt. Toggled per-slot from Inspector. */
  polishCallout?: boolean;
}

/** Hero prompt — high-converting App Store hero brief. Gives the model creative
 *  room (perspective, lighting, composition) while protecting the inner app UI
 *  and the top headline zone. Used for `kind: 'action'` slots. */
export function buildHeroPrompt(b: HeroGenerateBody): string {
  const p = b.preset;
  return [
    `Design a high-converting App Store hero screenshot for "${b.appName}". Goal: instantly communicate the main benefit in under 3 seconds.`,
    b.themeHint ? `App: ${b.themeHint}.` : '',
    p.description ? `Style: ${p.description}` : '',
    `Vibe: modern iOS marketing design — bold, premium, clean. Sharp lighting, soft shadows, lots of whitespace, strong visual hierarchy, vibrant background (same palette as the input: ${b.effectiveBackground} — do not change the dominant hue). Phone at a slight angle for depth (not flat). Glow / focus on the device. Make it instantly scannable at thumbnail size.`,
    p.decorationsHint ? `Decoration vibe: ${p.decorationsHint}` : '',
    `Composition: arrange every element with intentional spatial layout — anchor each ingredient in its own zone (corner, side, around the device), DON'T stack them vertically in a column. Use the whole canvas with breathing room. Visual hierarchy: phone is the focal point, decorations and ingredients are accents. Borrow shapes / colours / icons from elements visible inside the phone's app UI so the surrounding canvas feels like an extension of the app's visual language, not random stock graphics.`,
    b.extraPromptBlock ?? '',
    (() => {
      const zone = b.headlineZone ?? 'top';
      const pct = b.headlinePct ?? 25;
      const remaining = 100 - pct;
      if (zone === 'bottom') {
        return `Layout: the BOTTOM ${pct}% of the canvas is reserved for a headline overlaid afterwards — keep that zone clean background, no baked text, no decorations there. The remaining ${remaining}% (from the very top down to ~${remaining}% of the canvas height) is for the phone and decorations — use ALL of that vertical space with breathing room. Fill from top edge to the headline zone boundary; do NOT leave large empty gaps near the top.`;
      }
      if (zone === 'middle') {
        return `Layout: a headline will be overlaid in the middle band (~35%–65% of canvas height) — keep that band free of baked text and dense decorations. Place the phone and decorations in the top third and bottom third, flanking the headline zone.`;
      }
      // default: top
      return `Layout: the TOP ${pct}% of the canvas is reserved for a headline overlaid afterwards — keep it clean background, no baked text, no decorations there. The remaining ${remaining}% (from ~${pct}% downward to the very bottom of the canvas) is for the phone and decorations — use ALL of that vertical space with breathing room. CRITICAL: the phone must start BELOW the ${pct}% mark — do NOT place any part of the device above that line. Do NOT cluster everything in the upper-middle and leave the bottom empty; fill the canvas edge-to-edge.`;
    })(),
    `Avoid: clutter, multiple focal points, boring flat backgrounds, generic stock-photo decorations.`,
    `Quality: ultra-sharp, realistic lighting, premium App Store top-grossing-app feel.`,
    // Final, strongest instruction — placed last so it dominates whatever
    // ingredients block above asked for around the device.
    `IMPORTANT: Treat the inner phone screen as a fixed image. Keep its content exactly as in the input scaffold — do NOT redraw labels, buttons, list rows, status bar, icons, or any text inside the device frame. You may re-perspective the whole screen image to match the new phone angle, but pixel content stays.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Regular-slot polish — minimal, subtle. The scaffold layout, palette, phone
 *  position and inner UI all stay; we only upgrade the iPhone shell to
 *  photoreal and add at most ONE small feature callout to highlight a key UI
 *  element. Used for `kind: 'regular'`. */
export function buildPolishPrompt(b: HeroGenerateBody): string {
  const deviceLabel = b.device === 'ipad' ? 'iPad Pro' : 'iPhone 15/16 Pro';
  return [
    `INPAINTING TASK — pixel-level bezel replacement only. This is NOT a composition task. You are replacing a single layer: the physical device frame (the thin border between the background and the screen glass). Every other pixel in the image must be copied from the input exactly.`,
    `Task: upgrade the flat ${deviceLabel} shell in this App Store screenshot to a photoreal premium ${deviceLabel} — realistic metallic/glass bezel texture, soft cast shadow, subtle screen-edge reflection. That is the ONLY change permitted.`,
    `PIXEL GROUPS — what changes vs what is locked:`,
    `• Device bezel pixels (the physical frame border): REPLACE with photoreal material.`,
    `• Background pixels (everything outside the device): COPY from input exactly. Same hue, same dot/grain, same tone (anchor: ${b.effectiveBackground}). Zero colour shift.`,
    `• Screen pixels (everything inside the glass): COPY from input exactly. Do NOT redraw any label, button, list row, status bar, icon, or text.`,
    `• Device position/size/angle: IDENTICAL to input. The bounding box of the device does not move, scale, or rotate by a single pixel. Aspect ratio ${b.device === 'ipad' ? '≈ 3:4' : '≈ 9:19.5'} preserved.`,
    b.polishCallout
      ? `FEATURE CALLOUT — ADDITIVE OVERLAY ONLY.
DEVICE POSITION IS FROZEN: the phone/tablet does NOT move, shrink, or shift by a single pixel to make room for this callout. The callout is a new paint layer drawn on top of the existing composition — it does not displace anything.

WHAT TO EXTRACT: one visually rich UI component already visible inside the screen — a score panel, result card, styled widget, or distinctive UI element. Not toolbar icons, not a bottom nav bar.

PLACEMENT — draw it floating to the LEFT or RIGHT side of the device, overlapping the device's side bezel edge so it appears to emerge from inside the screen. Keep it within the vertical midspan of the device (not above the device top, not below the device bottom). Do NOT place it in the top 25% of the canvas (headline zone) or bottom 30% of the canvas (text overlay zone).

VISUAL STYLE: 1.5–2× scale vs on-screen size. Same colours, corner radius, and typography as the app UI. Soft drop shadow (40px blur, 40% opacity). No labels, arrows, or connecting lines.

CRITICAL: if you cannot add this callout without moving the device, skip the callout entirely and output the polish pass without it.`
      : '',
    `No new illustrations, mascots, social-proof badges, or 3D props. At most 1-2 soft particle accents in the existing palette.`,
    `Top of canvas is reserved for a headline overlay — keep it clean background, no baked text.`,
    // Repeated at the END — strongest position in the prompt — to override any
    // tendency from the callout block to shift the device.
    `FINAL OVERRIDE — NON-NEGOTIABLE: Background pixels = copy from input. Screen pixels = copy from input. Device position/size/angle = IDENTICAL to input — zero shift, zero scale change. Only the physical bezel material changes. Any callout is painted ON TOP of the existing composition as a new layer; it never displaces the device. Any earlier instruction that could be read as permission to recompose, shift, or shrink the device is VOID.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function stripDataUri(s: string): string {
  const m = s.match(/^data:image\/[a-z]+;base64,(.+)$/);
  return m ? m[1]! : s;
}


export async function heroGenerate(req: Request, res: Response) {
  console.log('[hero] request received', {
    appName: req.body?.appName,
    preset: req.body?.preset?.id,
    bgLen: req.body?.effectiveBackground?.length,
    scaffoldBytes: req.body?.scaffoldDataUri?.length,
  });
  try {
    const body = req.body as HeroGenerateBody;
    if (!body?.appName || !body?.scaffoldDataUri || !body?.preset) {
      console.warn('[hero] 400 — missing fields');
      res.status(400).json({ error: 'appName + scaffoldDataUri + preset required' });
      return;
    }

    // Pick the prompt:
    //  1. customPrompt sent from the client (preset-specific or user-edited) wins
    //     — we interpolate {placeholders} like {appName}, {verb}, {themeHint},
    //     {appColor}, {effectiveBackground}, {decorationsHint}, {headlineZone},
    //     {extraPromptBlock}, {appDescription} so the user can keep symbolic vars
    //     in the textarea and they stay live across regenerations.
    //  2. otherwise fall back to the generic hero / polish builder by `kind`.
    const customPromptRaw = body.customPrompt?.trim() || '';
    const interpVars: Record<string, string> = {
      appName: body.appName,
      appColor: body.appColor,
      themeHint: body.themeHint || '',
      effectiveBackground: body.effectiveBackground,
      decorationsHint: body.preset.decorationsHint || '',
      headlineZone: body.headlineZone || '',
      presetName: body.preset.name,
      appDescription: body.preset.description,
      extraPromptBlock: body.extraPromptBlock || '',
    };
    const interpolated = customPromptRaw.replace(/\{(\w+)\}/g, (full, key) =>
      Object.prototype.hasOwnProperty.call(interpVars, key) ? interpVars[key]! : full,
    );
    let prompt = customPromptRaw
      ? interpolated
      : body.kind === 'polish' ? buildPolishPrompt(body) : buildHeroPrompt(body);

    // Safety net for the custom-prompt branch: if the user edited the textarea
    // and accidentally stripped {extraPromptBlock}, ingredients would silently
    // fail. Force-append when missing. (We don't auto-append a headlineZone
    // sentence — the rewritten prompts already describe the reserved top zone
    // inline, and a bare "top"/"bottom" string adds noise.)
    if (customPromptRaw) {
      const missingExtras = !customPromptRaw.includes('{extraPromptBlock}') && body.extraPromptBlock?.trim();
      if (missingExtras) {
        prompt += '\n\n' + body.extraPromptBlock;
      }
    }
    // Hide-device override — AI follows the prompt's "render iPhone" language
    // unless we explicitly contradict it. Applies to BOTH branches so the toggle
    // works regardless of whether the user is on the custom-prompt path.
    if (body.hideDevice) {
      prompt += [
        '',
        '',
        'DEVICE OVERRIDE — CRITICAL:',
        'The user wants this hero composition WITHOUT any phone. Do NOT render an iPhone, do not add any device, do not include any screen. The composition is background + decorations + (any extra ingredients) only. If the input scaffold contained a phone, treat it as removed; recompose without it. Any earlier instruction to render / preserve / polish the iPhone is OVERRIDDEN by this directive.',
      ].join('\n');
    }
    // Parse scaffold PNG dimensions from header bytes (bytes 16-23 = width, height as big-endian uint32)
    const scaffoldBuf = Buffer.from(stripDataUri(body.scaffoldDataUri), 'base64');
    const scaffoldW = scaffoldBuf.readUInt32BE(16);
    const scaffoldH = scaffoldBuf.readUInt32BE(20);
    const outputW = body.device === 'ipad' ? 768 : 768;
    const outputH = body.device === 'ipad' ? 1024 : 1664;
    console.log('[hero] using prompt mode:', customPromptRaw ? 'custom' : (body.kind ?? 'hero'), body.hideDevice ? '(no-device)' : '', `polishCallout=${!!body.polishCallout}`);
    console.log(`[hero] scaffold dims: ${scaffoldW}×${scaffoldH} → fal output: ${outputW}×${outputH} | ratio scaffold=${(scaffoldW/scaffoldH).toFixed(4)} output=${(outputW/outputH).toFixed(4)}`);
    // Persist last prompt + scaffold to /tmp so we can inspect what was sent
    writeFile('/tmp/aso-studio-last-prompt.txt', prompt).catch(() => {});
    writeFile('/tmp/aso-studio-last-scaffold.png', new Uint8Array(scaffoldBuf)).catch(() => {});
    const key = getFalKey();
    console.log('[hero] key loaded, len:', key.length);
    console.log('[hero] prompt saved to /tmp/aso-studio-last-prompt.txt');

    // 1. Upload scaffold via fal SDK (avoids HTTP/2 ECONNRESET of raw fetch)
    fal.config({ credentials: key });
    const buf = Buffer.from(stripDataUri(body.scaffoldDataUri), 'base64');
    console.log('[hero] uploading scaffold to fal storage, bytes:', buf.byteLength);
    const scaffoldFile = new File([buf], 'scaffold.png', { type: 'image/png' });

    let scaffoldUrl: string = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        scaffoldUrl = await fal.storage.upload(scaffoldFile);
        break;
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        const isTransient = msg.includes('ENOTFOUND') || msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED') || msg.includes('fetch failed');
        if (isTransient && attempt < 3) {
          console.warn(`[hero] scaffold upload transient error (attempt ${attempt}/3), retrying in ${attempt * 3}s:`, msg);
          await new Promise((r) => setTimeout(r, attempt * 3000));
        } else {
          throw e;
        }
      }
    }
    console.log('[hero] uploaded:', scaffoldUrl);

    // 1b. If user uploaded an app icon, push it to fal storage too.
    let iconUrl: string | undefined;
    if (body.appIconDataUri) {
      try {
        const iconBuf = Buffer.from(stripDataUri(body.appIconDataUri), 'base64');
        const iconFile = new File([iconBuf], 'icon.png', { type: 'image/png' });
        iconUrl = await fal.storage.upload(iconFile);
        console.log('[hero] app icon uploaded:', iconUrl);
      } catch (e) {
        console.warn('[hero] icon upload failed, continuing without it:', e);
      }
    }


    // 2. Call gpt-image-2/edit via @fal-ai/client SDK (handles queue + polling).
    //    Raw fetch/curl both hit HTTP/2 RST_STREAM ECONNRESET on fal.run;
    //    the SDK uses the fal queue protocol and avoids long-held connections.
    console.log('[hero] calling fal.ai gpt-image-2/edit via SDK…');
    const imageUrls = [scaffoldUrl];
    if (iconUrl) imageUrls.push(iconUrl);
    console.log('[hero] image_urls count:', imageUrls.length);

    type FalResult = { data: { images?: Array<{ url: string }> } };
    const falInput = {
      prompt,
      image_urls: imageUrls,
      image_size: body.device === 'ipad'
        ? { width: 768, height: 1024 }
        : { width: 768, height: 1664 },
      quality: 'medium',
      output_format: 'png',
      num_images: 1,
    };

    let result: FalResult = { data: {} };
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        result = await fal.subscribe('openai/gpt-image-2/edit', {
          input: falInput,
          logs: true,
          onQueueUpdate: (update: { status: string }) => {
            console.log(`[hero] fal queue status (attempt ${attempt}):`, update.status);
          },
        }) as FalResult;
        break;
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        const isTransient = msg.includes('ENOTFOUND') || msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED') || msg.includes('fetch failed');
        if (isTransient && attempt < MAX_RETRIES) {
          const delay = attempt * 3000;
          console.warn(`[hero] transient error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms:`, msg);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw e;
        }
      }
    }

    console.log('[hero] fal response received, has images:', !!result.data?.images?.length);
    const imageUrl = result.data?.images?.[0]?.url;
    if (!imageUrl) {
      const detail = JSON.stringify(result.data).slice(0, 400);
      console.error('[hero] no image in response', detail);
      res.status(502).json({ error: 'no image in response', detail });
      return;
    }

    console.log('[hero] success →', imageUrl);
    // Download result for side-by-side comparison with scaffold
    fetch(imageUrl).then(r => r.arrayBuffer()).then(ab => {
      const resBuf = Buffer.from(ab);
      const resW = resBuf.readUInt32BE(16);
      const resH = resBuf.readUInt32BE(20);
      console.log(`[hero] result dims: ${resW}×${resH}`);
      writeFile('/tmp/aso-studio-last-result.png', new Uint8Array(resBuf)).catch(() => {});
    }).catch(() => {});

    // Persist result into state.json — survives browser navigation. fs.watch
    // in server/index.ts broadcasts via SSE so any reconnecting client (or
    // tab still open behind another app) picks up the new state.
    if (body.slotId) {
      persistSlotResult(body.slotId, {
        aiImageUrl: imageUrl,
        lastPrompt: prompt,
        generateState: 'done',
        errorMessage: null,
        appendHistoryUrl: imageUrl,
      });
    }

    res.json({ ok: true, url: imageUrl, prompt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? (e.stack ?? '') : '';
    const cause = (e as { cause?: unknown })?.cause;
    const causeMsg = cause instanceof Error ? ` | cause: ${cause.message} ${cause.stack ?? ''}` : cause ? ` | cause: ${String(cause)}` : '';
    const full = `${msg}\n${stack}${causeMsg}`;
    console.error('[hero] error caught:', full);
    try {
      const { appendFileSync } = await import('node:fs');
      const ts = new Date().toISOString().slice(11, 23);
      appendFileSync('/tmp/aso-studio-dev.log', `[${ts}] [server:error] hero: ${full.slice(0, 1000)}\n`);
    } catch {}
    if (req.body?.slotId) {
      persistSlotResult(req.body.slotId as string, {
        generateState: 'error',
        errorMessage: msg,
      });
    }
    res.status(500).json({ error: full.slice(0, 500) });
  }
}
