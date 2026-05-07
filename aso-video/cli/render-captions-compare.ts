import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRY = resolve(ROOT, 'remotion/index.ts');
const OUT_DIR = resolve(ROOT, 'output');
const FINAL_MP4 = join(OUT_DIR, 'captions-comparison.mp4');

const SRC_AUDIO = join(OUT_DIR, 'audio', 'dream-ad-v1.mp3');
const PUBLIC_AUDIO_DIR = resolve(ROOT, 'public', 'audio');
const PUBLIC_AUDIO = join(PUBLIC_AUDIO_DIR, 'dream-ad-v1.mp3');

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(PUBLIC_AUDIO_DIR, { recursive: true });

  if (!existsSync(PUBLIC_AUDIO)) {
    if (!existsSync(SRC_AUDIO)) {
      throw new Error(`source audio missing: ${SRC_AUDIO}`);
    }
    console.log(`[captions-compare] copying audio → ${PUBLIC_AUDIO}`);
    copyFileSync(SRC_AUDIO, PUBLIC_AUDIO);
  } else {
    console.log(`[captions-compare] reuse public audio ${PUBLIC_AUDIO}`);
  }

  const inputProps = JSON.stringify({
    audioUrl: 'audio/dream-ad-v1.mp3',
  });

  const args = [
    'remotion',
    'render',
    ENTRY,
    'CaptionsCompare',
    FINAL_MP4,
    '--codec=h264',
    `--props=${inputProps}`,
  ];
  console.log(`[captions-compare] rendering → ${FINAL_MP4}`);
  const t0 = Date.now();
  const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit' });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 0) {
    console.error(`[captions-compare] render failed status=${r.status}`);
    process.exit(r.status ?? 1);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`render time: ${elapsed}s`);
  console.log(`output: ${FINAL_MP4}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
