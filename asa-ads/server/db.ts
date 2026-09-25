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
      countries_json TEXT,
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

    -- Campaign × storefront × day. Multi-country campaigns report one row per
    -- storefront here; asa_daily only has the campaign total.
    CREATE TABLE IF NOT EXISTS asa_geo_daily (
      campaign_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      country TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      taps INTEGER NOT NULL DEFAULT 0,
      installs INTEGER NOT NULL DEFAULT 0,
      spend REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (campaign_id, date, country)
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

    -- Real per-keyword ASA revenue from Adapty's native Apple Ads attribution.
    -- Keys map 1:1 onto asa_keywords.id / asa_campaigns.id. Snapshot table —
    -- the sync replaces it each run. Lets the ROI engine use REAL paid/revenue
    -- per keyword instead of the country-average estimate (no SKAN, no Adapty
    -- paid integration — works at any volume).
    CREATE TABLE IF NOT EXISTS asa_kw_revenue (
      campaign_id INTEGER NOT NULL,
      keyword_id INTEGER NOT NULL,
      country TEXT,
      attributed_installs INTEGER NOT NULL DEFAULT 0,
      trials INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      revenue_usd REAL NOT NULL DEFAULT 0,
      cohort_start TEXT,
      cohort_end TEXT,
      observed_through TEXT,
      windows_json TEXT,
      bounded INTEGER NOT NULL DEFAULT 0,
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

    -- Durable composite snapshots for Apple Ads traffic intelligence. Apple
    -- insight endpoints are relatively expensive and can rate-limit bursts;
    -- keeping the last good response here lets restarts reuse it and provides
    -- a stale-if-error fallback when Apple temporarily returns 429/5xx.
    CREATE TABLE IF NOT EXISTS traffic_intelligence_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_traffic_cache_expiry ON traffic_intelligence_cache(expires_at);

    -- Durable work state for the read-only nightly traffic cache warmer. This
    -- never stores or applies Apple Ads mutations; it only records when each
    -- app × country cache was last refreshed and when it may be tried again.
    CREATE TABLE IF NOT EXISTS traffic_sync_targets (
      app_id INTEGER NOT NULL,
      country TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      next_run_at INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (app_id, country)
    );
    CREATE INDEX IF NOT EXISTS idx_traffic_sync_due ON traffic_sync_targets(next_run_at, priority DESC);

    CREATE TABLE IF NOT EXISTS adapty_funnel_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS adapty_cohort_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS adapty_keyword_geo_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- Append-only Platform API observations. Raw responses are retained for
    -- auditability; the separate cache points at the latest good snapshot so
    -- a transient Apple 429/5xx never erases a usable dashboard view.
    CREATE TABLE IF NOT EXISTS platform_api_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_key TEXT NOT NULL,
      source TEXT NOT NULL,
      method_id TEXT NOT NULL,
      app_id INTEGER,
      raw_payload TEXT NOT NULL,
      normalized_payload TEXT NOT NULL,
      request_meta TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_platform_snapshot_key ON platform_api_snapshots(snapshot_key, id DESC);
    CREATE INDEX IF NOT EXISTS idx_platform_snapshot_source ON platform_api_snapshots(source, app_id, id DESC);

    CREATE TABLE IF NOT EXISTS platform_api_cache (
      cache_key TEXT PRIMARY KEY,
      snapshot_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      last_error TEXT,
      FOREIGN KEY (snapshot_id) REFERENCES platform_api_snapshots(id)
    );
    CREATE INDEX IF NOT EXISTS idx_platform_cache_expiry ON platform_api_cache(expires_at);
  `);

  // SQLite has no `ADD COLUMN IF NOT EXISTS`; preserve existing local data
  // while upgrading snapshots created by earlier dashboard versions.
  const revenueColumns = new Set(
    (d.prepare("PRAGMA table_info(asa_kw_revenue)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  const additions: Array<[string, string]> = [
    ["attributed_installs", "INTEGER NOT NULL DEFAULT 0"],
    ["cohort_start", "TEXT"],
    ["cohort_end", "TEXT"],
    ["observed_through", "TEXT"],
    ["windows_json", "TEXT"],
    ["bounded", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [name, type] of additions) {
    if (!revenueColumns.has(name)) d.exec(`ALTER TABLE asa_kw_revenue ADD COLUMN ${name} ${type}`);
  }

  const campaignColumns = new Set(
    (d.prepare("PRAGMA table_info(asa_campaigns)").all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!campaignColumns.has("countries_json")) d.exec("ALTER TABLE asa_campaigns ADD COLUMN countries_json TEXT");
}
