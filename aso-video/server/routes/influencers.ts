// File-backed library of saved "influencers" — character presets pairing a
// generated portrait with the prompt that produced it. Lets the user re-spawn
// the same character later for follow-up ads.
import { Router } from 'express';
import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';

const router = Router();

const STORE = join(homedir(), '.aso-studio', 'video', 'influencers');
const VIDEO_ROOT = resolve(import.meta.dirname, '..', '..');
// Curated examples shipped in the repo at `aso-video/influencer/`. Anything
// placed there shows up alongside the user's own saved characters after a
// git pull — JSON sits next to its preview image so the whole pair is one
// drop-in unit. User names win on collision.
const SEED_STORE = join(VIDEO_ROOT, 'influencer');

mkdirSync(STORE, { recursive: true });

interface Influencer {
  name: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  quality?: string;
  imageUrl: string;       // public path: /output/images/...
  savedAt: number;
}

function safeName(n: string): string {
  return String(n || '').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 64) || `inf-${Date.now()}`;
}

router.get('/api/influencers', (_req, res) => {
  try {
    // User saves win when names collide — their edits override the example.
    const seen = new Set<string>();
    const items: Influencer[] = [];
    for (const dir of [STORE, SEED_STORE]) {
      let files: string[] = [];
      try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); }
      catch { /* dir may not exist */ continue; }
      for (const f of files) {
        if (seen.has(f)) continue;
        seen.add(f);
        try {
          items.push(JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Influencer);
        } catch { /* skip corrupt file */ }
      }
    }
    items.sort((a, b) => b.savedAt - a.savedAt);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post('/api/influencers/save', (req, res) => {
  const { name, prompt, model, aspectRatio, quality, imageUrl } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ ok: false, error: 'name required' });
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ ok: false, error: 'prompt required' });
  if (!imageUrl || typeof imageUrl !== 'string') return res.status(400).json({ ok: false, error: 'imageUrl required' });

  const safe = safeName(name);
  const rec: Influencer = {
    name: safe,
    prompt,
    model: String(model ?? 'gpt-image-2'),
    aspectRatio: String(aspectRatio ?? '9:16'),
    quality: quality ? String(quality) : undefined,
    imageUrl,
    savedAt: Date.now(),
  };
  try {
    writeFileSync(join(STORE, `${safe}.json`), JSON.stringify(rec, null, 2), { mode: 0o600 });
    res.json({ ok: true, item: rec });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.delete('/api/influencers/:name', (req, res) => {
  const safe = safeName(req.params.name);
  const path = join(STORE, `${safe}.json`);
  if (!existsSync(path)) return res.status(404).json({ ok: false, error: 'not found' });
  try {
    unlinkSync(path);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// (Optional) serve the persisted image bytes if the user moves the project —
// /output/images/... is the canonical URL but if file is missing we 404.
export default router;
export { STORE as INFLUENCERS_DIR };
