import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

let db: Database.Database | null = null;

export function openDb(dataDir: string): Database.Database {
  if (db) return db;
  mkdirSync(dataDir, { recursive: true });
  db = new Database(resolve(dataDir, "asa-ads.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("DB not opened — call openDb() first");
  return db;
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS asa_campaigns (
      id INTEGER PRIMARY KEY,
      org_id INTEGER NOT NULL,
      app_id INTEGER NOT NULL,
      app_name TEXT,
      name TEXT NOT NULL,
      country TEXT NOT NULL,
      status TEXT NOT NULL,
      serving_status TEXT,
      display_status TEXT,
      daily_budget REAL,
      lifetime_budget REAL,
      bidding_strategy TEXT,
      target_cpa REAL,
      start_time TEXT,
      end_time TEXT,
      updated_at TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asa_ad_groups (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      default_bid REAL,
      status TEXT NOT NULL,
      cpa_goal REAL,
      synced_at TEXT NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES asa_campaigns(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_adg_campaign ON asa_ad_groups(campaign_id);

    CREATE TABLE IF NOT EXISTS asa_keywords (
      id INTEGER PRIMARY KEY,
      ad_group_id INTEGER NOT NULL,
      campaign_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      match_type TEXT NOT NULL,
      bid REAL,
      status TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL,
      FOREIGN KEY (ad_group_id) REFERENCES asa_ad_groups(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_kw_adg ON asa_keywords(ad_group_id);
    CREATE INDEX IF NOT EXISTS idx_kw_campaign ON asa_keywords(campaign_id);

    CREATE TABLE IF NOT EXISTS asa_daily (
      campaign_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      taps INTEGER NOT NULL DEFAULT 0,
      installs INTEGER NOT NULL DEFAULT 0,
      spend REAL NOT NULL DEFAULT 0,
      ttr REAL NOT NULL DEFAULT 0,
      cpt REAL NOT NULL DEFAULT 0,
      cpi REAL NOT NULL DEFAULT 0,
      install_rate REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (campaign_id, date)
    );

    CREATE TABLE IF NOT EXISTS asa_kw_daily (
      keyword_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      taps INTEGER NOT NULL DEFAULT 0,
      installs INTEGER NOT NULL DEFAULT 0,
      spend REAL NOT NULL DEFAULT 0,
      cpt REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (keyword_id, date)
    );

    CREATE TABLE IF NOT EXISTS asa_search_terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      term TEXT NOT NULL,
      source_keyword_id INTEGER,
      match_type TEXT,
      impressions INTEGER NOT NULL DEFAULT 0,
      taps INTEGER NOT NULL DEFAULT 0,
      installs INTEGER NOT NULL DEFAULT 0,
      spend REAL NOT NULL DEFAULT 0,
      UNIQUE (campaign_id, date, term, source_keyword_id)
    );
    CREATE INDEX IF NOT EXISTS idx_st_campaign_date ON asa_search_terms(campaign_id, date);

    CREATE TABLE IF NOT EXISTS asa_negatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      ad_group_id INTEGER,
      text TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'EXACT',
      remote_id INTEGER,
      added_at TEXT NOT NULL,
      UNIQUE (campaign_id, text, match_type)
    );

    CREATE TABLE IF NOT EXISTS asc_events_daily (
      app_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      country TEXT NOT NULL,
      product TEXT NOT NULL,
      event_type TEXT NOT NULL,
      events INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (app_id, date, country, product, event_type)
    );

    -- Real per-keyword ASA revenue from deterministic AdServices attribution
    -- (asaRevenueByKeyword Cloud Function: AdServices keyword → Adapty revenue).
    -- Keys map 1:1 onto asa_keywords.id / asa_campaigns.id. Snapshot table —
    -- the sync replaces it each run. Lets the ROI engine use REAL paid/revenue
    -- per keyword instead of the country-average estimate (no SKAN, no Adapty
    -- paid integration — works at any volume).
    CREATE TABLE IF NOT EXISTS asa_kw_revenue (
      campaign_id INTEGER NOT NULL,
      keyword_id INTEGER NOT NULL,
      country TEXT,
      trials INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      revenue_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, keyword_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kwrev_campaign ON asa_kw_revenue(campaign_id);

    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      applied_at TEXT,
      result TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      ok INTEGER,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT NOT NULL,
      app_id INTEGER,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (key, app_id)
    );

    CREATE TABLE IF NOT EXISTS credentials (
      provider TEXT NOT NULL,
      field TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider, field)
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      params TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sent_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      alert_type TEXT NOT NULL,
      key TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      UNIQUE (alert_type, key)
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_sent ON sent_alerts(sent_at);
  `);
}
