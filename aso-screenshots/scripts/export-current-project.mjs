#!/usr/bin/env node

import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://localhost:5180/studio/export';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
let completionDialog = '';

page.on('console', (message) => {
  const text = message.text();
  const knownFontProbe = text.includes('Error inlining remote css file')
    || text.includes('Error while reading CSS rules from')
    || text.includes('Failed to load resource: the server responded with a status of 404');
  if (text.includes('[export') || (message.type() === 'error' && !knownFontProbe)) {
    process.stdout.write(`[browser:${message.type()}] ${text}\n`);
  }
});
page.on('dialog', async (dialog) => {
  completionDialog = dialog.message();
  process.stdout.write(`[dialog] ${completionDialog.split('\n')[0]}\n`);
  await dialog.dismiss();
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const exportButton = page.getByRole('button', { name: /^Export$/ });
  await exportButton.waitFor({ state: 'visible', timeout: 15_000 });
  // The first canonical SSE state replaces the hydrated Zustand tree once.
  // Let that render settle before clicking so the button is not detached.
  await page.waitForTimeout(1_000);
  let clicked = false;
  for (let attempt = 1; attempt <= 8 && !clicked; attempt += 1) {
    try {
      await page.getByRole('button', { name: /^Export$/ }).click({ timeout: 5_000 });
      clicked = true;
    } catch {
      await page.waitForTimeout(750);
    }
  }
  if (!clicked) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByRole('button', { name: /^Export$/ }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(1_000);
    await page.getByRole('button', { name: /^Export$/ }).click({ timeout: 15_000 });
    clicked = true;
  }
  process.stdout.write('[export] started\n');

  const deadline = Date.now() + 15 * 60_000;
  while (!completionDialog && Date.now() < deadline) {
    await page.waitForTimeout(500);
  }
  if (!completionDialog) throw new Error('Timed out waiting for export completion');
  const result = (await page.locator('body').textContent()) || '';
  process.stdout.write(`[result] ${result.replace(/\s+/g, ' ').trim()}\n`);
  if (/\d+ failed/.test(result)) process.exitCode = 2;
} finally {
  await browser.close();
}
