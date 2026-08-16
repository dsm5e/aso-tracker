import { readFile, writeFile } from 'node:fs/promises';

const STATE_API = 'http://localhost:5181/api/studio-state';
const TRANSLATE_API = 'http://localhost:5181/api/translate/batch';

const direction = process.argv[2];

const projects = {
  tracker: {
    stateFile: '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/03_CPP-Tracker-EN-Approval/state-tracker-en-final.json',
    outputFolder: '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/03_CPP-Tracker-EN-Approval',
    context: 'Pregnancy Tracker campaign: baby growth, milestones, kicks, contractions and maternal health.',
  },
  couple: {
    stateFile: '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/04_CPP-Couple-Journey-EN-Approval/state-couple-en-final.json',
    outputFolder: '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/04_CPP-Couple-Journey-EN-Approval',
    context: 'Couple Journey campaign: emotional shared pregnancy, partner support and preserving memories together.',
  },
  birth: {
    stateFile: '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/05_CPP-Birth-Ready-EN-Approval/state-birth-en-final.json',
    outputFolder: '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/05_CPP-Birth-Ready-EN-Approval',
    context: 'Birth Ready campaign: calm preparation, contractions, kicks, health and partner support.',
  },
};

if (!projects[direction]) {
  throw new Error('Usage: node cli/localize-elara-cpp.mjs <tracker|couple|birth>');
}

const localeSpecs = [
  { code: 'en-US', apiCode: 'en-US', name: 'English (US)', flag: '🇺🇸' },
  { code: 'ar-SA', apiCode: 'ar', name: 'Arabic (Saudi Arabia)', flag: '🇸🇦', rtl: true, font: 'Noto Sans Arabic' },
  { code: 'de-DE', apiCode: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'es-ES', apiCode: 'es', name: 'Spanish (Spain)', flag: '🇪🇸' },
  { code: 'fr-FR', apiCode: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'it', apiCode: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'ja', apiCode: 'ja', name: 'Japanese', flag: '🇯🇵', font: 'Noto Sans JP' },
  { code: 'ko', apiCode: 'ko', name: 'Korean', flag: '🇰🇷', font: 'Noto Sans KR' },
  { code: 'pt-BR', apiCode: 'pt-br', name: 'Portuguese (Brazil)', flag: '🇧🇷' },
  { code: 'ru', apiCode: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'zh-Hans', apiCode: 'zh-Hans', name: 'Chinese (Simplified)', flag: '🇨🇳', font: 'Noto Sans SC' },
];

const project = projects[direction];
const state = JSON.parse(await readFile(project.stateFile, 'utf8'));
state.outputFolder = project.outputFolder;

const copyOverrides = {
  birth: {
    'de-DE': {
      'birth-hero-en': {
        verb: 'BEREIT SEIN\n— *WENN ES BEGINNT*',
      },
    },
    ru: {
      'birth-product-05-en': {
        verb: 'ПАРТНЁР\nВСЕГДА РЯДОМ',
      },
    },
  },
};

function lineParts(line) {
  const match = line.match(/^(\s*—\s*)?(\*)?(.*?)(\*)?$/u);
  return {
    prefix: `${match?.[1] ?? ''}${match?.[2] ?? ''}`,
    text: (match?.[3] ?? line).trim(),
    suffix: match?.[4] ?? '',
  };
}

const sourceItems = [];
const sourceMeta = new Map();

state.screenshots.forEach((slot, slotIndex) => {
  const lines = String(slot.headline.verb ?? '').split('\n');
  lines.forEach((line, lineIndex) => {
    const parts = lineParts(line);
    const key = `s${slotIndex}_line${lineIndex}`;
    sourceItems.push({ key, text: parts.text });
    sourceMeta.set(key, parts);
  });

  if (slot.headline.descriptor) {
    sourceItems.push({ key: `s${slotIndex}_descriptor`, text: slot.headline.descriptor });
  }
  if (slot.pill) {
    sourceItems.push({ key: `s${slotIndex}_pill`, text: slot.pill });
  }
});

const english = Object.fromEntries(sourceItems.map((item) => [item.key, item.text]));

async function translate(spec) {
  if (spec.code === 'en-US') return english;

  const response = await fetch(TRANSLATE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetLocale: spec.apiCode,
      sourceLocale: 'en-US',
      appContext: [
        'Elara is a warm premium pregnancy app for an expecting mother and her partner.',
        project.context,
        'Translate concise App Store screenshot copy naturally for the target market.',
        'Keep each item short, emotionally clear and suitable for large centered typography.',
        'Do not add quotation marks, explanations, emojis or punctuation that is absent from the source.',
      ].join(' '),
      items: sourceItems,
    }),
  });
  if (!response.ok) {
    throw new Error(`${spec.code}: translate ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const translated = Object.fromEntries(
    payload.items.map((item) => [item.key, String(item.translation).trim()]),
  );
  for (const item of sourceItems) {
    if (!translated[item.key]) {
      throw new Error(`${spec.code}: missing translation for ${item.key}`);
    }
  }
  return translated;
}

const translations = new Map();
let cursor = 0;
const workers = Array.from({ length: 3 }, async () => {
  while (cursor < localeSpecs.length) {
    const spec = localeSpecs[cursor++];
    translations.set(spec.code, await translate(spec));
    console.log(`translated ${direction} ${spec.code}`);
  }
});
await Promise.all(workers);

state.locales = localeSpecs.map((spec) => {
  const translated = translations.get(spec.code);
  const slotTranslations = {};
  const pillTranslations = {};

  state.screenshots.forEach((slot, slotIndex) => {
    const sourceLines = String(slot.headline.verb ?? '').split('\n');
    const translatedLines = sourceLines.map((sourceLine, lineIndex) => {
      const key = `s${slotIndex}_line${lineIndex}`;
      const parts = sourceMeta.get(key) ?? lineParts(sourceLine);
      return `${parts.prefix}${translated[key]}${parts.suffix}`;
    });

    slotTranslations[slot.id] = {
      verb: translatedLines.join('\n'),
      descriptor: slot.headline.descriptor
        ? translated[`s${slotIndex}_descriptor`]
        : '',
      subhead: '',
    };
    if (slot.pill) {
      pillTranslations[slot.id] = translated[`s${slotIndex}_pill`];
    }
  });

  const localeOverrides = copyOverrides[direction]?.[spec.code] ?? {};
  for (const [slotId, override] of Object.entries(localeOverrides)) {
    slotTranslations[slotId] = {
      ...slotTranslations[slotId],
      ...override,
    };
  }

  return {
    id: spec.code,
    code: spec.code,
    flag: spec.flag,
    name: spec.name,
    rtl: spec.rtl ?? false,
    translations: slotTranslations,
    pillTranslations,
    extraTranslations: {},
    sourceOverrides: {},
    slotAdjustments: {},
    fontOverride: spec.font,
    aiTranslated: true,
  };
});

const manifest = {
  generatedAt: new Date().toISOString(),
  direction,
  appName: state.appName,
  note: 'Live marketing copy is localised. Product UI screenshots remain the approved English source screens.',
  locales: state.locales.map((locale) => ({
    code: locale.code,
    rtl: locale.rtl,
    fontOverride: locale.fontOverride,
    slots: state.screenshots.map((slot) => ({
      id: slot.id,
      pill: locale.pillTranslations[slot.id] ?? '',
      ...locale.translations[slot.id],
    })),
  })),
};

await writeFile(
  `${project.outputFolder}/translation-manifest-${direction}.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
await writeFile(
  `${project.outputFolder}/state-${direction}-all-locales.json`,
  `${JSON.stringify(state, null, 2)}\n`,
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
console.log(`${direction} CPP localized: ${state.locales.length} locales`);
