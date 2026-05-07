/**
 * Hero ingredients — toggleable additions to the AI hero prompt.
 *
 * Each entry pairs a UI label (shown in Inspector toggles) with a prompt fragment
 * appended to buildHeroPrompt() when the toggle is on. They're NEVER rendered as
 * HTML/SVG in scaffold — gpt-image-2 bakes them directly into the polished image,
 * which produces dramatically better results than us trying to draw them by hand.
 *
 * Some ingredients have editable text parameters surfaced as inputs in Inspector
 * when their toggle is on. Values get `{placeholder}`-interpolated into the
 * prompt at build time, falling back to the field's default when blank.
 */

import type { HeroIngredients } from '../state/studio';

export interface IngredientField {
  /** Key under action.ingredientParams[ingredientKey]. */
  key: string;
  /** Label shown above the input in Inspector. */
  label: string;
  placeholder?: string;
  /** Used in the prompt when the user leaves the field blank. */
  default: string;
}

interface IngredientDef {
  key: keyof HeroIngredients;
  label: string;
  hint: string;
  /** Sentence appended to the AI prompt when this ingredient is enabled.
   *  Supports `{fieldKey}` placeholders that get filled from `fields` defaults
   *  or the user's edits in Inspector. */
  prompt: string;
  /** Editable text fields shown below the toggle when it's on. Empty / omitted
   *  for ingredients without parameters (Editor's Choice, multi-device, etc.). */
  fields?: IngredientField[];
  /** When set, the resolved prompt is built by this function instead of by
   *  template interpolation — use for ingredients with conditional language
   *  (e.g. social proof where the rating caption is optional). */
  compose?: (params: Record<string, string>) => string;
}

export const HERO_INGREDIENTS: IngredientDef[] = [
  {
    key: 'socialProof',
    label: 'Соц-доказательство',
    hint: 'Лавры + ★★★★★ (подпись опционально — пусто = просто лавры со звёздами, для indie без отзывов)',
    // Both fields optional — empty = laurels + stars without any caption.
    prompt: '',
    fields: [
      { key: 'line1', label: 'Подпись 1 (опц.)', placeholder: '#1 Cat Game', default: '' },
      { key: 'line2', label: 'Подпись 2 (опц.)', placeholder: '4.9 Average', default: '' },
      { key: 'position', label: 'Позиция (top / bottom)', placeholder: 'top', default: 'top' },
    ],
    compose: (p) => {
      const line1 = p.line1?.trim();
      const line2 = p.line2?.trim();
      const pos = (p.position?.trim() || 'top').toLowerCase();
      const centerText = line1
        ? `"${line1}"${line2 ? ` with a smaller subtitle line "${line2}" below it` : ''}`
        : 'a bold award number or accolade';
      const placement = pos === 'bottom'
        ? `POSITION: place it centered just BELOW the bottom bezel of the device — touching or slightly overlapping the device's bottom edge on the outside. NEVER cover the app screen content inside the device. NEVER in the top headline zone.`
        : `POSITION: place it centered just ABOVE the top bezel of the device — floating immediately above the phone's top edge, touching or slightly overlapping the outer bezel only. NEVER cover the app screen content inside the device. If headline text occupies the top zone, tuck the badge snugly between the bottom of that text and the top of the phone — use the gap between them. If there is no headline text, center it in the upper area above the device. NEVER float it in empty background space far from the device.`;
      return `Add a social-proof award badge in the style of an editorial App Store laurel-wreath badge: TWO symmetrical flat laurel branches curving outward from a central text block, forming a wreath/crown shape. BADGE CENTER: large bold sans-serif text ${centerText} — prominent, legible at thumbnail size. LAUREL STYLE: flat line-art, thin strokes, dark/brand-accent color — NO 3D, NO metallic shading, NO gloss. The overall badge looks like a "No.1 [Category]" editorial plaque. ${placement} Sized about 40–50% of the phone width.`;
    },
  },
  {
    key: 'ctaArrow',
    label: 'CTA-стрелка',
    hint: 'Рукописная стрелка, указывающая на устройство',
    prompt: '',
    fields: [
      { key: 'text', label: 'Подпись стрелки', placeholder: 'Tap to start (пусто = AI выберет)', default: '' },
    ],
    compose: (p) => {
      const text = p.text?.trim();
      const tag = text
        ? `a tiny "${text}" tag`
        : `a short contextual call-to-action tag — choose 2–4 words that fit the app's core action visible inside the phone (e.g. "Scan now", "Open a case", "Try it free" — derive from the UI, not generic "Tap to start")`;
      return `Add a small hand-drawn marker (arrow or doodle squiggle, brand-accent color) pointing toward the iPhone, with ${tag}. Keep it tasteful and contextual, not cartoonish.`;
    },
  },
  {
    key: 'appIcon',
    label: 'Иконка приложения',
    hint: 'Крупный 3D-рендер иконки рядом с устройством',
    prompt:
      'Add a large premium 3D rendition of the app\'s icon (rounded-square iOS app icon) floating near the device — soft drop shadow, slight tilt, glassy or metallic finish appropriate to the brand.',
    // No text fields — image upload is handled separately via AppIconUploader.
  },
  {
    key: 'editorsChoice',
    label: 'Editor\'s Choice бейдж',
    hint: 'Медальон с лентой (пусто = AI выберет подпись по контексту)',
    prompt: '',
    fields: [
      { key: 'label', label: 'Текст медальона', placeholder: 'Editor\'s Choice (пусто = AI выберет)', default: '' },
    ],
    compose: (p) => {
      const label = p.label?.trim();
      const badgeText = label
        ? `"${label}"`
        : `an award title that fits the app's category and positioning visible in the scaffold — choose from options like "Editor's Choice", "Best in Class", "Top Pick", or something more specific to the app's niche`;
      return `Add an ${badgeText} award medallion (round badge with ribbon, gold/metallic finish, App Store-style). POSITION: overlay it on the LOWER-LEFT corner of the device — the badge should sit on top of / partially cover the phone's bottom-left area. It is an overlay element; it does NOT push the device away. CRITICAL: do NOT move, shrink, or reposition the phone/tablet to make room for this badge — the device stays exactly as in the scaffold. The badge floats on top of the device's lower portion. NEVER place it in the top 25% headline zone. Sized about ⅛ the canvas width.`;
    },
  },
  {
    key: 'pressQuotes',
    label: 'Лого прессы',
    hint: '«As seen in …» — пусто = AI выберет подходящие издания',
    prompt: '',
    fields: [
      { key: 'logos', label: 'Логотипы (через запятую)', placeholder: 'TechCrunch, Wired, Forbes (пусто = AI выберет)', default: '' },
    ],
    compose: (p) => {
      const logos = p.logos?.trim();
      const logosClause = logos
        ? logos
        : `three credible press or review outlets appropriate for this app's category and audience — infer from what's visible inside the phone (e.g. medical/clinical apps → journals like NEJM or Healthcare IT News; consumer apps → TechCrunch, Wired, The Verge; niche tools → relevant niche press)`;
      return `Add a small "As seen in" press strip with three faux outlet logos (${logosClause}), greyscale. POSITION: anchored to the VERY BOTTOM of the canvas — the strip must sit in the bottom 8% of the image, spanning the full width, with a subtle thin separator line above it. NEVER in the middle of the canvas, NEVER beside the device, NEVER above the bottom 15%. This is a footer element — treat it like a footer bar at the absolute bottom edge.`;
    },
  },
  {
    key: 'testimonial',
    label: 'Цитата отзыв',
    hint: 'Короткий отзыв пользователя — пусто = AI придумает из контекста',
    prompt: '',
    fields: [
      { key: 'quote', label: 'Цитата', placeholder: 'My go-to app (пусто = AI выберет)', default: '' },
      { key: 'author', label: 'Автор', placeholder: '— Sarah, designer (пусто = AI выберет)', default: '' },
    ],
    compose: (p) => {
      const quote = p.quote?.trim();
      const author = p.author?.trim();
      const quoteClause = quote
        ? `"${quote}"`
        : `a short authentic 5–8 word testimonial that matches the app's core benefit visible in the scaffold — write something specific and real-sounding (avoid generic "love this app"; instead derive from the UI's domain, e.g. "Finally, all my patient scans in one place" for a medical app)`;
      const authorClause = author
        ? `"${author}"`
        : `a realistic first name and role that fits the app's typical user — infer from the UI content (e.g. "— Dr. Müller, Radiologist" for a medical tool, "— Jake, designer" for a creative app)`;
      return `Add a short customer testimonial blurb in stylised quote marks (${quoteClause}) with attribution ${authorClause}. POSITION: overlay it on the LOWER-RIGHT area of the device — the testimonial floats on top of the phone's bottom-right portion. It is an overlay element; it does NOT push the device away. CRITICAL: do NOT move, shrink, or reposition the phone/tablet to make room for the testimonial — the device stays exactly as in the scaffold. NEVER place it in the top 25% headline zone.`;
    },
  },
  {
    key: 'handHolding',
    label: 'Рука, держащая телефон',
    hint: 'Фотореалистичная рука вместо плавающего устройства',
    prompt:
      'Replace the floating phone with a photorealistic human hand holding the iPhone — natural skin tones, soft cast shadow, lifestyle composition. The screen UI must remain pixel-faithful.',
  },
  {
    key: 'floatingFeatures',
    label: 'Парящие иконки фич',
    hint: '3D-мини-иконки вокруг устройства — пусто = AI выберет из UI',
    prompt: '',
    fields: [
      { key: 'icons', label: 'Иконки (через запятую)', placeholder: 'document, pen, lock… (пусто = AI выберет)', default: '' },
    ],
    compose: (p) => {
      const icons = p.icons?.trim();
      const iconsClause = icons
        ? icons
        : `3-5 icons derived directly from the app UI visible inside the phone — extract the dominant shapes, symbols and brand motifs already present on screen (buttons, list icons, status indicators) and render them as floating 3D elements`;
      return `Add 3-5 small 3D feature icons floating around the device (${iconsClause}). Derive their look from elements ALREADY visible inside the phone's app UI in the input scaffold — pull the same shapes, accent colours, and visual motifs. The floating icons should feel like the app's own UI extended outward into the canvas, not generic stock symbols. Tasteful spacing around the device, NOT inside the headline reserved zone.`;
    },
  },
  {
    key: 'multiDevice',
    label: 'iPhone + iPad',
    hint: 'Два устройства рядом — намёк на multi-platform',
    prompt:
      'Show the iPhone alongside a 3D iPad displaying a related view — slightly behind / overlapping the phone, suggests multi-platform support.',
  },
  {
    key: 'beforeAfter',
    label: 'Было / Стало',
    hint: 'Сплит-композиция — пусто = AI выводит из UI что за трансформация',
    prompt: '',
    fields: [
      { key: 'before', label: 'Слева (было)', placeholder: 'cluttered files… (пусто = AI выберет)', default: '' },
      { key: 'after', label: 'Справа (стало)', placeholder: 'clean result… (пусто = AI выберет)', default: '' },
    ],
    compose: (p) => {
      const before = p.before?.trim();
      const after = p.after?.trim();
      const beforeClause = before
        ? before
        : `the messy/unorganised problem state that this app solves — infer from the UI domain visible in the phone`;
      const afterClause = after
        ? after
        : `the clean, organised result the app produces — infer from what's shown in the phone's UI`;
      return `Split the composition into a subtle "before / after" — left half shows ${beforeClause}, right half shows ${afterClause}. Use a soft divider line or torn-paper edge.`;
    },
  },
];

/** Returns the ingredient definition by key — lets Inspector look up `fields`
 *  to render parameter inputs. */
export function findIngredient(key: keyof HeroIngredients): IngredientDef | undefined {
  return HERO_INGREDIENTS.find((i) => i.key === key);
}

/** Resolve `{fieldKey}` placeholders in an ingredient prompt using the user's
 *  saved values, falling back to the field defaults when a value is missing.
 *  When the ingredient supplies `compose`, that function builds the prompt
 *  directly instead of running template interpolation. */
function resolveIngredientPrompt(def: IngredientDef, params?: Record<string, string>): string {
  if (def.compose) return def.compose(params ?? {});
  if (!def.fields?.length) return def.prompt;
  const vars: Record<string, string> = {};
  for (const f of def.fields) vars[f.key] = (params?.[f.key]?.trim() || f.default);
  return def.prompt.replace(/\{(\w+)\}/g, (full, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k]! : full,
  );
}

export function buildIngredientsPromptBlock(
  ingredients?: HeroIngredients,
  params?: Partial<Record<keyof HeroIngredients, Record<string, string>>>,
): string {
  if (!ingredients) return '';
  const lines = HERO_INGREDIENTS.filter((i) => ingredients[i.key]).map(
    (i) => `- ${resolveIngredientPrompt(i, params?.[i.key])}`,
  );
  if (!lines.length) return '';
  return ['', 'EXTRA INGREDIENTS (user-selected, must appear in the polished image):', ...lines].join('\n');
}
