import { readFile, writeFile } from 'node:fs/promises';

const STATE_API = 'http://localhost:5181/api/studio-state';
const ASSET_BASE = 'http://localhost:5180/studio/uploads';
const OUTPUT = '/Users/qwar49/Desktop/Elara-ASO-2.2-Review/02_CPP-Father-EN-Approval';
const BACKUP = `${OUTPUT}/state-before-geo-previews.json`;

async function push(state) {
  const response = await fetch(`${STATE_API}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    throw new Error(`state push ${response.status}: ${await response.text()}`);
  }
  console.log(await response.text());
}

if (process.argv.includes('--restore')) {
  const state = JSON.parse(await readFile(BACKUP, 'utf8'));
  await push(state);
  console.log(`Restored ${state.locales.length} App Store locales`);
  process.exit(0);
}

const response = await fetch(STATE_API);
if (!response.ok) throw new Error(`state GET ${response.status}`);
const state = await response.json();
await writeFile(BACKUP, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

const hero = state.screenshots.find((slot) => slot.heroTextLayout === 'father-editorial');
const english = state.locales.find((locale) => locale.code === 'en-US');
if (!hero || !english) throw new Error('Father hero or en-US locale missing');

const markets = [
  {
    code: 'market-IN',
    name: 'India · English geo preview',
    flag: '🇮🇳',
    hero: 'father-market-heroes/father-hero-market-india-en-v1.png',
  },
  {
    code: 'market-ID',
    name: 'Indonesia · English geo preview',
    flag: '🇮🇩',
    hero: 'father-market-heroes/father-hero-market-indonesia-en-v1.png',
  },
  {
    code: 'market-ZA',
    name: 'South Africa · English geo preview',
    flag: '🇿🇦',
    hero: 'father-market-heroes/father-hero-market-south-africa-en-v1.png',
  },
];

state.locales = markets.map((market) => ({
  ...english,
  id: market.code,
  code: market.code,
  name: market.name,
  flag: market.flag,
  sourceOverrides: {
    ...english.sourceOverrides,
    [hero.id]: `${ASSET_BASE}/${market.hero}`,
  },
}));

await push(state);
console.log(`Prepared ${state.locales.length} geo preview locales`);
