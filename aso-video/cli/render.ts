import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRY = resolve(ROOT, 'remotion/index.ts');
const OUT_DIR = resolve(ROOT, 'output');
const OUT_FILE = resolve(OUT_DIR, 'dream-ad-mvp.mp4');

mkdirSync(OUT_DIR, { recursive: true });

const args = ['remotion', 'render', ENTRY, 'DreamAd', OUT_FILE, '--codec=h264'];

console.log(`[render] npx ${args.join(' ')}`);
const result = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit' });

if (result.status !== 0) {
  console.error(`[render] failed with status ${result.status}`);
  process.exit(result.status ?? 1);
}

console.log(`[render] done → ${OUT_FILE}`);
