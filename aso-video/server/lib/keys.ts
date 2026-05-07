import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const STUDIO_HOME = process.env.ASO_STUDIO_HOME
  ? resolve(process.env.ASO_STUDIO_HOME)
  : join(homedir(), '.aso-studio');

const KEYS_PATH = join(STUDIO_HOME, 'keys.json');

export type KeyName = 'FAL_API_KEY' | 'OPENAI_API_KEY';

function readKeysFile(): Record<string, string | undefined> {
  if (!existsSync(KEYS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function getKey(name: KeyName): string {
  if (process.env[name]) return process.env[name]!.trim();
  const fromFile = readKeysFile()[name];
  if (fromFile && fromFile.trim()) return fromFile.trim();
  throw new Error(
    `Missing ${name}. Set it in ${KEYS_PATH} or export ${name} as env var.`,
  );
}
