import { getDb } from "./db.ts";
import type { AsaClient, RawCampaign, RawAdGroup, RawKeyword, RawCampaignReport, RawKeywordReport, RawSearchTermReport, ReportTotals } from "./asa-client.ts";
import type { AscClient } from "./asc-client.ts";
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
      (id, org_id, app_id, name, country, status, serving_status, display_status,
       daily_budget, lifetime_budget, bidding_strategy, target_cpa, start_time, end_time, updated_at, synced_at)
    VALUES (@id, @org_id, @app_id, @name, @country, @status, @serving_status, @display_status,
            @daily_budget, @lifetime_budget, @bidding_strategy, @target_cpa, @start_time, @end_time, @updated_at, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, country=excluded.country, status=excluded.status,
      serving_status=excluded.serving_status, display_status=excluded.display_status,
      daily_budget=excluded.daily_budget, lifetime_budget=excluded.lifetime_budget,
      bidding_strategy=excluded.bidding_strategy, target_cpa=excluded.target_cpa,
      start_time=excluded.start_time, end_time=excluded.end_time,
      updated_at=excluded.updated_at, synced_at=excluded.synced_at
  `);
  const ts = now();
  db.transaction(() => {
    for (const c of campaigns) {
      upsert.run({
        id: c.id,
        org_id: 0,
        app_id: c.adamId,
        name: c.name,
        country: (c.countriesOrRegions ?? [])[0] ?? "",
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

export async function fullSync(asa: AsaClient, asc: AscClient, days = 14): Promise<{ campaigns: number; adGroups: number; keywords: number }> {
  const db = getDb();
  const startedAt = now();
  const log = db.prepare(`INSERT INTO sync_log (kind, started_at) VALUES (?, ?)`).run("full", startedAt);
  try {
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

    setPhase("campaigns", "Pulling campaigns", 0.05, startedAt);
    const campaigns = await syncCampaigns(asa);
    const activeIds = campaigns.filter((c) => c.status === "ENABLED").map((c) => c.id);

    setPhase("adgroups", `Loading ad groups & keywords (${activeIds.length} campaigns)`, 0.2, startedAt);
    const { adGroups, keywords } = await syncAdGroupsAndKeywords(asa, activeIds);

    setPhase("daily", `Fetching daily metrics + per-keyword + search terms`, 0.45, startedAt);
    await syncDailyReports(asa, startDate, endDate, activeIds);

    setPhase("asc", `Pulling ${days} days of ASC subscription events`, 0.8, startedAt);
    await syncAscEvents(asc, listDates(startDate, endDate));

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
