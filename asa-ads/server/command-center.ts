import Database from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDb } from "./db.ts";
import type { AppConfig } from "./config.ts";
import { fetchRevenueRows, type RevenueRow } from "./revenue.ts";

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
  const last = db.prepare(`SELECT MAX(date) AS d FROM snapshots WHERE app = ?`).get(slug) as { d: string | null };
  if (!last?.d) return { ...empty, slug };
  const rows = db.prepare(`
    SELECT locale,
           COUNT(*) AS tracked,
           COUNT(position) AS ranked,
           SUM(CASE WHEN position <= 10 THEN 1 ELSE 0 END) AS top10,
           AVG(position) AS avgPos
    FROM snapshots WHERE app = ? AND date = ?
    GROUP BY locale
  `).all(slug, last.d) as Array<{ locale: string; tracked: number; ranked: number; top10: number; avgPos: number | null }>;
  const bestStmt = db.prepare(`
    SELECT keyword, position FROM snapshots
    WHERE app = ? AND date = ? AND locale = ? AND position IS NOT NULL
    ORDER BY position ASC LIMIT 3
  `);
  const locales = rows.map((r) => ({
    ...r,
    date: last.d as string,
    avgPos: r.avgPos === null ? null : Math.round(r.avgPos * 10) / 10,
    best: bestStmt.all(slug, last.d, r.locale) as Array<{ keyword: string; position: number }>,
  }));
  return { slug, snapshotDate: last.d, locales };
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
  if (spend < 2 && installs < 5) return { verdict: "no-data", reason: "spend/installs too thin" };
  if (!hasFeed) return { verdict: "hold", reason: "no revenue feed — CPI-only signal" };
  if (roas !== null && roas >= 1.2) return { verdict: "scale", reason: `ROAS ${(roas * 100).toFixed(0)}% — raise bids/budget` };
  if (roas !== null && roas >= 0.6) return { verdict: "hold", reason: `ROAS ${(roas * 100).toFixed(0)}% — watch` };
  if (spend >= 5 && revenue === 0) return { verdict: "cut", reason: `$${spend.toFixed(2)} spent, $0 revenue` };
  if (roas !== null) return { verdict: "cut", reason: `ROAS ${(roas * 100).toFixed(0)}%` };
  return { verdict: "no-data", reason: "" };
}

export async function commandCenter(cfg: AppConfig, appId: number, days: number): Promise<{
  rows: CommandGeoRow[];
  revenueSource: boolean;
  aso: { slug: string | null; snapshotDate: string | null };
  revenueError?: string;
}> {
  const db = getDb();
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const geo = db.prepare(`
    SELECT c.country,
           COUNT(DISTINCT c.id) AS campaigns,
           SUM(CASE WHEN c.status = 'ENABLED' AND c.display_status = 'ON_HOLD' THEN 1 ELSE 0 END) AS onHold,
           COALESCE(SUM(d.impressions), 0) AS impressions,
           COALESCE(SUM(d.taps), 0) AS taps,
           COALESCE(SUM(d.installs), 0) AS installs,
           COALESCE(SUM(d.spend), 0) AS spend,
           COALESCE((
             SELECT SUM(events) FROM asc_events_daily e
             WHERE e.country = c.country AND e.date >= ? AND e.app_id = c.app_id
               AND e.event_type = 'Start Introductory Offer'
           ), 0) AS trials
    FROM asa_campaigns c
    LEFT JOIN asa_daily d ON d.campaign_id = c.id AND d.date >= ?
    WHERE c.app_id = ?
    GROUP BY c.country
    ORDER BY spend DESC
  `).all(start, start, appId) as Array<{ country: string; campaigns: number; onHold: number; installs: number; spend: number; trials: number }>;

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

  return { rows, revenueSource: hasFeed, aso: { slug: asoData.slug, snapshotDate: asoData.snapshotDate }, revenueError };
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
