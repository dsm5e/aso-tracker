// Resolves a possibly-local URL into a URL fal.ai's workers can fetch.
//
// Local files (served by us at /output/... or http://localhost:5191/output/...)
// are uploaded to fal.storage; public URLs pass through unchanged.
import { fal } from '@fal-ai/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { getKey } from './keys.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

// Self-contained config — fal is a singleton and the SAME instance is used
// across every module that imports it, but `fal.config()` has to be called
// at least once per process. Doing it here means callers can use toFalUrl()
// without remembering to configure the client first.
let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  fal.config({ credentials: getKey('FAL_API_KEY') });
  configured = true;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function localPath(url: string): string | null {
  // /output/foo.png  → ROOT/output/foo.png
  if (url.startsWith('/output/')) return join(ROOT, url);
  // http://localhost:5191/output/foo.png → ROOT/output/foo.png
  const m = url.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.+)$/);
  if (m) return join(ROOT, m[3]);
  return null;
}

/**
 * If `url` points at a local file (served by this app), upload its bytes to
 * fal.storage and return the public URL. Remote URLs are returned unchanged.
 */
export async function toFalUrl(url: string): Promise<string> {
  if (!url) return url;
  const path = localPath(url);
  if (!path) return url;
  if (!existsSync(path)) throw new Error(`local file not found: ${path}`);
  ensureConfigured();

  const buf = readFileSync(path);
  const ext = extname(path).toLowerCase();
  const mime = MIME[ext] ?? 'application/octet-stream';
  const filename = path.split('/').pop() ?? 'upload';

  const blob = new Blob([new Uint8Array(buf)], { type: mime });
  const file = new File([blob], filename, { type: mime });
  return await fal.storage.upload(file);
}

/** Map an array of URLs to fal-accessible URLs in parallel. */
export async function toFalUrls(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(toFalUrl));
}
