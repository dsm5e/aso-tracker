import { getDb } from "./db.ts";

export interface CampaignWithMetrics {
  id: number;
  name: string;
  country: string;
  status: string;
  serving_status: string | null;
  app_id: number;
  daily_budget: number;
  lifetime_budget: number;
  bidding_strategy: string | null;
  start_time: string | null;
  end_time: string | null;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  cpi: number;
  cpt: number;
  ttr: number;
  install_rate: number;
  trial_starts: number;
}

export function listCampaignsWithMetrics(daysBack = 14, appId?: number): CampaignWithMetrics[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const where = appId ? `AND c.app_id = ?` : ``;
  const args = appId ? [start, start, appId] : [start, start];
  return db.prepare(`
    SELECT c.id, c.name, c.country, c.status, c.serving_status, c.app_id,
           c.daily_budget, c.lifetime_budget, c.bidding_strategy, c.start_time, c.end_time,
           COALESCE(SUM(d.impressions), 0) AS impressions,
           COALESCE(SUM(d.taps), 0) AS taps,
           COALESCE(SUM(d.installs), 0) AS installs,
           COALESCE(SUM(d.spend), 0) AS spend,
           CASE WHEN SUM(d.installs) > 0 THEN SUM(d.spend) / SUM(d.installs) ELSE 0 END AS cpi,
           CASE WHEN SUM(d.taps) > 0 THEN SUM(d.spend) / SUM(d.taps) ELSE 0 END AS cpt,
           CASE WHEN SUM(d.impressions) > 0 THEN 1.0 * SUM(d.taps) / SUM(d.impressions) ELSE 0 END AS ttr,
           CASE WHEN SUM(d.taps) > 0 THEN 1.0 * SUM(d.installs) / SUM(d.taps) ELSE 0 END AS install_rate,
           COALESCE((
             SELECT SUM(events) FROM asc_events_daily e
             WHERE e.app_id = c.app_id
               AND e.country = c.country
               AND e.date >= ?
               AND e.event_type = 'Start Introductory Offer'
           ), 0) AS trial_starts
    FROM asa_campaigns c
    LEFT JOIN asa_daily d ON d.campaign_id = c.id AND d.date >= ?
    WHERE 1=1 ${where}
    GROUP BY c.id
    ORDER BY spend DESC
  `).all(...args) as CampaignWithMetrics[];
}

export interface KeywordWithMetrics {
  id: number;
  campaign_id: number;
  ad_group_id: number;
  campaign_name: string;
  country: string;
  text: string;
  match_type: string;
  bid: number;
  status: string;
  campaign_status: string;
  campaign_serving_status: string | null;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  cpt: number;
}

export function listKeywordsWithMetrics(daysBack = 14, campaignId?: number, appId?: number): KeywordWithMetrics[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const where = `${campaignId ? `AND k.campaign_id = ?` : ``}${appId ? ` AND c.app_id = ?` : ``}`;
  const args: unknown[] = [start];
  if (campaignId) args.push(campaignId);
  if (appId) args.push(appId);
  return db.prepare(`
    SELECT k.id, k.campaign_id, k.ad_group_id, c.name AS campaign_name, c.country,
           k.text, k.match_type, k.bid, k.status,
           c.status AS campaign_status, c.serving_status AS campaign_serving_status,
           COALESCE(SUM(d.impressions), 0) AS impressions,
           COALESCE(SUM(d.taps), 0) AS taps,
           COALESCE(SUM(d.installs), 0) AS installs,
           COALESCE(SUM(d.spend), 0) AS spend,
           CASE WHEN SUM(d.taps) > 0 THEN SUM(d.spend) / SUM(d.taps) ELSE 0 END AS cpt
    FROM asa_keywords k
    JOIN asa_campaigns c ON c.id = k.campaign_id
    LEFT JOIN asa_kw_daily d ON d.keyword_id = k.id AND d.date >= ?
    WHERE k.deleted = 0 ${where}
    GROUP BY k.id
    ORDER BY spend DESC, impressions DESC
  `).all(...args) as KeywordWithMetrics[];
}

export interface SearchTerm {
  campaign_id: number;
  campaign_name: string;
  country: string;
  term: string;
  source_keyword_id: number | null;
  match_type: string | null;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  is_negative: number;
}

export function listSearchTerms(daysBack = 14, appId?: number): SearchTerm[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const where = appId ? `AND c.app_id = ?` : ``;
  const args: unknown[] = appId ? [start, appId] : [start];
  return db.prepare(`
    SELECT s.campaign_id, c.name AS campaign_name, c.country,
           s.term, s.source_keyword_id, s.match_type,
           SUM(s.impressions) AS impressions,
           SUM(s.taps) AS taps,
           SUM(s.installs) AS installs,
           SUM(s.spend) AS spend,
           (SELECT 1 FROM asa_negatives n WHERE n.campaign_id = s.campaign_id AND n.text = s.term) AS is_negative
    FROM asa_search_terms s
    JOIN asa_campaigns c ON c.id = s.campaign_id
    WHERE s.date >= ? ${where}
    GROUP BY s.campaign_id, s.term, s.source_keyword_id
    ORDER BY impressions DESC
  `).all(...args) as SearchTerm[];
}

export interface ActionRow {
  id: number;
  type: string;
  payload: string;
  status: string;
  created_at: string;
  applied_at: string | null;
  result: string | null;
  error: string | null;
}

export function listActions(limit = 100): ActionRow[] {
  return getDb().prepare(`SELECT * FROM actions ORDER BY id DESC LIMIT ?`).all(limit) as ActionRow[];
}

export interface AppRow {
  app_id: number;
  /** Current store name: taken from the most recently started campaign. */
  app_name: string | null;
  /** Every store name this app_id has carried across renames (current first). */
  aliases: string[];
  campaign_count: number;
  active_count: number;
  spend_14d: number;
  installs_14d: number;
}

/** One row per app_id. The Ads API stamps each campaign with the app's store
 *  name at report time, so after a rename the same app_id carries several
 *  names; grouping by name would list the app once per rename. */
export function listApps(): AppRow[] {
  const db = getDb();
  const start = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT c.app_id,
           COUNT(*) AS campaign_count,
           SUM(CASE WHEN c.status = 'ENABLED' THEN 1 ELSE 0 END) AS active_count,
           COALESCE((SELECT SUM(d.spend) FROM asa_daily d
                     JOIN asa_campaigns c2 ON c2.id = d.campaign_id
                     WHERE c2.app_id = c.app_id AND d.date >= ?), 0) AS spend_14d,
           COALESCE((SELECT SUM(d.installs) FROM asa_daily d
                     JOIN asa_campaigns c2 ON c2.id = d.campaign_id
                     WHERE c2.app_id = c.app_id AND d.date >= ?), 0) AS installs_14d
    FROM asa_campaigns c
    GROUP BY c.app_id
    ORDER BY spend_14d DESC, campaign_count DESC
  `).all(start, start) as Omit<AppRow, "app_name" | "aliases">[];
  // Names newest-first: a campaign started later carries the newer store name.
  const names = db.prepare(`
    SELECT app_id, app_name FROM asa_campaigns
    WHERE app_name IS NOT NULL AND app_name != ''
    ORDER BY app_id, COALESCE(start_time, '') DESC, id DESC
  `).all() as Array<{ app_id: number; app_name: string }>;
  const aliases = new Map<number, string[]>();
  for (const n of names) {
    const list = aliases.get(n.app_id) ?? [];
    if (!list.includes(n.app_name)) list.push(n.app_name);
    aliases.set(n.app_id, list);
  }
  return rows.map((r) => {
    const list = aliases.get(r.app_id) ?? [];
    return { ...r, app_name: list[0] ?? null, aliases: list };
  });
}

export interface DailyTotals {
  date: string;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  cpi: number;
  cpt: number;
  ttr: number;
  trial_starts: number;
}

export function dailyTotals(daysBack = 14, campaignId?: number, appId?: number): DailyTotals[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);

  const conds: string[] = [];
  const args: unknown[] = [start];
  if (campaignId) { conds.push("d.campaign_id = ?"); args.push(campaignId); }
  if (appId) { conds.push("c.app_id = ?"); args.push(appId); }
  const where = conds.length ? "AND " + conds.join(" AND ") : "";

  const asa = db.prepare(`
    SELECT d.date,
           SUM(d.impressions) AS impressions,
           SUM(d.taps) AS taps,
           SUM(d.installs) AS installs,
           SUM(d.spend) AS spend,
           CASE WHEN SUM(d.installs) > 0 THEN SUM(d.spend) / SUM(d.installs) ELSE 0 END AS cpi,
           CASE WHEN SUM(d.taps) > 0 THEN SUM(d.spend) / SUM(d.taps) ELSE 0 END AS cpt,
           CASE WHEN SUM(d.impressions) > 0 THEN 1.0 * SUM(d.taps) / SUM(d.impressions) ELSE 0 END AS ttr
    FROM asa_daily d
    JOIN asa_campaigns c ON c.id = d.campaign_id
    WHERE d.date >= ? ${where}
    GROUP BY d.date
    ORDER BY d.date
  `).all(...args) as Array<{ date: string; impressions: number; taps: number; installs: number; spend: number; cpi: number; cpt: number; ttr: number }>;

  const trialArgs: unknown[] = [start];
  // Only apps with Apple Ads campaigns: other apps in the ASC account have no spend here.
  const trialWhere = appId ? "AND app_id = ?" : "AND app_id IN (SELECT DISTINCT app_id FROM asa_campaigns)";
  if (appId) trialArgs.push(appId);
  const trials = db.prepare(`
    SELECT date, SUM(events) AS events
    FROM asc_events_daily
    WHERE event_type = 'Start Introductory Offer' AND date >= ? ${trialWhere}
    GROUP BY date
  `).all(...trialArgs) as Array<{ date: string; events: number }>;
  const trialMap = new Map(trials.map((t) => [t.date, t.events]));

  return asa.map((row) => ({ ...row, trial_starts: trialMap.get(row.date) ?? 0 }));
}

/** Reporting window of the local Apple Ads data: `days` back from today, but
 *  ending at the last synced day so cohorts from other sources (Adapty, ASC)
 *  are not counted for days whose spend is not loaded yet. */
export function spendWindow(days: number): { start: string; end: string } {
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const last = (getDb().prepare(`SELECT MAX(date) AS d FROM asa_daily`).get() as { d: string | null }).d;
  return { start, end: last && last < today ? last : today };
}

export interface GeoBreakdownRow {
  country: string;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  cpi: number;
  campaigns: number;
  onHold: number;
  /** ASC "Start Introductory Offer" of the app(s) in this storefront — all
   *  sources, organic included; not Apple Ads-attributed. */
  trials: number;
}

/**
 * Apple Ads metrics per storefront. A dedicated campaign books to its country;
 * a multi-country campaign is split by the storefront report (asa_geo_daily).
 * Booking a multi-country campaign to its first country (the old behaviour)
 * put all of "WW — Rest of World" into LV and left the other storefronts with
 * a sliver of spend against their full trial counts.
 */
export function geoBreakdown(days: number, appId?: number): GeoBreakdownRow[] {
  const db = getDb();
  const { start, end } = spendWindow(days);
  const appCond = appId ? "AND c.app_id = ?" : "";
  const appArg = appId ? [appId] : [];
  const rows = db.prepare(`
    WITH split AS (SELECT DISTINCT campaign_id FROM asa_geo_daily WHERE date BETWEEN ? AND ?),
    facts AS (
      SELECT c.id AS campaign_id, c.app_id,
             CASE WHEN COALESCE(json_array_length(c.countries_json), 1) > 1 THEN 'WW' ELSE c.country END AS country,
             d.impressions, d.taps, d.installs, d.spend
      FROM asa_daily d JOIN asa_campaigns c ON c.id = d.campaign_id
      WHERE d.date BETWEEN ? AND ? AND d.campaign_id NOT IN (SELECT campaign_id FROM split) ${appCond}
      UNION ALL
      SELECT c.id, c.app_id, g.country, g.impressions, g.taps, g.installs, g.spend
      FROM asa_geo_daily g JOIN asa_campaigns c ON c.id = g.campaign_id
      WHERE g.date BETWEEN ? AND ? ${appCond}
    )
    SELECT f.country,
           SUM(f.impressions) AS impressions, SUM(f.taps) AS taps,
           SUM(f.installs) AS installs, SUM(f.spend) AS spend,
           CASE WHEN SUM(f.installs) > 0 THEN SUM(f.spend) / SUM(f.installs) ELSE 0 END AS cpi,
           COUNT(DISTINCT f.campaign_id) AS campaigns,
           COUNT(DISTINCT CASE WHEN c.status = 'ENABLED' AND c.display_status = 'ON_HOLD' THEN c.id END) AS onHold
    FROM facts f JOIN asa_campaigns c ON c.id = f.campaign_id
    GROUP BY f.country
    HAVING SUM(f.spend) > 0 OR SUM(f.installs) > 0
    ORDER BY spend DESC
  `).all(start, end, start, end, ...appArg, start, end, ...appArg) as Omit<GeoBreakdownRow, "trials">[];

  // Trials of the app(s) in view only — never other apps' storefront trials.
  const trialRows = db.prepare(`
    SELECT country, SUM(events) AS n FROM asc_events_daily
    WHERE event_type = 'Start Introductory Offer' AND date BETWEEN ? AND ?
      AND ${appId ? "app_id = ?" : "app_id IN (SELECT DISTINCT app_id FROM asa_campaigns)"}
    GROUP BY country
  `).all(start, end, ...appArg) as Array<{ country: string; n: number }>;
  const trials = new Map(trialRows.map((t) => [t.country.toUpperCase(), t.n]));
  return rows.map((r) => ({ ...r, trials: trials.get(r.country.toUpperCase()) ?? 0 }));
}
