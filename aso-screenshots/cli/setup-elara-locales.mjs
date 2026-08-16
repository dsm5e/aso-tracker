const STATE_API = 'http://localhost:5181/api/studio-state';
const TRANSLATE_API = 'http://localhost:5181/api/translate/batch';
const ASSET_BASE = 'http://localhost:5180/studio/uploads';

const localeSpecs = [
  { code: 'en-US', apiCode: 'en-US', asset: 'en', name: 'English (US)', flag: '🇺🇸', font: 'Nunito Sans' },
  { code: 'ar', apiCode: 'ar', asset: 'ar', name: 'Arabic', flag: '🇸🇦', font: 'Noto Sans Arabic', rtl: true },
  { code: 'de', apiCode: 'de', asset: 'de', name: 'German', flag: '🇩🇪', font: 'Nunito Sans' },
  { code: 'es', apiCode: 'es', asset: 'es', name: 'Spanish', flag: '🇪🇸', font: 'Nunito Sans' },
  { code: 'fr', apiCode: 'fr', asset: 'fr', name: 'French', flag: '🇫🇷', font: 'Nunito Sans' },
  { code: 'it', apiCode: 'it', asset: 'it', name: 'Italian', flag: '🇮🇹', font: 'Nunito Sans' },
  { code: 'ja', apiCode: 'ja', asset: 'ja', name: 'Japanese', flag: '🇯🇵', font: 'Noto Sans JP' },
  { code: 'ko', apiCode: 'ko', asset: 'ko', name: 'Korean', flag: '🇰🇷', font: 'Noto Sans KR' },
  { code: 'pt-BR', apiCode: 'pt-br', asset: 'pt-BR', name: 'Portuguese (Brazil)', flag: '🇧🇷', font: 'Nunito Sans' },
  { code: 'ru', apiCode: 'ru', asset: 'ru', name: 'Russian', flag: '🇷🇺', font: 'Nunito Sans' },
  { code: 'zh-Hans', apiCode: 'zh-Hans', asset: 'zh-Hans', name: 'Chinese (Simplified)', flag: '🇨🇳', font: 'Noto Sans SC' },
];

const sourceItems = [
  { key: 'headlineMain', text: 'THE MOST BEAUTIFUL WAY TO BE PREGNANT' },
  { key: 'headlineAccent', text: 'TOGETHER' },
  { key: 'annotation', text: 'Start your journey' },
  { key: 'proofText', text: 'One subscription · both of you' },
  { key: 'trustStrip', text: 'WEEK BY WEEK · KICKS · CALENDAR · PARTNER MODE' },
  { key: 'phoneTitle', text: 'Every milestone. Shared.' },
  { key: 'phoneSubtitle', text: 'One beautiful app for Mom & Dad.' },
  { key: 'phoneToggleLeft', text: 'MOM' },
  { key: 'phoneToggleRight', text: 'DAD' },
];

const english = Object.fromEntries(sourceItems.map((item) => [item.key, item.text]));

function breakAfterFirstSentence(text) {
  return text.replace(/([.!?。！？])\s+/u, '$1\n');
}

async function translate(spec) {
  if (spec.code === 'en-US') return english;
  const response = await fetch(TRANSLATE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetLocale: spec.apiCode,
      sourceLocale: 'en-US',
      appContext: 'Elara is a warm premium pregnancy app shared by Mom and Dad. Copy must feel gentle, supportive and concise.',
      items: sourceItems,
    }),
  });
  if (!response.ok) {
    throw new Error(`${spec.code}: translate ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  const translated = Object.fromEntries(
    payload.items.map((item) => [item.key, item.translation]),
  );
  for (const item of sourceItems) {
    if (!translated[item.key]) {
      throw new Error(`${spec.code}: missing translation for ${item.key}`);
    }
  }
  return translated;
}

const stateResponse = await fetch(STATE_API);
if (!stateResponse.ok) throw new Error(`state GET ${stateResponse.status}`);
const state = await stateResponse.json();
const hero = state.screenshots.find((slot) => slot.heroTextLayout === 'elara');
if (!hero) throw new Error('Elara hero slot not found');

const translations = new Map();
let cursor = 0;
const workers = Array.from({ length: 3 }, async () => {
  while (cursor < localeSpecs.length) {
    const spec = localeSpecs[cursor++];
    const result = await translate(spec);
    translations.set(spec.code, result);
    console.log(`translated ${spec.code}`);
  }
});
await Promise.all(workers);

state.locales = localeSpecs.map((spec) => {
  const tr = translations.get(spec.code);
  const sourceOverrides = Object.fromEntries(
    state.screenshots
      .filter((slot) => slot.id !== hero.id)
      .map((slot) => {
        const match = slot.id.match(/-(\d{2})$/);
        if (!match) throw new Error(`cannot derive frame number from ${slot.id}`);
        return [slot.id, `${ASSET_BASE}/elara-v21-${spec.asset}-${match[1]}.png`];
      }),
  );

  return {
    id: spec.code,
    code: spec.code,
    flag: spec.flag,
    name: spec.name,
    rtl: spec.rtl ?? false,
    translations: Object.fromEntries(
      state.screenshots.map((slot) => [
        slot.id,
        slot.id === hero.id
          ? {
              verb: `${tr.headlineMain}\n— *${tr.headlineAccent}*`,
              descriptor: '',
              subhead: '',
            }
          : { verb: '', descriptor: '', subhead: '' },
      ]),
    ),
    pillTranslations: { [hero.id]: 'ELARA' },
    extraTranslations: {
      [hero.id]: {
        annotation: tr.annotation,
        proofText: tr.proofText,
        trustStrip: tr.trustStrip,
        phoneBrand: 'ELARA',
        phoneTitle: breakAfterFirstSentence(tr.phoneTitle),
        phoneSubtitle: tr.phoneSubtitle,
        phoneToggleLeft: tr.phoneToggleLeft,
        phoneToggleRight: tr.phoneToggleRight,
      },
    },
    sourceOverrides,
    slotAdjustments: {},
    fontOverride: spec.font,
    aiTranslated: true,
  };
});

const pushed = await fetch(`${STATE_API}/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(state),
});
if (!pushed.ok) throw new Error(`state push ${pushed.status}: ${await pushed.text()}`);
console.log(await pushed.text());
console.log(`Elara locales prepared: ${state.locales.length}`);
