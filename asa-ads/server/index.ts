import "dotenv/config";
import express from "express";
import { loadConfig } from "./config.ts";
import { openDb, getDb } from "./db.ts";
import { AsaClient } from "./asa-client.ts";
import { AscClient } from "./asc-client.ts";
import { fullSync, getSyncStatus } from "./sync.ts";
import { listCampaignsWithMetrics, listKeywordsWithMetrics, listSearchTerms, listActions, dailyTotals, listApps } from "./queries.ts";
import { recommend, suggestSearchTermActions } from "./bid-engine.ts";
import { projectCampaign, projectKeyword, quickVerdict } from "./roi-engine.ts";
import { enqueue, apply, cancel, type Action } from "./actions.ts";
import { attach, broadcast } from "./sse.ts";
import { checkAndSendAlerts, listAlerts, loadAlertsConfig } from "./alerts.ts";
import { loadSettings, updateSettings, listAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, suggestSettings } from "./settings.ts";
import { getCredentialsMasked, setCredentials, type Provider } from "./credentials.ts";

const cfg = loadConfig();
openDb(cfg.dataDir);
const asa = new AsaClient(cfg.asa);
const asc = new AscClient(cfg.asc);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/sse", (_req, res) => attach(res));

app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/api/apps", (_req, res) => res.json(listApps()));

app.get("/api/negatives", (_req, res) => {
  const rows = getDb().prepare(`
    SELECT n.id, n.campaign_id, c.name AS campaign_name, c.country, n.text, n.match_type, n.remote_id, n.added_at
    FROM asa_negatives n
    LEFT JOIN asa_campaigns c ON c.id = n.campaign_id
    ORDER BY n.id DESC
  `).all();
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
  res.json(listKeywordsWithMetrics(days, cid));
});

app.get("/api/search-terms", (req, res) => {
  const days = Number(req.query.days ?? 14);
  res.json(listSearchTerms(days));
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
app.get("/api/roi/verdict/:campaignId", (req, res) => {
  res.json(quickVerdict(Number(req.params.campaignId), Number(req.query.days ?? 14)));
});

app.get("/api/recommendations/bids", (req, res) => {
  const days = Number(req.query.days ?? 7);
  const cid = req.query.campaign_id ? Number(req.query.campaign_id) : undefined;
  res.json(recommend(days, cid));
});

app.get("/api/recommendations/search-terms", (req, res) => {
  const days = Number(req.query.days ?? 14);
  res.json(suggestSearchTermActions(days));
});

app.post("/api/actions", (req, res) => {
  const id = enqueue(req.body as Action);
  res.json({ id });
});

app.post("/api/actions/:id/apply", async (req, res) => {
  const r = await apply(asa, Number(req.params.id));
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
  if (provider !== "asa" && provider !== "asc") { res.status(400).json({ error: "invalid provider" }); return; }
  res.json(getCredentialsMasked(provider));
});

app.put("/api/credentials/:provider", (req, res) => {
  const provider = req.params.provider as Provider;
  if (provider !== "asa" && provider !== "asc") { res.status(400).json({ error: "invalid provider" }); return; }
  setCredentials(provider, req.body || {});
  res.json({ ok: true, restartRequired: true });
});

app.get("/api/alert-rules", (_req, res) => res.json(listAlertRules()));
app.post("/api/alert-rules", (req, res) => {
  const { name, kind, params } = req.body || {};
  if (!name || !kind) { res.status(400).json({ error: "name and kind required" }); return; }
  res.json(createAlertRule(name, kind, params || {}));
});
app.patch("/api/alert-rules/:id", (req, res) => {
  updateAlertRule(Number(req.params.id), req.body || {});
  res.json({ ok: true });
});
app.delete("/api/alert-rules/:id", (req, res) => {
  deleteAlertRule(Number(req.params.id));
  res.json({ ok: true });
});

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
  fullSync(asa, asc, days, { fnUrl: cfg.asaRevenueFnUrl, app: "medscan", pullToken: cfg.asaRevenuePullToken })
    .then((r) => broadcast("sync:done", r))
    .catch((e) => broadcast("sync:error", { error: (e as Error).message }));
  res.json({ ok: true, started: true });
});

app.listen(cfg.port, () => {
  console.log(`ASA Ads API on :${cfg.port}`);
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
