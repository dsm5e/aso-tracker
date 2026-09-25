import { ADAPTY_ANALYTICS_APP_ID, type AppConfig } from "./config.ts";
import { fetchAdaptyGeoEconomics, type AdaptyGeoEconomics } from "./revenue-client.ts";
import { normalizeCountry, spendWindow } from "./queries.ts";

export interface RevenueRow { country: string; trials: number; paid: number; revenueUsd: number }
export interface DailyRevenue { date: string; revenueUsd: number }

// Adapty allows ~2 req/s and every read is 3 requests; Economics and the
// decision matrix load the same window back to back, so share one answer.
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: Promise<AdaptyGeoEconomics> }>();

function cachedEconomics(window: { start: string; end: string }): Promise<AdaptyGeoEconomics> {
  const key = `${window.start}:${window.end}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = fetchAdaptyGeoEconomics(window);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key)); // never cache a failure
  return value;
}

/** Geo-level real revenue rows for an app, [] when no feed is configured.
 *  Shared by /api/revenue and the Command Center aggregator. */
export async function fetchRevenueRows(_cfg: AppConfig, appId: number | undefined, days: number, countryFilter?: string): Promise<{ rows: RevenueRow[]; daily: DailyRevenue[]; feed: boolean; error?: string }> {
  const country = normalizeCountry(countryFilter);
  try {
    if (appId && appId === ADAPTY_ANALYTICS_APP_ID) {
      // Adapty's own Apple Ads attribution, segmented by country and joined to
      // trials, paid subscriptions, and net revenue at the acquisition cohort.
      // Same window as the Apple Ads spend it is divided by (ends at the last
      // synced spend day), otherwise unsynced days add trials without spend.
      const economics = await cachedEconomics(spendWindow(days));
      const rows = economics.rows
        .filter((row) => !country || row.country.toUpperCase() === country)
        .map((row) => ({ ...row, revenueUsd: Math.round(row.revenueUsd * 100) / 100 }));
      const daily = country ? economics.dailyRevenueByCountry?.[country] ?? [] : economics.dailyRevenue;
      // `feed`: the app has an attribution source even when the selected
      // storefront has no rows (0 revenue is a fact, not a missing feed).
      return { rows, daily, feed: true };
    }
    return { rows: [], daily: [], feed: false };
  } catch (e) {
    return { rows: [], daily: [], feed: false, error: (e as Error).message };
  }
}
