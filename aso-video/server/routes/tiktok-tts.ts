import { Router } from 'express';
import { mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const router = Router();

const ROOT = resolve(import.meta.dirname, '..', '..');
const AUDIO_DIR = join(ROOT, 'output', 'audio');

// TikTok TTS unofficial endpoints — tried in order. weilbyte.dev died (DNS gone),
// gesserit.co/api/tiktok-tts is currently up and returns `audioUrl` as data URL.
const ENDPOINTS = [
  {
    url: 'https://gesserit.co/api/tiktok-tts',
    parse: async (r: Response) => {
      const j = (await r.json()) as { audioUrl?: string; error?: string };
      if (!j.audioUrl) throw new Error(j.error || 'no audioUrl');
      // data:audio/mp3;base64,XXXX
      const m = j.audioUrl.match(/^data:audio\/mp3;base64,(.+)$/);
      if (!m) throw new Error('audioUrl is not data:audio/mp3 base64');
      return m[1];
    },
    body: (text: string, voice: string) => ({ text, voice }),
  },
  {
    url: 'https://tiktok-tts.weilbyte.dev/api/generation',
    parse: async (r: Response) => {
      const j = (await r.json()) as { data?: string; success?: boolean };
      if (!j.success || !j.data) throw new Error('weilbyte returned no data');
      return j.data;
    },
    body: (text: string, voice: string) => ({ text, voice }),
  },
];

function splitSentences(text: string, max = 290): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) {
      out.push(s);
    } else {
      // hard split on ~max
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
    }
  }
  return out;
}

async function generateChunkBase64(
  text: string,
  voice: string,
): Promise<string> {
  let lastErr: unknown = null;
  for (const ep of ENDPOINTS) {
    try {
      const r = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ep.body(text, voice)),
      });
      if (!r.ok) {
        lastErr = new Error(`${ep.url} → ${r.status}`);
        continue;
      }
      return await ep.parse(r);
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw new Error(
    `all TikTok TTS endpoints failed: ${(lastErr as Error)?.message ?? lastErr}`,
  );
}

function concatMp3s(inputs: string[], output: string): void {
  if (inputs.length === 1) {
    // simple copy via fs
    writeFileSync(output, readFileSync(inputs[0]));
    return;
  }
  const listFile = join(tmpdir(), `tts-concat-${Date.now()}.txt`);
  writeFileSync(
    listFile,
    inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
  );
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output],
    { stdio: 'pipe' },
  );
  try { unlinkSync(listFile); } catch {}
  if (r.status !== 0) {
    throw new Error(`ffmpeg concat failed: ${r.stderr.toString()}`);
  }
}

export async function generateTikTokTTS(
  text: string,
  slug: string,
  voice = 'en_female_emotional',
): Promise<{ url: string; path: string }> {
  mkdirSync(AUDIO_DIR, { recursive: true });
  const outPath = join(AUDIO_DIR, `${slug}.mp3`);
  const chunks = splitSentences(text);
  const tmpFiles: string[] = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const b64 = await generateChunkBase64(chunks[i], voice);
      const f = join(tmpdir(), `tts-${slug}-${i}.mp3`);
      writeFileSync(f, Buffer.from(b64, 'base64'));
      tmpFiles.push(f);
    }
    concatMp3s(tmpFiles, outPath);
  } finally {
    for (const f of tmpFiles) {
      try { unlinkSync(f); } catch {}
    }
  }
  return { url: `/output/audio/${slug}.mp3`, path: outPath };
}

router.post('/api/voiceover/tiktok-tts', async (req, res) => {
  const { text, voice = 'en_female_emotional', slug } = req.body ?? {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'text required' });
  }
  const finalSlug =
    typeof slug === 'string' && slug ? slug : `tts-${Date.now()}`;
  try {
    const out = await generateTikTokTTS(text, finalSlug, voice);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
