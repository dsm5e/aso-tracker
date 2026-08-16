import { Router } from 'express';
import { fal } from '@fal-ai/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getKey } from '../lib/keys.js';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const AUDIO_DIR = join(ROOT, 'output', 'audio');
const MODEL = 'fal-ai/elevenlabs/tts/eleven-v3';

let configured = false;
function configure() {
  if (configured) return;
  fal.config({ credentials: getKey('FAL_API_KEY') });
  configured = true;
}

router.post('/api/voiceover/fal-elevenlabs', async (req, res) => {
  const { text, voice = 'Aria', slug = `fal-eleven-${Date.now()}` } = req.body ?? {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'text required' });
  }
  try {
    configure();
    mkdirSync(AUDIO_DIR, { recursive: true });
    const result = await fal.subscribe(MODEL, {
      input: {
        text,
        voice,
        stability: 0.38,
        timestamps: true,
        apply_text_normalization: 'auto',
        language_code: 'en',
      },
      logs: true,
    });
    const data = (result as { data?: any }).data ?? result;
    const audioUrl = data.audio?.url;
    if (!audioUrl) throw new Error('ElevenLabs returned no audio URL');
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) throw new Error(`audio download failed: ${audioResponse.status}`);
    const filename = `${slug}.mp3`;
    const timestampsFilename = `${slug}.timestamps.json`;
    writeFileSync(join(AUDIO_DIR, filename), Buffer.from(await audioResponse.arrayBuffer()));
    writeFileSync(join(AUDIO_DIR, timestampsFilename), `${JSON.stringify(data.timestamps ?? [], null, 2)}\n`);
    res.json({
      ok: true,
      url: `/output/audio/${filename}`,
      timestampsUrl: `/output/audio/${timestampsFilename}`,
      timestamps: data.timestamps ?? [],
      voice,
      cost: text.length / 1000 * 0.10,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

export default router;
