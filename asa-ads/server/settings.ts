import { getDb } from "./db.ts";

export interface Settings {
  /** ROI engine */
  target_cpi_tier1: number;
  target_cpi_tier2: number;
  ltv_per_paid: number;
  trial_to_paid_rate: number;

  /** Confidence gates */
  min_spend_for_signal: number;
  min_installs_for_signal: number;
  min_days_for_signal: number;

  /** Alerts */
  alert_cpi_threshold: number;
  alert_spend_no_install: number;
  alert_interval_min: number;
}

const DEFAULTS: Settings = {
  target_cpi_tier1: 1.0,
  target_cpi_tier2: 0.6,
  ltv_per_paid: 30.0,
  trial_to_paid_rate: 0.30,
  min_spend_for_signal: 2.0,
  min_installs_for_signal: 5,
  min_days_for_signal: 3,
  alert_cpi_threshold: 2.0,
  alert_spend_no_install: 5.0,
  alert_interval_min: 30,
};

/** Confidence gates and alert interval are global only — not per-app. */
const GLOBAL_ONLY: Array<keyof Settings> = [
  "min_spend_for_signal",
  "min_installs_for_signal",
  "min_days_for_signal",
  "alert_interval_min",
];

const cache = new Map<string, Settings>();

function cacheKey(appId?: number): string {
  return appId ? `app:${appId}` : "global";
}

/**
 * Load settings for an app. Falls back through:
 *   per-app override → global override → DEFAULTS
 */
export function loadSettings(appId?: number): Settings {
  const ck = cacheKey(appId);
  const hit = cache.get(ck);
  if (hit) return hit;

  const db = getDb();
  const global = db.prepare(`SELECT key, value FROM settings WHERE app_id IS NULL`).all() as Array<{ key: string; value: string }>;
  const perApp = appId
    ? (db.prepare(`SELECT key, value FROM settings WHERE app_id = ?`).all(appId) as Array<{ key: string; value: string }>)
    : [];

  const merged: Settings = { ...DEFAULTS };
  for (const r of global) {
    const k = r.key as keyof Settings;
    if (k in merged) {
      const v = Number(r.value);
      if (Number.isFinite(v)) (merged as Record<string, number>)[k] = v;
    }
  }
  for (const r of perApp) {
    const k = r.key as keyof Settings;
    if (k in merged && !GLOBAL_ONLY.includes(k)) {
      const v = Number(r.value);
      if (Number.isFinite(v)) (merged as Record<string, number>)[k] = v;
    }
  }

  cache.set(ck, merged);
  return merged;
}

export function updateSettings(patch: Partial<Settings>, appId?: number): Settings {
  const db = getDb();
  const ts = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO settings (key, app_id, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key, app_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const key = k as keyof Settings;
      // Global-only keys always written to global row regardless of appId
      const scope = GLOBAL_ONLY.includes(key) ? null : (appId ?? null);
      stmt.run(key, scope, String(v), ts);
    }
  })();
  cache.clear();
  return loadSettings(appId);
}

export const GLOBAL_ONLY_KEYS = GLOBAL_ONLY;

export interface AlertRule {
  id: number;
  name: string;
  kind: "burn" | "high_cpi" | "stalled" | "spend_spike" | "low_ttr" | "custom_roi";
  enabled: number;
  params: string;
  created_at: string;
}

export function listAlertRules(): AlertRule[] {
  return getDb().prepare(`SELECT * FROM alert_rules ORDER BY id`).all() as AlertRule[];
}

export function createAlertRule(name: string, kind: AlertRule["kind"], params: Record<string, unknown>): AlertRule {
  const db = getDb();
  const r = db.prepare(`INSERT INTO alert_rules (name, kind, params, created_at) VALUES (?, ?, ?, ?)`)
    .run(name, kind, JSON.stringify(params), new Date().toISOString());
  return db.prepare(`SELECT * FROM alert_rules WHERE id = ?`).get(r.lastInsertRowid) as AlertRule;
}

export function updateAlertRule(id: number, patch: Partial<{ enabled: boolean; params: Record<string, unknown>; name: string }>): void {
  const db = getDb();
  if (typeof patch.enabled === "boolean") {
    db.prepare(`UPDATE alert_rules SET enabled = ? WHERE id = ?`).run(patch.enabled ? 1 : 0, id);
  }
  if (patch.params !== undefined) {
    db.prepare(`UPDATE alert_rules SET params = ? WHERE id = ?`).run(JSON.stringify(patch.params), id);
  }
  if (patch.name !== undefined) {
    db.prepare(`UPDATE alert_rules SET name = ? WHERE id = ?`).run(patch.name, id);
  }
}

export function deleteAlertRule(id: number): void {
  getDb().prepare(`DELETE FROM alert_rules WHERE id = ?`).run(id);
}

export interface SuggestedSettings {
  trial_to_paid_rate: { value: number; basis: string };
  target_cpi_tier1: { value: number; basis: string };
  target_cpi_tier2: { value: number; basis: string };
  alert_cpi_threshold: { value: number; basis: string };
  alert_spend_no_install: { value: number; basis: string };
  ltv_per_paid: { value: number; basis: string };
}

export function suggestSettings(appId?: number): SuggestedSettings {
  const db = getDb();
  const current = loadSettings(appId);

  // Trial → paid from ASC events, last 90 days, scoped to app if provided
  const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const whereApp = appId ? "AND app_id = ?" : "";
  const args: unknown[] = appId ? [since, appId] : [since];
  const events = db.prepare(`
    SELECT event_type, SUM(events) AS n
    FROM asc_events_daily
    WHERE date >= ? ${whereApp}
    GROUP BY event_type
  `).all(...args) as Array<{ event_type: string; n: number }>;
  const eventMap = new Map(events.map((e) => [e.event_type, e.n]));
  const trials = eventMap.get("Start Introductory Offer") ?? 0;

  // Trial → paid actually happens via these events:
  //   Crossgrade from Introductory Offer = user kept and switched plans (paid)
  //   Billing Retry from Introductory Offer = Apple charging after trial end (paid)
  //   Subscribe = new sub without trial (also counts as paid acquisition)
  //   Renew = mostly recurring; we count it conservatively
  const crossgrade = eventMap.get("Crossgrade from Introductory Offer") ?? 0;
  const billingRetry = eventMap.get("Billing Retry from Introductory Offer") ?? 0;
  const subscribe = eventMap.get("Subscribe") ?? 0;
  const netPaid = crossgrade + billingRetry * 0.8 + subscribe; // 0.8 — not all retries eventually pay

  let trialToPaid = current.trial_to_paid_rate;
  let trialBasis = `no data — keeping current ${current.trial_to_paid_rate}`;
  if (trials >= 10) {
    const rate = Math.min(0.9, Math.max(0.05, netPaid / trials));
    trialToPaid = Math.round(rate * 100) / 100;
    trialBasis = `ASC 90d${appId ? " (app)" : ""}: ${trials} trials → ${crossgrade} crossgrade + ${billingRetry} retry × 0.8 + ${subscribe} subscribe = ${netPaid.toFixed(0)} paid (${(rate * 100).toFixed(0)}%)`;
  } else if (trials > 0) {
    trialBasis = `only ${trials} trials${appId ? " for this app" : ""} in last 90d — need ≥10`;
  }

  const ltvBasis = "estimate — sync SUBSCRIBER report or Adapty for real LTV";
  const ltv = current.ltv_per_paid;

  const cpiTier1 = Math.round(ltv * trialToPaid * 0.25 * 100) / 100;
  const cpiTier2 = Math.round(cpiTier1 * 0.6 * 100) / 100;
  const alertCpi = Math.round(cpiTier1 * 2 * 100) / 100;
  const alertBurn = Math.round(cpiTier1 * 5 * 100) / 100;

  return {
    trial_to_paid_rate: { value: trialToPaid, basis: trialBasis },
    ltv_per_paid: { value: ltv, basis: ltvBasis },
    target_cpi_tier1: {
      value: cpiTier1,
      basis: `LTV $${ltv} × trial→paid ${trialToPaid} × 0.25 install→trial × ASA share`,
    },
    target_cpi_tier2: {
      value: cpiTier2,
      basis: `tier-1 target × 0.6 (lower buying power)`,
    },
    alert_cpi_threshold: {
      value: alertCpi,
      basis: `target tier-1 × 2 = alert when CPI is double the goal`,
    },
    alert_spend_no_install: {
      value: alertBurn,
      basis: `target tier-1 × 5 = no install at this spend means waste`,
    },
  };
}
