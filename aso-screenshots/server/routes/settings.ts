import type { Request, Response } from 'express';
import { getKeyStatus, setKey, type KeyName } from '../lib/keys.js';

const VALID_KEYS: KeyName[] = ['FAL_API_KEY', 'OPENAI_API_KEY'];

export function getKeysStatus(_req: Request, res: Response) {
  res.json(getKeyStatus());
}

export function updateKey(req: Request, res: Response) {
  const { name, value } = req.body as { name?: string; value?: string | null };
  if (!name || !VALID_KEYS.includes(name as KeyName)) {
    return res.status(400).json({ error: `name must be one of ${VALID_KEYS.join(', ')}` });
  }
  setKey(name as KeyName, value ?? null);
  res.json(getKeyStatus());
}
