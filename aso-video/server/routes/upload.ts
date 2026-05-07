import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, renameSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

const router = Router();
const ROOT = resolve(import.meta.dirname, '..', '..');
const UPLOAD_DIR = join(ROOT, 'output', 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']);

function makeUploader(allowedMime: Set<string>, maxBytes: number) {
  return multer({
    dest: UPLOAD_DIR,
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      if (!allowedMime.has(file.mimetype)) return cb(new Error(`invalid mime type ${file.mimetype}`));
      cb(null, true);
    },
  });
}

const imageUpload = makeUploader(IMAGE_MIME, 10 * 1024 * 1024);
const videoUpload = makeUploader(VIDEO_MIME, 200 * 1024 * 1024); // 200MB cap

router.post('/api/upload/image', (req, res) => {
  imageUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: (err as Error).message });
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ ok: false, error: 'no file uploaded' });

    const ext = (extname(file.originalname).toLowerCase()) || '.jpg';
    if (!IMAGE_EXT.has(ext)) {
      return res.status(400).json({ ok: false, error: `invalid extension ${ext}` });
    }
    const id = randomUUID();
    const filename = `upload-${id}${ext}`;
    const newPath = join(UPLOAD_DIR, filename);
    renameSync(file.path, newPath);
    res.json({ ok: true, url: `/output/uploads/${filename}`, path: newPath });
  });
});

router.post('/api/upload/video', (req, res) => {
  videoUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: (err as Error).message });
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ ok: false, error: 'no file uploaded' });

    const ext = (extname(file.originalname).toLowerCase()) || '.mp4';
    if (!VIDEO_EXT.has(ext)) {
      return res.status(400).json({ ok: false, error: `invalid extension ${ext}` });
    }
    const id = randomUUID();
    const filename = `upload-${id}${ext}`;
    const newPath = join(UPLOAD_DIR, filename);
    renameSync(file.path, newPath);
    res.json({ ok: true, url: `/output/uploads/${filename}`, path: newPath });
  });
});

export default router;
