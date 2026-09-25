import type Database from "better-sqlite3";
import { fetchKeywordRevenue, type KeywordRevenuePayload } from "./revenue-client.ts";

type JsonRecord = Record<string, unknown>;

interface BaseKeywordRow {
  keywordId: number;
  campaignId: number;
  campaignName: string;
  country: string;
  countriesJson: string | null;
  text: string;
  matchType: string;
  bid: number | null;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  attributedInstalls: number;
  trials: number;
  paid: number;
  revenueUsd: number;
  revenueUpdatedAt: string | null;
  cohortStart: string | null;
  cohortEnd: string | null;
  observedThrough: string | null;
  /** Country scope only: this keyword's slice of the keyword × storefront report. */
  geoImpressions?: number;
  geoTaps?: number;
  geoInstalls?: number;
  geoSpend?: number;
  /** 1 when the campaign has keyword × storefront rows in the window. */
  geoCovered?: number;
}

interface SignalRow {
  country: string;
  keyword: string;
  source: string | null;
  popularity: number | null;
  share: { value: number | null; lowerBound: number | null; upperBound: number | null } | null;
  paidRank: number | null;
  confidence: string | null;
}

export interface DecisionMatrixInput {
  appId: number;
  country?: string;
  days?: number;
  forceRefresh?: boolean;
}

const GEO_ECONOMICS_TTL_MS = 6 * 60 * 60 * 1000;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

const MEDICAL_INTENT = /(?:\bdicom\b|\bdcm\b|\bcbct\b|\bpacs\b|\bmri\b|\birm\b|\btac\b|\bct\b|\bnifti\b|x[\s-]?ray|rayos?\s+x|raios?\s+x|radiol|radiogr|tomograf|angiograph|röntgen|røntgen|rontgen|рентген|томограф|\bмрт\b|medical|medic[ao]|médical|imagerie|dental|dentist|cone\s+beam|slicer|radiant|osirix|horos|weasis|imaios|idv|microdicom|lumadicom|medscan|romexis|sidexis|ondemand3d|3dicom|orthanc|ohif|exocad|intelerad|ambra\s+health|blue\s+sky\s+plan|visualizador\s+dicom|visor\s+dicom|dicom\s+betrachter|أشعة|تصوير)/iu;

export function hasMedicalIntent(value: string): boolean {
  return MEDICAL_INTENT.test(normalized(value));
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function range(values: Array<number | null>): { min: number; max: number } | null {
  const present = values.filter((value): value is number => value != null && Number.isFinite(value));
  return present.length ? { min: Math.min(...present), max: Math.max(...present) } : null;
}

function shareFrom(value: unknown): SignalRow["share"] {
  const input = record(value);
  if (!input) {
    const direct = finite(value);
    if (direct == null) return null;
    const percent = direct >= 0 && direct <= 1 ? direct * 100 : direct;
    return { value: percent, lowerBound: null, upperBound: null };
  }
  const asPercent = (candidate: unknown) => {
    const numeric = finite(candidate);
    return numeric == null ? null : numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
  };
  const lowerBound = asPercent(input.lowerBound ?? input.low ?? input.min);
  const upperBound = asPercent(input.upperBound ?? input.high ?? input.max);
  const direct = asPercent(input.value ?? input.mid ?? input.midpoint ?? input.share);
  return {
    value: direct ?? (lowerBound != null && upperBound != null ? (lowerBound + upperBound) / 2 : null),
    lowerBound,
    upperBound,
  };
}

function newestTrafficSignals(db: Database.Database, appId: number, country?: string): SignalRow[] {
  const rows = db.prepare(`
    SELECT cache_key AS cacheKey, payload, generated_at AS generatedAt
      FROM traffic_intelligence_cache
     ORDER BY generated_at DESC
  `).all() as Array<{ cacheKey: string; payload: string; generatedAt: string }>;
  const selected = new Map<string, { payload: JsonRecord; generatedAt: string; full: boolean }>();

  for (const row of rows) {
    try {
      const key = JSON.parse(row.cacheKey) as { appId?: number; country?: string; terms?: unknown[] };
      const geo = String(key.country ?? "").toUpperCase();
      if (key.appId !== appId || !/^[A-Z]{2}$/.test(geo) || (country && geo !== country)) continue;
      const payload = record(JSON.parse(row.payload));
      if (!payload) continue;
      const full = !Array.isArray(key.terms) || key.terms.length === 0;
      const current = selected.get(geo);
      // Prefer the normal full-storefront snapshot over a newer ad-hoc
      // one-term request. Within the same kind, rows are already newest first.
      if (!current || (full && !current.full)) selected.set(geo, { payload, generatedAt: row.generatedAt, full });
    } catch {
      // A malformed historical cache row must not break the local matrix.
    }
  }

  const signals: SignalRow[] = [];
  for (const [geo, entry] of selected) {
    const candidates = [
      ...(Array.isArray(entry.payload.keywords) ? entry.payload.keywords : []),
      ...(Array.isArray(entry.payload.discovery) ? entry.payload.discovery : []),
    ];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const row = record(candidate);
      if (!row || typeof row.keyword !== "string") continue;
      const keyword = normalized(row.keyword);
      if (!keyword || seen.has(keyword)) continue;
      seen.add(keyword);
      signals.push({
        country: geo,
        keyword,
        source: typeof row.source === "string" ? row.source : null,
        popularity: finite(row.popularity),
        share: shareFrom(row.capturedShare ?? row.impressionShare),
        paidRank: finite(row.paidRank),
        confidence: typeof row.confidence === "string" ? row.confidence : null,
      });
    }
  }
  return signals;
}

function latestDeliveryDate(db: Database.Database, appId: number): string {
  const row = db.prepare(`
    SELECT MAX(d.date) AS value
      FROM asa_kw_daily d
      JOIN asa_keywords k ON k.id = d.keyword_id
      JOIN asa_campaigns c ON c.id = k.campaign_id
     WHERE c.app_id = ?
  `).get(appId) as { value: string | null } | undefined;
  return row?.value ?? isoDate(new Date());
}

function targetCountries(row: Pick<BaseKeywordRow, "country" | "countriesJson">): string[] {
  try {
    const parsed = JSON.parse(row.countriesJson ?? "null");
    if (Array.isArray(parsed)) {
      const values = parsed.map((value) => String(value).toUpperCase()).filter((value) => /^[A-Z]{2}$/.test(value));
      if (values.length) return [...new Set(values)];
    }
  } catch {
    // Fall back to the legacy first-country column below.
  }
  return /^[A-Z]{2}$/.test(row.country) ? [row.country] : [];
}

function loadBaseRows(db: Database.Database, appId: number, country: string | undefined, start: string, end: string): BaseKeywordRow[] {
  const countryClause = country ? `AND (
    EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(c.countries_json) THEN c.countries_json ELSE json_array(c.country) END)
       WHERE UPPER(CAST(value AS TEXT)) = ?
    )
    OR (c.countries_json IS NULL AND UPPER(c.country) = ?)
    -- delivered there in the window even if the targeting changed since
    OR EXISTS (SELECT 1 FROM asa_kw_geo_daily x WHERE x.campaign_id = c.id AND x.country = ? AND x.date BETWEEN ? AND ?)
  )` : "";
  const args: Array<string | number> = [start, end];
  if (country) args.push(start, end, country, start, end);
  args.push(appId);
  if (country) args.push(country, country, country, start, end);
  // Country scope also reads the keyword × storefront report so multi-country
  // campaigns contribute their real share of that storefront.
  const geoCtes = country ? `,
    geo AS (
      SELECT keyword_id, SUM(impressions) AS impressions, SUM(taps) AS taps,
             SUM(installs) AS installs, SUM(spend) AS spend
        FROM asa_kw_geo_daily
       WHERE date BETWEEN ? AND ? AND country = ?
       GROUP BY keyword_id
    ),
    geo_campaigns AS (
      SELECT DISTINCT campaign_id FROM asa_kw_geo_daily WHERE date BETWEEN ? AND ?
    )` : "";
  const geoColumns = country ? `,
           COALESCE(gd.impressions, 0) AS geoImpressions,
           COALESCE(gd.taps, 0) AS geoTaps,
           COALESCE(gd.installs, 0) AS geoInstalls,
           COALESCE(gd.spend, 0) AS geoSpend,
           CASE WHEN k.campaign_id IN (SELECT campaign_id FROM geo_campaigns) THEN 1 ELSE 0 END AS geoCovered` : "";
  const geoJoin = country ? "LEFT JOIN geo gd ON gd.keyword_id = k.id" : "";
  return db.prepare(`
    WITH delivery AS (
      SELECT keyword_id,
             COALESCE(SUM(impressions), 0) AS impressions,
             COALESCE(SUM(taps), 0) AS taps,
             COALESCE(SUM(installs), 0) AS installs,
             COALESCE(SUM(spend), 0) AS spend
        FROM asa_kw_daily
       WHERE date BETWEEN ? AND ?
       GROUP BY keyword_id
    )${geoCtes}
    SELECT k.id AS keywordId, k.campaign_id AS campaignId,
           c.name AS campaignName, UPPER(c.country) AS country,
           c.countries_json AS countriesJson,
           k.text, k.match_type AS matchType, k.bid,
           COALESCE(d.impressions, 0) AS impressions,
           COALESCE(d.taps, 0) AS taps,
           COALESCE(d.installs, 0) AS installs,
           COALESCE(d.spend, 0) AS spend,
           COALESCE(r.attributed_installs, 0) AS attributedInstalls,
           COALESCE(r.trials, 0) AS trials,
           COALESCE(r.paid, 0) AS paid,
           COALESCE(r.revenue_usd, 0) AS revenueUsd,
           r.updated_at AS revenueUpdatedAt,
           r.cohort_start AS cohortStart, r.cohort_end AS cohortEnd,
           r.observed_through AS observedThrough${geoColumns}
      FROM asa_keywords k
      JOIN asa_campaigns c ON c.id = k.campaign_id
      JOIN asa_ad_groups g ON g.id = k.ad_group_id
      LEFT JOIN delivery d ON d.keyword_id = k.id
      ${geoJoin}
      LEFT JOIN asa_kw_revenue r
        ON r.keyword_id = k.id AND r.campaign_id = k.campaign_id AND r.bounded = 1
     WHERE c.app_id = ? ${countryClause}
       AND c.status = 'ENABLED' AND g.status = 'ENABLED'
       AND k.status = 'ACTIVE' AND k.deleted = 0
     ORDER BY k.text, c.country
  `).all(...args) as BaseKeywordRow[];
}

function readGeoEconomicsCache(db: Database.Database, cacheKey: string): KeywordRevenuePayload | null {
  const row = db.prepare(`SELECT payload, expires_at AS expiresAt FROM adapty_keyword_geo_cache WHERE cache_key = ?`).get(cacheKey) as { payload: string; expiresAt: number } | undefined;
  if (!row || Number(row.expiresAt) <= Date.now()) return null;
  try {
    return JSON.parse(row.payload) as KeywordRevenuePayload;
  } catch {
    return null;
  }
}

async function geoEconomics(
  db: Database.Database,
  input: DecisionMatrixInput,
  country: string,
  window: { start: string; end: string },
): Promise<KeywordRevenuePayload> {
  const cacheKey = JSON.stringify({ schema: 2, appId: input.appId, country, ...window });
  const cached = input.forceRefresh ? null : readGeoEconomicsCache(db, cacheKey);
  if (cached) return cached;
  const payload = await fetchKeywordRevenue(window, { country });
  const generatedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO adapty_keyword_geo_cache (cache_key, payload, generated_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload = excluded.payload,
      generated_at = excluded.generated_at,
      expires_at = excluded.expires_at
  `).run(cacheKey, JSON.stringify(payload), generatedAt, Date.now() + GEO_ECONOMICS_TTL_MS);
  return payload;
}

function confidence(signals: SignalRow[], hasEconomics: boolean): "high" | "medium" | "low" {
  const measured = signals.filter((signal) => signal.popularity != null || signal.share?.value != null).length;
  if (hasEconomics && measured >= 2) return "high";
  if (hasEconomics || measured > 0) return "medium";
  return "low";
}

export function buildDecisionMatrix(
  db: Database.Database,
  input: DecisionMatrixInput,
  geoPayload?: KeywordRevenuePayload | null,
  geoError?: string | null,
): JsonRecord {
  const country = input.country && input.country.toUpperCase() !== "ALL" ? input.country.toUpperCase() : undefined;
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error("country must be ALL or an ISO 3166-1 alpha-2 code");
  const days = Math.max(1, Math.min(180, Math.floor(input.days ?? 30)));
  const end = latestDeliveryDate(db, input.appId);
  const startDate = new Date(`${end}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - days + 1);
  const start = isoDate(startDate);
  const loadedRows = loadBaseRows(db, input.appId, country, start, end);
  const geoByKeyword = new Map((geoPayload?.rows ?? []).map((row) => [row.keywordId, row]));
  const geoObservedAt = geoPayload?.observedThrough ?? null;
  const baseRows = country ? loadedRows.map((row) => {
    const economics = geoByKeyword.get(row.keywordId);
    const storefronts = targetCountries(row);
    const multiCountry = storefronts.length > 1;
    // A multi-country campaign's keyword totals span every storefront. Use the
    // keyword × storefront report when the campaign has it; without that split
    // the delivery cannot be assigned to one storefront and stays out (0).
    const split = multiCountry && row.geoCovered === 1;
    return {
      ...row,
      impressions: split ? Number(row.geoImpressions ?? 0) : multiCountry ? 0 : row.impressions,
      taps: split ? Number(row.geoTaps ?? 0) : multiCountry ? 0 : row.taps,
      installs: split ? Number(row.geoInstalls ?? 0) : multiCountry ? 0 : row.installs,
      spend: split ? Number(row.geoSpend ?? 0) : multiCountry ? 0 : row.spend,
      attributedInstalls: economics?.attributedInstalls ?? 0,
      trials: economics?.trials ?? 0,
      paid: economics?.paid ?? 0,
      revenueUsd: economics?.revenueUsd ?? 0,
      revenueUpdatedAt: geoPayload ? geoObservedAt : null,
      cohortStart: geoPayload?.window.start ?? null,
      cohortEnd: geoPayload?.window.end ?? null,
      observedThrough: geoObservedAt,
    };
  }) : loadedRows;
  const allSignals = newestTrafficSignals(db, input.appId, country);
  const signalsByKeyword = new Map<string, SignalRow[]>();
  for (const signal of allSignals) signalsByKeyword.set(signal.keyword, [...(signalsByKeyword.get(signal.keyword) ?? []), signal]);

  const groups = new Map<string, BaseKeywordRow[]>();
  for (const row of baseRows) {
    const key = normalized(row.text);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const keywordKeys = new Set([...groups.keys(), ...signalsByKeyword.keys()]);
  const keywords = [...keywordKeys].map((key) => {
    const owned = groups.get(key) ?? [];
    const signals = signalsByKeyword.get(key) ?? [];
    const hasEconomics = owned.some((row) => Boolean(row.revenueUpdatedAt));
    const impressions = owned.reduce((sum, row) => sum + Number(row.impressions || 0), 0);
    const taps = owned.reduce((sum, row) => sum + Number(row.taps || 0), 0);
    const installs = owned.reduce((sum, row) => sum + Number(row.installs || 0), 0);
    const spend = owned.reduce((sum, row) => sum + Number(row.spend || 0), 0);
    const attributedInstalls = owned.reduce((sum, row) => sum + Number(row.attributedInstalls || 0), 0);
    const trials = owned.reduce((sum, row) => sum + Number(row.trials || 0), 0);
    const paid = owned.reduce((sum, row) => sum + Number(row.paid || 0), 0);
    const revenueUsd = owned.reduce((sum, row) => sum + Number(row.revenueUsd || 0), 0);
    const shares = signals.map((signal) => signal.share).filter((value): value is NonNullable<SignalRow["share"]> => value != null);
    const shareValue = average(shares.map((share) => share.value));
    const lowerBound = average(shares.map((share) => share.lowerBound));
    const upperBound = average(shares.map((share) => share.upperBound));
    const bids = owned.map((row) => row.bid);
    const ranks = signals.map((signal) => signal.paidRank);
    const countries = [...new Set([...owned.flatMap(targetCountries), ...signals.map((signal) => signal.country)])].sort();
    const sources = [...new Set(signals.flatMap((signal) => signal.source?.split(", ") ?? []))];
    const cohortStarts = owned.map((row) => row.cohortStart).filter((value): value is string => Boolean(value)).sort();
    const cohortEnds = owned.map((row) => row.cohortEnd).filter((value): value is string => Boolean(value)).sort();
    const updated = owned.map((row) => row.revenueUpdatedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const observedThrough = owned.map((row) => row.observedThrough).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
    const countryAverage = !country && signals.length > 1;
    return {
      keyword: owned[0]?.text ?? signals[0]?.keyword ?? key,
      source: sources.length ? sources.join(", ") : owned.length ? "owned-keyword" : "impression-share",
      tracked: owned.length > 0,
      popularity: average(signals.map((signal) => signal.popularity)),
      impressionShare: shareValue == null && lowerBound == null && upperBound == null ? null : {
        value: shareValue,
        lowerBound,
        upperBound,
        basis: shares.some((share) => share.lowerBound != null || share.upperBound != null) ? "bounded" : "modeled",
        aggregation: countryAverage ? "mean-across-storefronts" : "storefront",
      },
      capturedShare: shareValue == null && lowerBound == null && upperBound == null ? null : {
        value: shareValue,
        lowerBound,
        upperBound,
        basis: shares.some((share) => share.lowerBound != null || share.upperBound != null) ? "bounded" : "modeled",
        aggregation: countryAverage ? "mean-across-storefronts" : "storefront",
      },
      paidRank: country ? (ranks.filter((value): value is number => value != null)[0] ?? null) : null,
      paidRankRange: range(ranks),
      bid: country ? average(bids) : null,
      bidRange: range(bids),
      currency: "USD",
      matchTypes: [...new Set(owned.map((row) => row.matchType))],
      campaignCount: new Set(owned.map((row) => row.campaignId)).size,
      keywordCount: owned.length,
      countryCount: countries.length,
      countries,
      signalCountryCount: new Set(signals.map((signal) => signal.country)).size,
      impressions,
      taps,
      installs,
      spend: Math.round(spend * 100) / 100,
      attributedInstalls: hasEconomics ? attributedInstalls : null,
      trials: hasEconomics ? trials : null,
      paid: hasEconomics ? paid : null,
      revenueUsd: hasEconomics ? Math.round(revenueUsd * 100) / 100 : null,
      revenueUpdatedAt: updated,
      realizedRoas: hasEconomics && spend > 0 ? Math.round((revenueUsd / spend) * 10_000) / 10_000 : null,
      cpaTrial: hasEconomics && trials > 0 ? Math.round((spend / trials) * 100) / 100 : null,
      cpaPaid: hasEconomics && paid > 0 ? Math.round((spend / paid) * 100) / 100 : null,
      economicsGrain: hasEconomics ? (country ? "attributed-keyword-country" : "attributed-keyword-global") : "missing",
      cohortMaturity: "unknown",
      cohort: hasEconomics ? {
        start: cohortStarts[0] ?? null,
        end: cohortEnds.at(-1) ?? null,
        observedThrough,
        maturity: "unknown",
        source: "Adapty · profile_install_date",
      } : null,
      confidence: confidence(signals, hasEconomics),
      relevanceStatus: hasMedicalIntent(owned[0]?.text ?? signals[0]?.keyword ?? key)
        ? "medical-intent"
        : owned.length ? "account-keyword" : "rejected",
      aggregation: country ? "single-storefront" : "all-storefronts",
      reason: countryAverage
        ? `Спрос и доля — среднее по ${new Set(signals.map((signal) => signal.country)).size} витринам; доставка и экономика — сумма.`
        : "Доставка и экономика — фактические суммы по ключам аккаунта.",
    };
  }).sort((a, b) => Number(b.trials ?? -1) - Number(a.trials ?? -1)
    || Number(b.attributedInstalls ?? -1) - Number(a.attributedInstalls ?? -1)
    || Number(b.popularity ?? -1) - Number(a.popularity ?? -1)
    || String(a.keyword).localeCompare(String(b.keyword)));

  const tracked = keywords.filter((row) => row.tracked);
  const rawDiscovery = keywords.filter((row) => !row.tracked);
  // A popularity/share signal proves that an ad appeared, not that the query
  // belongs to MedScan. Only medically relevant discovery terms can become
  // decision candidates; account-owned terms remain visible for waste audits.
  const discovery = rawDiscovery.filter((row) => hasMedicalIntent(String(row.keyword)));
  const rejectedDiscovery = rawDiscovery.length - discovery.length;
  const countryRows = loadBaseRows(db, input.appId, undefined, start, end);
  const countryGroups = new Map<string, BaseKeywordRow[]>();
  for (const row of countryRows) {
    for (const geo of targetCountries(row)) countryGroups.set(geo, [...(countryGroups.get(geo) ?? []), row]);
  }
  const cachedCountries = new Set(newestTrafficSignals(db, input.appId).map((signal) => signal.country));
  const availableCountries = [...new Set([...countryGroups.keys(), ...cachedCountries])].sort().map((geo) => {
    const rows = countryGroups.get(geo) ?? [];
    const attributedRows = rows.filter((row) => Boolean(row.revenueUpdatedAt));
    return {
      code: geo,
      keywordCount: rows.length,
      attributedInstalls: attributedRows.reduce((sum, row) => sum + Number(row.attributedInstalls || 0), 0),
      trials: attributedRows.reduce((sum, row) => sum + Number(row.trials || 0), 0),
      paid: attributedRows.reduce((sum, row) => sum + Number(row.paid || 0), 0),
      revenueUsd: Math.round(attributedRows.reduce((sum, row) => sum + Number(row.revenueUsd || 0), 0) * 100) / 100,
    };
  });

  const totals = tracked.reduce((summary, row) => ({
    impressions: summary.impressions + Number(row.impressions || 0),
    taps: summary.taps + Number(row.taps || 0),
    installs: summary.installs + Number(row.installs || 0),
    attributedInstalls: summary.attributedInstalls + Number(row.attributedInstalls || 0),
    trials: summary.trials + Number(row.trials || 0),
    paid: summary.paid + Number(row.paid || 0),
    spend: summary.spend + Number(row.spend || 0),
    revenueUsd: summary.revenueUsd + Number(row.revenueUsd || 0),
  }), { impressions: 0, taps: 0, installs: 0, attributedInstalls: 0, trials: 0, paid: 0, spend: 0, revenueUsd: 0 });

  return {
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    scope: country ? "country" : "all",
    country: country ?? null,
    window: { start, end, days, label: `${days} дней` },
    availableCountries,
    summary: {
      countries: country ? 1 : availableCountries.length,
      keywords: tracked.length,
      discoveryCandidates: discovery.length,
      rejectedDiscovery,
      ...totals,
      installToTrial: totals.attributedInstalls > 0 ? totals.trials / totals.attributedInstalls : null,
      trialToPaid: totals.trials > 0 ? totals.paid / totals.trials : null,
      installToPaid: totals.attributedInstalls > 0 ? totals.paid / totals.attributedInstalls : null,
      roas: totals.spend > 0 ? totals.revenueUsd / totals.spend : null,
    },
    keywords: tracked,
    discovery,
    unverifiedSuggestions: [],
    partialErrors: geoError ? [{ scope: "Adapty · ключ × страна", message: geoError }] : [],
    limitations: {
      allScope: "Доставка, атрибутированные установки, триалы, оплаты, расход и выручка суммируются. Популярность и доля — средние по витринам, где Apple вернула сигнал.",
      countryScope: "Country-level installs, trials, paid and net revenue use an explicit Adapty country filter. Apple delivery/spend of multi-country campaigns comes from the keyword × storefront report (groupBy countryOrRegion); campaigns without that split yet are excluded rather than guessed.",
      maturity: "Keyword-level D7/D30/D60 maturity is not available in the current Adapty segmentation and is never inferred.",
      relevance: `${rejectedDiscovery} non-medical Apple signals were kept out of the decision queue by the MedScan relevance gate.`,
    },
  };
}

export async function getDecisionMatrix(db: Database.Database, input: DecisionMatrixInput): Promise<JsonRecord> {
  const country = input.country && input.country.toUpperCase() !== "ALL" ? input.country.toUpperCase() : undefined;
  if (!country) return buildDecisionMatrix(db, input);
  const end = latestDeliveryDate(db, input.appId);
  const days = Math.max(1, Math.min(180, Math.floor(input.days ?? 30)));
  const startDate = new Date(`${end}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - days + 1);
  const window = { start: isoDate(startDate), end };
  try {
    return buildDecisionMatrix(db, input, await geoEconomics(db, input, country, window));
  } catch (error) {
    return buildDecisionMatrix(db, input, null, error instanceof Error ? error.message : String(error));
  }
}
