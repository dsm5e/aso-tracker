import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const STUDIO_HOME = process.env.ASO_STUDIO_HOME
  ? resolve(process.env.ASO_STUDIO_HOME)
  : join(homedir(), '.aso-studio');

const KEYS_PATH = join(STUDIO_HOME, 'keys.json');

/**
 * Keys the studio itself uses for its public features (image gen + translation).
 * Anything else (ASC, Apple Ads, social posting, etc.) is configured by the
 * tools that actually need them — not stored here.
 */
export const KEY_NAMES = [
  'FAL_API_KEY',
  'OPENAI_API_KEY',
] as const;

export type KeyName = (typeof KEY_NAMES)[number];

type KeysFile = Partial<Record<KeyName, string>>;

let cache: Partial<Record<KeyName, string | null>> = {};

function ensureHome(): void {
  if (!existsSync(STUDIO_HOME)) mkdirSync(STUDIO_HOME, { recursive: true });
}

function readKeysFile(): KeysFile {
  if (!existsSync(KEYS_PATH)) return {};
  try { return JSON.parse(readFileSync(KEYS_PATH, 'utf8')) as KeysFile; }
  catch { return {}; }
}

function writeKeysFile(next: KeysFile): void {
  ensureHome();
  writeFileSync(KEYS_PATH, JSON.stringify(next, null, 2));
  // mode 0600 = owner read/write only. Best effort — chmodSync silently fails
  // on Windows, which is fine since the threat model assumes Unix dev boxes.
  try { chmodSync(KEYS_PATH, 0o600); } catch {/* not POSIX */}
}

/**
 * Resolve an API key. Order:
 *   1. process.env.<NAME>           — for CI / direct override
 *   2. ~/.aso-studio/keys.json      — set via Settings UI (mode 600)
 *   3. throw                        — caller surfaces "configure key in Settings"
 */
export function getKey(name: KeyName): string {
  if (cache[name]) return cache[name] as string;

  if (process.env[name]) {
    cache[name] = process.env[name]!.trim();
    return cache[name] as string;
  }

  const fromFile = readKeysFile()[name];
  if (fromFile && fromFile.trim()) {
    cache[name] = fromFile.trim();
    return cache[name] as string;
  }

  throw new Error(
    `Missing ${name}. Set it in Settings (top-right ⚙) or export ${name} as an env var.`
  );
}

export function setKey(name: KeyName, value: string | null): void {
  const next = readKeysFile();
  if (value === null || value.trim() === '') delete next[name];
  else next[name] = value.trim();
  writeKeysFile(next);
  // Bust cache for this key so the next getKey() reads fresh.
  delete cache[name];
}

export interface KeyStatus {
  set: boolean;
  masked: string | null;
  source: 'env' | 'keys.json' | null;
}

export function getKeyStatus(): Record<KeyName, KeyStatus> {
  const out = {} as Record<KeyName, KeyStatus>;
  const file = readKeysFile();
  for (const name of KEY_NAMES) {
    let value: string | null = null;
    let source: 'env' | 'keys.json' | null = null;
    if (process.env[name]) { value = process.env[name]!.trim(); source = 'env'; }
    else if (file[name]) { value = file[name]!.trim(); source = 'keys.json'; }
    out[name] = {
      set: !!value,
      masked: value ? maskKey(value) : null,
      source,
    };
  }
  return out;
}

function maskKey(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length);
  return value.slice(0, 4) + '••••' + value.slice(-4);
}
