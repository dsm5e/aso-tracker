import { chromium } from 'playwright';

const base = 'http://localhost:5180/studio';
const stateResponse = await fetch('http://localhost:5181/api/studio-state');
if (!stateResponse.ok) throw new Error(`state GET ${stateResponse.status}`);
const state = await stateResponse.json();
const expected = state.screenshots.length * Math.max(1, state.locales.length);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });

page.on('dialog', async (dialog) => {
  // Export asks whether to archive/reset after saving. Review renders must keep
  // the active Studio project intact, so dismiss that confirmation.
  await dialog.dismiss();
});
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error(`[browser] ${msg.text()}`);
});

await page.goto(`${base}/export`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
await page.getByRole('button', { name: 'Export', exact: true }).waitFor({ timeout: 30_000 });
await page.waitForFunction(({ expectedCount, expectedFolder }) => {
  const body = document.body.innerText;
  const inputs = Array.from(document.querySelectorAll('input'));
  return body.includes(`Slots: ${expectedCount} `) &&
    inputs.some((input) => input.value === expectedFolder);
}, { expectedCount: state.screenshots.length, expectedFolder: state.outputFolder }, { timeout: 30_000 });
// The project summary can match one render before the footer finishes mounting
// after an externally pushed state. Let that final React pass settle.
await page.waitForTimeout(2500);
// State sync can replace the export footer between locator resolution and the
// synthetic pointer action. Activate the live DOM button in one page task.
let started = false;
for (let attempt = 0; attempt < 100 && !started; attempt += 1) {
  started = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.trim() === 'Export');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    // Return to Playwright before React synchronously replaces the button with
    // the progress UI; otherwise the execution result can be lost with the node.
    window.setTimeout(() => button.click(), 0);
    return true;
  });
  if (!started) await page.waitForTimeout(100);
}
if (!started) throw new Error('Export button was not available after state sync');

await page.waitForFunction((expectedCount) => {
  const body = document.body.innerText;
  return body.includes(`${expectedCount} rendered`);
}, expected, { timeout: Math.max(120_000, expected * 8_000) });

console.log((await page.locator('body').innerText()).split('\n').filter((line) =>
  /rendered|failed|saved|PNG/i.test(line)
).join('\n'));

// Surface per-job failures: the footer only shows counts, and a silent
// "0 failed" is the difference between a finished run and a missing locale.
const failures = await page.evaluate(() => {
  const body = document.body.innerText;
  const m = body.match(/^.*(failed|collision|exceeds|safe zone).*$/gim);
  return m ? m.slice(0, 40) : [];
});
if (failures.length) console.log('--- failures ---\n' + failures.join('\n'));

await browser.close();
