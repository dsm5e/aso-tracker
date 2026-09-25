import Database from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDb } from "./db.ts";
import type { AppConfig } from "./config.ts";
import { fetchRevenueRows, type RevenueRow } from "./revenue.ts";
import { geoBreakdown, normalizeCountry } from "./queries.ts";

// ---------------------------------------------------------------------------
// Command Center — one screen per app: ASA spend/installs ⋈ real revenue ⋈
// organic ASO positions (aso-keywords rankings.db), with a SCALE/HOLD/CUT/
// NO-DATA verdict per geo and an account-health banner (billing/on-hold).
// ---------------------------------------------------------------------------

const ASO_HOME = process.env.ASO_STUDIO_HOME ?? join(homedir(), ".aso-studio");
const RANKINGS_DB = join(ASO_HOME, "keywords", "rankings.db");
const APPS_JSON = join(ASO_HOME, "keywords", "apps.json");

let rankingsDb: Database.Database | null = null;
function openRankings(): Database.Database | null {
  if (rankingsDb) return rankingsDb;
  if (!existsSync(RANKINGS_DB)) return null;
  rankingsDb = new Database(RANKINGS_DB, { readonly: true, fileMustExist: true });
  return rankingsDb;
}

/** adamId (ASA app_id) → aso-keywords slug, via ~/.aso-studio/keywords/apps.json */
function slugForAdamId(appId: number): string | null {
  try {
    const apps = JSON.parse(readFileSync(APPS_JSON, "utf-8")) as Array<{ id: string; iTunesId: string }>;
    return apps.find((a) => Number(a.iTunesId) === appId)?.id ?? null;
  } catch {
    return null;
  }
}

export interface AsoLocaleSummary {
  locale: string;
  date: string;
  tracked: number;
  ranked: number;
  top10: number;
  avgPos: number | null;
  best: Array<{ keyword: string; position: number }>;
}

/** Latest organic positions per locale for the app. Read-only side DB. */
export function asoSummary(appId: number): { slug: string | null; snapshotDate: string | null; locales: AsoLocaleSummary[] } {
  const empty = { slug: null, snapshotDate: null, locales: [] as AsoLocaleSummary[] };
  const slug = slugForAdamId(appId);
  if (!slug) return empty;
  const db = openRankings();
  if (!db) return { ...empty, slug };
  // Every storefront is refreshed independently. A single global MAX(date)
  // silently discarded older-but-valid locales; select the newest row per
  // locale/query and resolve duplicate runs on the same day by the largest id.
  const latest = db.prepare(`
    WITH latest_date AS (
      SELECT locale, keyword, MAX(date) AS date
        FROM snapshots
       WHERE app = ?
    GROUP BY locale, keyword
    ), latest_id AS (
      SELECT s.locale, s.keyword, MAX(s.id) AS id
        FROM snapshots s
        JOIN latest_date d
          ON d.locale = s.locale AND d.keyword = s.keyword AND d.date = s.date
       WHERE s.app = ?
    GROUP BY s.locale, s.keyword
    )
    SELECT s.locale, s.keyword, s.date, s.position
      FROM snapshots s
      JOIN latest_id l ON l.id = s.id
  `).all(slug, slug) as Array<{ locale: string; keyword: string; date: string; position: number | null }>;
  if (latest.length === 0) return { ...empty, slug };

  const grouped = new Map<string, typeof latest>();
  for (const row of latest) grouped.set(row.locale, [...(grouped.get(row.locale) ?? []), row]);
  const locales = Array.from(grouped.entries()).map(([locale, rows]) => {
    const ranked = rows.filter((row) => row.position !== null);
    const positionSum = ranked.reduce((sum, row) => sum + Number(row.position), 0);
    return {
      locale,
      date: rows.map((row) => row.date).sort().at(-1) as string,
      tracked: rows.length,
      ranked: ranked.length,
      top10: ranked.filter((row) => Number(row.position) <= 10).length,
      avgPos: ranked.length ? Math.round((positionSum / ranked.length) * 10) / 10 : null,
      best: ranked
        .sort((a, b) => Number(a.position) - Number(b.position))
        .slice(0, 3)
        .map((row) => ({ keyword: row.keyword, position: Number(row.position) })),
    };
  });
  const snapshotDate = latest.map((row) => row.date).sort().at(-1) ?? null;
  return { slug, snapshotDate, locales };
}

export type Verdict = "scale" | "hold" | "cut" | "no-data";

export interface CommandGeoRow {
  country: string;
  campaigns: number;
  onHold: number;
  spend: number;
  installs: number;
  cpi: number;
  trials: number;
  paid: number;
  revenue: number;
  roas: number | null; // null when no revenue feed for this app
  verdict: Verdict;
  reason: string;
  aso: AsoLocaleSummary | null;
}

function verdictFor(spend: number, installs: number, revenue: number, roas: number | null, hasFeed: boolean): { verdict: Verdict; reason: string } {
  if (spend < 2 && installs < 5) return { verdict: "no-data", reason: "мало расхода и установок" };
  if (!hasFeed) return { verdict: "hold", reason: "нет источника выручки — оценка только по CPI" };
  if (roas !== null && roas >= 1.2) return { verdict: "scale", reason: `ROAS ${(roas * 100).toFixed(0)}% — поднять ставки и бюджет` };
  if (roas !== null && roas >= 0.6) return { verdict: "hold", reason: `ROAS ${(roas * 100).toFixed(0)}% — наблюдать` };
  if (spend >= 5 && revenue === 0) return { verdict: "cut", reason: `$${spend.toFixed(2)} потрачено, выручки нет` };
  if (roas !== null) return { verdict: "cut", reason: `ROAS ${(roas * 100).toFixed(0)}%` };
  return { verdict: "no-data", reason: "" };
}

export async function commandCenter(cfg: AppConfig, appId: number, days: number, countryFilter?: string): Promise<{
  rows: CommandGeoRow[];
  revenueSource: boolean;
  aso: { slug: string | null; snapshotDate: string | null };
  revenueError?: string;
}> {
  // Storefront grain: multi-country campaigns are split by the geo report.
  const geo = geoBreakdown(days, appId);

  const { rows: revRows, error: revenueError } = await fetchRevenueRows(cfg, appId, days);
  const revBy = new Map<string, RevenueRow>(revRows.map((r) => [r.country.toUpperCase(), r]));
  const hasFeed = revRows.length > 0;

  const asoData = asoSummary(appId);
  const asoBy = new Map(asoData.locales.map((l) => [l.locale.toUpperCase(), l]));

  const rows: CommandGeoRow[] = geo.map((g) => {
    const rev = revBy.get(g.country.toUpperCase());
    const trials = rev ? rev.trials : g.trials;
    const paid = rev?.paid ?? 0;
    const revenue = rev?.revenueUsd ?? 0;
    const roas = hasFeed ? (g.spend > 0 ? revenue / g.spend : 0) : null;
    const v = verdictFor(g.spend, g.installs, revenue, roas, hasFeed);
    return {
      country: g.country,
      campaigns: g.campaigns,
      onHold: g.onHold,
      spend: Math.round(g.spend * 100) / 100,
      installs: g.installs,
      cpi: g.installs > 0 ? Math.round((g.spend / g.installs) * 100) / 100 : 0,
      trials, paid,
      revenue: Math.round(revenue * 100) / 100,
      roas,
      verdict: v.verdict,
      reason: v.reason,
      aso: asoBy.get(g.country.toUpperCase()) ?? null,
    };
  });

  // The storefront filter narrows the table; the feed flag stays app-level.
  const country = normalizeCountry(countryFilter);
  const scoped = country ? rows.filter((row) => row.country.toUpperCase() === country) : rows;
  return { rows: scoped, revenueSource: hasFeed, aso: { slug: asoData.slug, snapshotDate: asoData.snapshotDate }, revenueError };
}

export interface AccountHealth {
  totalEnabled: number;
  running: number;
  onHold: number;
  paused: number;
  billingSuspected: boolean;
  lastSyncAt: string | null;
}

/** Account-level health: an all-campaigns ON_HOLD wall = billing/card problem. */
export function accountHealth(): AccountHealth {
  const db = getDb();
  const r = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'ENABLED' THEN 1 ELSE 0 END) AS totalEnabled,
      SUM(CASE WHEN status = 'ENABLED' AND display_status = 'RUNNING' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status = 'ENABLED' AND display_status = 'ON_HOLD' THEN 1 ELSE 0 END) AS onHold,
      SUM(CASE WHEN status = 'PAUSED' THEN 1 ELSE 0 END) AS paused
    FROM asa_campaigns
  `).get() as { totalEnabled: number; running: number; onHold: number; paused: number };
  const sync = db.prepare(`SELECT finished_at FROM sync_log WHERE ok = 1 ORDER BY id DESC LIMIT 1`).get() as { finished_at: string | null } | undefined;
  const billingSuspected = r.totalEnabled > 0 && r.onHold >= Math.max(3, Math.ceil(r.totalEnabled * 0.5));
  return { ...r, billingSuspected, lastSyncAt: sync?.finished_at ?? null };
}
