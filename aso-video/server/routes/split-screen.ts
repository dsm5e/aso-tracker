// Split-screen compositor — stacks two videos vertically into a single 9:16
// 1080×1920 mp4. Top is the "talking head" (with audio), bottom is the
// satisfying / b-roll filler (audio dropped). Bottom auto-loops to match
// top duration if shorter, trimmed if longer.
import { Router } from 'express';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const VIDEO_DIR = join(ROOT, 'output', 'videos');

function ffmpegBin(): string {
  const full = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return existsSync(full) ? full : 'ffmpeg';
}
function ffprobeBin(): string {
  const full = '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
  return existsSync(full) ? full : 'ffprobe';
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolveP(stdout);
      else rejectP(new Error(`${cmd} exit ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function videoDuration(path: string): Promise<number> {
  const out = await run(ffprobeBin(), [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', path,
  ]);
  return Number(out.trim()) || 0;
}

function localPath(url: string): string | null {
  if (url.startsWith('/output/')) return join(ROOT, url);
  const m = url.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.+)$/);
  if (m) return join(ROOT, m[3]);
  return null;
}

const RATIO_TO_TOP_HEIGHT: Record<string, number> = {
  '50/50': 960,
  '60/40': 1152,
  '65/35': 1248,  // most common TikTok talking-head
  '70/30': 1344,
};

router.post('/api/compose/split-screen', async (req, res) => {
  const { topUrl, bottomUrl, ratio = '65/35', audioSource = 'top' } = req.body ?? {};
  if (!topUrl || !bottomUrl) {
    return res.status(400).json({ ok: false, error: 'topUrl and bottomUrl required' });
  }
  const topPath = localPath(topUrl);
  const bottomPath = localPath(bottomUrl);
  if (!topPath || !existsSync(topPath)) return res.status(400).json({ ok: false, error: `top video not found: ${topUrl}` });
  if (!bottomPath || !existsSync(bottomPath)) return res.status(400).json({ ok: false, error: `bottom video not found: ${bottomUrl}` });

  const topH = RATIO_TO_TOP_HEIGHT[ratio] ?? 1248;
  const botH = 1920 - topH;
  const W = 1080;

  const ts = Date.now();
  const outPath = join(VIDEO_DIR, `splitscreen-${ts}.mp4`);

  try {
    mkdirSync(VIDEO_DIR, { recursive: true });

    // Anchor output duration to top clip; loop bottom to match (ffmpeg
    // `-stream_loop -1` repeats input indefinitely, then `-shortest` trims).
    const topDur = await videoDuration(topPath);
    if (!topDur) throw new Error('failed to read top video duration');

    // Build filtergraph: scale+crop each input to target W×H, then vstack.
    const filter =
      `[0:v]scale=${W}:${topH}:force_original_aspect_ratio=increase,crop=${W}:${topH}[top];` +
      `[1:v]scale=${W}:${botH}:force_original_aspect_ratio=increase,crop=${W}:${botH}[bot];` +
      `[top][bot]vstack=inputs=2[v]`;

    const args: string[] = [
      '-y',
      '-i', topPath,
      '-stream_loop', '-1', '-i', bottomPath,
      '-filter_complex', filter,
      '-map', '[v]',
      '-t', String(topDur),
    ];
    // Audio handling
    if (audioSource === 'top') args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', '128k');
    else if (audioSource === 'bottom') args.push('-map', '1:a?', '-c:a', 'aac', '-b:a', '128k');
    else if (audioSource === 'mute') args.push('-an');
    else args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', '128k');
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath);

    await run(ffmpegBin(), args);

    res.json({
      ok: true,
      url: `/output/videos/splitscreen-${ts}.mp4`,
      path: outPath,
      ratio,
      duration: topDur,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
