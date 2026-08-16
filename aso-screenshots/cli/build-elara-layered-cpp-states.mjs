#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ARCHIVE =
  '/Users/qwar49/Documents/Elara-ASO-Archives/Elara-ASO-2.2-Review-full-2026-07-27';
const OUTPUT =
  '/Users/qwar49/Documents/Elara-ASO-Working-2026-07-27/06_CPP-Layered-Titanium';
const ASSET_BASE = 'http://localhost:5180/studio/uploads/elara-localized-ui';
const ASSET_ROOT =
  '/Users/qwar49/Developer/MYPROJECT/aso-studio/aso-screenshots/public/uploads/elara-localized-ui';

const configs = {
  father: {
    stateFile: join(
      ARCHIVE,
      '02_CPP-Father-EN-Approval/state-father-final.json',
    ),
    outputFolder: join(OUTPUT, '02_CPP-Father-Partner'),
    scenarios: {
      'father-together-en': 'home',
      'father-invite-en': 'partner-invite',
      'father-dad-mode-en': 'partner-dad',
      'father-kicks-en': 'kicks',
      'father-contractions-en': 'contractions-active',
      'father-weekly-en': 'baby',
      'father-calendar-en': 'journal',
      'father-health-en': 'health',
    },
    deviceScale: 0.82,
  },
  tracker: {
    stateFile: join(
      ARCHIVE,
      '03_CPP-Tracker-EN-Approval/state-kick-counter-v2-all-locales.json',
    ),
    outputFolder: join(OUTPUT, '03_CPP-Kick-Counter'),
    scenarios: {
      'tracker-product-01-en': 'baby',
      'tracker-product-02-en': 'journal',
      'tracker-product-03-en': 'kicks',
      'tracker-product-04-en': 'contractions-active',
      'tracker-product-05-en': 'health',
      'tracker-product-06-en': 'journey',
    },
  },
  couple: {
    stateFile: join(
      ARCHIVE,
      '04_CPP-Couple-Journey-EN-Approval/state-calendar-due-date-v2-all-locales.json',
    ),
    outputFolder: join(OUTPUT, '04_CPP-Calendar-Due-Date'),
    scenarios: {
      'couple-product-01-en': 'partner-invite',
      'couple-product-02-en': 'wishlist',
      'couple-product-03-en': 'baby',
      'couple-product-04-en': 'journal',
      'couple-product-05-en': 'journey',
      'couple-product-06-en': 'kicks',
      'couple-product-07-en': 'health',
    },
  },
  birth: {
    stateFile: join(
      ARCHIVE,
      '05_CPP-Birth-Ready-EN-Approval/state-contraction-timer-v2-all-locales.json',
    ),
    outputFolder: join(OUTPUT, '05_CPP-Contraction-Timer'),
    scenarios: {
      'birth-product-01-en': 'contractions-active',
      'birth-product-02-en': 'kicks',
      'birth-product-03-en': 'journal',
      'birth-product-04-en': 'health',
      'birth-product-05-en': 'partner-invite',
      'birth-product-06-en': 'journey',
    },
  },
};

await mkdir(OUTPUT, { recursive: true });
const manifest = {
  generatedAt: new Date().toISOString(),
  frameStyle: 'titanium',
  sourceMode: 'localized simulator UI layered under reusable frame',
  projects: [],
};

for (const [key, config] of Object.entries(configs)) {
  const state = JSON.parse(await readFile(config.stateFile, 'utf8'));
  const slotsById = new Map(state.screenshots.map((slot) => [slot.id, slot]));

  for (const [slotId, scenario] of Object.entries(config.scenarios)) {
    const slot = slotsById.get(slotId);
    if (!slot) throw new Error(`${key}: missing slot ${slotId}`);

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
    });

    if (key === 'father') {
      Object.assign(slot, {
        deviceScale: config.deviceScale,
        deviceX: 0,
        deviceY: 38,
        tiltDeg: 0,
        tiltX: 0,
        tiltY: 0,
      });
      if (slot.action) slot.action.hideDevice = false;
    }
  }

  for (const locale of state.locales) {
    locale.sourceOverrides ??= {};
    for (const [slotId, scenario] of Object.entries(config.scenarios)) {
      const sourcePath = join(ASSET_ROOT, locale.code, `${scenario}.png`);
      await access(sourcePath);
      locale.sourceOverrides[slotId] =
        `${ASSET_BASE}/${locale.code}/${scenario}.png`;
    }
  }

  state.outputFolder = config.outputFolder;
  state.viewMode = 'scaffold';
  await mkdir(config.outputFolder, { recursive: true });
  const statePath = join(config.outputFolder, `state-${key}-layered-titanium.json`);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  manifest.projects.push({
    key,
    appName: state.appName,
    statePath,
    outputFolder: config.outputFolder,
    localeCount: state.locales.length,
    screenshotCount: state.screenshots.length,
    layeredSlotCount: Object.keys(config.scenarios).length,
  });
  console.log(
    `${key}: ${state.locales.length} locales × ${state.screenshots.length} slots → ${statePath}`,
  );
}

await writeFile(
  join(OUTPUT, 'layered-cpp-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
