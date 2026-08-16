// Экспорт скриншотов из терминала.
//
// Зачем: рендер в этой студии живёт В БРАУЗЕРЕ — она отрисовывает каждый слот
// в DOM, снимает его и шлёт готовый PNG на `/api/export/save-png`, который
// пишет файл. Из Node этот шаг не повторить: нужен настоящий layout-движок со
// шрифтами, масками и clip-path. Поэтому вместо переписывания рендера мы
// поднимаем headless-браузер и жмём ту же кнопку, что и человек, — результат
// байт в байт совпадает с тем, что видно в редакторе.
//
// Usage:  node scripts/export-cli.mjs [--url http://localhost:5180] [--timeout 600]
import { chromium } from 'playwright';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
};
const BASE = arg('url', 'http://localhost:5180');
const TIMEOUT = Number(arg('timeout', 600)) * 1000;

// Берём системный Chrome: playwright-браузеры здесь не скачаны, а тянуть
// 150 МБ ради одной кнопки незачем. Если Chrome нет — падаем на дефолт.
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { existsSync } = await import('node:fs');
const browser = await chromium.launch(
  existsSync(CHROME) ? { executablePath: CHROME } : {},
);
// Окно должно быть большим: слоты рендерятся в реальном размере и
// масштабируются под вьюпорт — в узком окне часть из них не смонтируется.
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

page.on('console', (m) => {
  const t = m.text();
  if (/error|fail|❌/i.test(t)) console.log('  [browser]', t);
});

const saved = [];
page.on('response', async (r) => {
  if (r.url().includes('/export/save-png') && r.ok()) saved.push(r.url());
});

console.log(`→ открываю ${BASE}/studio/export`);
// НЕ networkidle: студия держит открытый SSE-поток состояния, сеть никогда
// не «затихает» и ожидание всегда падает по таймауту. Ждём готовности DOM,
// а дальше — саму кнопку.
await page.goto(`${BASE}/studio/export`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

const button = page.getByRole('button', { name: 'Export', exact: true });
await button.waitFor({ state: 'visible', timeout: 30_000 });
if (await button.isDisabled()) {
  // Кнопка гаснет, когда студия сама нашла проблему (нет слотов, не задана
  // папка). Показать её title полезнее, чем молча упасть по таймауту.
  const why = await button.getAttribute('title');
  console.error('✗ экспорт заблокирован студией:', why ?? 'причина не указана');
  await browser.close();
  process.exit(1);
}

console.log('→ жму Export, жду рендер…');
await button.click();

// Готово, когда кнопка Stop исчезла и вернулась Export.
await page.getByRole('button', { name: 'Stop' }).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
await page.getByRole('button', { name: 'Stop' }).waitFor({ state: 'detached', timeout: TIMEOUT });

console.log(`✓ сохранено файлов: ${saved.length}`);
await browser.close();
