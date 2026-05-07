// GET /api/library — list all generated/uploaded media in output/.
// DELETE /api/library — remove a single file. Path must live inside output/.
import { Router } from 'express';
import { readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const OUTPUT = join(ROOT, 'output');

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VID_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const AUD_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']);

function kindFor(filename: string): 'image' | 'video' | 'audio' | null {
  const i = filename.lastIndexOf('.');
  if (i < 0) return null;
  const ext = filename.slice(i).toLowerCase();
  if (IMG_EXT.has(ext)) return 'image';
  if (VID_EXT.has(ext)) return 'video';
  if (AUD_EXT.has(ext)) return 'audio';
  return null;
}

interface Entry {
  kind: 'image' | 'video' | 'audio';
  filename: string;
  url: string;
  size_bytes: number;
  mtime: number;
}

function scan(subdir: string, urlBase: string, out: Entry[]): void {
  const dir = join(OUTPUT, subdir);
  if (!existsSync(dir)) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const f of entries) {
    const full = join(dir, f);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    const k = kindFor(f);
    if (!k) continue;
    out.push({
      kind: k,
      filename: f,
      url: `${urlBase}/${f}`,
      size_bytes: st.size,
      mtime: st.mtimeMs,
    });
  }
}

// DELETE /api/library?url=/output/images/foo.png — only paths under
// output/ are accepted (no traversal outside the project).
router.delete('/api/library', (req, res) => {
  const url = String(req.query.url ?? req.body?.url ?? '');
  if (!url.startsWith('/output/')) {
    return res.status(400).json({ ok: false, error: 'url must start with /output/' });
  }
  const abs = resolve(OUTPUT, url.slice('/output/'.length));
  if (!abs.startsWith(OUTPUT + '/')) {
    return res.status(400).json({ ok: false, error: 'path traversal blocked' });
  }
  if (!existsSync(abs)) return res.status(404).json({ ok: false, error: 'not found' });
  try {
    unlinkSync(abs);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.get('/api/library', (_req, res) => {
  const items: Entry[] = [];
  scan('images', '/output/images', items);
  scan('videos', '/output/videos', items);
  scan('audio', '/output/audio', items);
  scan('uploads', '/output/uploads', items);
  scan('audio/voices', '/output/audio/voices', items);
  items.sort((a, b) => b.mtime - a.mtime);
  const total_bytes = items.reduce((s, i) => s + i.size_bytes, 0);
  res.json({ ok: true, items, total_files: items.length, total_bytes });
});

export default router;
