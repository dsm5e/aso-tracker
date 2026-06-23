import { getDb } from "./db.ts";

export interface BidRecommendation {
  keyword_id: number;
  text: string;
  match_type: string;
  current_bid: number;
  recommended_bid: number;
  reason: string;
  confidence: "low" | "medium" | "high";
  expected_cpi_change: number;
}

/**
 * Heuristic bid recommendation based on historical ASA data.
 *
 * Rules:
 * - No impressions in 7 days → bid is below auction floor → +50% (capped at +$0.30)
 * - Has impressions, no installs, spent <= $1 → too early, keep
 * - Has impressions, installs, CPI ≤ target → can scale, +20% to outbid more often
 * - Has impressions, no installs, spent > $2 → underperforming, -20%
 * - Has installs but CPI > target → -15% to push CPI down
 *
 * Target CPI defaults:
 * - US/GB/AU/CA/DE/FR/JP/CH/NL/SE/NO: $1.00 (tier-1)
 * - others: $0.60 (tier-2/3)
 */
const TIER1 = new Set(["US", "GB", "AU", "CA", "DE", "FR", "JP", "CH", "NL", "SE", "NO", "IE", "BE", "AT", "DK", "FI"]);

function targetCpi(country: string): number {
  return TIER1.has(country) ? 1.0 : 0.6;
}

export function recommend(daysBack = 7, campaignId?: number, appId?: number): BidRecommendation[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const where = `${campaignId ? `AND k.campaign_id = ?` : ``}${appId ? ` AND c.app_id = ?` : ``}`;
  const args: unknown[] = [start];
  if (campaignId) args.push(campaignId);
  if (appId) args.push(appId);

  const rows = db.prepare(`
    SELECT k.id AS keyword_id, k.text, k.match_type, k.bid, c.country,
           COALESCE(SUM(d.impressions), 0) AS imp,
           COALESCE(SUM(d.taps), 0) AS taps,
           COALESCE(SUM(d.installs), 0) AS installs,
           COALESCE(SUM(d.spend), 0) AS spend,
           CASE WHEN SUM(d.installs) > 0 THEN SUM(d.spend) / SUM(d.installs) ELSE 0 END AS cpi
    FROM asa_keywords k
    JOIN asa_campaigns c ON c.id = k.campaign_id
    LEFT JOIN asa_kw_daily d ON d.keyword_id = k.id AND d.date >= ?
    WHERE k.deleted = 0 AND k.status = 'ACTIVE' ${where}
    GROUP BY k.id
  `).all(...args) as Array<{
    keyword_id: number; text: string; match_type: string; bid: number; country: string;
    imp: number; taps: number; installs: number; spend: number; cpi: number;
  }>;

  const out: BidRecommendation[] = [];
  for (const r of rows) {
    const target = targetCpi(r.country);
    let rec = r.bid;
    let reason = "";
    let confidence: BidRecommendation["confidence"] = "medium";
    let expectedDelta = 0;

    if (r.imp === 0) {
      rec = Math.min(r.bid + 0.3, r.bid * 1.5);
      reason = "Нет impressions за 7д — bid ниже auction floor";
      confidence = "low";
    } else if (r.imp > 0 && r.installs === 0 && r.spend > 2.0) {
      rec = Math.max(r.bid * 0.8, 0.05);
      reason = `${r.imp} imp, 0 installs, потрачено $${r.spend.toFixed(2)} — не выкупает install`;
      confidence = "medium";
    } else if (r.installs > 0 && r.cpi <= target * 0.7) {
      rec = r.bid * 1.2;
      reason = `CPI $${r.cpi.toFixed(2)} (target $${target}) — winner, scale up`;
      confidence = "high";
      expectedDelta = 0.1;
    } else if (r.installs > 0 && r.cpi > target * 1.5) {
      rec = r.bid * 0.85;
      reason = `CPI $${r.cpi.toFixed(2)} выше target $${target} — снизить`;
      confidence = "high";
      expectedDelta = -0.15;
    } else if (r.imp > 50 && r.installs === 0) {
      rec = Math.max(r.bid * 0.9, 0.05);
      reason = `${r.imp} imp без install — нерелевантный keyword?`;
      confidence = "low";
    } else {
      reason = "В пределах нормы";
      confidence = "low";
    }
    rec = Math.round(rec * 100) / 100;
    if (rec !== r.bid) {
      out.push({
        keyword_id: r.keyword_id,
        text: r.text,
        match_type: r.match_type,
        current_bid: r.bid,
        recommended_bid: rec,
        reason,
        confidence,
        expected_cpi_change: expectedDelta,
      });
    }
  }
  out.sort((a, b) => Math.abs(b.recommended_bid - b.current_bid) - Math.abs(a.recommended_bid - a.current_bid));
  return out;
}

export interface SearchTermSuggestion {
  campaign_id: number;
  campaign_name: string;
  term: string;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  suggestion: "negative" | "add_as_keyword";
  reason: string;
}

export function suggestSearchTermActions(daysBack = 14, appId?: number, minImpForNegative = 30, minTapForNegative = 5): SearchTermSuggestion[] {
  const db = getDb();
  const start = new Date(Date.now() - daysBack * 86400_000).toISOString().slice(0, 10);
  const where = appId ? `AND c.app_id = ?` : ``;
  const args: unknown[] = appId ? [start, appId] : [start];
  const rows = db.prepare(`
    SELECT s.campaign_id, c.name AS campaign_name, s.term,
           SUM(s.impressions) AS imp,
           SUM(s.taps) AS taps,
           SUM(s.installs) AS installs,
           SUM(s.spend) AS spend,
           (SELECT 1 FROM asa_negatives n WHERE n.campaign_id = s.campaign_id AND n.text = s.term) AS is_neg,
           (SELECT 1 FROM asa_keywords k WHERE k.campaign_id = s.campaign_id AND lower(k.text) = lower(s.term) AND k.deleted = 0) AS is_kw
    FROM asa_search_terms s
    JOIN asa_campaigns c ON c.id = s.campaign_id
    WHERE s.date >= ? ${where}
    GROUP BY s.campaign_id, s.term
  `).all(...args) as Array<{ campaign_id: number; campaign_name: string; term: string; imp: number; taps: number; installs: number; spend: number; is_neg: number | null; is_kw: number | null }>;

  const out: SearchTermSuggestion[] = [];
  for (const r of rows) {
    if (r.is_neg) continue;
    if (r.is_kw) continue;
    if (!r.term || !r.term.trim()) continue; // Apple AUTO-match without text — not actionable
    if (r.installs > 0) {
      out.push({
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        term: r.term,
        impressions: r.imp,
        taps: r.taps,
        installs: r.installs,
        spend: r.spend,
        suggestion: "add_as_keyword",
        reason: `${r.installs} install(s) за период, но keyword не таргетится напрямую`,
      });
    } else if (r.imp >= minImpForNegative && r.taps >= minTapForNegative && r.installs === 0) {
      out.push({
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        term: r.term,
        impressions: r.imp,
        taps: r.taps,
        installs: 0,
        spend: r.spend,
        suggestion: "negative",
        reason: `${r.imp} imp / ${r.taps} taps / 0 installs — мусорный трафик`,
      });
    }
  }
  out.sort((a, b) => b.spend - a.spend || b.installs - a.installs);
  return out;
}
