import { getDb } from "./db.ts";
import type { AsaClient, RawCampaign, RawAdGroup, RawKeyword, RawKeywordReport, RawSearchTermReport, RawCampaignGeoReport, ReportTotals } from "./asa-client.ts";
import type { AscClient } from "./asc-client.ts";
import { fetchKeywordRevenue } from "./revenue-client.ts";
import { broadcast } from "./sse.ts";

function now(): string { return new Date().toISOString(); }

function toNum(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function totalsFrom(t: ReportTotals): {
  imp: number; taps: number; installs: number; spend: number; ttr: number; cpt: number; cpi: number; ir: number;
} {
  return {
    imp: t.impressions ?? 0,
    taps: t.taps ?? 0,
    installs: t.totalInstalls ?? 0,
    spend: toNum(t.localSpend?.amount),
    ttr: t.ttr ?? 0,
    cpt: toNum(t.avgCPT?.amount),
    cpi: toNum(t.totalAvgCPI?.amount),
    ir: t.totalInstallRate ?? 0,
  };
}

export async function syncCampaigns(asa: AsaClient): Promise<RawCampaign[]> {
  const db = getDb();
  const campaigns = await asa.listCampaigns();
  const upsert = db.prepare(`
    INSERT INTO asa_campaigns
      (id, org_id, app_id, name, country, countries_json, status, serving_status, display_status,
       daily_budget, lifetime_budget, bidding_strategy, target_cpa, start_time, end_time, updated_at, synced_at)
    VALUES (@id, @org_id, @app_id, @name, @country, @countries_json, @status, @serving_status, @display_status,
            @daily_budget, @lifetime_budget, @bidding_strategy, @target_cpa, @start_time, @end_time, @updated_at, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, country=excluded.country, countries_json=excluded.countries_json, status=excluded.status,
      serving_status=excluded.serving_status, display_status=excluded.display_status,
      daily_budget=excluded.daily_budget, lifetime_budget=excluded.lifetime_budget,
      bidding_strategy=excluded.bidding_strategy, target_cpa=excluded.target_cpa,
      start_time=excluded.start_time, end_time=excluded.end_time,
      updated_at=excluded.updated_at, synced_at=excluded.synced_at
  `);
  const ts = now();
  db.transaction(() => {
    // Apple omits permanently deleted campaigns from listCampaigns(). Keep
    // their historical delivery rows, but never leave a vanished campaign
    // looking ENABLED in the local read model.
    const liveIds = campaigns.map((campaign) => campaign.id);
    if (liveIds.length) {
      const placeholders = liveIds.map(() => "?").join(",");
      db.prepare(`
        UPDATE asa_campaigns
        SET status = 'DELETED',
            serving_status = 'NOT_RUNNING',
            display_status = 'DELETED',
            synced_at = ?
        WHERE id NOT IN (${placeholders})
      `).run(ts, ...liveIds);
    } else {
      db.prepare(`
        UPDATE asa_campaigns
        SET status = 'DELETED',
            serving_status = 'NOT_RUNNING',
            display_status = 'DELETED',
            synced_at = ?
      `).run(ts);
    }
    for (const c of campaigns) {
      upsert.run({
        id: c.id,
        org_id: 0,
        app_id: c.adamId,
        name: c.name,
        country: (c.countriesOrRegions ?? [])[0] ?? "",
        countries_json: JSON.stringify(c.countriesOrRegions ?? []),
        status: c.status,
        serving_status: c.servingStatus ?? null,
        display_status: c.displayStatus ?? null,
        daily_budget: toNum(c.dailyBudgetAmount?.amount),
        lifetime_budget: toNum(c.budgetAmount?.amount),
        bidding_strategy: c.biddingStrategy ?? null,
        target_cpa: c.targetCpa ? toNum(c.targetCpa.amount) : null,
        start_time: c.startTime ?? null,
        end_time: c.endTime ?? null,
        updated_at: c.modificationTime ?? ts,
        synced_at: ts,
      });
    }
  })();
  return campaigns;
}

export async function syncAdGroupsAndKeywords(asa: AsaClient, campaignIds: number[]): Promise<{ adGroups: RawAdGroup[]; keywords: RawKeyword[] }> {
  const db = getDb();
  const ts = now();
  const adGroups: RawAdGroup[] = [];
  const keywords: RawKeyword[] = [];

  const upsertAdg = db.prepare(`
    INSERT INTO asa_ad_groups (id, campaign_id, name, default_bid, status, cpa_goal, synced_at)
    VALUES (@id, @campaign_id, @name, @default_bid, @status, @cpa_goal, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, default_bid=excluded.default_bid, status=excluded.status,
      cpa_goal=excluded.cpa_goal, synced_at=excluded.synced_at
  `);
  const upsertKw = db.prepare(`
    INSERT INTO asa_keywords (id, ad_group_id, campaign_id, text, match_type, bid, status, deleted, synced_at)
    VALUES (@id, @ad_group_id, @campaign_id, @text, @match_type, @bid, @status, @deleted, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      text=excluded.text, match_type=excluded.match_type, bid=excluded.bid,
      status=excluded.status, deleted=excluded.deleted, synced_at=excluded.synced_at
  `);

  for (const cid of campaignIds) {
    const adgs = await asa.listAdGroups(cid);
    adGroups.push(...adgs);
    db.transaction(() => {
      for (const a of adgs) {
        upsertAdg.run({
          id: a.id,
          campaign_id: a.campaignId,
          name: a.name,
          default_bid: toNum(a.defaultBidAmount?.amount),
          status: a.status,
          cpa_goal: a.cpaGoal ? toNum(a.cpaGoal.amount) : null,
          synced_at: ts,
        });
      }
    })();
    for (const a of adgs) {
      const kws = await asa.listKeywords(cid, a.id);
      keywords.push(...kws);
      db.transaction(() => {
        for (const k of kws) {
          upsertKw.run({
            id: k.id,
            ad_group_id: k.adGroupId,
            campaign_id: k.campaignId,
            text: k.text,
            match_type: k.matchType,
            bid: toNum(k.bidAmount?.amount),
            status: k.status,
            deleted: k.deleted ? 1 : 0,
            synced_at: ts,
          });
        }
      })();
    }
  }
  return { adGroups, keywords };
}

export async function syncDailyReports(asa: AsaClient, startDate: string, endDate: string, campaignIds: number[]): Promise<void> {
  const db = getDb();

  const campRows = await asa.campaignReport(startDate, endDate);
  const upDaily = db.prepare(`
    INSERT INTO asa_daily (campaign_id, date, impressions, taps, installs, spend, ttr, cpt, cpi, install_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, date) DO UPDATE SET
      impressions=excluded.impressions, taps=excluded.taps, installs=excluded.installs,
      spend=excluded.spend, ttr=excluded.ttr, cpt=excluded.cpt, cpi=excluded.cpi,
      install_rate=excluded.install_rate
  `);
  const upAppName = db.prepare(`UPDATE asa_campaigns SET app_name = ? WHERE id = ? AND (app_name IS NULL OR app_name != ?)`);
  db.transaction(() => {
    for (const row of campRows) {
      const cid = row.metadata.campaignId;
      const appName = (row.metadata as { app?: { appName?: string } }).app?.appName;
      if (appName) upAppName.run(appName, cid, appName);
      for (const g of row.granularity ?? []) {
        const t = totalsFrom(g);
        upDaily.run(cid, g.date, t.imp, t.taps, t.installs, t.spend, t.ttr, t.cpt, t.cpi, t.ir);
      }
    }
  })();

  const upKwDaily = db.prepare(`
    INSERT INTO asa_kw_daily (keyword_id, date, impressions, taps, installs, spend, cpt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(keyword_id, date) DO UPDATE SET
      impressions=excluded.impressions, taps=excluded.taps, installs=excluded.installs,
      spend=excluded.spend, cpt=excluded.cpt
  `);
  for (const cid of campaignIds) {
    let kwRows: RawKeywordReport[] = [];
    try {
      kwRows = await asa.keywordReport(cid, startDate, endDate);
    } catch (e) {
      console.warn(`keywordReport(${cid}) failed: ${(e as Error).message}`);
      continue;
    }
    db.transaction(() => {
      for (const row of kwRows) {
        const kid = row.metadata.keywordId;
        for (const g of row.granularity ?? []) {
          const t = totalsFrom(g);
          upKwDaily.run(kid, g.date, t.imp, t.taps, t.installs, t.spend, t.cpt);
        }
      }
    })();
  }

  const upSt = db.prepare(`
    INSERT INTO asa_search_terms (campaign_id, date, term, source_keyword_id, match_type, impressions, taps, installs, spend)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, date, term, source_keyword_id) DO UPDATE SET
      impressions=excluded.impressions, taps=excluded.taps, installs=excluded.installs, spend=excluded.spend
  `);
  for (const cid of campaignIds) {
    let stRows: RawSearchTermReport[] = [];
    try {
      stRows = await asa.searchTermReport(cid, startDate, endDate);
    } catch (e) {
      console.warn(`searchTermReport(${cid}) failed: ${(e as Error).message}`);
      continue;
    }
    db.transaction(() => {
      for (const row of stRows) {
        const term = row.metadata.searchTermText ?? "";
        const srcKw = row.metadata.keywordId ?? null;
        const mt = row.metadata.matchType ?? null;
        for (const g of row.granularity ?? []) {
          const t = totalsFrom(g);
          upSt.run(cid, g.date, term, srcKw, mt, t.imp, t.taps, t.installs, t.spend);
        }
      }
    })();
  }
}

/** Storefront split of every campaign (dedicated and multi-country). Soft-fails:
 *  without it the geo views fall back to campaign-country attribution. */
export async function syncGeoDaily(asa: AsaClient, startDate: string, endDate: string): Promise<number> {
  let rows: RawCampaignGeoReport[];
  try {
    rows = await asa.campaignGeoReport(startDate, endDate);
  } catch (e) {
    console.warn(`ASA geo report: ${(e as Error).message}`);
    return 0;
  }
  const db = getDb();
  const up = db.prepare(`
    INSERT INTO asa_geo_daily (campaign_id, date, country, impressions, taps, installs, spend)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, date, country) DO UPDATE SET
      impressions=excluded.impressions, taps=excluded.taps,
      installs=excluded.installs, spend=excluded.spend
  `);
  let n = 0;
  db.transaction(() => {
    // The report omits empty rows, so clear the window first to drop rows that went to zero.
    db.prepare(`DELETE FROM asa_geo_daily WHERE date BETWEEN ? AND ?`).run(startDate, endDate);
    for (const row of rows) {
      const country = row.metadata.countryOrRegion?.trim().toUpperCase();
      if (!country || !/^[A-Z]{2}$/.test(country)) continue;
      for (const g of row.granularity ?? []) {
        const t = totalsFrom(g);
        up.run(row.metadata.campaignId, g.date, country, t.imp, t.taps, t.installs, t.spend);
        n++;
      }
    }
  })();
  return n;
}

export async function syncAscEvents(asc: AscClient, dates: string[]): Promise<void> {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO asc_events_daily (app_id, date, country, product, event_type, events)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_id, date, country, product, event_type) DO UPDATE SET events=excluded.events
  `);
  for (const d of dates) {
    let rows;
    try {
      rows = await asc.subscriptionEvents(d);
    } catch (e) {
      console.warn(`ASC events ${d}: ${(e as Error).message}`);
      continue;
    }
    db.transaction(() => {
      for (const r of rows) {
        if (!r.appId) continue;
        upsert.run(r.appId, r.date, r.country, r.product, r.eventType, r.events);
      }
    })();
  }
}

/** Pull Apple Ads keyword economics directly from Adapty and replace the local
 * snapshot. Soft-fails so an analytics outage never breaks the Apple sync. */
export async function syncAsaRevenue(
  cohortWindow: { start: string; end: string },
): Promise<number> {
  const db = getDb();
  let payload;
  try {
    payload = await fetchKeywordRevenue(cohortWindow);
  } catch (e) {
    console.warn(`ASA revenue pull: ${(e as Error).message}`);
    return 0;
  }
  const keywordOwner = db.prepare(`
    SELECT k.campaign_id AS campaignId, k.ad_group_id AS adGroupId,
           c.country AS fallbackCountry, c.countries_json AS countriesJson
    FROM asa_keywords k
    JOIN asa_campaigns c ON c.id = k.campaign_id
    WHERE k.id = ?
    LIMIT 1
  `);
  const rows = payload.rows.map((row) => {
    const owner = keywordOwner.get(row.keywordId) as
      { campaignId: number; adGroupId: number; fallbackCountry: string | null; countriesJson: string | null } | undefined;
    if (!owner) return row;
    return {
      ...row,
      campaignId: owner.campaignId,
      adGroupId: owner.adGroupId,
      country: attributableCampaignCountry(owner.countriesJson, owner.fallbackCountry),
    };
  }).filter((row) => row.campaignId > 0 && row.keywordId > 0);
  const upsert = db.prepare(`
    INSERT INTO asa_kw_revenue (
      campaign_id, keyword_id, country, attributed_installs, trials, paid,
      revenue_usd, cohort_start, cohort_end, observed_through, windows_json,
      bounded, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(campaign_id, keyword_id) DO UPDATE SET
      country=excluded.country, attributed_installs=excluded.attributed_installs,
      trials=excluded.trials, paid=excluded.paid, revenue_usd=excluded.revenue_usd,
      cohort_start=excluded.cohort_start, cohort_end=excluded.cohort_end,
      observed_through=excluded.observed_through, windows_json=excluded.windows_json,
      bounded=excluded.bounded, updated_at=excluded.updated_at
  `);
  const ts = now();
  db.transaction(() => {
    // This is a complete bounded snapshot. Deleting first prevents historical
    // and removed keyword rows from silently surviving forever.
    db.prepare("DELETE FROM asa_kw_revenue").run();
    for (const r of rows) {
      upsert.run(
        r.campaignId,
        r.keywordId,
        r.country,
        r.attributedInstalls,
        r.trials,
        r.paid,
        r.revenueUsd,
        payload.window.start,
        payload.window.end,
        payload.observedThrough,
        JSON.stringify(r.windows),
        ts,
      );
    }
  })();
  return rows.length;
}

/**
 * Keyword-level Adapty attribution does not include storefront. A campaign's
 * country is therefore usable only when that campaign targets exactly one
 * storefront. Multi-geo campaigns must stay unlabelled instead of inheriting
 * the first item in countries_json.
 */
export function attributableCampaignCountry(
  countriesJson: string | null | undefined,
  fallbackCountry: string | null | undefined,
): string | null {
  if (countriesJson) {
    try {
      const countries = JSON.parse(countriesJson) as unknown;
      if (Array.isArray(countries)) {
        if (countries.length !== 1 || typeof countries[0] !== "string") return null;
        const country = countries[0].trim().toUpperCase();
        return /^[A-Z]{2}$/.test(country) ? country : null;
      }
    } catch {
      // Older rows may predate countries_json; use the dedicated-country field.
    }
  }
  const fallback = fallbackCountry?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(fallback) ? fallback : null;
}

export function listDates(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start);
  const e = new Date(end);
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface SyncStatus {
  active: boolean;
  phase: string;
  label: string;
  progress: number;
  started_at: string | null;
  finished_at: string | null;
  ok: number | null;
  error: string | null;
}

let currentSync: SyncStatus | null = null;

export function getSyncStatus(): SyncStatus {
  if (currentSync) return currentSync;
  const db = getDb();
  const last = db.prepare(`SELECT started_at, finished_at, ok, error FROM sync_log ORDER BY id DESC LIMIT 1`).get() as
    | { started_at: string; finished_at: string | null; ok: number | null; error: string | null }
    | undefined;
  return {
    active: false,
    phase: "idle",
    label: last?.ok === 1 ? "Last sync OK" : last?.ok === 0 ? "Last sync failed" : "No sync yet",
    progress: last?.ok === 1 ? 1 : 0,
    started_at: last?.started_at ?? null,
    finished_at: last?.finished_at ?? null,
    ok: last?.ok ?? null,
    error: last?.error ?? null,
  };
}

function setPhase(phase: string, label: string, progress: number, started: string): void {
  currentSync = {
    active: true,
    phase, label, progress,
    started_at: started,
    finished_at: null,
    ok: null,
    error: null,
  };
  broadcast("sync:phase", { phase, label, progress });
}

/**
 * Campaign structure and delivery reports have deliberately different scopes.
 * Paused campaigns still need their ad groups and keywords in the local read
 * model so a staged rebuild is inspectable before cutover. Report endpoints,
 * however, are only useful for campaigns that can currently deliver.
 */
export function campaignSyncScopes(campaigns: RawCampaign[]): {
  structureIds: number[];
  reportIds: number[];
} {
  return {
    structureIds: campaigns.map((campaign) => campaign.id),
    reportIds: campaigns
      .filter((campaign) => campaign.status === "ENABLED")
      .map((campaign) => campaign.id),
  };
}

export async function fullSync(asa: AsaClient, asc: AscClient, days = 14): Promise<{ campaigns: number; adGroups: number; keywords: number }> {
  const db = getDb();
  const startedAt = now();
  const log = db.prepare(`INSERT INTO sync_log (kind, started_at) VALUES (?, ?)`).run("full", startedAt);
  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - Math.max(0, days - 1) * 86400_000).toISOString().slice(0, 10);

    setPhase("campaigns", "Pulling campaigns", 0.05, startedAt);
    const campaigns = await syncCampaigns(asa);
    const { structureIds, reportIds } = campaignSyncScopes(campaigns);

    setPhase("adgroups", `Loading ad groups & keywords (${structureIds.length} campaigns)`, 0.2, startedAt);
    const { adGroups, keywords } = await syncAdGroupsAndKeywords(asa, structureIds);

    setPhase("daily", `Fetching daily metrics + per-keyword + search terms (${reportIds.length} enabled campaigns)`, 0.45, startedAt);
    await syncDailyReports(asa, startDate, endDate, reportIds);
    await syncGeoDaily(asa, startDate, endDate);

    setPhase("asc", `Pulling ${days} days of ASC subscription events`, 0.8, startedAt);
    await syncAscEvents(asc, listDates(startDate, endDate));

    setPhase("revenue", "Loading Apple Ads keyword economics from Adapty", 0.9, startedAt);
    await syncAsaRevenue({ start: startDate, end: endDate });

    setPhase("done", "Complete", 1.0, startedAt);
    db.prepare(`UPDATE sync_log SET finished_at = ?, ok = 1 WHERE id = ?`).run(now(), log.lastInsertRowid);
    setTimeout(() => { currentSync = null; }, 3000);
    return { campaigns: campaigns.length, adGroups: adGroups.length, keywords: keywords.length };
  } catch (e) {
    const msg = (e as Error).message;
    if (currentSync) { currentSync.active = false; currentSync.error = msg; currentSync.ok = 0; }
    db.prepare(`UPDATE sync_log SET finished_at = ?, ok = 0, error = ? WHERE id = ?`)
      .run(now(), msg, log.lastInsertRowid);
    setTimeout(() => { currentSync = null; }, 5000);
    throw e;
  }
}
