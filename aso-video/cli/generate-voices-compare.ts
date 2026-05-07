import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateTikTokTTS } from '../server/routes/tiktok-tts.js';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRY = resolve(ROOT, 'remotion/index.ts');
const OUT_DIR = resolve(ROOT, 'output');
const AUDIO_DIR = join(OUT_DIR, 'audio');
const VOICES_DIR = join(AUDIO_DIR, 'voices');
const FINAL_AUDIO = join(AUDIO_DIR, 'voices-comparison.mp3');
const FINAL_MP4 = join(OUT_DIR, 'voices-comparison.mp4');

const SCRIPT = 'Did you know dreams predict your future?';
const SEGMENT_SECONDS = 5;

type Voice = { id: string; name: string; gradient: string };

const VOICES: Voice[] = [
  { id: 'en_us_001', name: 'Standard Female', gradient: 'linear-gradient(180deg, #0f0f23 0%, #2a1a5e 100%)' },
  { id: 'en_female_emotional', name: 'Emotional', gradient: 'linear-gradient(180deg, #1a0033 0%, #4d1f7a 100%)' },
  { id: 'en_female_samc', name: 'Samantha', gradient: 'linear-gradient(180deg, #001a33 0%, #1a4d7a 100%)' },
  { id: 'en_female_ht_f08_warmy_breeze', name: 'Warm Breeze', gradient: 'linear-gradient(180deg, #2a1500 0%, #7a4a1a 100%)' },
  { id: 'en_us_007', name: 'Husky Female', gradient: 'linear-gradient(180deg, #1a1a1a 0%, #4d4d4d 100%)' },
  { id: 'en_female_betty', name: 'Betty', gradient: 'linear-gradient(180deg, #2a0a1f 0%, #7a1a4e 100%)' },
];

function ffprobeDuration(path: string): number {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return parseFloat(r.stdout.trim());
}

function padToFiveSeconds(input: string, output: string): void {
  // apad pads with silence; -t caps to exact 5s; aresample normalizes timestamps for clean concat
  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i', input,
      '-af', `apad=whole_dur=${SEGMENT_SECONDS},aresample=async=1:first_pts=0`,
      '-t', String(SEGMENT_SECONDS),
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '192k',
      output,
    ],
    { stdio: 'pipe' },
  );
  if (r.status !== 0) throw new Error(`ffmpeg pad failed: ${r.stderr.toString()}`);
}

function concatPaddedMp3s(inputs: string[], output: string): void {
  const listFile = join(tmpdir(), `voices-concat-${Date.now()}.txt`);
  writeFileSync(listFile, inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  // re-encode for clean concat (different source bitrates can break -c copy)
  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '192k',
      output,
    ],
    { stdio: 'pipe' },
  );
  try { unlinkSync(listFile); } catch {}
  if (r.status !== 0) throw new Error(`ffmpeg concat failed: ${r.stderr.toString()}`);
}

async function main() {
  mkdirSync(VOICES_DIR, { recursive: true });

  const successful: Voice[] = [];
  const failed: { voice: Voice; error: string }[] = [];
  const paddedFiles: string[] = [];

  for (const v of VOICES) {
    // generateTikTokTTS writes to output/audio/${slug}.mp3 and uses ${slug} in tmp
    // file names — keep slug flat (no slashes) and move into voices/ after.
    const slug = `voice-${v.id}`;
    const generatedPath = join(AUDIO_DIR, `${slug}.mp3`);
    const outPath = join(VOICES_DIR, `${v.id}.mp3`);
    try {
      if (existsSync(outPath) && process.env.SKIP_TTS) {
        console.log(`[voices-compare] reuse ${outPath}`);
      } else {
        console.log(`[voices-compare] TTS ${v.id} (${v.name})`);
        await generateTikTokTTS(SCRIPT, slug, v.id);
        // Move from output/audio/voice-${id}.mp3 → output/audio/voices/${id}.mp3
        copyFileSync(generatedPath, outPath);
        try { unlinkSync(generatedPath); } catch {}
      }
      const dur = ffprobeDuration(outPath);
      console.log(`[voices-compare]   → ${dur.toFixed(2)}s`);
      const padded = join(tmpdir(), `voices-pad-${v.id}.mp3`);
      padToFiveSeconds(outPath, padded);
      paddedFiles.push(padded);
      successful.push(v);
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[voices-compare] FAIL ${v.id}: ${msg}`);
      failed.push({ voice: v, error: msg });
    }
  }

  if (successful.length < 1) {
    throw new Error('no voices succeeded — aborting');
  }

  console.log(`[voices-compare] concatenating ${successful.length} voices`);
  concatPaddedMp3s(paddedFiles, FINAL_AUDIO);
  for (const f of paddedFiles) {
    try { unlinkSync(f); } catch {}
  }

  // Copy to public/ for staticFile() in Remotion
  const PUBLIC_AUDIO = resolve(ROOT, 'public', 'audio');
  mkdirSync(PUBLIC_AUDIO, { recursive: true });
  const publicAudioName = 'voices-comparison.mp3';
  copyFileSync(FINAL_AUDIO, join(PUBLIC_AUDIO, publicAudioName));

  const inputProps = JSON.stringify({
    audioUrl: `audio/${publicAudioName}`,
    voices: successful,
  });

  const segmentFrames = SEGMENT_SECONDS * 30;
  const totalFrames = segmentFrames * successful.length;

  const args = [
    'remotion',
    'render',
    ENTRY,
    'VoicesCompare',
    FINAL_MP4,
    '--codec=h264',
    `--props=${inputProps}`,
    `--frames=0-${totalFrames - 1}`,
  ];
  console.log(`[voices-compare] rendering → ${FINAL_MP4}`);
  const t0 = Date.now();
  const r = spawnSync('npx', args, { cwd: ROOT, stdio: 'inherit' });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 0) {
    console.error(`[voices-compare] render failed status=${r.status}`);
    process.exit(r.status ?? 1);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`successful (${successful.length}): ${successful.map((v) => v.id).join(', ')}`);
  console.log(`failed (${failed.length}): ${failed.map((f) => `${f.voice.id} (${f.error})`).join(', ') || 'none'}`);
  console.log(`render time: ${elapsed}s`);
  console.log(`output: ${FINAL_MP4}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
