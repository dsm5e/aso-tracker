#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONTROL_STATE =
  '/Users/qwar49/.aso-studio/state.control.elara.20260626_114001.json';
const APPROVED_STATE =
  '/Users/qwar49/Documents/Elara-ASO-Archives/Elara-ASO-2.2-Review-full-2026-07-27/02_CPP-Father-EN-Approval/state-before-father-cpp.json';
const OUTPUT_ROOT = process.env.ELARA_DEFAULT_OUTPUT_ROOT
  ?? '/Users/qwar49/Documents/Elara-ASO-Working-2026-07-27/06_CPP-Layered-Titanium/01_Default';
const ASSET_BASE = 'http://localhost:5180/studio/uploads/elara-localized-ui';
const ASSET_ROOT =
  '/Users/qwar49/Developer/MYPROJECT/aso-studio/aso-screenshots/public/uploads/elara-localized-ui';
const BACKGROUND_URL = process.env.ELARA_DEFAULT_BACKGROUND_URL
  ?? 'http://localhost:5180/studio/uploads/elara-product-silk-soft-v3.png';
const HERO_URL = process.env.ELARA_DEFAULT_HERO_URL
  ?? 'http://localhost:5180/studio/uploads/elara-hero-textless-soft-v4.png';

const localeSpecs = [
  { source: 'en', code: 'en-US', name: 'English (US)', flag: '🇺🇸' },
  { source: 'ar', code: 'ar-SA', name: 'Arabic (Saudi Arabia)', flag: '🇸🇦', rtl: true },
  { source: 'de', code: 'de-DE', name: 'German', flag: '🇩🇪' },
  { source: 'es', code: 'es-ES', name: 'Spanish (Spain)', flag: '🇪🇸' },
  { source: 'fr', code: 'fr-FR', name: 'French', flag: '🇫🇷' },
  { source: 'it', code: 'it', name: 'Italian', flag: '🇮🇹' },
  { source: 'ja', code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { source: 'ko', code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { source: 'pt-BR', code: 'pt-BR', name: 'Portuguese (Brazil)', flag: '🇧🇷' },
  { source: 'ru', code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { source: 'zh-Hans', code: 'zh-Hans', name: 'Chinese (Simplified)', flag: '🇨🇳' },
];

const requestedLocaleCodes = new Set(
  (process.env.ELARA_DEFAULT_LOCALES ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean),
);
const selectedLocaleSpecs = requestedLocaleCodes.size === 0
  ? localeSpecs
  : localeSpecs.filter((spec) => requestedLocaleCodes.has(spec.code));

if (selectedLocaleSpecs.length !== (requestedLocaleCodes.size || localeSpecs.length)) {
  const foundCodes = new Set(selectedLocaleSpecs.map((spec) => spec.code));
  const missingCodes = [...requestedLocaleCodes].filter((code) => !foundCodes.has(code));
  throw new Error(`unknown locale code(s): ${missingCodes.join(', ')}`);
}

// Match the approved 2.1 screen intent exactly. The earlier layered pass used
// `baby` on frame 02 and `kicks` behind frame 03; both changed the story.
const primaryScenarios = {
  elprt: 'home',
  elmile: 'journey',
  elbby: 'wishlist',
  elrit: 'journal',
  eltol: 'health',
  elide: 'home',
};

const secondaryScenarios = {
  elmile: 'partner-dad',
  elide: 'partner-invite',
};

const control = JSON.parse(await readFile(CONTROL_STATE, 'utf8'));
const approved = JSON.parse(await readFile(APPROVED_STATE, 'utf8'));

// Preserve the good live-localized textless Hero and the approved final
// baby-feet frame. Middle product frames retain the approved marketing copy
// from the control state but receive real locale-native simulator UI.
control.screenshots[0] = structuredClone(approved.screenshots[0]);
control.screenshots[7] = structuredClone(approved.screenshots[7]);
if (HERO_URL) {
  Object.assign(control.screenshots[0], {
    sourceUrl: HERO_URL,
    enhancedUrl: null,
    titlePx: 112,
    headlineSafeBottomFraction: 0.328,
    headlineVerticalAlign: 'center',
    heroPhoneOverlayLayout: 'elara-soft-v4',
  });
  if (control.screenshots[0].action) {
    control.screenshots[0].action.aiImageUrl = null;
    control.screenshots[0].action.generateState = 'idle';
  }
}
const state = control;
const slotsById = new Map(state.screenshots.map((slot) => [slot.id, slot]));

for (const [slotId, scenario] of Object.entries(primaryScenarios)) {
  const slot = slotsById.get(slotId);
  if (!slot) throw new Error(`missing Default slot ${slotId}`);

  Object.assign(slot, {
    sourceLayout: 'device',
    sourceUrl: `${ASSET_BASE}/en-US/${scenario}.png`,
    sourcePixelWidth: 1320,
    sourcePixelHeight: 2868,
    sourceScale: 1,
    sourceOffsetX: 0,
    sourceOffsetY: 0,
    deviceFrameStyle: 'titanium',
    enhancedUrl: null,
    bgImageUrl: BACKGROUND_URL,
  });
  if (slot.action) {
    slot.action.aiImageUrl = null;
    slot.action.generateState = 'idle';
    slot.action.hideDevice = false;
  }
}

for (const [slotId, scenario] of Object.entries(secondaryScenarios)) {
  const slot = slotsById.get(slotId);
  if (!slot) throw new Error(`missing Default dual-device slot ${slotId}`);
  slot.secondaryUrl = `${ASSET_BASE}/en-US/${scenario}.png`;
}

const controlLocales = new Map(control.locales.map((locale) => [locale.code, locale]));
const approvedLocales = new Map(approved.locales.map((locale) => [locale.code, locale]));
const heroId = state.screenshots[0].id;
const finalId = state.screenshots[7].id;
state.locales = [];

for (const spec of selectedLocaleSpecs) {
  const copyLocale = controlLocales.get(spec.source);
  const approvedLocale = approvedLocales.get(
    spec.source === 'en' ? 'en-US' : spec.source,
  );
  if (!copyLocale) throw new Error(`missing copy locale ${spec.source}`);
  if (!approvedLocale) throw new Error(`missing approved locale ${spec.source}`);

  const sourceOverrides = {
    [finalId]: approvedLocale.sourceOverrides?.[finalId]
      ?? approved.screenshots[7].sourceUrl,
  };
  for (const [slotId, scenario] of Object.entries(primaryScenarios)) {
    const sourcePath = join(ASSET_ROOT, spec.code, `${scenario}.png`);
    await access(sourcePath);
    sourceOverrides[slotId] = `${ASSET_BASE}/${spec.code}/${scenario}.png`;
  }

  const secondaryOverrides = {};
  for (const [slotId, scenario] of Object.entries(secondaryScenarios)) {
    const sourcePath = join(ASSET_ROOT, spec.code, `${scenario}.png`);
    await access(sourcePath);
    secondaryOverrides[slotId] = `${ASSET_BASE}/${spec.code}/${scenario}.png`;
  }

  const translations = structuredClone(copyLocale.translations ?? {});
  delete translations.elcov1;
  delete translations.elcov2;
  translations[heroId] = structuredClone(
    approvedLocale.translations?.[heroId] ?? approved.screenshots[0].headline,
  );
  translations[finalId] = {
    verb: '',
    descriptor: '',
    subhead: '',
  };

  const pillTranslations = structuredClone(copyLocale.pillTranslations ?? {});
  delete pillTranslations.elcov1;
  delete pillTranslations.elcov2;
  if (approvedLocale.pillTranslations?.[heroId]) {
    pillTranslations[heroId] = approvedLocale.pillTranslations[heroId];
  }

  const extraTranslations = structuredClone(copyLocale.extraTranslations ?? {});
  delete extraTranslations.elcov1;
  delete extraTranslations.elcov2;
  extraTranslations[heroId] = structuredClone(
    approvedLocale.extraTranslations?.[heroId] ?? {},
  );

  const slotAdjustments = structuredClone(copyLocale.slotAdjustments ?? {});
  delete slotAdjustments.elcov1;
  delete slotAdjustments.elcov2;
  if (spec.code === 'ar-SA') {
    slotAdjustments[heroId] = {
      ...(slotAdjustments[heroId] ?? {}),
      titlePx: 136,
    };
  }

  state.locales.push({
    ...copyLocale,
    id: spec.code,
    code: spec.code,
    name: spec.name,
    flag: spec.flag,
    rtl: spec.rtl ?? false,
    translations,
    pillTranslations,
    extraTranslations,
    sourceOverrides,
    secondaryOverrides,
    slotAdjustments,
    fontOverride: approvedLocale.fontOverride ?? copyLocale.fontOverride,
  });
}

state.appName = 'Elara: Pregnancy for Dad & Mom';
state.outputFolder = OUTPUT_ROOT;
state.viewMode = 'scaffold';
state.activeScreenshotId = heroId;
state.filenamePattern = '{n}-{app}-{locale}.{ext}';
state.folderStructure = 'per-locale';

await mkdir(OUTPUT_ROOT, { recursive: true });
const statePath = join(OUTPUT_ROOT, 'state-default-layered-titanium.json');
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

const manifest = {
  generatedAt: new Date().toISOString(),
  appName: state.appName,
  statePath,
  outputFolder: OUTPUT_ROOT,
  frameStyle: 'titanium',
  backgroundUrl: BACKGROUND_URL,
  sourceMode: 'localized simulator UI layered under reusable frame',
  localeCount: state.locales.length,
  screenshotCount: state.screenshots.length,
  layeredSlotCount: Object.keys(primaryScenarios).length,
  primaryScenarios,
  secondaryScenarios,
};
await writeFile(
  join(OUTPUT_ROOT, 'layered-default-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(
  `default: ${state.locales.length} locales × ${state.screenshots.length} slots → ${statePath}`,
);
