import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { idempotentCreate, normalizeIdempotencyKey } from './idempotency.js';

function fixture() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE entities (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL);
    CREATE TABLE aso_idempotency_keys (
      scope TEXT NOT NULL, app_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      entity_id INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (scope, app_id, idempotency_key)
    );
  `);
  const create = (value: string) => {
    const result = database.prepare('INSERT INTO entities (value) VALUES (?)').run(value);
    return { id: Number(result.lastInsertRowid), value };
  };
  const load = (id: number) => database.prepare('SELECT id, value FROM entities WHERE id = ?').get(id) as { id: number; value: string } | undefined ?? null;
  return { database, create, load };
}

test('idempotency key returns the original capture, scopes by app, and rolls back a failed first delivery', () => {
  const { database, create, load } = fixture();
  const first = idempotentCreate(database, 'paid-observation', 'medscan', 'client:delivery_123', () => create('first'), load);
  const retry = idempotentCreate(database, 'paid-observation', 'medscan', 'client:delivery_123', () => create('should-not-exist'), load);
  const otherApp = idempotentCreate(database, 'paid-observation', 'another-app', 'client:delivery_123', () => create('other-app'), load);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.value.id, first.value.id);
  assert.equal(otherApp.created, true);
  const rowCount = database.prepare('SELECT COUNT(*) AS count FROM entities').get() as { count: number };
  assert.equal(rowCount.count, 2);

  assert.throws(() => idempotentCreate(database, 'metadata-snapshot', 'medscan', 'client:failing_12', () => {
    throw new Error('disk full');
  }, load), /disk full/);
  const recovered = idempotentCreate(database, 'metadata-snapshot', 'medscan', 'client:failing_12', () => create('after-retry'), load);
  assert.equal(recovered.created, true);
});

test('idempotency keys reject oversized and unsafe values', () => {
  assert.equal(normalizeIdempotencyKey('capture_123'), 'capture_123');
  assert.throws(() => normalizeIdempotencyKey('../../escape'), /idempotencyKey/);
  assert.throws(() => normalizeIdempotencyKey('short'), /idempotencyKey/);
});
