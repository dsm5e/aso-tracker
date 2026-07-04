import { GEO_REVENUE_APP_ID, KEYWORD_REVENUE_APP_ID, type AppConfig } from "./config.ts";

export interface RevenueRow { country: string; trials: number; paid: number; revenueUsd: number }

/** Geo-level real revenue rows for an app, [] when no feed is configured.
 *  Shared by /api/revenue and the Command Center aggregator. */
export async function fetchRevenueRows(cfg: AppConfig, appId: number | undefined, days: number): Promise<{ rows: RevenueRow[]; error?: string }> {
  try {
    if (appId && appId === GEO_REVENUE_APP_ID && cfg.geoRevenueFnUrl) {
      const url = new URL(cfg.geoRevenueFnUrl);
      url.searchParams.set("days", String(days));
      if (cfg.geoRevenueKey) url.searchParams.set("key", cfg.geoRevenueKey);
      const r = await fetch(url.toString());
      if (!r.ok) return { rows: [], error: `revenue fn ${r.status}` };
      const j = await r.json() as { rows?: RevenueRow[] };
      return { rows: (j.rows ?? []).map((x) => ({ ...x, country: x.country.toUpperCase() })) };
    }
    if (appId && appId === KEYWORD_REVENUE_APP_ID && cfg.keywordRevenueFnUrl) {
      // Per-keyword feed (AdServices attribution) folded to country grain.
      const url = new URL(cfg.keywordRevenueFnUrl);
      if (cfg.keywordRevenueAppSlug) url.searchParams.set("app", cfg.keywordRevenueAppSlug);
      if (cfg.keywordRevenuePullToken) url.searchParams.set("key", cfg.keywordRevenuePullToken);
      const r = await fetch(url.toString());
      if (!r.ok) return { rows: [], error: `revenue fn ${r.status}` };
      const j = await r.json() as { rows?: Array<{ country: string | null; trials: number; paid: number; revenueUsd: number }> };
      const by = new Map<string, RevenueRow>();
      for (const kw of j.rows ?? []) {
        const c = (kw.country ?? "?").toUpperCase();
        const row = by.get(c) ?? { country: c, trials: 0, paid: 0, revenueUsd: 0 };
        row.trials += kw.trials || 0; row.paid += kw.paid || 0; row.revenueUsd += kw.revenueUsd || 0;
        by.set(c, row);
      }
      const rows = [...by.values()].map((x) => ({ ...x, revenueUsd: Math.round(x.revenueUsd * 100) / 100 }))
        .sort((a, b) => b.revenueUsd - a.revenueUsd);
      return { rows };
    }
    return { rows: [] };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  }
}
