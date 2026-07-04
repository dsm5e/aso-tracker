import { request } from "undici";
import { getDb } from "./db.ts";
import { broadcast } from "./sse.ts";

interface AlertsConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  cpiThreshold: number;
  burnThreshold: number;
}

export function loadAlertsConfig(): AlertsConfig {
  return {
    enabled: (process.env.ALERTS_ENABLED ?? "false") === "true",
    botToken: process.env.TG_BOT_TOKEN,
    chatId: process.env.TG_CHAT_ID,
    cpiThreshold: Number(process.env.ALERT_CPI_THRESHOLD ?? 2.0),
    burnThreshold: Number(process.env.ALERT_SPEND_NO_INSTALL ?? 5.0),
  };
}

async function sendTelegram(cfg: AlertsConfig, text: string): Promise<boolean> {
  if (!cfg.botToken || !cfg.chatId) return false;
  try {
    const res = await request(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return res.statusCode >= 200 && res.statusCode < 300;
  } catch {
    return false;
  }
}

interface AlertCheck {
  type: string;
  key: string;
  campaignId: number | null;
  message: string;
}

function findAlerts(today: string): AlertCheck[] {
  const db = getDb();
  const out: AlertCheck[] = [];

  // 1. Burn: campaign spent > $X today with 0 installs
  const burns = db.prepare(`
    SELECT c.id, c.name, c.country, d.spend, d.installs, d.impressions
    FROM asa_campaigns c
    JOIN asa_daily d ON d.campaign_id = c.id
    WHERE d.date = ? AND d.spend >= ? AND d.installs = 0 AND c.status = 'ENABLED'
  `).all(today, Number(process.env.ALERT_SPEND_NO_INSTALL ?? 5.0)) as Array<{ id: number; name: string; country: string; spend: number; installs: number; impressions: number }>;
  for (const b of burns) {
    out.push({
      type: "burn",
      key: `burn-${b.id}-${today}`,
      campaignId: b.id,
      message: `🔥 <b>Burn:</b> ${b.name} (${b.country}) spent $${b.spend.toFixed(2)} today with 0 installs (${b.impressions} imp)`,
    });
  }

  // 2. High CPI over last 7 days
  const start7 = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const highCpi = db.prepare(`
    SELECT c.id, c.name, c.country, SUM(d.spend) AS spend, SUM(d.installs) AS installs
    FROM asa_campaigns c
    JOIN asa_daily d ON d.campaign_id = c.id
    WHERE d.date >= ? AND c.status = 'ENABLED'
    GROUP BY c.id
    HAVING installs >= 3 AND (spend / installs) >= ?
  `).all(start7, Number(process.env.ALERT_CPI_THRESHOLD ?? 2.0)) as Array<{ id: number; name: string; country: string; spend: number; installs: number }>;
  for (const c of highCpi) {
    const cpi = c.spend / c.installs;
    out.push({
      type: "high_cpi",
      key: `cpi-${c.id}-${today}`,
      campaignId: c.id,
      message: `💸 <b>High CPI:</b> ${c.name} (${c.country}) CPI $${cpi.toFixed(2)} over 7 days (${c.installs} installs, $${c.spend.toFixed(2)} spent)`,
    });
  }

  // 3. Stalled: ENABLED but NOT_RUNNING with reason
  const stalled = db.prepare(`
    SELECT id, name, country, serving_status
    FROM asa_campaigns
    WHERE status = 'ENABLED' AND serving_status != 'RUNNING' AND serving_status IS NOT NULL
  `).all() as Array<{ id: number; name: string; country: string; serving_status: string }>;
  for (const s of stalled) {
    out.push({
      type: "stalled",
      key: `stalled-${s.id}-${today}`,
      campaignId: s.id,
      message: `⚠️ <b>Stalled:</b> ${s.name} (${s.country}) is ENABLED but serving=${s.serving_status}`,
    });
  }

  // 4. Account hold wall: most ENABLED campaigns ON_HOLD = billing/card problem.
  // One alert per day — this is the "card declined and nobody noticed" catcher.
  const hold = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'ENABLED' THEN 1 ELSE 0 END) AS enabled,
      SUM(CASE WHEN status = 'ENABLED' AND display_status = 'ON_HOLD' THEN 1 ELSE 0 END) AS onHold
    FROM asa_campaigns
  `).get() as { enabled: number; onHold: number };
  if (hold.enabled > 0 && hold.onHold >= Math.max(3, Math.ceil(hold.enabled * 0.5))) {
    out.push({
      type: "account_hold",
      key: `account-hold-${today}`,
      campaignId: null,
      message: `🚨 <b>Account on hold:</b> ${hold.onHold}/${hold.enabled} ENABLED campaigns are ON_HOLD — check Apple Ads billing (card declined?)`,
    });
  }

  // 5. Spend spike: today >= 2x prev day (only if today >= $5)
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const spikes = db.prepare(`
    SELECT c.id, c.name, c.country, d.spend AS today_spend, p.spend AS prev_spend
    FROM asa_campaigns c
    JOIN asa_daily d ON d.campaign_id = c.id AND d.date = ?
    JOIN asa_daily p ON p.campaign_id = c.id AND p.date = ?
    WHERE d.spend >= 5 AND p.spend > 0 AND d.spend >= 2 * p.spend
  `).all(today, yesterday) as Array<{ id: number; name: string; country: string; today_spend: number; prev_spend: number }>;
  for (const s of spikes) {
    out.push({
      type: "spend_spike",
      key: `spike-${s.id}-${today}`,
      campaignId: s.id,
      message: `📈 <b>Spend spike:</b> ${s.name} (${s.country}) $${s.today_spend.toFixed(2)} today vs $${s.prev_spend.toFixed(2)} yesterday`,
    });
  }

  return out;
}

export async function checkAndSendAlerts(): Promise<{ checked: number; sent: number; skipped: number }> {
  const cfg = loadAlertsConfig();
  if (!cfg.enabled) return { checked: 0, sent: 0, skipped: 0 };
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const candidates = findAlerts(today);
  let sent = 0, skipped = 0;
  for (const a of candidates) {
    const exists = db.prepare(`SELECT id FROM sent_alerts WHERE alert_type = ? AND key = ?`).get(a.type, a.key);
    if (exists) { skipped++; continue; }
    const delivered = await sendTelegram(cfg, a.message);
    db.prepare(`INSERT INTO sent_alerts (campaign_id, alert_type, key, message, sent_at, delivered) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(a.campaignId, a.type, a.key, a.message, new Date().toISOString(), delivered ? 1 : 0);
    if (delivered) sent++;
    broadcast("alert:new", { type: a.type, message: a.message, delivered });
  }
  return { checked: candidates.length, sent, skipped };
}

export interface AlertRow {
  id: number; campaign_id: number | null; alert_type: string; key: string;
  message: string; sent_at: string; delivered: number;
}

export function listAlerts(limit = 200): AlertRow[] {
  return getDb().prepare(`SELECT * FROM sent_alerts ORDER BY id DESC LIMIT ?`).all(limit) as AlertRow[];
}
