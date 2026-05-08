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
function ffprobeBin(): string {
  const full = '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
  return existsSync(full) ? full : 'ffprobe';
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

/** Probe a media file for an audio stream. iPhone screen recordings have
 * none, so we have to fabricate silence for them or ffmpeg's concat filter
 * complains the audio stream specifier matches no streams. */
function hasAudio(path: string): Promise<boolean> {
  return new Promise((resolveP) => {
    const child = spawn(ffprobeBin(), [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      path,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', () => resolveP(out.trim().length > 0));
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

    // Probe each input for audio. Screen recordings from iPhone are
    // video-only — we synthesise silence with anullsrc for those slots
    // so the concat filter has matching audio streams in both inputs.
    const [aHasAudio, bHasAudio] = await Promise.all([hasAudio(aPath), hasAudio(bPath)]);

    // Build inputs: real files always; an anullsrc lavfi input appended
    // for any side that lacks audio. Track what stream index each audio
    // ends up on so the filter graph can reference it correctly.
    const args: string[] = ['-y', '-i', aPath, '-i', bPath];
    let aAudioRef = '0:a';
    let bAudioRef = '1:a';
    let nextInputIdx = 2;
    if (!aHasAudio) {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      aAudioRef = `${nextInputIdx}:a`;
      nextInputIdx += 1;
    }
    if (!bHasAudio) {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      bAudioRef = `${nextInputIdx}:a`;
      nextInputIdx += 1;
    }

    // Re-encode to a common 1080×1920 30fps target so concat doesn't choke
    // on minor resolution drift between sources (Kling outputs 1088×1904).
    // Use scale+crop (not scale+pad) to avoid black bars — Kling is wider+shorter
    // than 1080×1920, so pad-fitting always letterboxed ~15px.
    const filter =
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,setsar=1,fps=30[v0];` +
      `[1:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,setsar=1,fps=30[v1];` +
      `[v0][${aAudioRef}][v1][${bAudioRef}]concat=n=2:v=1:a=1[v][a]`;
    await run(ffmpegBin(), [
      ...args,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      // anullsrc is infinite — bound the output to the longest concatenated
      // duration so ffmpeg doesn't hang on the silent stream.
      '-shortest',
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
