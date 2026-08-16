import { chromium } from 'playwright';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

page.on('console', (message) => {
  console.log(`[browser:${message.type()}] ${message.text()}`);
});
page.on('pageerror', (error) => {
  console.error(`[browser:error] ${error.message}`);
});

await page.goto('http://localhost:5180/studio/editor', {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await page.waitForSelector('[data-mockup-canvas-inner]', {
  state: 'attached',
  timeout: 60_000,
});
console.log('ASO Studio browser ready');

await new Promise((resolve) => process.once('SIGTERM', resolve));
await browser.close();
