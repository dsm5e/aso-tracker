// Stitch — concatenate two videos end-to-end. Both are scaled+padded to
// 1080×1920 9:16 to handle source dimension drift (e.g. Kling 1088×1904).
// Audio is concatenated too; one shared audio track in the output.
import { Router } from 'express';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const VIDEO_DIR = join(ROOT, 'output', 'videos');

function ffmpegBin(): string {
  const full = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return existsSync(full) ? full : 'ffmpeg';
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`ffmpeg exit ${code}: ${stderr.slice(-2500)}`));
    });
  });
}

function localPath(url: string): string | null {
  if (url.startsWith('/output/')) return join(ROOT, url);
  const m = url.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.+)$/);
  if (m) return join(ROOT, m[3]);
  return null;
}

router.post('/api/compose/stitch', async (req, res) => {
  const { videoUrlA, videoUrlB } = req.body ?? {};
  if (!videoUrlA || !videoUrlB) {
    return res.status(400).json({ ok: false, error: 'videoUrlA and videoUrlB required' });
  }
  const aPath = localPath(videoUrlA);
  const bPath = localPath(videoUrlB);
  if (!aPath || !existsSync(aPath)) return res.status(400).json({ ok: false, error: `video A not found: ${videoUrlA}` });
  if (!bPath || !existsSync(bPath)) return res.status(400).json({ ok: false, error: `video B not found: ${videoUrlB}` });

  const ts = Date.now();
  const outPath = join(VIDEO_DIR, `stitch-${ts}.mp4`);

  try {
    mkdirSync(VIDEO_DIR, { recursive: true });

    // Re-encode to a common 1080×1920 30fps target so concat doesn't choke
    // on minor resolution drift between sources (Kling outputs 1088×1904).
    //
    // Use scale+crop (not scale+pad) to avoid black bars top/bottom: Kling
    // sources are slightly wider AND slightly shorter than 1080×1920, so
    // pad-fitting always letterboxed ~15px. We instead scale-to-fill, then
    // crop the marginal extra width — ad stays edge-to-edge.
    const filter =
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,setsar=1,fps=30[v0];` +
      `[1:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,setsar=1,fps=30[v1];` +
      `[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]`;
    await run(ffmpegBin(), [
      '-y',
      '-i', aPath,
      '-i', bPath,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ]);

    res.json({
      ok: true,
      url: `/output/videos/stitch-${ts}.mp4`,
      path: outPath,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
