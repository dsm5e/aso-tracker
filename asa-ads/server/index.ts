import "dotenv/config";
import express from "express";
import { ADAPTY_ANALYTICS_APP_ID, loadConfig } from "./config.ts";
import { openDb, getDb } from "./db.ts";
import { AsaClient } from "./asa-client.ts";
import { AscClient } from "./asc-client.ts";
import { fullSync, getSyncStatus } from "./sync.ts";
import { listCampaignsWithMetrics, listKeywordsWithMetrics, listSearchTerms, listActions, dailyTotals, listApps } from "./queries.ts";
import { recommend, suggestSearchTermActions } from "./bid-engine.ts";
import { projectCampaign, projectKeyword } from "./roi-engine.ts";
import { enqueue, apply, cancel, type Action } from "./actions.ts";
import { attach, broadcast } from "./sse.ts";
import { checkAndSendAlerts, listAlerts, loadAlertsConfig } from "./alerts.ts";
import { loadSettings, updateSettings, suggestSettings } from "./settings.ts";
import { getCredentialsMasked, setCredentials, PROVIDERS, type Provider } from "./credentials.ts";
import { integrationsStatus } from "./integrations.ts";
import { fetchRevenueRows } from "./revenue.ts";
import { commandCenter, accountHealth } from "./command-center.ts";
import { PlatformApiClient } from "./platform-api-client.ts";
import { PLATFORM_API_METHODS } from "./platform-api-methods.ts";
import { PlatformReadService } from "./platform-read-service.ts";
import { parseTrafficQuery, TrafficIntelligenceService } from "./traffic-intelligence.ts";
import { TrafficSyncScheduler } from "./traffic-sync-scheduler.ts";
import { dataQuality } from "./data-quality.ts";
import { AscAnalyticsService } from "./asc-analytics.ts";
import { AdaptyAnalyticsService } from "./adapty-analytics.ts";
import { getDecisionMatrix } from "./decision-matrix.ts";
import { getCachedTop5Batch } from "./aso-ranking-batch.ts";

const cfg = loadConfig();
openDb(cfg.dataDir);
const asa = new AsaClient(cfg.asa);
const asc = new AscClient(cfg.asc);
const platform = new PlatformApiClient(asa, cfg.asa.orgId);
const platformReads = new PlatformReadService(getDb(), platform);
const trafficIntelligence = new TrafficIntelligenceService(getDb(), platform);
const trafficSyncScheduler = new TrafficSyncScheduler(getDb(), trafficIntelligence, {
  enabled: process.env.TRAFFIC_SYNC_ENABLED !== "false",
  concurrency: Number(process.env.TRAFFIC_SYNC_CONCURRENCY ?? 1),
  prioritySpendThreshold: Number(process.env.TRAFFIC_SYNC_PRIORITY_SPEND ?? 25),
  nightlyHourUtc: Number(process.env.TRAFFIC_SYNC_HOUR_UTC ?? 2),
});
const ascAnalytics = new AscAnalyticsService(asc);
const adaptyAnalytics = new AdaptyAnalyticsService(getDb(), ADAPTY_ANALYTICS_APP_ID || 6762091560);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/sse", (_req, res) => attach(res));

app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/api/apps", (_req, res) => res.json(listApps()));

app.get("/api/platform/methods", (_req, res) => {
  const sections = [...new Set(PLATFORM_API_METHODS.map((method) => method.section))];
  const methods = platformReads.catalog().map((method) => ({
    ...method,
    group: method.section,
    name: method.title,
    access: method.kind === "read" ? "read" : "write",
    integrated: method.collector !== null,
    docsUrl: method.documentationUrl,
  }));
  res.json({
    api: "Apple Ads Platform API",
    version: "v1",
    baseUrl: "https://api.ads.apple.com/v1",
    generatedFromOfficialDocs: "2026-09-04",
    mode: "read-only",
    totals: {
      methods: PLATFORM_API_METHODS.length,
      integrated: methods.filter((method) => method.integrated).length,
      catalogOnly: PLATFORM_API_METHODS.filter((method) => method.integration === "catalog-only").length,
      reads: PLATFORM_API_METHODS.filter((method) => method.kind === "read").length,
      mutations: PLATFORM_API_METHODS.filter((method) => method.kind === "mutation").length,
      sections: sections.length,
    },
    integrationLegend: {
      "typed-collector": "Collected by an explicit read-only Platform endpoint and saved as a durable snapshot",
      "generic-read-ready": "Can be queried through the constrained read-only executor",
      "blocked-in-audit-mode": "Mutation endpoint; never callable unless the server is explicitly switched out of audit mode",
    },
    methods,
  });
});

app.post("/api/platform/read", async (req, res) => {
  try {
    const appId = req.body?.appId === undefined ? undefined : Number(req.body.appId);
    if (appId !== undefined && (!Number.isSafeInteger(appId) || appId <= 0)) throw new Error("appId must be a positive integer");
    res.json(await platformReads.executeGeneric({
      methodId: String(req.body?.methodId ?? ""),
      pathParams: req.body?.pathParams,
      body: req.body?.body,
      appId,
      force: req.body?.force === true,
    }));
  } catch (error) {
    const status = error instanceof Error && /read-only|Unknown|Missing path|Invalid path|body|filters/i.test(error.message) ? 400 : 502;
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/platform/inventory", async (req, res) => {
  const appId = Number(req.query.app_id ?? req.query.appId ?? 0);
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "app_id must be a positive integer" });
  try { res.json(await platformReads.inventory(appId, req.query.force === "1" || req.query.force === "true")); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.get("/api/platform/reports", async (req, res) => {
  const appId = Number(req.query.app_id ?? req.query.appId ?? 0);
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "app_id must be a positive integer" });
  try { res.json(await platformReads.reports(appId, Number(req.query.days ?? 30), req.query.force === "1" || req.query.force === "true")); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.get("/api/platform/suggestions", async (req, res) => {
  const appId = Number(req.query.app_id ?? req.query.appId ?? 0);
  const country = String(req.query.country ?? "");
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "app_id must be a positive integer" });
  try { res.json(await platformReads.suggestions(appId, country, req.query.force === "1" || req.query.force === "true")); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.get("/api/traffic-intelligence", async (req, res) => {
  try {
    const input = parseTrafficQuery(req.query as Record<string, unknown>);
    res.json(await trafficIntelligence.get(input));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/decision-matrix", async (req, res) => {
  const appId = Number(req.query.app_id ?? req.query.appId ?? req.query.itunesId ?? 0);
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    res.status(400).json({ error: "app_id must be a positive integer" });
    return;
  }
  try {
    res.json(await getDecisionMatrix(getDb(), {
      appId,
      country: req.query.country ? String(req.query.country) : undefined,
      days: Number(req.query.days ?? 30),
      forceRefresh: req.query.force === "true" || req.query.force === "1",
    }));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Cached cross-store ASO result cards for visible Traffic/Matrix rows. This
// performs one bounded SQLite read; live App Store refresh remains exclusively
// in the ASO tracker where its conservative Apple throttle is enforced.
app.post("/api/aso/rankings/top5-batch", (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(getCachedTop5Batch(req.body));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/traffic-intelligence/sync/status", (_req, res) => {
  res.json(trafficSyncScheduler.getStatus());
});

app.get("/api/data-quality", (req, res) => {
  const appId = Number(req.query.app_id ?? req.query.itunesId ?? 0);
  const country = req.query.country ? String(req.query.country) : undefined;
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    res.status(400).json({ error: "app_id must be a positive integer" });
    return;
  }
  res.json(dataQuality(appId, country));
});

app.get("/api/app-store-analytics/status", async (req, res) => {
  const appId = Number(req.query.app_id ?? 0);
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "app_id must be a positive integer" });
  try { res.json(await ascAnalytics.status(appId)); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error), local: ascAnalytics.localStatus(appId) }); }
});

app.get("/api/app-store-analytics/funnel", (req, res) => {
  const appId = Number(req.query.app_id ?? 0);
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "app_id must be a positive integer" });
  res.json(ascAnalytics.funnel(appId, req.query.country ? String(req.query.country) : undefined, Number(req.query.days ?? 30)));
});

app.get("/api/adapty/funnel", async (req, res) => {
  const appId = Number(req.query.app_id ?? 0);
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "app_id must be a positive integer" });
  const days = Math.max(1, Math.min(180, Number(req.query.days ?? 30)));
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  try {
    res.json(await adaptyAnalytics.get({ appId, start, end, country: req.query.country ? String(req.query.country) : undefined, force: req.query.force === "true" }));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/adapty/cohorts", async (req, res) => {
  const appId = Number(req.query.app_id ?? 0);
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "app_id must be a positive integer" });
  const months = Math.max(1, Math.min(12, Number(req.query.months ?? 3)));
  try {
    res.json(await adaptyAnalytics.getCohorts({ appId, months, force: req.query.force === "true" }));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/app-store-analytics/sync", async (req, res) => {
  const appId = Number(req.body?.appId ?? req.query.app_id ?? 0);
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "appId must be a positive integer" });
  try { res.json(await ascAnalytics.sync(appId)); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.post("/api/app-store-analytics/request", async (req, res) => {
  const appId = Number(req.body?.appId ?? 0);
  const accessType = req.body?.accessType;
  if (!Number.isSafeInteger(appId) || appId <= 0) return res.status(400).json({ error: "appId must be a positive integer" });
  if (accessType !== "ONE_TIME_SNAPSHOT" && accessType !== "ONGOING") return res.status(400).json({ error: "accessType must be ONE_TIME_SNAPSHOT or ONGOING" });
  try { res.json(await ascAnalytics.createRequest(appId, accessType)); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
});

app.get("/api/negatives", (req, res) => {
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  const rows = getDb().prepare(`
    SELECT n.id, n.campaign_id, c.name AS campaign_name, c.country, n.text, n.match_type, n.remote_id, n.added_at
    FROM asa_negatives n
    LEFT JOIN asa_campaigns c ON c.id = n.campaign_id
    ${appId ? `WHERE c.app_id = ?` : ``}
    ORDER BY n.id DESC
  `).all(...(appId ? [appId] : []));
  res.json(rows);
});

app.get("/api/geo", (req, res) => {
  const days = Number(req.query.days ?? 14);
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const where = appId ? `AND c.app_id = ?` : ``;
  const args = appId ? [start, start, appId] : [start, start];
  const rows = getDb().prepare(`
    SELECT c.country,
           SUM(d.impressions) AS impressions,
           SUM(d.taps) AS taps,
           SUM(d.installs) AS installs,
           SUM(d.spend) AS spend,
           CASE WHEN SUM(d.installs) > 0 THEN SUM(d.spend)/SUM(d.installs) ELSE 0 END AS cpi,
           COUNT(DISTINCT c.id) AS campaigns,
           COALESCE((
             SELECT SUM(events) FROM asc_events_daily e
             WHERE e.country = c.country AND e.date >= ?
               AND e.event_type = 'Start Introductory Offer'
           ), 0) AS trials
    FROM asa_campaigns c
    LEFT JOIN asa_daily d ON d.campaign_id = c.id AND d.date >= ?
    WHERE 1=1 ${where}
    GROUP BY c.country
    ORDER BY spend DESC
  `).all(...args);
  res.json(rows);
});

app.get("/api/campaigns", (req, res) => {
  const days = Number(req.query.days ?? 14);
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  res.json(listCampaignsWithMetrics(days, appId));
});

// Geo-level real revenue, server-side proxy so the function key never reaches
// the browser. Returns { rows: [{ country, trials, paid, revenueUsd }] };
// [] for apps without a configured revenue feed.
app.get("/api/revenue", async (req, res) => {
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  const days = Number(req.query.days ?? 30);
  const r = await fetchRevenueRows(cfg, appId, days);
  res.json(r);
});

// Command Center — ASA ⋈ revenue ⋈ organic ASO positions, verdict per geo.
app.get("/api/command-center", async (req, res) => {
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  const days = Number(req.query.days ?? 30);
  if (!appId) { res.status(400).json({ error: "app_id required" }); return; }
  try {
    res.json(await commandCenter(cfg, appId, days));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/account-health", (_req, res) => {
  try {
    res.json(accountHealth());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/daily", (req, res) => {
  const days = Number(req.query.days ?? 14);
  const cid = req.query.campaign_id ? Number(req.query.campaign_id) : undefined;
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  res.json(dailyTotals(days, cid, appId));
});

app.get("/api/keywords/:id/daily", (req, res) => {
  const id = Number(req.params.id);
  const days = Number(req.query.days ?? 14);
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = getDb().prepare(`
    SELECT date, impressions, taps, installs, spend,
           CASE WHEN taps > 0 THEN spend/taps ELSE 0 END AS cpt,
           CASE WHEN installs > 0 THEN spend/installs ELSE 0 END AS cpi
    FROM asa_kw_daily
    WHERE keyword_id = ? AND date >= ?
    ORDER BY date
  `).all(id, start);
  res.json(rows);
});

app.get("/api/keywords", (req, res) => {
  const days = Number(req.query.days ?? 14);
  const cid = req.query.campaign_id ? Number(req.query.campaign_id) : undefined;
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  res.json(listKeywordsWithMetrics(days, cid, appId));
});

app.get("/api/search-terms", (req, res) => {
  const days = Number(req.query.days ?? 14);
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  res.json(listSearchTerms(days, appId));
});

app.get("/api/roi/campaign/:id", (req, res) => {
  const id = Number(req.params.id);
  const spend = Number(req.query.spend ?? 1000);
  const days = Number(req.query.days ?? 14);
  const p = projectCampaign(id, spend, days);
  if (!p) { res.status(404).json({ error: "not found" }); return; }
  res.json(p);
});
app.get("/api/roi/keyword/:id", (req, res) => {
  const id = Number(req.params.id);
  const spend = Number(req.query.spend ?? 100);
  const days = Number(req.query.days ?? 14);
  const p = projectKeyword(id, spend, days);
  if (!p) { res.status(404).json({ error: "not found" }); return; }
  res.json(p);
});
app.get("/api/recommendations/bids", (req, res) => {
  const days = Number(req.query.days ?? 7);
  const cid = req.query.campaign_id ? Number(req.query.campaign_id) : undefined;
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  res.json(recommend(days, cid, appId));
});

app.get("/api/recommendations/search-terms", (req, res) => {
  const days = Number(req.query.days ?? 14);
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  res.json(suggestSearchTermActions(days, appId));
});

app.post("/api/actions", (req, res) => {
  const id = enqueue(req.body as Action);
  res.json({ id });
});

app.post("/api/actions/:id/apply", async (req, res) => {
  const r = await apply(asa, Number(req.params.id), cfg.allowAppleAdsMutations && req.get("x-asa-approval") === "explicit-user-approved");
  res.json(r);
});

app.post("/api/actions/:id/cancel", (req, res) => {
  cancel(Number(req.params.id));
  res.json({ ok: true });
});

app.get("/api/actions", (_req, res) => res.json(listActions()));

app.get("/api/settings", (req, res) => {
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  res.json(loadSettings(appId));
});
app.patch("/api/settings", (req, res) => {
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  res.json(updateSettings(req.body || {}, appId));
});
app.get("/api/settings/suggest", (req, res) => {
  const appId = req.query.app_id ? Number(req.query.app_id) : undefined;
  res.json(suggestSettings(appId));
});

app.get("/api/credentials/:provider", (req, res) => {
  const provider = req.params.provider as Provider;
  if (!PROVIDERS.includes(provider)) { res.status(400).json({ error: "invalid provider" }); return; }
  res.json(getCredentialsMasked(provider));
});

app.put("/api/credentials/:provider", (req, res) => {
  const provider = req.params.provider as Provider;
  if (!PROVIDERS.includes(provider)) { res.status(400).json({ error: "invalid provider" }); return; }
  setCredentials(provider, req.body || {});
  res.json({ ok: true, restartRequired: true });
});

// Connection status for the «Подключить» gate in every studio product (no secret values).
app.get("/api/integrations", (_req, res) => res.json(integrationsStatus()));

app.get("/api/alerts", (_req, res) => res.json(listAlerts()));
app.post("/api/alerts/check", async (_req, res) => {
  try {
    const r = await checkAndSendAlerts();
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get("/api/sync/status", (_req, res) => res.json(getSyncStatus()));

app.post("/api/sync", (req, res) => {
  if (getSyncStatus().active) {
    res.status(409).json({ error: "sync already running", status: getSyncStatus() });
    return;
  }
  const days = Number(req.body?.days ?? 14);
  broadcast("sync:start", { days });
  // Fire and forget — sync continues in background even if client navigates away.
  // Progress tracked in currentSync (in-memory) + sync_log table.
  fullSync(asa, asc, days)
    .then((r) => broadcast("sync:done", r))
    .catch((e) => broadcast("sync:error", { error: (e as Error).message }));
  res.json({ ok: true, started: true });
});

app.listen(cfg.port, cfg.host, () => {
  console.log(`ASA Ads API on http://${cfg.host}:${cfg.port}`);
  trafficSyncScheduler.start();
  const alertCfg = loadAlertsConfig();
  if (alertCfg.enabled) {
    const intervalMin = Number(process.env.ALERT_INTERVAL_MIN ?? 30);
    console.log(`Alerts enabled, polling every ${intervalMin} min`);
    setInterval(() => {
      checkAndSendAlerts()
        .then((r) => { if (r.sent > 0) console.log(`Sent ${r.sent} alerts (${r.skipped} skipped)`); })
        .catch((e) => console.error("alert check failed:", e));
    }, intervalMin * 60_000);
  }
});
