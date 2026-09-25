import type Database from 'better-sqlite3';

/** Client keys are deliberately boring: safe in headers/logs and bounded in DB. */
export function normalizeIdempotencyKey(value: unknown, field = 'idempotencyKey'): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  const key = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(key)) {
    throw new Error(`${field} must be 8–128 letters, digits, _ or -`);
  }
  return key;
}

/**
 * Atomically reserve a delivery key before writing the append-only entity.
 * A precise key is scoped to its app and fact type; another app can safely
 * reuse the same client-generated UUID.
 */
export function idempotentCreate<T extends { id: number }>(
  database: Database.Database,
  scope: string,
  appId: string,
  key: string,
  create: () => T,
  load: (id: number) => T | null,
): { value: T; created: boolean } {
  const transaction = database.transaction(() => {
    const existing = database.prepare(`
      SELECT entity_id AS entityId FROM aso_idempotency_keys
       WHERE scope = ? AND app_id = ? AND idempotency_key = ?
    `).get(scope, appId, key) as { entityId: number } | undefined;
    if (existing) {
      const value = load(existing.entityId);
      if (!value) throw new Error('idempotency record refers to a missing entity');
      return { value, created: false };
    }
    // The transaction rolls this reservation back if `create` fails, so a
    // partial/failed write can never permanently poison a delivery key.
    const created = create();
    database.prepare(`
      INSERT INTO aso_idempotency_keys (scope, app_id, idempotency_key, entity_id)
      VALUES (?, ?, ?, ?)
    `).run(scope, appId, key, created.id);
    return { value: created, created: true };
  });
  return transaction();
}
