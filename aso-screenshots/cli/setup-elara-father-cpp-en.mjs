import { writeFile } from 'node:fs/promises';

const API = 'http://localhost:5181/api/studio-state';
const ASSET = 'http://localhost:5180/studio/uploads';
const OUTPUT = '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/02_CPP-Father-EN-Approval';
const BACKUP = `${OUTPUT}/state-before-father-cpp.json`;

const response = await fetch(API);
if (!response.ok) throw new Error(`state GET ${response.status}`);
const state = await response.json();
await writeFile(BACKUP, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

function fullBleedSlot({ id, filename, source, hero = false }) {
  return {
    id,
    filename,
    device: 'iphone',
    presetId: 'elara',
    kind: hero ? 'action' : 'regular',
    sourceUrl: `${ASSET}/${source}`,
    sourcePixelWidth: hero ? 1024 : 1290,
    sourcePixelHeight: hero ? 2048 : 2796,
    sourceLayout: 'full-bleed',
    sourceScale: 1,
    sourceOffsetX: 0,
    sourceOffsetY: 0,
    secondaryUrl: null,
    enhancedUrl: null,
    backgroundOverride: null,
    bgImageUrl: null,
    headline: hero
      ? {
          verb: 'FROM FIRST KICK\nTO FIRST HELLO\n— *TOGETHER*',
          descriptor: 'A pregnancy app built for Mom & Dad.',
          subhead: '',
        }
      : { verb: '', descriptor: '', subhead: '' },
    pill: hero ? 'PREGNANCY FOR TWO' : undefined,
    pillBg: hero ? 'rgba(255,255,255,0.70)' : undefined,
    pillFg: hero ? '#5A3042' : undefined,
    annotation: undefined,
    proofText: undefined,
    proofAttribution: undefined,
    trustStrip: undefined,
    heroTextLayout: hero ? 'father-editorial' : undefined,
    footer: undefined,
    headlineAccent: '#E75F57',
    titleColorOverride: '#44283A',
    subtitleColorOverride: '#5A3A49',
    textColorOverride: '#44283A',
    showAppIcon: false,
    textBacking: false,
    font: 'Nunito Sans',
    fontSize: 118,
    titlePx: hero ? 124 : 118,
    subPx: hero ? 46 : 54,
    textYFraction: hero ? 0.035 : 0.045,
    tiltDeg: 0,
    tiltX: 0,
    tiltY: 0,
    deviceX: 0,
    deviceY: 0,
    deviceScale: 1,
    textX: 0,
    textY: 0,
    breakout: false,
    pulseScreen: 0,
    enhanceState: 'idle',
    sampleIndex: 0,
    action: {
      primary: '',
      secondary: '',
      showStars: false,
      hideDevice: true,
      themeHint: hero
        ? 'Textless editorial family portrait; father leads, mother and newborn complete the shared journey.'
        : '',
      aiImageUrl: null,
      aiHistory: [],
      lastPrompt: null,
      generateState: 'idle',
      ingredients: {
        socialProof: false,
        ctaArrow: false,
        appIcon: false,
        editorsChoice: false,
        pressQuotes: false,
        testimonial: false,
        handHolding: false,
        floatingFeatures: false,
        multiDevice: false,
        beforeAfter: false,
      },
      ingredientParams: {},
      useCustomPrompt: false,
      customPrompt: '',
    },
  };
}

const sources = [
  ['father-hero-en', '01-father-hero.png', 'father-hero-photo-textless-v1.png', true],
  ['father-together-en', '02-together.png', '01-together.png', false],
  ['father-invite-en', '03-invite.png', '02-invite.png', false],
  ['father-dad-mode-en', '04-dad-mode.png', '03-dad-mode.png', false],
  ['father-kicks-en', '05-kicks.png', '04-kicks.png', false],
  ['father-contractions-en', '06-contractions.png', '05-contractions.png', false],
  ['father-weekly-en', '07-weekly.png', '06-weekly.png', false],
  ['father-calendar-en', '08-calendar.png', '07-calendar.png', false],
  ['father-health-en', '09-health.png', '08-health.png', false],
];

state.appName = 'Elara Father & Partner';
state.appColor = '#E75F57';
state.appIconUrl = 'http://localhost:5180/studio/elara-icon.png';
state.devices = 'iphone';
state.iphoneModel = 'iphone-67';
state.outputFolder = OUTPUT;
state.selectedPresetId = 'elara';
state.catalogFilter = 'all';
state.previewDevice = 'iphone';
state.viewMode = 'scaffold';
state.destination = 'local';
state.format = 'png';
state.sizes = { iphone: true, ipad: false };
state.filenamePattern = '{n}-{app}-{locale}.{ext}';
state.folderStructure = 'per-locale';
state.agentNav = '/editor';
state.agentPolishCommand = null;
state.multiSelect = [];
state.ppo = null;
state.screenshots = sources.map(([id, filename, source, hero]) =>
  fullBleedSlot({ id, filename, source, hero }),
);
state.activeScreenshotId = state.screenshots[0].id;
state.locales = [{
  id: 'en-US',
  code: 'en-US',
  flag: '🇺🇸',
  name: 'English (US)',
  rtl: false,
  translations: Object.fromEntries(
    state.screenshots.map((s) => [s.id, { ...s.headline }]),
  ),
  pillTranslations: Object.fromEntries(
    state.screenshots.map((s) => [s.id, s.pill]),
  ),
  extraTranslations: {},
  slotAdjustments: {},
  aiTranslated: true,
}];

const pushed = await fetch(`${API}/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(state),
});
if (!pushed.ok) {
  throw new Error(`state push ${pushed.status}: ${await pushed.text()}`);
}
console.log(await pushed.text());
console.log(`Father CPP prepared: ${state.screenshots.length} English slots`);
