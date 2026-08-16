const API = 'http://localhost:5181/api/studio-state';
const ASSET = 'http://localhost:5180/studio/uploads';

const direction = process.argv[2];

const concepts = {
  tracker: {
    appName: 'Elara Pregnancy Tracker',
    outputFolder: '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/03_CPP-Tracker-EN-Approval',
    presetId: 'elara-sand',
    appColor: '#C97B5A',
    background: 'linear-gradient(160deg, #F6EFE4 0%, #EDE1D1 52%, #DFC9B5 100%)',
    titleColor: '#3A2E2A',
    subtitleColor: '#7B5948',
    accent: '#C87458',
    hero: {
      source: 'elara-cpp-tracker-hero-textless-v1.png',
      pill: 'PREGNANCY TRACKER',
      verb: 'KNOW WHAT’S\nHAPPENING\n— *EVERY WEEK*',
      descriptor: 'Baby growth, due date & daily guidance.',
      titlePx: 154,
      subPx: 50,
      textYFraction: 0.027,
    },
    products: [
      {
        source: 'slot2.png',
        pill: 'WEEK-BY-WEEK TRACKER',
        verb: 'WATCH YOUR\nBABY GROW',
        descriptor: 'Size, development and what changes next.',
      },
      {
        source: 'slot6.png',
        pill: 'PREGNANCY CALENDAR',
        verb: 'NEVER MISS\nA MILESTONE',
        descriptor: 'Appointments, memories and due-date countdown.',
      },
      {
        source: 'elara-kicks-ui.png',
        pill: 'KICK COUNTER',
        verb: 'COUNT EVERY\nKICK',
        descriptor: 'Notice patterns and feel reassured.',
      },
      {
        source: 'elara-contractions-ui.png',
        pill: 'CONTRACTION TIMER',
        verb: 'TIME EVERY\nCONTRACTION',
        descriptor: 'Track duration, frequency and history.',
      },
      {
        source: 'slot7.png',
        pill: 'MATERNAL HEALTH',
        verb: 'YOUR HEALTH\nAT A GLANCE',
        descriptor: 'Weight, water, sleep and symptoms.',
      },
      {
        source: 'slot9.png',
        pill: 'YOUR PREGNANCY JOURNEY',
        verb: 'SAVE EVERY\nMILESTONE',
        descriptor: 'A clear timeline from first flutter onward.',
      },
    ],
  },
  couple: {
    appName: 'Elara Pregnancy Together',
    outputFolder: '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/04_CPP-Couple-Journey-EN-Approval',
    presetId: 'elara',
    appColor: '#8D7189',
    background: 'linear-gradient(155deg, #F5EDF4 0%, #E8D9E7 50%, #D8C1D5 100%)',
    titleColor: '#402D42',
    subtitleColor: '#765C73',
    accent: '#9A6D91',
    productBackgrounds: [
      'elara-cpp-couple-paper-bg-a-v1.png',
      'elara-cpp-couple-paper-bg-b-v1.png',
    ],
    hero: {
      source: 'elara-cpp-couple-hero-textless-v1.png',
      pill: 'YOUR PREGNANCY, SHARED',
      verb: 'Feel closer\n— *every week*',
      descriptor: 'One beautiful app for both of you.',
      titlePx: 162,
      subPx: 52,
      textYFraction: 0.035,
    },
    products: [
      {
        source: 'slot3b.png',
        pill: 'ONE INVITE · TWO PEOPLE',
        verb: 'Connect\nin seconds',
        descriptor: 'No separate account or complicated setup.',
      },
      {
        source: 'slot5.png',
        pill: 'SHARED WISHLIST',
        verb: 'Ask for what\nyou need',
        descriptor: 'Small gestures become real support.',
      },
      {
        source: 'slot2.png',
        pill: 'WEEK-BY-WEEK GROWTH',
        verb: 'Watch your baby\ngrow together',
        descriptor: 'The same milestones on both phones.',
      },
      {
        source: 'slot6.png',
        pill: 'SHARED CALENDAR',
        verb: 'Keep every moment\ntogether',
        descriptor: 'Appointments, notes and memories in one place.',
      },
      {
        source: 'slot9.png',
        pill: 'YOUR STORY',
        verb: 'Build a journey\nyou’ll keep',
        descriptor: 'A shared timeline from first flutter onward.',
      },
      {
        source: 'elara-kicks-ui.png',
        pill: 'KICK COUNTER',
        verb: 'Feel every movement\ntogether',
        descriptor: 'Track the little moments that feel huge.',
      },
      {
        source: 'slot7.png',
        pill: 'CARE THAT FEELS USEFUL',
        verb: 'Know how to\nsupport her',
        descriptor: 'Health insights without the overwhelm.',
      },
    ],
  },
  birth: {
    appName: 'Elara Birth Ready',
    outputFolder: '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/05_CPP-Birth-Ready-EN-Approval',
    presetId: 'elara',
    appColor: '#42B8C8',
    background: 'linear-gradient(160deg, #091A35 0%, #102A4E 52%, #123D59 100%)',
    titleColor: '#F7FAFF',
    subtitleColor: '#C8D9E8',
    accent: '#FF8C7C',
    heroFont: 'Manrope',
    productFont: 'Manrope',
    productBackgrounds: [
      'elara-cpp-birth-ready-bg-a-v1.png',
      'elara-cpp-birth-ready-bg-b-v1.png',
    ],
    hero: {
      source: 'elara-cpp-birth-ready-hero-textless-v1.png',
      pill: 'CALM · READY · TOGETHER',
      verb: 'FEEL READY\n— *WHEN IT STARTS*',
      descriptor: 'Contractions, kicks and the moments before hello.',
      titlePx: 150,
      subPx: 48,
      textYFraction: 0.032,
    },
    products: [
      {
        source: 'elara-contractions-ui.png',
        pill: 'CONTRACTION TIMER',
        verb: 'TIME EVERY\nCONTRACTION',
        descriptor: 'Duration, frequency and history at a glance.',
      },
      {
        source: 'elara-kicks-ui.png',
        pill: 'KICK COUNTER',
        verb: 'KNOW YOUR BABY’S\nMOVEMENT PATTERN',
        descriptor: 'A calm daily ritual for reassurance.',
      },
      {
        source: 'slot6.png',
        pill: 'BIRTH COUNTDOWN',
        verb: 'PLAN THE\nWEEKS AHEAD',
        descriptor: 'Appointments and milestones in one calendar.',
      },
      {
        source: 'slot7.png',
        pill: 'MATERNAL HEALTH',
        verb: 'KEEP HEALTH\nIN VIEW',
        descriptor: 'Weight, water, sleep and symptoms.',
      },
      {
        source: 'slot3b.png',
        pill: 'PARTNER SUPPORT',
        verb: 'BRING YOUR PARTNER\nWITH YOU',
        descriptor: 'One invite keeps both of you connected.',
      },
      {
        source: 'slot9.png',
        pill: 'YOUR JOURNEY',
        verb: 'REMEMBER HOW FAR\nYOU’VE COME',
        descriptor: 'Every milestone, saved in one timeline.',
      },
    ],
  },
};

if (!concepts[direction]) {
  throw new Error('Usage: node cli/setup-elara-cpp-preview.mjs <tracker|couple|birth>');
}

const concept = concepts[direction];
const response = await fetch(API);
if (!response.ok) throw new Error(`state GET ${response.status}`);
const state = await response.json();

function baseSlot({
  id,
  filename,
  source,
  sourceLayout,
  pill,
  verb,
  descriptor,
  hero = false,
  index = 0,
}) {
  const isCoupleEditorial = direction === 'couple';
  const isBirthReady = direction === 'birth';
  const coupleXs = [-34, 32, -22, 34, -30, 26, 0];
  const coupleScales = [0.80, 0.84, 0.81, 0.84, 0.80, 0.83, 0.82];
  const birthXs = [0, 28, -26, 22, -24, 0];
  const birthScales = [0.84, 0.82, 0.83, 0.82, 0.81, 0.82];
  const productBackground = !hero && concept.productBackgrounds
    ? concept.productBackgrounds[index % concept.productBackgrounds.length]
    : null;

  return {
    id,
    filename,
    device: 'iphone',
    sourceUrl: `${ASSET}/${source}`,
    sourcePixelWidth: hero ? 1024 : 1320,
    sourcePixelHeight: hero ? 2048 : 2868,
    sourceLayout,
    sourceScale: hero ? 1.09 : 1,
    sourceOffsetX: 0,
    sourceOffsetY: 0,
    secondaryUrl: null,
    enhancedUrl: null,
    presetId: concept.presetId,
    backgroundOverride: hero ? null : concept.background,
    bgImageUrl: productBackground ? `${ASSET}/${productBackground}` : null,
    headline: { verb, descriptor, subhead: '' },
    pill,
    pillBg: hero ? 'rgba(255,255,255,0.82)' : concept.accent,
    pillFg: hero ? concept.titleColor : '#FFFFFF',
    annotation: undefined,
    proofText: undefined,
    proofAttribution: undefined,
    trustStrip: undefined,
    heroTextLayout: isCoupleEditorial ? 'cpp-editorial' : (hero ? 'father-editorial' : 'cpp-centered'),
    footer: undefined,
    headlineAccent: concept.accent,
    titleColorOverride: concept.titleColor,
    subtitleColorOverride: concept.subtitleColor,
    textColorOverride: concept.titleColor,
    showAppIcon: false,
    textBacking: false,
    font: hero
      ? concept.heroFont ?? (isCoupleEditorial ? 'Fraunces' : 'Nunito Sans')
      : concept.productFont ?? (isCoupleEditorial ? 'Fraunces' : 'Inter'),
    fontSize: 118,
    titlePx: hero ? concept.hero.titlePx : isCoupleEditorial ? 124 : 132,
    subPx: hero ? concept.hero.subPx : 54,
    textYFraction: hero ? concept.hero.textYFraction : 0.042,
    tiltDeg: 0,
    tiltX: 0,
    tiltY: 0,
    deviceX: !hero && isCoupleEditorial
      ? coupleXs[index - 1] ?? 0
      : !hero && isBirthReady
        ? birthXs[index - 1] ?? 0
        : 0,
    deviceY: hero ? 0 : 38,
    deviceScale: hero
      ? 1
      : isCoupleEditorial
        ? coupleScales[index - 1] ?? 0.82
        : isBirthReady
          ? birthScales[index - 1] ?? 0.82
          : 0.84,
    textX: 0,
    textY: 0,
    breakout: false,
    pulseScreen: 0,
    enhanceState: 'idle',
    sampleIndex: index,
    kind: hero ? 'action' : 'regular',
    action: {
      primary: '',
      secondary: '',
      showStars: false,
      hideDevice: hero,
      themeHint: hero
        ? `${direction} CPP textless editorial hero`
        : 'Exact Elara product screen on a clean premium campaign background',
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

const hero = baseSlot({
  id: `${direction}-hero-en`,
  filename: '01-hero.png',
  source: concept.hero.source,
  sourceLayout: 'full-bleed',
  pill: concept.hero.pill,
  verb: concept.hero.verb,
  descriptor: concept.hero.descriptor,
  hero: true,
});

const products = concept.products.map((product, index) => baseSlot({
  id: `${direction}-product-${String(index + 1).padStart(2, '0')}-en`,
  filename: `${String(index + 2).padStart(2, '0')}-${product.source}`,
  source: product.source,
  sourceLayout: 'device',
  pill: product.pill,
  verb: product.verb,
  descriptor: product.descriptor,
  index: index + 1,
}));

state.appName = concept.appName;
state.appColor = concept.appColor;
state.appIconUrl = 'http://localhost:5180/studio/elara-icon.png';
state.devices = 'iphone';
state.iphoneModel = 'iphone-67';
state.outputFolder = concept.outputFolder;
state.selectedPresetId = concept.presetId;
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
state.screenshots = [hero, ...products];
state.activeScreenshotId = hero.id;
state.locales = [{
  id: 'en-US',
  code: 'en-US',
  flag: '🇺🇸',
  name: 'English (US)',
  rtl: false,
  translations: Object.fromEntries(
    state.screenshots.map((slot) => [slot.id, { ...slot.headline }]),
  ),
  pillTranslations: Object.fromEntries(
    state.screenshots.map((slot) => [slot.id, slot.pill]),
  ),
  extraTranslations: {},
  sourceOverrides: {},
  slotAdjustments: {},
  fontOverride: undefined,
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
console.log(`${direction} CPP prepared: ${state.screenshots.length} English slots`);
