import { getDb } from "./db.ts";
import { loadSettings } from "./settings.ts";

/**
 * ROI projection engine.
 *
 * Given historical ASA performance + country-level ASC trial events,
 * project what happens if you spend $X more on a campaign or keyword.
 *
 * Honest about data quality: if signal is too thin, says so.
 */

export interface RoiConfig {
  /** Trial → paid conversion rate. Default 0.30 (industry baseline). */
  trialToPaid: number;
  /** LTV per paid user in USD (weekly $4.99 × ~10 renewals before churn). */
  ltv: number;
  /** Min spend before we trust a sample. */
  minSpendForSignal: number;
  /** Min installs before we trust a sample. */
  minInstallsForSignal: number;
  /** Min days running before we trust a sample. */
  minDaysForSignal: number;
}

export const DEFAULT_ROI: RoiConfig = {
  trialToPaid: 0.30,
  ltv: 30.0,
  minSpendForSignal: 2.0,
  minInstallsForSignal: 5,
  minDaysForSignal: 3,
};

/** Min attributed paid users (per keyword/campaign) before real ASA
 * attribution OVERRIDES the country-average forward projection. Below this we
 * still surface realized revenue/ROAS (it's a measured fact), we just don't
 * extrapolate a conversion rate from a 1-2 paid sample. */
const REAL_MIN_PAID = 3;

function effectiveConfig(appId?: number, override?: Partial<RoiConfig>): RoiConfig {
  const s = loadSettings(appId);
  return {
    trialToPaid: override?.trialToPaid ?? s.trial_to_paid_rate,
    ltv: override?.ltv ?? s.ltv_per_paid,
    minSpendForSignal: override?.minSpendForSignal ?? s.min_spend_for_signal,
    minInstallsForSignal: override?.minInstallsForSignal ?? s.min_installs_for_signal,
    minDaysForSignal: override?.minDaysForSignal ?? s.min_days_for_signal,
  };
}

export type Verdict =
  | { kind: "scale";        label: string; reason: string }
  | { kind: "hold";         label: string; reason: string }
  | { kind: "cut";          label: string; reason: string }
  | { kind: "unknown";      label: string; reason: string };

export interface Projection {
  /** Whether the projection is reliable enough to act on. */
  confidence: "high" | "medium" | "low" | "insufficient";

  /** Aggregate inputs. */
  spend_so_far: number;
  installs_so_far: number;
  days_running: number;
  cpi: number;

  /** Estimated install → trial CR for this country. */
  install_to_trial_rate: number;
  /** Where the CR came from (sample size hint). */
  trial_rate_source: string;

  /** If you spend an additional $proposed_spend, expected outcome. */
  proposed_spend: number;
  projected_installs: number;
  projected_trials: number;
  projected_paid: number;
  projected_revenue: number;
  projected_roi: number;            // (revenue − spend) / spend
  projected_cpa_trial: number;      // $ per trial start
  projected_cpa_paid: number;       // $ per paying subscriber

  /** What action to take. */
  verdict: Verdict;

  /** If insufficient — what would unlock more confidence. */
  next_step?: string;

  /** "real" = projection driven by deterministic AdServices attribution;
   * "estimated" = country-average fallback (no attribution data yet). */
  revenue_source: "real" | "estimated";
  /** Measured so far from ASA-attributed users (NOT projected). */
  paid_so_far: number;
  revenue_so_far: number;
  /** Realized revenue ÷ spend so far — the direct "am I in the green" number. */
  roas_so_far: number;
}

interface CampaignStats {
  campaign_id: number;
  name: string;
  country: string;
  app_id: number;
  spend: number;
  impressions: number;
  taps: number;
  installs: number;
  cpi: number;
  days_active: number;
  start_date: string | null;
}

function loadCampaignStats(campaignId: number, daysBack: number): CampaignStats | null {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT c.id AS campaign_id, c.name, c.country, c.app_id,
           COALESCE(SUM(d.spend), 0) AS spend,
           COALESCE(SUM(d.impressions), 0) AS impressions,
           COALESCE(SUM(d.taps), 0) AS taps,
           COALESCE(SUM(d.installs), 0) AS installs,
           CASE WHEN SUM(d.installs) > 0 THEN SUM(d.spend) / SUM(d.installs) ELSE 0 END AS cpi,
           COUNT(DISTINCT d.date) AS days_active,
           MIN(d.date) AS start_date
    FROM asa_campaigns c
    LEFT JOIN asa_daily d ON d.campaign_id = c.id AND d.date >= ? AND d.impressions > 0
    WHERE c.id = ?
  `).get(start, campaignId) as CampaignStats | undefined;
  return row ?? null;
}

function loadKeywordStats(keywordId: number, daysBack: number): (CampaignStats & { keyword_id: number; text: string; bid: number }) | null {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT k.id AS keyword_id, k.text, k.bid, k.campaign_id, c.name, c.country, c.app_id,
           COALESCE(SUM(d.spend), 0) AS spend,
           COALESCE(SUM(d.impressions), 0) AS impressions,
           COALESCE(SUM(d.taps), 0) AS taps,
           COALESCE(SUM(d.installs), 0) AS installs,
           CASE WHEN SUM(d.installs) > 0 THEN SUM(d.spend) / SUM(d.installs) ELSE 0 END AS cpi,
           COUNT(DISTINCT d.date) AS days_active,
           MIN(d.date) AS start_date
    FROM asa_keywords k
    JOIN asa_campaigns c ON c.id = k.campaign_id
    LEFT JOIN asa_kw_daily d ON d.keyword_id = k.id AND d.date >= ? AND d.impressions > 0
    WHERE k.id = ?
  `).get(start, keywordId) as (CampaignStats & { keyword_id: number; text: string; bid: number }) | undefined;
  return row ?? null;
}

/** Real (measured) ASA outcome from deterministic AdServices attribution,
 * joined with Adapty revenue — populated by the asa_kw_revenue sync. Absent
 * when there's no attribution data yet for this keyword/campaign. */
export interface RealRevenue { trials: number; paid: number; revenue_usd: number; }

function loadRealRevenueForKeyword(keywordId: number): RealRevenue | undefined {
  const r = getDb().prepare(
    `SELECT trials, paid, revenue_usd FROM asa_kw_revenue WHERE keyword_id = ?`
  ).get(keywordId) as { trials: number; paid: number; revenue_usd: number } | undefined;
  return r ? { trials: r.trials, paid: r.paid, revenue_usd: r.revenue_usd } : undefined;
}

function loadRealRevenueForCampaign(campaignId: number): RealRevenue | undefined {
  const r = getDb().prepare(
    `SELECT COALESCE(SUM(trials),0) AS trials, COALESCE(SUM(paid),0) AS paid,
            COALESCE(SUM(revenue_usd),0) AS revenue_usd
     FROM asa_kw_revenue WHERE campaign_id = ?`
  ).get(campaignId) as { trials: number; paid: number; revenue_usd: number } | undefined;
  if (!r || (r.paid === 0 && r.revenue_usd === 0 && r.trials === 0)) return undefined;
  return { trials: r.trials, paid: r.paid, revenue_usd: r.revenue_usd };
}

interface TrialRateEstimate {
  rate: number;
  source: string;
  samples: number;
}

/**
 * Estimate install → trial conversion rate for a country.
 *
 * Without SKAN attribution we approximate: country_trials / country_asa_installs.
 * Adjusted for the fact that organic installs also produce trials —
 * we assume ASA-installs have ~1.5× the trial rate of average users (engaged buyers).
 *
 * Falls back through: country-app → country-global → global average.
 */
function estimateTrialRate(appId: number, country: string, daysBack: number): TrialRateEstimate {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);

  // 1. App-country: ASA installs vs ASC trial starts in this country
  const appCountry = db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(d.installs), 0)
       FROM asa_daily d
       JOIN asa_campaigns c ON c.id = d.campaign_id
       WHERE c.app_id = ? AND c.country = ? AND d.date >= ?) AS asa_installs,
      (SELECT COALESCE(SUM(events), 0)
       FROM asc_events_daily
       WHERE app_id = ? AND country = ? AND date >= ?
         AND event_type = 'Start Introductory Offer') AS trial_starts
  `).get(appId, country, start, appId, country, start) as { asa_installs: number; trial_starts: number };

  // ASC trial events include organic users, so the raw ratio overestimates
  // true ASA-attributed trial rate. Reasonable industry baselines for paid
  // acquisition on iOS subscriptions: tier-1 ~20-30%, tier-2/3 ~15-25%.
  // Without SKAN we can't isolate ASA-trials, so:
  //   - If raw ratio > 0.7 → data is contaminated by organic, fall back to baseline
  //   - Otherwise cap at 0.40
  const CAP = 0.40;
  const FLOOR = 0.10;
  const CONTAMINATED = 0.7;
  const BASELINE = 0.25;

  if (appCountry.asa_installs >= 10 && appCountry.trial_starts >= 3) {
    const raw = appCountry.trial_starts / appCountry.asa_installs;
    if (raw > CONTAMINATED) {
      return {
        rate: BASELINE,
        source: `${country}: raw ratio ${(raw * 100).toFixed(0)}% looks organic-contaminated → using baseline ${(BASELINE * 100).toFixed(0)}%`,
        samples: appCountry.asa_installs,
      };
    }
    const rate = Math.min(CAP, Math.max(FLOOR, raw));
    return {
      rate,
      source: `${country}: ${appCountry.trial_starts} trials / ${appCountry.asa_installs} ASA installs`,
      samples: appCountry.asa_installs,
    };
  }

  // 2. App-wide: all countries
  const appWide = db.prepare(`
    SELECT
      (SELECT COALESCE(SUM(d.installs), 0)
       FROM asa_daily d
       JOIN asa_campaigns c ON c.id = d.campaign_id
       WHERE c.app_id = ? AND d.date >= ?) AS asa_installs,
      (SELECT COALESCE(SUM(events), 0)
       FROM asc_events_daily
       WHERE app_id = ? AND date >= ?
         AND event_type = 'Start Introductory Offer') AS trial_starts
  `).get(appId, start, appId, start) as { asa_installs: number; trial_starts: number };

  if (appWide.asa_installs >= 10) {
    const raw = appWide.trial_starts / appWide.asa_installs;
    if (raw > CONTAMINATED) {
      return {
        rate: BASELINE,
        source: `app-global: raw ratio ${(raw * 100).toFixed(0)}% organic-contaminated → baseline ${(BASELINE * 100).toFixed(0)}% (needs SKAN for accuracy)`,
        samples: appWide.asa_installs,
      };
    }
    const rate = Math.min(CAP, Math.max(FLOOR, raw));
    return {
      rate,
      source: `app-global: ${appWide.trial_starts} trials / ${appWide.asa_installs} ASA installs`,
      samples: appWide.asa_installs,
    };
  }

  // 3. Industry baseline fallback
  return {
    rate: BASELINE,
    source: "industry baseline (insufficient ASA history, no SKAN)",
    samples: 0,
  };
}

function assessConfidence(stats: CampaignStats, cfg: RoiConfig): "high" | "medium" | "low" | "insufficient" {
  const { spend, installs, days_active } = stats;
  // No spend or no days → not enough to say anything
  if (spend < 0.1 || days_active < 1) return "insufficient";
  if (installs >= 15 && days_active >= 7 && spend >= cfg.minSpendForSignal) return "high";
  if (installs >= cfg.minInstallsForSignal && days_active >= cfg.minDaysForSignal) return "medium";
  if (installs >= 2 && days_active >= 2) return "low";
  return "insufficient";
}

function decide(
  cpi: number,
  projectedRoi: number,
  confidence: "high" | "medium" | "low" | "insufficient",
  installs: number,
  days: number,
  stats: { taps: number; impressions: number; spend: number; days_active: number },
): { verdict: Verdict; next_step?: string } {
  if (confidence === "insufficient") {
    let next: string;
    if (stats.impressions === 0) {
      next = "0 impressions — keyword/campaign not winning auction. Поднять bid +30% или ждать 48ч после bid change.";
    } else if (stats.taps < 3) {
      next = `Только ${stats.taps} taps. Подожди 48–72ч или подними daily budget чтобы получить хотя бы 10 taps.`;
    } else if (installs < 1) {
      next = `${stats.taps} taps без install. Подожди ещё 2–3 дня или проверь релевантность keyword.`;
    } else {
      const needInstalls = Math.max(0, 5 - installs);
      const needDays = Math.max(0, 3 - days);
      next = `Подожди: нужно ${needInstalls > 0 ? `ещё ${needInstalls} installs` : `${needDays} дня`} для уверенной оценки.`;
    }
    return {
      verdict: {
        kind: "unknown",
        label: "WAIT",
        reason: "Недостаточно данных для прогноза",
      },
      next_step: next,
    };
  }

  // Decisions by ROI band
  if (projectedRoi >= 1.0) {
    return {
      verdict: {
        kind: "scale",
        label: "SCALE",
        reason: `ROI ${(projectedRoi * 100).toFixed(0)}% — profitable, scale up`,
      },
    };
  }
  if (projectedRoi >= 0.2) {
    return {
      verdict: {
        kind: "hold",
        label: "HOLD",
        reason: `ROI ${(projectedRoi * 100).toFixed(0)}% — marginal, optimize before scaling`,
      },
    };
  }
  if (projectedRoi >= -0.3) {
    return {
      verdict: {
        kind: "hold",
        label: "MONITOR",
        reason: `ROI ${(projectedRoi * 100).toFixed(0)}% — break-even zone, watch closely`,
      },
    };
  }
  return {
    verdict: {
      kind: "cut",
      label: "CUT",
      reason: `ROI ${(projectedRoi * 100).toFixed(0)}% — losing money, pause or rework`,
    },
  };
}

function projectFrom(
  stats: CampaignStats,
  trialRate: TrialRateEstimate,
  proposedSpend: number,
  cfg: RoiConfig,
  real?: RealRevenue,
): Projection {
  let confidence = assessConfidence(stats, cfg);
  const cpi = stats.installs > 0 ? stats.spend / stats.installs : 0;

  // No installs yet → estimate taps → installs from a 25% IR (industry default).
  const effectiveCpi = cpi > 0 ? cpi : (stats.taps > 0 ? (stats.spend / stats.taps) / 0.25 : 0);
  const projInstalls = effectiveCpi > 0 ? proposedSpend / effectiveCpi : 0;

  // Forward projection — country-average estimate by default.
  let trialRateOut = trialRate.rate;
  let trialSource = trialRate.source;
  let projTrials = projInstalls * trialRate.rate;
  let projPaid = projTrials * cfg.trialToPaid;
  let projRevenue = projPaid * cfg.ltv;
  let revenueSource: "real" | "estimated" = "estimated";

  // Realized so far from ASA-attributed users — a measured fact, not a
  // projection. This is the direct "am I in the green" number.
  const paidSoFar = real?.paid ?? 0;
  const revenueSoFar = real?.revenue_usd ?? 0;
  const roasSoFar = stats.spend > 0 ? revenueSoFar / stats.spend : 0;

  // Deterministic AdServices attribution OVERRIDES the country-average estimate
  // once there are enough attributed paid users to trust the rate. Valuation
  // stays at LTV (forward-looking, incl. future renewals); the conversion rate
  // is now REAL, so the projection + verdict are measured, not guessed.
  if (real && real.paid >= REAL_MIN_PAID && stats.installs > 0) {
    const realInstallToPaid = real.paid / stats.installs;
    projPaid = projInstalls * realInstallToPaid;
    projRevenue = projPaid * cfg.ltv;
    if (real.trials > 0) {
      trialRateOut = real.trials / stats.installs;
      projTrials = projInstalls * trialRateOut;
    }
    trialSource = `real ASA attribution (${real.paid} paid / ${stats.installs} installs)`;
    revenueSource = "real";
    confidence = "high";
  }

  const projRoi = proposedSpend > 0 ? (projRevenue - proposedSpend) / proposedSpend : 0;
  const projCpaTrial = projTrials > 0 ? proposedSpend / projTrials : 0;
  const projCpaPaid = projPaid > 0 ? proposedSpend / projPaid : 0;

  const { verdict, next_step } = decide(cpi, projRoi, confidence, stats.installs, stats.days_active, {
    taps: stats.taps,
    impressions: stats.impressions,
    spend: stats.spend,
    days_active: stats.days_active,
  });

  return {
    confidence,
    spend_so_far: stats.spend,
    installs_so_far: stats.installs,
    days_running: stats.days_active,
    cpi,
    install_to_trial_rate: trialRateOut,
    trial_rate_source: trialSource,
    proposed_spend: proposedSpend,
    projected_installs: Math.round(projInstalls * 10) / 10,
    projected_trials: Math.round(projTrials * 10) / 10,
    projected_paid: Math.round(projPaid * 100) / 100,
    projected_revenue: Math.round(projRevenue * 100) / 100,
    projected_roi: Math.round(projRoi * 1000) / 1000,
    projected_cpa_trial: Math.round(projCpaTrial * 100) / 100,
    projected_cpa_paid: Math.round(projCpaPaid * 100) / 100,
    verdict,
    next_step,
    revenue_source: revenueSource,
    paid_so_far: paidSoFar,
    revenue_so_far: Math.round(revenueSoFar * 100) / 100,
    roas_so_far: Math.round(roasSoFar * 1000) / 1000,
  };
}

export function projectCampaign(campaignId: number, proposedSpend = 1000, daysBack = 14, cfgOverride?: Partial<RoiConfig>): Projection | null {
  const stats = loadCampaignStats(campaignId, daysBack);
  if (!stats) return null;
  const trialRate = estimateTrialRate(stats.app_id, stats.country, daysBack);
  const real = loadRealRevenueForCampaign(campaignId);
  return projectFrom(stats, trialRate, proposedSpend, effectiveConfig(stats.app_id, cfgOverride), real);
}

export function projectKeyword(keywordId: number, proposedSpend = 100, daysBack = 14, cfgOverride?: Partial<RoiConfig>): Projection | null {
  const stats = loadKeywordStats(keywordId, daysBack);
  if (!stats) return null;
  const trialRate = estimateTrialRate(stats.app_id, stats.country, daysBack);
  const real = loadRealRevenueForKeyword(keywordId);
  return projectFrom(stats, trialRate, proposedSpend, effectiveConfig(stats.app_id, cfgOverride), real);
}

/** Quick verdict (no projection) — used in tables to show row-level color/label. */
export function quickVerdict(campaignId: number, daysBack = 14): { verdict: Verdict; confidence: "high" | "medium" | "low" | "insufficient" } {
  const p = projectCampaign(campaignId, 100, daysBack);
  if (!p) return { verdict: { kind: "unknown", label: "?", reason: "no data" }, confidence: "insufficient" };
  return { verdict: p.verdict, confidence: p.confidence };
}
