const API = 'http://localhost:5181/api/studio-state';
const ASSET = 'http://localhost:5180/studio/uploads';
const OUTPUT = '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/01_EN-Approval';

const response = await fetch(API);
if (!response.ok) throw new Error(`state GET ${response.status}`);
const state = await response.json();

const textlessHeroPrompt = [
  'Create premium, conversion-first App Store hero ART for Elara, a warm pregnancy app for Mom and Dad.',
  'Use the supplied scaffold as the exact composition and product-UI source.',
  'Preserve every pixel inside the phone screen exactly. Do not redraw any in-app label, icon, number, status bar, QR code, button or card.',
  'Keep the warm champagne, blush, coral and soft-peach palette with deep-plum contrast.',
  'Add restrained symmetrical laurel branches, soft silk-like organic waves, delicate bubbles and a subtle focus glow around the device.',
  'Leave the TOP 27% clean for a live headline overlay. Leave the BOTTOM 17% visually calm for live annotation, proof card and trust strip overlays.',
  'Do not render any marketing words, letters, numbers, award claims, ratings, review copy, logos or badges outside the phone. All marketing text is overlaid later by the Studio.',
  'The phone remains the single focal point. Premium App Store quality, strong at thumbnail size, uncluttered.',
].join('\n\n');

const textlessCoverPrompt = [
  'Create a new premium App Store hero composition for Elara from the supplied onboarding screen, following the same product-first principle as the MedScan reference.',
  'Place the exact supplied screen inside one realistic premium iPhone, angled slightly in 3D and occupying most of the middle and lower canvas. Preserve every pixel inside the phone screen exactly: do not redraw or alter any in-app word, button, fetus, icon or layout.',
  'Extend the screen’s champagne, blush, coral and silk-wave visual language into the surrounding background. Add restrained symmetrical coral laurel branches beside the empty headline area, a few delicate bubbles, realistic contact shadow and a subtle coral focus glow around the phone.',
  'Keep the TOP 27% clean and calm for a live localized headline. Keep the BOTTOM 17% visually calm for live proof and trust-strip overlays.',
  'Do not add any marketing words, letters, numbers, ratings, logos, badges, award claims or review text outside the phone. All marketing text is overlaid later by the Studio.',
  'One phone only. Strong product focus at thumbnail size, elegant depth, premium lighting, uncluttered, top-grossing App Store quality.',
].join('\n\n');

function slot({
  id,
  filename,
  source,
  sourceLayout = 'device',
  pill,
  verb,
  descriptor = '',
  annotation,
  proofText,
  proofAttribution,
  trustStrip,
  phoneBrand,
  phoneTitle,
  phoneSubtitle,
  phoneToggleLeft,
  phoneToggleRight,
  heroTextLayout,
  main = false,
  backgroundOverride = null,
  titleColor = '#2C2C2C',
  accentColor = '#F07F78',
}) {
  return {
    id,
    filename,
    device: 'iphone',
    sourceUrl: `${ASSET}/${source}`,
    sourcePixelWidth: main ? 853 : 1320,
    sourcePixelHeight: main ? 1844 : 2868,
    sourceLayout,
    sourceScale: 1,
    sourceOffsetX: 0,
    sourceOffsetY: 0,
    secondaryUrl: null,
    enhancedUrl: null,
    presetId: 'elara',
    backgroundOverride,
    bgImageUrl: null,
    headline: { verb, descriptor, subhead: '' },
    pill,
    pillBg: 'rgba(255,255,255,0.78)',
    pillFg: '#D96F71',
    annotation,
    proofText,
    proofAttribution,
    trustStrip,
    phoneBrand,
    phoneTitle,
    phoneSubtitle,
    phoneToggleLeft,
    phoneToggleRight,
    heroTextLayout,
    footer: undefined,
    headlineAccent: accentColor,
    titleColorOverride: titleColor,
    subtitleColorOverride: accentColor,
    showAppIcon: false,
    textBacking: false,
    font: main ? 'Nunito Sans' : 'Inter',
    fontSize: 118,
    titlePx: main ? 142 : 126,
    subPx: 54,
    textYFraction: main ? 0.03 : 0.045,
    tiltDeg: main ? -4 : -2,
    tiltX: main ? -2 : 0,
    tiltY: main ? -6 : -4,
    deviceX: main ? 0 : 25,
    deviceY: main ? 130 : 30,
    deviceScale: main ? 0.78 : 0.82,
    textX: 0,
    textY: 0,
    breakout: false,
    pulseScreen: 0,
    enhanceState: 'idle',
    sampleIndex: 0,
    kind: 'action',
    action: {
      primary: '',
      secondary: '',
      showStars: false,
      hideDevice: main,
      themeHint: main
        ? 'Elara onboarding screen in one premium angled iPhone, warm silk pregnancy world'
        : 'Textless Elara product hero with one exact UI screen',
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
      useCustomPrompt: true,
      customPrompt: main ? textlessCoverPrompt : textlessHeroPrompt,
    },
  };
}

function ordinaryScreenshot(number) {
  const n = String(number).padStart(2, '0');
  const screenshot = slot({
    id: `elara-v21-en-${n}`,
    filename: `${n}-v21.png`,
    source: `elara-v21-en-${n}.png`,
    sourceLayout: 'full-bleed',
    pill: '',
    verb: '',
  });

  return {
    ...screenshot,
    sourcePixelWidth: 1290,
    sourcePixelHeight: 2796,
    headline: { verb: '', descriptor: '', subhead: '' },
    pill: undefined,
    annotation: undefined,
    proofText: undefined,
    proofAttribution: undefined,
    trustStrip: undefined,
    phoneBrand: undefined,
    phoneTitle: undefined,
    phoneSubtitle: undefined,
    phoneToggleLeft: undefined,
    phoneToggleRight: undefined,
    heroTextLayout: undefined,
    footer: undefined,
    backgroundOverride: null,
    kind: 'regular',
    action: {
      ...screenshot.action,
      hideDevice: true,
      aiImageUrl: null,
      aiHistory: [],
      useCustomPrompt: false,
      customPrompt: '',
    },
  };
}

state.appName = 'Elara: Pregnancy for Dad & Mom';
state.appColor = '#F07F78';
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

state.screenshots = [
  slot({
    id: 'elara-main-en-v1',
    filename: '01-main.png',
    source: 'elara-hero-textless-approved.png',
    sourceLayout: 'full-bleed',
    pill: 'ELARA',
    verb: 'THE MOST\nBEAUTIFUL WAY\nTO BE PREGNANT\n— *TOGETHER*',
    descriptor: '',
    annotation: 'Start your journey',
    proofText: 'One subscription · both of you',
    trustStrip: 'WEEK BY WEEK · KICKS · CALENDAR · PARTNER MODE',
    phoneBrand: 'ELARA',
    phoneTitle: 'Every milestone.\nShared.',
    phoneSubtitle: 'One beautiful app for Mom & Dad.',
    phoneToggleLeft: 'MOM',
    phoneToggleRight: 'DAD',
    heroTextLayout: 'elara',
    titleColor: '#4A283D',
    accentColor: '#F05F52',
    main: true,
  }),
  ...[2, 3, 4, 5, 6, 7, 8].map(ordinaryScreenshot),
];

state.activeScreenshotId = state.screenshots[0].id;
state.locales = [{
  id: 'en-US',
  code: 'en-US',
  flag: '🇺🇸',
  name: 'English (US)',
  rtl: false,
  translations: Object.fromEntries(state.screenshots.map((s) => [s.id, { ...s.headline }])),
  pillTranslations: Object.fromEntries(state.screenshots.map((s) => [s.id, s.pill])),
  extraTranslations: Object.fromEntries(state.screenshots.map((s) => [s.id, {
    annotation: s.annotation,
    proofText: s.proofText,
    proofAttribution: s.proofAttribution,
    trustStrip: s.trustStrip,
    phoneBrand: s.phoneBrand,
    phoneTitle: s.phoneTitle,
    phoneSubtitle: s.phoneSubtitle,
    phoneToggleLeft: s.phoneToggleLeft,
    phoneToggleRight: s.phoneToggleRight,
  }])),
  slotAdjustments: {},
  aiTranslated: true,
}];

const pushed = await fetch(`${API}/push`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(state),
});
if (!pushed.ok) throw new Error(`state push ${pushed.status}: ${await pushed.text()}`);
console.log(await pushed.text());
console.log(`Elara review state prepared: ${state.screenshots.length} English hero slots`);
