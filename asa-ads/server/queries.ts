import { getDb } from "./db.ts";

/** "BR" for a storefront filter; undefined for world ("ALL", empty, junk). */
export function normalizeCountry(value: unknown): string | undefined {
  const country = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : undefined;
}

/** SQL predicate: campaign `c` targets storefront `?` (countries_json, or the
 *  legacy single-country column when the list is missing). One bound arg. */
export const CAMPAIGN_SERVES_COUNTRY = `EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_valid(c.countries_json) AND json_array_length(c.countries_json) > 0
                               THEN c.countries_json ELSE json_array(c.country) END)
   WHERE UPPER(CAST(value AS TEXT)) = ?
)`;

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

export function listCampaignsWithMetrics(daysBack = 14, appId?: number, countryFilter?: string): CampaignWithMetrics[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const country = normalizeCountry(countryFilter);
  if (country) {
    // Storefront view: campaigns that target the country (or delivered there
    // in the window), with that storefront's slice of the geo report.
    const args: unknown[] = [country, start, start, country, country, start, country];
    if (appId) args.push(appId);
    return db.prepare(`
      SELECT c.id, c.name, c.country, c.status, c.serving_status, c.app_id,
             c.daily_budget, c.lifetime_budget, c.bidding_strategy, c.start_time, c.end_time,
             COALESCE(SUM(g.impressions), 0) AS impressions,
             COALESCE(SUM(g.taps), 0) AS taps,
             COALESCE(SUM(g.installs), 0) AS installs,
             COALESCE(SUM(g.spend), 0) AS spend,
             CASE WHEN SUM(g.installs) > 0 THEN SUM(g.spend) / SUM(g.installs) ELSE 0 END AS cpi,
             CASE WHEN SUM(g.taps) > 0 THEN SUM(g.spend) / SUM(g.taps) ELSE 0 END AS cpt,
             CASE WHEN SUM(g.impressions) > 0 THEN 1.0 * SUM(g.taps) / SUM(g.impressions) ELSE 0 END AS ttr,
             CASE WHEN SUM(g.taps) > 0 THEN 1.0 * SUM(g.installs) / SUM(g.taps) ELSE 0 END AS install_rate,
             COALESCE((
               SELECT SUM(events) FROM asc_events_daily e
               WHERE e.app_id = c.app_id AND UPPER(e.country) = ? AND e.date >= ?
                 AND e.event_type = 'Start Introductory Offer'
             ), 0) AS trial_starts
      FROM asa_campaigns c
      LEFT JOIN asa_geo_daily g ON g.campaign_id = c.id AND g.date >= ? AND g.country = ?
      WHERE (${CAMPAIGN_SERVES_COUNTRY}
             OR EXISTS (SELECT 1 FROM asa_geo_daily x WHERE x.campaign_id = c.id AND x.date >= ? AND x.country = ?))
        ${appId ? "AND c.app_id = ?" : ""}
      GROUP BY c.id
      ORDER BY spend DESC
    `).all(...args) as CampaignWithMetrics[];
  }
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

export function listKeywordsWithMetrics(daysBack = 14, campaignId?: number, appId?: number, countryFilter?: string): KeywordWithMetrics[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const country = normalizeCountry(countryFilter);
  const where = `${campaignId ? `AND k.campaign_id = ?` : ``}${appId ? ` AND c.app_id = ?` : ``}`;
  // World: keyword totals. Storefront: keywords of campaigns that target it
  // (or delivered there), metrics from the keyword × country report.
  const args: unknown[] = country ? [start, country, country, start, country] : [start];
  if (campaignId) args.push(campaignId);
  if (appId) args.push(appId);
  const join = country
    ? `LEFT JOIN asa_kw_geo_daily d ON d.keyword_id = k.id AND d.date >= ? AND d.country = ?`
    : `LEFT JOIN asa_kw_daily d ON d.keyword_id = k.id AND d.date >= ?`;
  const scope = country
    ? `AND (${CAMPAIGN_SERVES_COUNTRY}
            OR EXISTS (SELECT 1 FROM asa_kw_geo_daily x WHERE x.keyword_id = k.id AND x.date >= ? AND x.country = ?))`
    : "";
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
    ${join}
    WHERE k.deleted = 0 ${scope} ${where}
    GROUP BY k.id
    ORDER BY spend DESC, impressions DESC
  `).all(...args) as KeywordWithMetrics[];
}

/** Daily delivery of one keyword; storefront slice when a country is set. */
export function keywordDaily(keywordId: number, daysBack = 14, countryFilter?: string): Array<Record<string, unknown>> {
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const country = normalizeCountry(countryFilter);
  return getDb().prepare(`
    SELECT date, SUM(impressions) AS impressions, SUM(taps) AS taps, SUM(installs) AS installs, SUM(spend) AS spend,
           CASE WHEN SUM(taps) > 0 THEN SUM(spend)/SUM(taps) ELSE 0 END AS cpt,
           CASE WHEN SUM(installs) > 0 THEN SUM(spend)/SUM(installs) ELSE 0 END AS cpi
    FROM ${country ? "asa_kw_geo_daily" : "asa_kw_daily"}
    WHERE keyword_id = ? AND date >= ? ${country ? "AND country = ?" : ""}
    GROUP BY date
    ORDER BY date
  `).all(...(country ? [keywordId, start, country] : [keywordId, start])) as Array<Record<string, unknown>>;
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

export function listSearchTerms(daysBack = 14, appId?: number, countryFilter?: string): SearchTerm[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const country = normalizeCountry(countryFilter);
  const where = appId ? `AND c.app_id = ?` : ``;
  const args: unknown[] = [start];
  if (country) args.push(country);
  if (appId) args.push(appId);
  const source = country
    ? `(SELECT campaign_id, date, term, NULLIF(source_keyword_id, 0) AS source_keyword_id, match_type,
               impressions, taps, installs, spend, country FROM asa_st_geo_daily)`
    : "asa_search_terms";
  return db.prepare(`
    SELECT s.campaign_id, c.name AS campaign_name, c.country,
           s.term, s.source_keyword_id, s.match_type,
           SUM(s.impressions) AS impressions,
           SUM(s.taps) AS taps,
           SUM(s.installs) AS installs,
           SUM(s.spend) AS spend,
           (SELECT 1 FROM asa_negatives n WHERE n.campaign_id = s.campaign_id AND n.text = s.term) AS is_negative
    FROM ${source} s
    JOIN asa_campaigns c ON c.id = s.campaign_id
    WHERE s.date >= ? ${country ? "AND s.country = ?" : ""} ${where}
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

export function dailyTotals(daysBack = 14, campaignId?: number, appId?: number, countryFilter?: string): DailyTotals[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const country = normalizeCountry(countryFilter);

  const conds: string[] = [];
  const args: unknown[] = [start];
  if (country) { conds.push("d.country = ?"); args.push(country); }
  if (campaignId) { conds.push("d.campaign_id = ?"); args.push(campaignId); }
  if (appId) { conds.push("c.app_id = ?"); args.push(appId); }
  const where = conds.length ? "AND " + conds.join(" AND ") : "";

  // A storefront reads the campaign × country report; world the campaign totals.
  const asa = db.prepare(`
    SELECT d.date,
           SUM(d.impressions) AS impressions,
           SUM(d.taps) AS taps,
           SUM(d.installs) AS installs,
           SUM(d.spend) AS spend,
           CASE WHEN SUM(d.installs) > 0 THEN SUM(d.spend) / SUM(d.installs) ELSE 0 END AS cpi,
           CASE WHEN SUM(d.taps) > 0 THEN SUM(d.spend) / SUM(d.taps) ELSE 0 END AS cpt,
           CASE WHEN SUM(d.impressions) > 0 THEN 1.0 * SUM(d.taps) / SUM(d.impressions) ELSE 0 END AS ttr
    FROM ${country ? "asa_geo_daily" : "asa_daily"} d
    JOIN asa_campaigns c ON c.id = d.campaign_id
    WHERE d.date >= ? ${where}
    GROUP BY d.date
    ORDER BY d.date
  `).all(...args) as Array<{ date: string; impressions: number; taps: number; installs: number; spend: number; cpi: number; cpt: number; ttr: number }>;

  const trialArgs: unknown[] = [start];
  // Only apps with Apple Ads campaigns: other apps in the ASC account have no spend here.
  let trialWhere = appId ? "AND app_id = ?" : "AND app_id IN (SELECT DISTINCT app_id FROM asa_campaigns)";
  if (appId) trialArgs.push(appId);
  if (country) { trialWhere += " AND UPPER(country) = ?"; trialArgs.push(country); }
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
export function geoBreakdown(days: number, appId?: number, countryFilter?: string): GeoBreakdownRow[] {
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
  const country = normalizeCountry(countryFilter);
  return rows
    .filter((r) => !country || r.country.toUpperCase() === country)
    .map((r) => ({ ...r, trials: trials.get(r.country.toUpperCase()) ?? 0 }));
}

export interface AppCountry { code: string; spend: number; installs: number; impressions: number }

/** Storefronts with Apple Ads delivery for the app(s) in the last `days`,
 *  biggest spend first — the options of the global country filter. */
export function listAppCountries(appId?: number, days = 90): AppCountry[] {
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  return getDb().prepare(`
    SELECT g.country AS code, SUM(g.spend) AS spend, SUM(g.installs) AS installs, SUM(g.impressions) AS impressions
    FROM asa_geo_daily g JOIN asa_campaigns c ON c.id = g.campaign_id
    WHERE g.date >= ? ${appId ? "AND c.app_id = ?" : ""}
    GROUP BY g.country
    HAVING SUM(g.spend) > 0 OR SUM(g.impressions) > 0
    ORDER BY spend DESC, impressions DESC, code
  `).all(...(appId ? [start, appId] : [start])) as AppCountry[];
}
