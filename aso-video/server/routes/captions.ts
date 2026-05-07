// Captions node — takes a video, transcribes its audio track via fal whisper,
// groups words into TikTok-style chunks (3–5 words / ≤2s) and burns ASS
// subtitles into a new mp4 with ffmpeg.
import { Router } from 'express';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { transcribeToWords, type Word } from './whisper.js';

// Brew's default `ffmpeg` formula is built without libass; CapCut-grade ASS
// styling needs `ffmpeg-full` which installs keg-only at this path.
// We resolve fresh on each call so a fresh ffmpeg-full install picks up
// without restarting tsx watch.
function ffmpegBin(): string {
  const full = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return existsSync(full) ? full : 'ffmpeg';
}

// Cache directory for word-level transcripts so re-rendering with a different
// caption style doesn't pay fal.whisper again.
const CACHE_DIR = join(resolve(import.meta.dirname, '..', '..'), 'output', 'captions-cache');
mkdirSync(CACHE_DIR, { recursive: true });

function cachePathFor(videoPath: string): string {
  return join(CACHE_DIR, `${basename(videoPath)}.words.json`);
}

function readCachedWords(videoPath: string): Word[] | null {
  const p = cachePathFor(videoPath);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf-8')) as { words?: Word[] };
    return Array.isArray(j.words) && j.words.length ? j.words : null;
  } catch { return null; }
}

function writeCachedWords(videoPath: string, words: Word[]): void {
  try {
    writeFileSync(cachePathFor(videoPath), JSON.stringify({ words, savedAt: Date.now() }, null, 2));
  } catch {}
}

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const VIDEO_DIR = join(ROOT, 'output', 'videos');

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`${cmd} exit ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function localPath(url: string): string | null {
  if (url.startsWith('/output/')) return join(ROOT, url);
  const m = url.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.+)$/);
  if (m) return join(ROOT, m[3]);
  return null;
}

/**
 * Group words into chunks bounded by:
 *  - ≤maxWords words
 *  - ≤maxDur seconds
 *  - ≤maxChars total characters (incl. spaces) — keeps each chunk on a single
 *    line at the chosen font size so text doesn't jump 1→2 lines.
 */
function groupWords(
  words: Word[],
  maxWords = 5,
  maxDur = 2.0,
  maxChars = Infinity,
): { start: number; end: number; text: string }[] {
  const chunks: { start: number; end: number; text: string }[] = [];
  let buf: Word[] = [];
  const bufLen = (b: Word[]) => b.map((w) => w.text).join(' ').length;
  for (const w of words) {
    if (buf.length === 0) { buf.push(w); continue; }
    const start = buf[0].start;
    const dur = w.end - start;
    const projectedLen = bufLen(buf) + 1 + w.text.length;
    const overflow =
      buf.length >= maxWords ||
      dur > maxDur ||
      projectedLen > maxChars;
    if (overflow) {
      chunks.push({ start: buf[0].start, end: buf[buf.length - 1].end, text: buf.map((b) => b.text).join(' ') });
      buf = [w];
    } else {
      buf.push(w);
    }
  }
  if (buf.length) chunks.push({ start: buf[0].start, end: buf[buf.length - 1].end, text: buf.map((b) => b.text).join(' ') });
  return chunks;
}

/**
 * Estimate the max number of characters that fit on a single line for a given
 * font size. Calibrated for Arial Black at 1088×1904 (Kling) with default 40px
 * left/right margins. ~0.55 width-per-char heuristic; conservative on purpose.
 */
function maxCharsForFont(fontSize: number, videoWidth = 1088, marginH = 80): number {
  const usable = videoWidth - marginH * 2;
  const charPx = fontSize * 0.55;
  return Math.max(8, Math.floor(usable / charPx));
}

type CaptionPreset =
  | 'capcut-classic'
  | 'minimal'
  | 'bold-yellow'
  | 'hormozi'
  | 'subway-surfer'
  | 'tiktok-native'
  | 'neon-glow'
  | 'karaoke-pop';

interface StyleOpts {
  preset: CaptionPreset;
  fontSize: number;
  marginV: number; // bottom margin in pixels
}

// Format `H:MM:SS.cs` (centiseconds) for ASS Dialogue events.
function fmtAssTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s - h * 3600 - m * 60;
  const sec = Math.floor(rem);
  const cs = Math.round((rem - sec) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ASS color: &HAABBGGRR (alpha + BGR, NOT RGB).
const C = {
  white: '&H00FFFFFF',
  yellow: '&H0000FFFF',
  black: '&H00000000',
  shadow: '&H50000000', // 50% alpha black
};

interface PresetStyle {
  fontname: string;
  primary: string;
  outline: string;
  back: string;
  bold: 1 | 0;
  italic: 1 | 0;
  borderStyle: 1 | 3; // 1 = outline + drop shadow, 3 = opaque box
  outlineW: number;
  shadowW: number;
  scaleX: number;
  scaleY: number;
  uppercase: boolean;
  /** Per-chunk inline animation tags (fade + scale pop). */
  popIn: string;
}

// Additional ASS color helpers
const C2 = {
  ...C,
  pink: '&H00B469FF',     // hot pink (BGR)
  cyan: '&H00FFFF00',     // cyan
  green: '&H0000FF00',    // green
  bgBlack: '&H80000000',  // 50% black for box backdrops
};

const PRESETS: Record<CaptionPreset, PresetStyle> = {
  // All presets use fade-only entry — no scale animation — so text size is
  // rock-stable across chunks (no "popping" between captions).

  // 1. CapCut Classic — production default. White Arial Black, black outline.
  'capcut-classic': {
    fontname: 'Arial Black',
    primary: C.white,
    outline: C.black,
    back: C.shadow,
    bold: 1,
    italic: 0,
    borderStyle: 1,
    outlineW: 5,
    shadowW: 2,
    scaleX: 100,
    scaleY: 100,
    uppercase: true,
    popIn: '{\\fad(120,0)}',
  },

  // 2. Minimal — small white Helvetica, no animation, no outline.
  'minimal': {
    fontname: 'Helvetica',
    primary: C.white,
    outline: C.black,
    back: '&H00000000',
    bold: 0,
    italic: 0,
    borderStyle: 1,
    outlineW: 1,
    shadowW: 0,
    scaleX: 100,
    scaleY: 100,
    uppercase: false,
    popIn: '{\\fad(120,0)}',
  },

  // 3. Bold Yellow — Impact, yellow with thick black border.
  'bold-yellow': {
    fontname: 'Impact',
    primary: C.yellow,
    outline: C.black,
    back: C.shadow,
    bold: 1,
    italic: 0,
    borderStyle: 1,
    outlineW: 6,
    shadowW: 3,
    scaleX: 100,
    scaleY: 100,
    uppercase: true,
    popIn: '{\\fad(80,0)}',
  },

  // 4. Hormozi — viral yellow Impact, EXTRA thick outline.
  'hormozi': {
    fontname: 'Impact',
    primary: C.yellow,
    outline: C.black,
    back: C2.bgBlack,
    bold: 1,
    italic: 0,
    borderStyle: 1,
    outlineW: 10,
    shadowW: 4,
    scaleX: 100,
    scaleY: 100,
    uppercase: true,
    popIn: '{\\fad(60,0)}',
  },

  // 5. Subway Surfer — bold white with thin outline.
  'subway-surfer': {
    fontname: 'Helvetica',
    primary: C.white,
    outline: C.black,
    back: C.shadow,
    bold: 1,
    italic: 0,
    borderStyle: 1,
    outlineW: 4,
    shadowW: 0,
    scaleX: 100,
    scaleY: 100,
    uppercase: true,
    popIn: '{\\fad(80,0)}',
  },

  // 6. TikTok Native — semi-transparent black pill background, white text.
  'tiktok-native': {
    fontname: 'Helvetica',
    primary: C.white,
    outline: C.black,
    back: '&H64000000',
    bold: 1,
    italic: 0,
    borderStyle: 3,
    outlineW: 12,
    shadowW: 0,
    scaleX: 100,
    scaleY: 100,
    uppercase: false,
    popIn: '{\\fad(80,0)}',
  },

  // 7. Neon Glow — pink primary with cyan outline glow.
  'neon-glow': {
    fontname: 'Arial Black',
    primary: C2.pink,
    outline: C2.cyan,
    back: C.shadow,
    bold: 1,
    italic: 0,
    borderStyle: 1,
    outlineW: 4,
    shadowW: 6,
    scaleX: 100,
    scaleY: 100,
    uppercase: true,
    popIn: '{\\fad(120,0)}',
  },

  // 8. Karaoke Pop — green high-contrast.
  'karaoke-pop': {
    fontname: 'Arial Black',
    primary: C2.green,
    outline: C.black,
    back: C.shadow,
    bold: 1,
    italic: 0,
    borderStyle: 1,
    outlineW: 5,
    shadowW: 2,
    scaleX: 100,
    scaleY: 100,
    uppercase: true,
    popIn: '{\\fad(60,0)}',
  },
};

function buildAss(
  chunks: { start: number; end: number; text: string }[],
  opts: StyleOpts,
  w = 1080,
  h = 1920,
): string {
  const p = PRESETS[opts.preset];
  const styleLine =
    `Default,${p.fontname},${opts.fontSize},${p.primary},${p.primary},${p.outline},${p.back},` +
    `${p.bold},${p.italic},0,0,${p.scaleX},${p.scaleY},0,0,${p.borderStyle},${p.outlineW},${p.shadowW},2,40,40,${opts.marginV},1`;

  const events = chunks.map((c) => {
    const text = p.uppercase ? c.text.toUpperCase() : c.text;
    // ASS escapes: backslash → \\, single brace already used for tags.
    const safe = text.replace(/\\/g, '\\\\').replace(/\n/g, '\\N');
    return `Dialogue: 0,${fmtAssTime(c.start)},${fmtAssTime(c.end)},Default,,0,0,0,,${p.popIn}${safe}`;
  }).join('\n');

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

/**
 * Transcribe-only — populates the word cache and returns the word list,
 * without burning subtitles. Used by the UI to preview exact timings so the
 * user can align Image Overlay start/end to specific words ("teeth", etc.).
 */
/**
 * Resolve a captions node's upstream video and return its transcript. Walks
 * incoming `video` edges back through the graph until it finds a node with
 * data.outputUrl pointing to a file on disk. This lets the UI call
 * "Transcribe only" without having to know the upstream URL itself.
 */
router.post('/api/captions/transcript-by-node', async (req, res) => {
  const { nodeId } = req.body ?? {};
  if (!nodeId || typeof nodeId !== 'string') {
    return res.status(400).json({ ok: false, error: 'nodeId required' });
  }
  // Lazy import to avoid cycle.
  const { upstreamFor } = await import('../lib/graphStore.js');

  // Walk upstream up to 12 hops looking for any node with outputUrl.
  let cursor: string | null = nodeId;
  let videoUrl: string | undefined;
  for (let i = 0; i < 12 && cursor; i++) {
    const up = upstreamFor(cursor, 'video');
    if (!up) break;
    const d = up.data as { outputUrl?: string };
    if (d.outputUrl) { videoUrl = d.outputUrl; break; }
    cursor = up.id;
  }
  if (!videoUrl) {
    return res.status(400).json({ ok: false, error: 'no upstream video with outputUrl found — run upstream nodes first' });
  }
  const path = localPath(videoUrl);
  if (!path || !existsSync(path)) {
    return res.status(400).json({ ok: false, error: `upstream video not found: ${videoUrl}` });
  }
  try {
    let words = readCachedWords(path);
    let cached = !!words;
    if (!words) {
      const ts = Date.now();
      const tmp = join(tmpdir(), `tx-${ts}`);
      mkdirSync(tmp, { recursive: true });
      const audioPath = join(tmp, 'audio.mp3');
      await run(ffmpegBin(), ['-y', '-i', path, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', audioPath]);
      const r = await transcribeToWords(audioPath);
      words = r.words;
      writeCachedWords(path, words);
    }
    res.json({ ok: true, words, cached, sourceUrl: videoUrl });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post('/api/captions/transcript', async (req, res) => {
  const { videoUrl } = req.body ?? {};
  if (!videoUrl || typeof videoUrl !== 'string') {
    return res.status(400).json({ ok: false, error: 'videoUrl required' });
  }
  const path = localPath(videoUrl);
  if (!path || !existsSync(path)) {
    return res.status(400).json({ ok: false, error: `video not found: ${videoUrl}` });
  }

  try {
    let words = readCachedWords(path);
    let cached = !!words;
    if (!words) {
      const ts = Date.now();
      const tmp = join(tmpdir(), `transcribe-${ts}`);
      mkdirSync(tmp, { recursive: true });
      const audioPath = join(tmp, 'audio.mp3');
      await run(ffmpegBin(), ['-y', '-i', path, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', audioPath]);
      const r = await transcribeToWords(audioPath);
      words = r.words;
      if (!words.length) throw new Error('whisper returned no words');
      writeCachedWords(path, words);
    }
    res.json({ ok: true, words, cached, count: words.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

/**
 * Find the first occurrence (case-insensitive, punctuation-tolerant) of a
 * given word in the cached transcript. Returns its start/end seconds —
 * used by Image Overlay's "auto-align" button.
 */
router.post('/api/captions/find-word', async (req, res) => {
  const { videoUrl, word } = req.body ?? {};
  if (!videoUrl || !word || typeof videoUrl !== 'string' || typeof word !== 'string') {
    return res.status(400).json({ ok: false, error: 'videoUrl + word required' });
  }
  const path = localPath(videoUrl);
  if (!path || !existsSync(path)) {
    return res.status(400).json({ ok: false, error: `video not found: ${videoUrl}` });
  }
  let words = readCachedWords(path);
  // Lazy-fetch transcript on first call so user doesn't need to "Transcribe"
  // separately first.
  if (!words) {
    try {
      const ts = Date.now();
      const tmp = join(tmpdir(), `findword-${ts}`);
      mkdirSync(tmp, { recursive: true });
      const audioPath = join(tmp, 'audio.mp3');
      await run(ffmpegBin(), ['-y', '-i', path, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', audioPath]);
      const r = await transcribeToWords(audioPath);
      words = r.words;
      writeCachedWords(path, words);
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(word);
  const match = words.find((w) => norm(w.text) === target);
  if (!match) return res.status(404).json({ ok: false, error: `word "${word}" not found in transcript` });
  res.json({ ok: true, start: match.start, end: match.end, text: match.text });
});

router.post('/api/captions/burn', async (req, res) => {
  const { videoUrl, preset, fontSize, marginV } = req.body ?? {};
  if (!videoUrl || typeof videoUrl !== 'string') {
    return res.status(400).json({ ok: false, error: 'videoUrl required' });
  }
  const path = localPath(videoUrl);
  if (!path || !existsSync(path)) {
    return res.status(400).json({ ok: false, error: 'video must be a local /output/ url for now' });
  }
  const opts: StyleOpts = {
    preset: (Object.keys(PRESETS) as CaptionPreset[]).includes(preset) ? preset : 'capcut-classic',
    fontSize: typeof fontSize === 'number' ? fontSize : 64,
    marginV: typeof marginV === 'number' ? marginV : 280,
  };

  const ts = Date.now();
  const tmp = join(tmpdir(), `cap-${ts}`);
  mkdirSync(tmp, { recursive: true });
  const audioPath = join(tmp, 'audio.mp3');
  const assPath = join(tmp, 'subs.ass');
  const outPath = join(VIDEO_DIR, `captioned-${ts}.mp4`);

  try {
    mkdirSync(VIDEO_DIR, { recursive: true });

    // 1+2. Get word timings — from cache if we've transcribed this clip
    // before, otherwise extract audio with ffmpeg and call whisper.
    let words = readCachedWords(path);
    let cached = !!words;
    if (!words) {
      await run(ffmpegBin(), ['-y', '-i', path, '-vn', '-acodec', 'libmp3lame', '-q:a', '4', audioPath]);
      const r = await transcribeToWords(audioPath);
      words = r.words;
      if (!words.length) throw new Error('whisper returned no words');
      writeCachedWords(path, words);
    }

    // 3. Group words → ASS file (CapCut-style fade+pop animations).
    // maxChars derived from font size so chunks never wrap to 2 lines.
    const maxChars = maxCharsForFont(opts.fontSize);
    const chunks = groupWords(words, 5, 2.0, maxChars);
    const assText = buildAss(chunks, opts);
    writeFileSync(assPath, assText, 'utf-8');

    // 4. Burn-in via libass (subtitles filter). Inside a filter graph `:`
    // separates options and `\` is the escape — colons in the absolute path
    // must be escaped, plus paths with spaces need single-quoting.
    const safe = assPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    await run(ffmpegBin(), ['-y', '-i', path, '-vf', `subtitles=filename=${safe}`, '-c:a', 'copy', outPath]);

    res.json({
      ok: true,
      url: `/output/videos/${outPath.split('/').pop()}`,
      path: outPath,
      chunks,
      preset: opts.preset,
      cached_transcript: cached,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
