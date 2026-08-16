import { writeFile } from 'node:fs/promises';

const STATE_API = 'http://localhost:5181/api/studio-state';
const TRANSLATE_API = 'http://localhost:5181/api/translate/batch';
const ASSET_BASE = 'http://localhost:5180/studio/uploads';
const OUTPUT = '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/02_CPP-Father-EN-Approval';

const localeSpecs = [
  {
    code: 'en-US',
    apiCode: 'en-US',
    name: 'English (US)',
    flag: '🇺🇸',
    font: 'Nunito Sans',
    assetFolder: null,
    assetPrefix: null,
    hero: 'father-hero-photo-textless-v1.png',
  },
  {
    code: 'ar-SA',
    apiCode: 'ar',
    name: 'Arabic (Saudi Arabia)',
    flag: '🇸🇦',
    font: 'Noto Sans Arabic',
    rtl: true,
    assetFolder: 'ar-SA',
    assetPrefix: 'ar',
    hero: 'father-market-heroes/father-hero-ar-SA-v1.png',
  },
  {
    code: 'de-DE',
    apiCode: 'de',
    name: 'German',
    flag: '🇩🇪',
    font: 'Nunito Sans',
    assetFolder: 'de-DE',
    assetPrefix: 'de',
    hero: 'father-market-heroes/father-hero-western-europe-v1.png',
  },
  {
    code: 'es-ES',
    apiCode: 'es',
    name: 'Spanish (Spain)',
    flag: '🇪🇸',
    font: 'Nunito Sans',
    assetFolder: 'es-ES',
    assetPrefix: 'es',
    hero: 'father-market-heroes/father-hero-southern-europe-v1.png',
  },
  {
    code: 'fr-FR',
    apiCode: 'fr',
    name: 'French',
    flag: '🇫🇷',
    font: 'Nunito Sans',
    assetFolder: 'fr-FR',
    assetPrefix: 'fr',
    hero: 'father-market-heroes/father-hero-western-europe-v1.png',
  },
  {
    code: 'it',
    apiCode: 'it',
    name: 'Italian',
    flag: '🇮🇹',
    font: 'Nunito Sans',
    assetFolder: 'it',
    assetPrefix: 'it',
    hero: 'father-market-heroes/father-hero-southern-europe-v1.png',
  },
  {
    code: 'ja',
    apiCode: 'ja',
    name: 'Japanese',
    flag: '🇯🇵',
    font: 'Noto Sans JP',
    assetFolder: 'ja',
    assetPrefix: 'ja',
    hero: 'father-market-heroes/father-hero-ja-v1.png',
  },
  {
    code: 'ko',
    apiCode: 'ko',
    name: 'Korean',
    flag: '🇰🇷',
    font: 'Noto Sans KR',
    assetFolder: 'ko',
    assetPrefix: 'ko',
    hero: 'father-market-heroes/father-hero-ko-v1.png',
  },
  {
    code: 'pt-BR',
    apiCode: 'pt-br',
    name: 'Portuguese (Brazil)',
    flag: '🇧🇷',
    font: 'Nunito Sans',
    assetFolder: 'pt-BR',
    assetPrefix: 'pt-BR',
    hero: 'father-market-heroes/father-hero-pt-BR-v1.png',
  },
  {
    code: 'ru',
    apiCode: 'ru',
    name: 'Russian',
    flag: '🇷🇺',
    font: 'Nunito Sans',
    assetFolder: 'ru',
    assetPrefix: 'ru',
    hero: 'father-market-heroes/father-hero-ru-v1.png',
  },
  {
    code: 'zh-Hans',
    apiCode: 'zh-Hans',
    name: 'Chinese (Simplified)',
    flag: '🇨🇳',
    font: 'Noto Sans SC',
    assetFolder: 'zh-Hans',
    assetPrefix: 'zh-Hans',
    hero: 'father-market-heroes/father-hero-zh-Hans-v1.png',
  },
];

const productCopy = [
  {
    eyebrowKey: 'product1Eyebrow',
    headlineKey: 'product1Headline',
    eyebrow: 'ELARA FOR MOM & DAD',
    headline: 'YOUR PREGNANCY, TOGETHER',
  },
  {
    eyebrowKey: 'product2Eyebrow',
    headlineKey: 'product2Headline',
    eyebrow: 'ONE SUBSCRIPTION · TWO PEOPLE',
    headline: 'DAD JOINS IN SECONDS',
  },
  {
    eyebrowKey: 'product3Eyebrow',
    headlineKey: 'product3Headline',
    eyebrow: 'A VIEW MADE FOR DAD',
    headline: 'HE KNOWS HOW TO HELP',
  },
  {
    eyebrowKey: 'product4Eyebrow',
    headlineKey: 'product4Headline',
    eyebrow: 'KICK COUNTER',
    headline: 'FEEL EVERY MOVEMENT',
  },
  {
    eyebrowKey: 'product5Eyebrow',
    headlineKey: 'product5Headline',
    eyebrow: 'CONTRACTION TIMER',
    headline: 'READY WHEN LABOR STARTS',
  },
  {
    eyebrowKey: 'product6Eyebrow',
    headlineKey: 'product6Headline',
    eyebrow: 'WEEK-BY-WEEK GROWTH',
    headline: 'EVERY WEEK, BEAUTIFULLY CLEAR',
  },
  {
    eyebrowKey: 'product7Eyebrow',
    headlineKey: 'product7Headline',
    eyebrow: 'PREGNANCY CALENDAR & JOURNAL',
    headline: 'YOUR STORY, IN ONE PLACE',
  },
  {
    eyebrowKey: 'product8Eyebrow',
    headlineKey: 'product8Headline',
    eyebrow: 'WEIGHT · WATER · SLEEP',
    headline: 'HEALTH, WITHOUT THE OVERWHELM',
  },
];

const sourceItems = [
  { key: 'journeyStart', text: 'FROM FIRST KICK' },
  { key: 'journeyEnd', text: 'TO FIRST HELLO' },
  { key: 'together', text: 'TOGETHER' },
  { key: 'descriptor', text: 'A pregnancy app built for Mom & Dad.' },
  { key: 'pill', text: 'PREGNANCY FOR TWO' },
  ...productCopy.flatMap((item) => [
    { key: item.eyebrowKey, text: item.eyebrow },
    { key: item.headlineKey, text: item.headline },
  ]),
];

const english = Object.fromEntries(sourceItems.map((item) => [item.key, item.text]));

const editorialOverrides = {
  'de-DE': {
    journeyStart: 'VOM ERSTEN TRITT',
    journeyEnd: 'BIS ZUM ERSTEN HALLO',
    together: 'GEMEINSAM',
    descriptor: 'Eine Schwangerschafts-App für Mama & Papa.',
    pill: 'SCHWANGERSCHAFT ZU ZWEIT',
  },
  it: {
    journeyStart: 'DAL PRIMO CALCETTO',
    journeyEnd: 'AL PRIMO INCONTRO',
    together: 'INSIEME',
    descriptor: "L'app per la gravidanza pensata per Mamma e Papà.",
    pill: 'GRAVIDANZA IN DUE',
  },
  ja: {
    journeyStart: '最初の胎動から',
    journeyEnd: '初めての対面まで',
    together: 'ふたりで',
    descriptor: 'ママとパパのための妊娠アプリ',
    pill: 'ふたりで歩む妊娠',
  },
  ko: {
    journeyStart: '첫 태동부터',
    journeyEnd: '첫 만남까지',
    together: '함께',
    descriptor: '엄마와 아빠를 위한 임신 앱',
    pill: '둘이 함께하는 임신',
  },
};

async function translate(spec) {
  if (spec.code === 'en-US') return english;
  const response = await fetch(TRANSLATE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetLocale: spec.apiCode,
      sourceLocale: 'en-US',
      appContext: [
        'Elara is a warm premium pregnancy app shared by Mom and Dad.',
        'This is concise App Store screenshot copy for a Father/Partner campaign.',
        'Translate naturally for the target market, not word-for-word.',
        'Keep each phrase short and emotionally warm.',
        '“First hello” means meeting the newborn for the first time.',
      ].join(' '),
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
  return { ...translated, ...(editorialOverrides[spec.code] ?? {}) };
}

function localeSourceUrl(spec, frameNumber) {
  if (spec.code === 'en-US') {
    const englishFiles = [
      '01-together.png',
      '02-invite.png',
      '03-dad-mode.png',
      '04-kicks.png',
      '05-contractions.png',
      '06-weekly.png',
      '07-calendar.png',
      '08-health.png',
    ];
    return `${ASSET_BASE}/${englishFiles[frameNumber - 1]}`;
  }
  const padded = String(frameNumber).padStart(2, '0');
  return `${ASSET_BASE}/father-locale-sources/${spec.assetFolder}/Elara_${spec.assetPrefix}_${padded}_1290x2796.png`;
}

const stateResponse = await fetch(STATE_API);
if (!stateResponse.ok) throw new Error(`state GET ${stateResponse.status}`);
const state = await stateResponse.json();
const hero = state.screenshots.find((slot) => slot.heroTextLayout === 'father-editorial');
if (!hero) throw new Error('Father editorial hero slot not found');
if (state.screenshots.length !== 9) {
  throw new Error(`Expected 9 Father CPP slots, found ${state.screenshots.length}`);
}
const productSlots = state.screenshots.filter((slot) => slot.id !== hero.id);
if (productSlots.length !== productCopy.length) {
  throw new Error(`Expected ${productCopy.length} product slots, found ${productSlots.length}`);
}

// Keep the editable/localised hero copy at the same bold visual scale as the
// approved market-ID artwork. FitTitle still shrinks unusually long locales.
Object.assign(hero, {
  titlePx: 156,
  subPx: 52,
  textYFraction: 0.026,
});

productSlots.forEach((slot, index) => {
  const copy = productCopy[index];
  Object.assign(slot, {
    headline: { verb: copy.headline, descriptor: '', subhead: '' },
    pill: copy.eyebrow,
    pillBg: undefined,
    pillFg: '#E75F57',
    heroTextLayout: 'father-product-localized',
    bgImageUrl: `${ASSET_BASE}/father-product-silk-textless-v1.png`,
    // 132px matches the approved baked English/market-ID headline scale.
    // Long translations can wrap to two lines and FitTitle remains the
    // last-resort overflow guard.
    titlePx: 132,
    subPx: 0,
    textYFraction: 0.022,
    textX: 0,
    textY: 0,
    font: 'Nunito Sans',
    titleColorOverride: '#44283A',
    subtitleColorOverride: '#5A3A49',
    textColorOverride: '#44283A',
    headlineAccent: '#E75F57',
    textBacking: false,
    showAppIcon: false,
  });
});

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

state.outputFolder = OUTPUT;
state.locales = localeSpecs.map((spec) => {
  const tr = translations.get(spec.code);
  const sourceOverrides = {
    [hero.id]: `${ASSET_BASE}/${spec.hero}`,
  };

  return {
    id: spec.code,
    code: spec.code,
    flag: spec.flag,
    name: spec.name,
    rtl: spec.rtl ?? false,
    translations: Object.fromEntries(
      state.screenshots.map((slot) => {
        if (slot.id === hero.id) {
          return [
            slot.id,
            {
              verb: `${tr.journeyStart}\n${tr.journeyEnd}\n— *${tr.together}*`,
              descriptor: tr.descriptor,
              subhead: '',
            },
          ];
        }
        const index = productSlots.findIndex((productSlot) => productSlot.id === slot.id);
        const copy = productCopy[index];
        return [
          slot.id,
          {
            verb: tr[copy.headlineKey],
            descriptor: '',
            subhead: '',
          },
        ];
      }),
    ),
    pillTranslations: {
      [hero.id]: tr.pill,
      ...Object.fromEntries(
        productSlots.map((slot, index) => [
          slot.id,
          tr[productCopy[index].eyebrowKey],
        ]),
      ),
    },
    extraTranslations: {},
    sourceOverrides,
    slotAdjustments: {},
    fontOverride: spec.font,
    aiTranslated: true,
  };
});

const manifest = {
  generatedAt: new Date().toISOString(),
  appName: state.appName,
  locales: state.locales.map((locale) => ({
    code: locale.code,
    name: locale.name,
    rtl: locale.rtl,
    fontOverride: locale.fontOverride,
    heroSource: locale.sourceOverrides[hero.id],
    headline: locale.translations[hero.id],
    pill: locale.pillTranslations[hero.id],
    productCopy: productSlots.map((slot) => ({
      slotId: slot.id,
      eyebrow: locale.pillTranslations[slot.id],
      headline: locale.translations[slot.id].verb,
    })),
  })),
  marketOnlyHeroAssets: {
    india: `${ASSET_BASE}/father-market-heroes/father-hero-market-india-en-v1.png`,
    indonesia: `${ASSET_BASE}/father-market-heroes/father-hero-market-indonesia-en-v1.png`,
    southAfrica: `${ASSET_BASE}/father-market-heroes/father-hero-market-south-africa-en-v1.png`,
  },
};

await writeFile(
  `${OUTPUT}/translation-manifest-father-cpp.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

const pushed = await fetch(`${STATE_API}/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(state),
});
if (!pushed.ok) {
  throw new Error(`state push ${pushed.status}: ${await pushed.text()}`);
}
console.log(await pushed.text());
console.log(`Father CPP locales prepared: ${state.locales.length}`);
