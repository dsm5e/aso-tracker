import { ADAPTY_ANALYTICS_APP_ID, type AppConfig } from "./config.ts";
import { fetchAdaptyGeoRevenue } from "./revenue-client.ts";

export interface RevenueRow { country: string; trials: number; paid: number; revenueUsd: number }

/** Geo-level real revenue rows for an app, [] when no feed is configured.
 *  Shared by /api/revenue and the Command Center aggregator. */
export async function fetchRevenueRows(_cfg: AppConfig, appId: number | undefined, days: number): Promise<{ rows: RevenueRow[]; error?: string }> {
  try {
    if (appId && appId === ADAPTY_ANALYTICS_APP_ID) {
      // Adapty's own Apple Ads attribution, segmented by country and joined to
      // trials, paid subscriptions, and net revenue at the acquisition cohort.
      const end = new Date();
      const start = new Date(end.getTime() - Math.max(0, days - 1) * 86_400_000);
      const rows = (await fetchAdaptyGeoRevenue({
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      })).map((row) => ({ ...row, revenueUsd: Math.round(row.revenueUsd * 100) / 100 }));
      return { rows };
    }
    return { rows: [] };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  }
}
