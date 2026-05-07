import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { generateTikTokTTS } from '../server/routes/tiktok-tts.js';
import { transcribeToWords, type Word } from '../server/routes/whisper.js';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRY = resolve(ROOT, 'remotion/index.ts');
const OUT_DIR = resolve(ROOT, 'output');
const AUDIO_DIR = join(OUT_DIR, 'audio');
const CAP_DIR = join(OUT_DIR, 'captions');
const SLUG = 'dream-ad-v1';
const FINAL_MP4 = join(OUT_DIR, `${SLUG}.mp4`);

const SCRIPT = [
  'Did you know dreams can predict your future?',
  'I had this same dream every single night for six months.',
  'So I asked Dream Journal what it actually means.',
  'Try Dream free for seven days, link in bio.',
].join(' ');

async function main() {
  mkdirSync(AUDIO_DIR, { recursive: true });
  mkdirSync(CAP_DIR, { recursive: true });

  // 1. TTS
  const audioPath = join(AUDIO_DIR, `${SLUG}.mp3`);
  if (existsSync(audioPath) && process.env.SKIP_TTS) {
    console.log(`[generate-v1] reusing ${audioPath}`);
  } else {
    console.log(`[generate-v1] generating TikTok TTS → ${audioPath}`);
    await generateTikTokTTS(SCRIPT, SLUG);
  }

  // 2. Whisper transcribe
  const capPath = join(CAP_DIR, `${SLUG}.json`);
  let words: Word[];
  let model: string;
  if (existsSync(capPath) && process.env.SKIP_WHISPER) {
    console.log(`[generate-v1] reusing ${capPath}`);
    const j = JSON.parse(readFileSync(capPath, 'utf8'));
    words = j.words;
    model = j.model;
  } else {
    console.log(`[generate-v1] transcribing via fal Whisper`);
    const out = await transcribeToWords(`/output/audio/${SLUG}.mp3`);
    words = out.words;
    model = out.model;
    writeFileSync(capPath, JSON.stringify({ model, words }, null, 2));
    console.log(
      `[generate-v1] wrote ${capPath} (${words.length} words, model=${model})`,
    );
  }

  // 3. Render — Remotion only loads http(s) or staticFile() relative paths.
  // Copy audio into public/ and reference via staticFile name.
  const PUBLIC_AUDIO = resolve(ROOT, 'public', 'audio');
  mkdirSync(PUBLIC_AUDIO, { recursive: true });
  const publicAudioName = `${SLUG}.mp3`;
  copyFileSync(audioPath, join(PUBLIC_AUDIO, publicAudioName));
  console.log(`[generate-v1] rendering → ${FINAL_MP4}`);
  const inputProps = JSON.stringify({
    audioUrl: `audio/${publicAudioName}`, // resolved with staticFile() inside DreamAd
    words,
  });
  const args = [
    'remotion',
    'render',
    ENTRY,
    'DreamAd',
    FINAL_MP4,
    '--codec=h264',
    `--props=${inputProps}`,
  ];
  console.log(
    `[generate-v1] npx remotion render ... (props ~${inputProps.length} bytes)`,
  );
  const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[generate-v1] render failed status=${r.status}`);
    process.exit(r.status ?? 1);
  }

  console.log(`[generate-v1] done → ${FINAL_MP4}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
