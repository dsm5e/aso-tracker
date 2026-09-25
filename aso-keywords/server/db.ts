import Database from 'better-sqlite3';
import { DB_PATH, ensureKeywordsHome, migrateLegacyData } from './paths.js';

migrateLegacyData();
ensureKeywordsHome();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    app        TEXT NOT NULL,
    locale     TEXT NOT NULL,
    keyword    TEXT NOT NULL,
    position   INTEGER,
    total      INTEGER,
    top5_json  TEXT,
    error      TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS ix_snapshots_date_app ON snapshots(date, app);
  CREATE INDEX IF NOT EXISTS ix_snapshots_app_kw_locale ON snapshots(app, keyword, locale);
  CREATE INDEX IF NOT EXISTS ix_snapshots_app_locale_kw_date ON snapshots(app, locale, keyword, date);

  CREATE TABLE IF NOT EXISTS metadata_changes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    app        TEXT NOT NULL,
    locale     TEXT NOT NULL,
    version    TEXT,
    title      TEXT,
    subtitle   TEXT,
    keywords   TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS ix_metachanges_app_date ON metadata_changes(app, date);

  CREATE TABLE IF NOT EXISTS store_search_cache (
    country     TEXT NOT NULL,
    term        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    fetched_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (country, term)
  );
  CREATE INDEX IF NOT EXISTS ix_store_search_cache_expiry ON store_search_cache(expires_at);

  CREATE TABLE IF NOT EXISTS ad_repository_cache (
    app_id       TEXT NOT NULL,
    date_preset  TEXT NOT NULL,
    payload      TEXT NOT NULL,
    fetched_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    PRIMARY KEY (app_id, date_preset)
  );
  CREATE INDEX IF NOT EXISTS ix_ad_repository_cache_expiry ON ad_repository_cache(expires_at);

  -- A keyword-level paid result is not available from Apple's public APIs.
  -- These append-only observations deliberately keep the original capture and
  -- source so an observed appearance can never be presented as private SOV.
  CREATE TABLE IF NOT EXISTS paid_search_observations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id          TEXT NOT NULL,
    locale          TEXT NOT NULL,
    keyword         TEXT NOT NULL,
    observed_at     TEXT NOT NULL,
    source          TEXT NOT NULL,
    evidence_url    TEXT,
    evidence_quality TEXT NOT NULL,
    paid_results_json TEXT NOT NULL,
    notes           TEXT,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS ix_paid_observations_scope
    ON paid_search_observations(app_id, locale, keyword, observed_at DESC);
  CREATE INDEX IF NOT EXISTS ix_paid_observations_app_date
    ON paid_search_observations(app_id, observed_at DESC);

  -- Public App Store fields vary by storefront.  Store every declared or
  -- fetched revision instead of mutating a current-state row, so ASO changes
  -- retain an auditable before/after trail.
  CREATE TABLE IF NOT EXISTS public_metadata_snapshots (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id           TEXT NOT NULL,
    locale           TEXT NOT NULL,
    observed_at      TEXT NOT NULL,
    version          TEXT,
    title            TEXT,
    subtitle         TEXT,
    keywords         TEXT,
    description      TEXT,
    category         TEXT,
    seller_name      TEXT,
    store_url        TEXT,
    icon_url         TEXT,
    screenshots_json TEXT NOT NULL DEFAULT '[]',
    source           TEXT NOT NULL,
    source_url       TEXT,
    fingerprint      TEXT NOT NULL,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS ix_metadata_snapshots_scope
    ON public_metadata_snapshots(app_id, locale, observed_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS ix_metadata_snapshots_fingerprint
    ON public_metadata_snapshots(app_id, locale, fingerprint, observed_at DESC);

  -- Experiments are archived, never deleted.  Their window definitions are
  -- kept beside the metadata diff instead of inferred from changing rankings.
  CREATE TABLE IF NOT EXISTS aso_experiments (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id                TEXT NOT NULL,
    name                  TEXT NOT NULL,
    status                TEXT NOT NULL,
    hypothesis            TEXT,
    locales_json          TEXT NOT NULL DEFAULT '[]',
    metadata_changes_json TEXT NOT NULL DEFAULT '[]',
    notes                 TEXT,
    before_start          TEXT,
    before_end            TEXT,
    after_start           TEXT,
    after_end             TEXT,
    created_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    archived_at           INTEGER
  );
  CREATE INDEX IF NOT EXISTS ix_aso_experiments_app_status
    ON aso_experiments(app_id, archived_at, updated_at DESC);

  CREATE TABLE IF NOT EXISTS aso_experiment_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id  INTEGER NOT NULL,
    app_id         TEXT NOT NULL,
    action         TEXT NOT NULL,
    payload_json   TEXT NOT NULL,
    created_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS ix_aso_experiment_events_experiment
    ON aso_experiment_events(experiment_id, created_at ASC);

  -- Delivery deduplication is separate from the append-only fact tables.
  -- This avoids unsafe uniqueness migrations over historical observations
  -- while making a retried API request return its original record.
  CREATE TABLE IF NOT EXISTS aso_idempotency_keys (
    scope           TEXT NOT NULL,
    app_id          TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    entity_id       INTEGER NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (scope, app_id, idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS ix_aso_idempotency_entity
    ON aso_idempotency_keys(scope, app_id, entity_id);
`);

// Rank source per snapshot row (P0 2026-09-25). Rows written before the App
// Store (MZStore) source existed all came from the iTunes Search API.
{
  const cols = db.prepare(`PRAGMA table_info(snapshots)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'source')) {
    db.exec(`ALTER TABLE snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'itunes'`);
  }
}

// Dual measurement of a fixed probe set: both rank sources for the same
// (app, locale, keyword) and day. Kept out of the snapshots table so history,
// matrix and "latest row" queries never see a second row per keyword.
db.exec(`
  CREATE TABLE IF NOT EXISTS rank_source_probes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    app        TEXT NOT NULL,
    locale     TEXT NOT NULL,
    keyword    TEXT NOT NULL,
    source     TEXT NOT NULL,
    position   INTEGER,
    total      INTEGER,
    ms         INTEGER,
    error      TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS ix_rank_source_probes_pair
    ON rank_source_probes(app, locale, keyword, date, source);
`);

export interface SnapshotRow {
  date: string;
  app: string;
  locale: string;
  keyword: string;
  position: number | null;
  total: number;
  top5: Array<{ name: string; id: string; dev: string; tid?: number; pos?: number }>;
  error?: string;
  /** Which rank source produced the row; defaults to 'itunes'. */
  source?: 'appstore' | 'itunes';
}

export function insertSnapshot(r: SnapshotRow) {
  const stmt = db.prepare(`
    INSERT INTO snapshots (date, app, locale, keyword, position, total, top5_json, error, source)
    VALUES (@date, @app, @locale, @keyword, @position, @total, @top5_json, @error, @source)
  `);
  stmt.run({
    date: r.date,
    app: r.app,
    locale: r.locale,
    keyword: r.keyword,
    position: r.position,
    total: r.total,
    top5_json: JSON.stringify(r.top5 || []),
    error: r.error || null,
    source: r.source ?? 'itunes',
  });
}

export function insertSnapshotsBatch(rows: SnapshotRow[]) {
  const stmt = db.prepare(`
    INSERT INTO snapshots (date, app, locale, keyword, position, total, top5_json, error, source)
    VALUES (@date, @app, @locale, @keyword, @position, @total, @top5_json, @error, @source)
  `);
  const tx = db.transaction((rs: SnapshotRow[]) => {
    for (const r of rs) {
      stmt.run({
        date: r.date,
        app: r.app,
        locale: r.locale,
        keyword: r.keyword,
        position: r.position,
        total: r.total,
        top5_json: JSON.stringify(r.top5 || []),
        error: r.error || null,
        source: r.source ?? 'itunes',
      });
    }
  });
  tx(rows);
}
