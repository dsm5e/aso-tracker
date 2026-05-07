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
`);

export interface SnapshotRow {
  date: string;
  app: string;
  locale: string;
  keyword: string;
  position: number | null;
  total: number;
  top5: Array<{ name: string; id: string; dev: string }>;
  error?: string;
}

export function insertSnapshot(r: SnapshotRow) {
  const stmt = db.prepare(`
    INSERT INTO snapshots (date, app, locale, keyword, position, total, top5_json, error)
    VALUES (@date, @app, @locale, @keyword, @position, @total, @top5_json, @error)
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
  });
}

export function insertSnapshotsBatch(rows: SnapshotRow[]) {
  const stmt = db.prepare(`
    INSERT INTO snapshots (date, app, locale, keyword, position, total, top5_json, error)
    VALUES (@date, @app, @locale, @keyword, @position, @total, @top5_json, @error)
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
      });
    }
  });
  tx(rows);
}
