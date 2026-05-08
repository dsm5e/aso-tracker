// Video Overlay compositor — overlay one video on top of another for a time
// range. Base audio is preserved (overlay video's audio is muted). Used for
// flows like "phone screen recording appears mid-talking-head" — the base
// (Kling face) keeps voicing the monologue while the screen replaces the
// frame visually for the back half of the ad.
//
// Different from stitch (sequential) and split-screen (side-by-side):
// this is composite with timing.
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
      else rejectP(new Error(`ffmpeg exit ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function localPath(url: string): string | null {
  if (url.startsWith('/output/')) return join(ROOT, url);
  const m = url.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.+)$/);
  if (m) return join(ROOT, m[3]);
  return null;
}

type Position = 'fullscreen' | 'phone-screenshot' | 'card' | 'polaroid' | 'center' | 'top' | 'bottom';

router.post('/api/compose/video-overlay', async (req, res) => {
  const {
    baseUrl, overlayUrl,
    start = 5,           // when overlay appears (seconds into base)
    duration,             // total output duration; defaults to base duration
    keepBaseAudio = true, // mute the overlay audio
    position = 'phone-screenshot' as Position,
    fadeMs = 200,
  } = req.body ?? {};
  if (!baseUrl || !overlayUrl) {
    return res.status(400).json({ ok: false, error: 'baseUrl and overlayUrl required' });
  }
  const basePath = localPath(baseUrl);
  const overlayPath = localPath(overlayUrl);
  if (!basePath || !existsSync(basePath)) return res.status(400).json({ ok: false, error: `base not found: ${baseUrl}` });
  if (!overlayPath || !existsSync(overlayPath)) return res.status(400).json({ ok: false, error: `overlay not found: ${overlayUrl}` });

  const startN = Math.max(0, Number(start) || 0);
  const ts = Date.now();
  const outPath = join(VIDEO_DIR, `overlay-video-${ts}.mp4`);

  try {
    mkdirSync(VIDEO_DIR, { recursive: true });

    // 1080×1920 vertical canvas. Build per-position pre-chain for [1:v]
    // (overlay video). Rounded-corner alpha mask via geq — same trick as
    // image-overlay: hypot of corner-distance ≤ R → fully visible, else 0.
    const W = 1080, H = 1920;
    function roundedAlpha(R: number): string {
      const dx = `max(0,max(${R}-X,X-(W-${R})))`;
      const dy = `max(0,max(${R}-Y,Y-(H-${R})))`;
      return `255*lte(hypot(${dx},${dy}),${R})`;
    }
    let preChain: string;
    let xy: string;
    if (position === 'fullscreen') {
      preChain = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=rgba`;
      xy = 'x=0:y=0';
    } else if (position === 'center') {
      preChain = `scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1,fps=30,format=rgba`;
      xy = 'x=(W-w)/2:y=(H-h)/2';
    } else if (position === 'top') {
      preChain = `scale=${W}:-1,setsar=1,fps=30,format=rgba`;
      xy = 'x=0:y=0';
    } else if (position === 'bottom') {
      preChain = `scale=${W}:-1,setsar=1,fps=30,format=rgba`;
      xy = 'x=0:y=H-h';
    } else if (position === 'card') {
      const w = Math.round(W * 0.8);
      preChain = `scale=${w}:-1,setsar=1,fps=30,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedAlpha(24)}'`;
      xy = 'x=(W-w)/2:y=(H-h)/2';
    } else if (position === 'polaroid') {
      const inner = Math.round(W * 0.75);
      const border = 40;
      preChain =
        `scale=${inner}:-1,setsar=1,fps=30,` +
        `pad=iw+${border * 2}:ih+${border * 2}:${border}:${border}:color=white,` +
        `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedAlpha(24)}'`;
      xy = 'x=(W-w)/2:y=(H-h)/2';
    } else {
      // phone-screenshot — 70% width, large rounded corners (60px). Looks
      // like a phone screen floating over the base.
      const w = Math.round(W * 0.7);
      preChain = `scale=${w}:-1,setsar=1,fps=30,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedAlpha(60)}'`;
      xy = 'x=(W-w)/2:y=(H-h)/2';
    }

    const fadeS = Math.max(0, Number(fadeMs) || 0) / 1000;
    const fadeIn = fadeS > 0 ? `,fade=t=in:st=${startN.toFixed(3)}:d=${fadeS.toFixed(3)}:alpha=1` : '';

    const filter =
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30[base];` +
      `[1:v]${preChain},setpts=PTS-STARTPTS+${startN}/TB${fadeIn}[ov];` +
      `[base][ov]overlay=enable='gte(t,${startN})':${xy}[v]`;

    const args: string[] = [
      '-y',
      '-i', basePath,
      '-i', overlayPath,
      '-filter_complex', filter,
      '-map', '[v]',
    ];
    if (keepBaseAudio) {
      args.push('-map', '0:a?');
    }
    args.push(
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
    );
    if (typeof duration === 'number' && duration > 0) {
      args.push('-t', String(duration));
    }
    args.push(outPath);

    await run(ffmpegBin(), args);

    res.json({
      ok: true,
      url: `/output/videos/overlay-video-${ts}.mp4`,
      path: outPath,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
