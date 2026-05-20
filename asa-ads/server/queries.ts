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

export function listKeywordsWithMetrics(daysBack = 14, campaignId?: number): KeywordWithMetrics[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const where = campaignId ? `AND k.campaign_id = ?` : ``;
  const args = campaignId ? [start, campaignId] : [start];
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

export function listSearchTerms(daysBack = 14): SearchTerm[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
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
    WHERE s.date >= ?
    GROUP BY s.campaign_id, s.term, s.source_keyword_id
    ORDER BY impressions DESC
  `).all(start) as SearchTerm[];
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
  app_name: string | null;
  campaign_count: number;
  active_count: number;
  spend_14d: number;
  installs_14d: number;
}

export function listApps(): AppRow[] {
  const db = getDb();
  const start = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  return db.prepare(`
    SELECT c.app_id, c.app_name,
           COUNT(*) AS campaign_count,
           SUM(CASE WHEN c.status = 'ENABLED' THEN 1 ELSE 0 END) AS active_count,
           COALESCE((SELECT SUM(d.spend) FROM asa_daily d
                     JOIN asa_campaigns c2 ON c2.id = d.campaign_id
                     WHERE c2.app_id = c.app_id AND d.date >= ?), 0) AS spend_14d,
           COALESCE((SELECT SUM(d.installs) FROM asa_daily d
                     JOIN asa_campaigns c2 ON c2.id = d.campaign_id
                     WHERE c2.app_id = c.app_id AND d.date >= ?), 0) AS installs_14d
    FROM asa_campaigns c
    GROUP BY c.app_id, c.app_name
    ORDER BY spend_14d DESC
  `).all(start, start) as AppRow[];
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
  const trialWhere = appId ? "AND app_id = ?" : "";
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
