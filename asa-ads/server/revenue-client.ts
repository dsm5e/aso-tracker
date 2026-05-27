import { request } from "undici";

/**
 * Real per-keyword ASA revenue, pulled from the `asaRevenueByKeyword` Cloud
 * Function. That function joins deterministic AdServices attribution
 * (asa_attribution/{customerUserId}) with Adapty subscription revenue events
 * (same customerUserId) in Firestore — no SKAN, no Adapty paid integration, so
 * it works at any volume. campaignId / keywordId are Apple's global ids and map
 * 1:1 onto asa_campaigns.id / asa_keywords.id.
 */
export interface KeywordRevenueRow {
  campaignId: number;
  keywordId: number;
  adGroupId: number | null;
  country: string | null;
  trials: number;
  paid: number;
  revenueUsd: number;
}

/**
 * GET the aggregate. Returns [] on any failure (missing URL handled by caller)
 * so a flaky function never breaks the rest of the sync — the ROI engine just
 * falls back to the country-average estimate.
 */
export async function fetchKeywordRevenue(
  fnUrl: string,
  app: string,
  pullToken?: string,
): Promise<KeywordRevenueRow[]> {
  const url = new URL(fnUrl);
  url.searchParams.set("app", app);
  if (pullToken) url.searchParams.set("key", pullToken);

  const res = await request(url.toString(), { method: "GET" });
  const buf = Buffer.from(await res.body.arrayBuffer());
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`asaRevenueByKeyword ${res.statusCode}: ${buf.toString("utf-8").slice(0, 200)}`);
  }
  const json = JSON.parse(buf.toString("utf-8")) as { rows?: unknown[] };
  return (json.rows ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      campaignId: Number(r.campaignId),
      keywordId: Number(r.keywordId),
      adGroupId: r.adGroupId != null ? Number(r.adGroupId) : null,
      country: (r.country as string) ?? null,
      trials: Number(r.trials) || 0,
      paid: Number(r.paid) || 0,
      revenueUsd: Number(r.revenueUsd) || 0,
    };
  });
}
