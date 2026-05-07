// Image Overlay compositor — burn an image onto a video for a specific time
// range with fade in/out. Used for jump-scares, brand outros, phone mockups.
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

type Position =
  | 'fullscreen'      // cover entire frame
  | 'center'          // fit + transparent letterbox
  | 'top'             // full-width banner top
  | 'bottom'          // full-width banner bottom
  | 'card'            // 80% width, rounded 24px, centered (TikTok meme insert)
  | 'polaroid'        // 75% width, white frame 40px, rounded 24px
  | 'phone-screenshot'; // 70% width, big rounded 60px (looks like phone screen)

router.post('/api/compose/image-overlay', async (req, res) => {
  const {
    videoUrl, imageUrl,
    start = 2.0, end = 3.5,
    position = 'card' as Position,
    fadeMs = 200,
    opacity = 1.0,
  } = req.body ?? {};
  if (!videoUrl || !imageUrl) {
    return res.status(400).json({ ok: false, error: 'videoUrl and imageUrl required' });
  }
  const vPath = localPath(videoUrl);
  const iPath = localPath(imageUrl);
  if (!vPath || !existsSync(vPath)) return res.status(400).json({ ok: false, error: `video not found: ${videoUrl}` });
  if (!iPath || !existsSync(iPath)) return res.status(400).json({ ok: false, error: `image not found: ${imageUrl}` });

  const startN = Math.max(0, Number(start) || 0);
  const endN = Math.max(startN + 0.1, Number(end) || startN + 1.5);
  const dur = endN - startN;
  const fadeS = Math.max(0, Number(fadeMs) || 0) / 1000;
  const op = Math.min(1, Math.max(0, Number(opacity) || 1));

  const ts = Date.now();
  const outPath = join(VIDEO_DIR, `overlay-${ts}.mp4`);

  // 1080×1920 vertical canvas assumed.
  const W = 1080, H = 1920;

  // Build the per-preset filter chain — produces the [ov] stream ready to be
  // composited over the base video.
  //
  // Rounded-corner alpha mask via geq:
  //   For each pixel (X, Y), compute (dx, dy) — how far it sticks into a
  //   "corner cutout". If hypot(dx, dy) ≤ R the pixel is inside the rounded
  //   rectangle (alpha 255), otherwise 0.
  //
  //   ffmpeg's `max` only takes 2 args, so we nest. Plain commas — they are
  //   literal inside single-quoted values, no backslash escaping needed.
  function roundedAlpha(R: number): string {
    const dx = `max(0,max(${R}-X,X-(W-${R})))`;
    const dy = `max(0,max(${R}-Y,Y-(H-${R})))`;
    return `255*lte(hypot(${dx},${dy}),${R})`;
  }

  let preChain: string;       // filters applied to [1:v] producing [ov]
  let xy: string;             // overlay positioning expression

  if (position === 'fullscreen') {
    preChain = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=rgba`;
    xy = 'x=0:y=0';
  } else if (position === 'center') {
    preChain = `scale=${W}:${H}:force_original_aspect_ratio=decrease,format=rgba`;
    xy = 'x=(W-w)/2:y=(H-h)/2';
  } else if (position === 'top') {
    preChain = `scale=${W}:-1,format=rgba`;
    xy = 'x=0:y=0';
  } else if (position === 'bottom') {
    preChain = `scale=${W}:-1,format=rgba`;
    xy = 'x=0:y=H-h';
  } else if (position === 'card') {
    // 80% width, rounded 24px, centered. Source aspect preserved.
    const w = Math.round(W * 0.8);
    preChain = `scale=${w}:-1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedAlpha(24)}'`;
    xy = 'x=(W-w)/2:y=(H-h)/2';
  } else if (position === 'polaroid') {
    // 75% width image, then 40px white frame around it, rounded 24px.
    const inner = Math.round(W * 0.75);
    const border = 40;
    preChain =
      `scale=${inner}:-1,` +
      `pad=iw+${border * 2}:ih+${border * 2}:${border}:${border}:color=white,` +
      `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedAlpha(24)}'`;
    xy = 'x=(W-w)/2:y=(H-h)/2';
  } else {
    // phone-screenshot: 70% width, big rounded 60px (like a phone screen)
    const w = Math.round(W * 0.7);
    preChain = `scale=${w}:-1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${roundedAlpha(60)}'`;
    xy = 'x=(W-w)/2:y=(H-h)/2';
  }

  const fadeIn = fadeS > 0 ? `,fade=t=in:st=${startN.toFixed(3)}:d=${fadeS.toFixed(3)}:alpha=1` : '';
  const fadeOutSt = (endN - fadeS).toFixed(3);
  const fadeOut = fadeS > 0 ? `,fade=t=out:st=${fadeOutSt}:d=${fadeS.toFixed(3)}:alpha=1` : '';
  const opacityClause = op < 1 ? `,colorchannelmixer=aa=${op}` : '';

  const filter =
    `[1:v]${preChain}${opacityClause}${fadeIn}${fadeOut}[ov];` +
    `[0:v][ov]overlay=enable='between(t,${startN.toFixed(3)},${endN.toFixed(3)})':${xy}[v]`;

  const args = [
    '-y',
    '-i', vPath,
    '-loop', '1', '-i', iPath,    // loop image so it has frames during the entire video
    '-filter_complex', filter,
    '-map', '[v]',
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    outPath,
  ];

  try {
    mkdirSync(VIDEO_DIR, { recursive: true });
    await run(ffmpegBin(), args);
    res.json({
      ok: true,
      url: `/output/videos/overlay-${ts}.mp4`,
      path: outPath,
      start: startN,
      end: endN,
      position,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
