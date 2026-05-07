import { Router } from 'express';
import { fal } from '@fal-ai/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getKey } from '../lib/keys.js';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');

let configured = false;
function configure() {
  if (configured) return;
  fal.config({ credentials: getKey('FAL_API_KEY') });
  configured = true;
}

export type Word = { text: string; start: number; end: number };

// Models tried in order until one accepts the request.
const MODELS = ['fal-ai/wizper', 'fal-ai/whisper'];

async function uploadIfLocal(audioUrl: string): Promise<string> {
  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    return audioUrl;
  }
  // local path or "/output/..." served path — read file & upload to fal storage
  let abs = audioUrl;
  if (audioUrl.startsWith('/output/')) abs = join(ROOT, audioUrl.replace(/^\//, ''));
  if (!existsSync(abs)) throw new Error(`audio file not found: ${abs}`);
  const buf = readFileSync(abs);
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  const url = await fal.storage.upload(
    new File([blob], `audio-${Date.now()}.mp3`, { type: 'audio/mpeg' }),
  );
  return url;
}

export async function transcribeToWords(audioUrl: string): Promise<{
  words: Word[];
  model: string;
}> {
  configure();
  const url = await uploadIfLocal(audioUrl);

  let lastErr: unknown = null;
  for (const model of MODELS) {
    try {
      const result = await fal.subscribe(model, {
        input: {
          audio_url: url,
          task: 'transcribe',
          language: 'en',
          chunk_level: 'word',
          version: '3',
        },
      });
      const data = (result as { data?: any }).data ?? result;
      const chunks: Array<{ text?: string; timestamp?: [number, number] }> =
        data.chunks ?? data.words ?? [];
      const words: Word[] = chunks
        .filter((c) => c.timestamp && c.text)
        .map((c) => ({
          text: (c.text as string).trim(),
          start: (c.timestamp as [number, number])[0],
          end: (c.timestamp as [number, number])[1],
        }));
      if (!words.length) throw new Error(`${model}: empty word list`);
      return { words, model };
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw new Error(
    `whisper transcription failed across models: ${(lastErr as Error)?.message ?? lastErr}`,
  );
}

router.post('/api/whisper/transcribe', async (req, res) => {
  const { audioUrl } = req.body ?? {};
  if (!audioUrl || typeof audioUrl !== 'string') {
    return res.status(400).json({ ok: false, error: 'audioUrl required' });
  }
  try {
    const { words, model } = await transcribeToWords(audioUrl);
    res.json({ ok: true, model, words });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
