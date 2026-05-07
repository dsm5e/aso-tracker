// End Card — render branded Dream outro via Remotion, then concat to the
// end of the input video. Output is a new mp4 with the talking-head + outro
// glued together at 1080×1920.
import { Router } from 'express';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const VIDEO_DIR = join(ROOT, 'output', 'videos');

function ffmpegBin(): string {
  const full = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return existsSync(full) ? full : 'ffmpeg';
}

function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`${cmd} exit ${code}: ${stderr.slice(-2500)}`));
    });
  });
}

function localPath(url: string): string | null {
  if (url.startsWith('/output/')) return join(ROOT, url);
  const m = url.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.+)$/);
  if (m) return join(ROOT, m[3]);
  return null;
}

router.post('/api/compose/end-card', async (req, res) => {
  const {
    videoUrl,
    cta = 'Try Dream Free',
    subtitle = 'Decode every dream',
    brand = 'Dream',
    duration = 3.0,            // seconds, must align with composition's frame count
  } = req.body ?? {};

  if (!videoUrl) return res.status(400).json({ ok: false, error: 'videoUrl required' });
  const inPath = localPath(videoUrl);
  if (!inPath || !existsSync(inPath)) return res.status(400).json({ ok: false, error: `video not found: ${videoUrl}` });

  const ts = Date.now();
  const tmp = join(tmpdir(), `endcard-${ts}`);
  mkdirSync(tmp, { recursive: true });

  const cardSilent = join(tmp, 'card-silent.mp4');
  const cardWithAudio = join(tmp, 'card-audio.mp4');
  const outPath = join(VIDEO_DIR, `endcard-${ts}.mp4`);

  try {
    mkdirSync(VIDEO_DIR, { recursive: true });

    // 1. Render Remotion EndCard to silent mp4. Bundling can take 30-60s on
    //    first cold call; subsequent calls reuse the bundle cache under
    //    ~/.remotion/.
    //
    //    Frame count = duration * fps. Composition default is 90 frames @ 30fps
    //    (3s); we override via --frames if user wanted different duration.
    const fps = 30;
    const totalFrames = Math.max(15, Math.round(Number(duration) * fps));
    const props = JSON.stringify({ cta, subtitle, brand });
    await run('npx', [
      'remotion', 'render',
      'remotion/index.ts', 'EndCard', cardSilent,
      '--props', props,
      '--frames', `0-${totalFrames - 1}`,
      '--codec', 'h264',
      '--log', 'warn',
      '--gl', 'angle',
    ], ROOT);

    // 2. Bake silent stereo audio onto the card so the concat filter has
    //    matching stream counts on both inputs.
    await run(ffmpegBin(), [
      '-y',
      '-i', cardSilent,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-shortest',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      cardWithAudio,
    ]);

    // 3. Concat input video + end card. Both scaled+cropped to 1080×1920.
    //    Crop instead of pad so Kling's 1088×1904 source doesn't letterbox
    //    with black bars — minor horizontal crop is invisible vs ugly bars.
    //    End card is already rendered at exact 1080×1920 so the crop is no-op.
    const filter =
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,setsar=1,fps=${fps}[v0];` +
      `[1:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,setsar=1,fps=${fps}[v1];` +
      `[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]`;
    await run(ffmpegBin(), [
      '-y',
      '-i', inPath,
      '-i', cardWithAudio,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ]);

    res.json({
      ok: true,
      url: `/output/videos/endcard-${ts}.mp4`,
      path: outPath,
      duration,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
