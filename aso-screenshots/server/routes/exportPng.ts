import type { Request, Response } from 'express';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Buffer } from 'node:buffer';
import { homedir, platform } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

interface SavePngBody {
  /** PNG data URI from html-to-image. */
  dataUri: string;
  /** Filename within the output folder (already sanitized by client). */
  filename: string;
  /** Output folder root — absolute path or `~/...`. Created recursively. */
  folder: string;
  /** Optional sub-path inside folder for organization (e.g. locale code). */
  subPath?: string;
}

function expandHome(p: string): string {
  if (!p) return '';
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

export async function exportSavePng(req: Request, res: Response) {
  const body = req.body as SavePngBody;
  if (!body?.dataUri || !body?.filename || !body?.folder) {
    res.status(400).json({ error: 'dataUri + filename + folder required' });
    return;
  }
  try {
    const expanded = expandHome(body.folder);
    const root = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
    // Sanitize filename — strip path separators and weird chars.
    const safeName = body.filename.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    const safeSub = body.subPath
      ? body.subPath.replace(/[\\:*?"<>|]/g, '_').replace(/\.\./g, '_')
      : '';
    const dir = safeSub ? join(root, safeSub) : root;
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, safeName);
    // Decode base64 data URI.
    const m = body.dataUri.match(/^data:image\/(?:png|jpeg);base64,(.+)$/);
    if (!m) {
      res.status(400).json({ error: 'expected PNG or JPEG data URI' });
      return;
    }
    const buf = Buffer.from(m[1], 'base64');
    await writeFile(filePath, new Uint8Array(buf));
    res.json({ ok: true, path: filePath, bytes: buf.byteLength });
  } catch (e) {
    console.error('[export] save failed:', (e as Error).message);
    res.status(500).json({ error: (e as Error).message });
  }
}

/** Open the native macOS folder picker via osascript. Returns the chosen
 *  path or null when the user cancels. Other platforms get a 501 — the dev
 *  tool is mac-only for now. */
export async function exportPickFolder(_req: Request, res: Response) {
  if (platform() !== 'darwin') {
    res.status(501).json({ error: 'native folder picker only available on macOS' });
    return;
  }
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'try',
      '-e',
      '  set f to choose folder with prompt "Pick output folder for screenshots"',
      '-e',
      '  return POSIX path of f',
      '-e',
      'on error number -128',
      '-e',
      '  return ""',
      '-e',
      'end try',
    ]);
    const folder = stdout.trim().replace(/\/$/, '');
    if (!folder) {
      res.json({ ok: true, cancelled: true });
      return;
    }
    res.json({ ok: true, folder });
  } catch (e) {
    console.error('[export] pick failed:', (e as Error).message);
    res.status(500).json({ error: (e as Error).message });
  }
}

export async function exportEnsureFolder(req: Request, res: Response) {
  try {
    const folder = expandHome((req.body?.folder ?? '') as string);
    if (!folder) {
      res.status(400).json({ error: 'folder required' });
      return;
    }
    await mkdir(folder, { recursive: true });
    res.json({ ok: true, folder });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

// dirname imported but only used if we wanted to derive parent; leave for future use.
void dirname;
