import { getDb } from "./db.ts";
import type { AsaClient } from "./asa-client.ts";
import { broadcast } from "./sse.ts";

export type Action =
  | { type: "update_bid"; campaign_id: number; ad_group_id: number; keyword_id: number; amount: string }
  | { type: "add_negative"; campaign_id: number; term: string; match_type?: "BROAD" | "EXACT" }
  | { type: "pause_keyword"; campaign_id: number; ad_group_id: number; keyword_id: number }
  | { type: "update_default_bid"; campaign_id: number; ad_group_id: number; amount: string }
  | { type: "pause_campaign"; campaign_id: number }
  | { type: "resume_campaign"; campaign_id: number }
  | { type: "update_daily_budget"; campaign_id: number; amount: string };

export function enqueue(a: Action): number {
  const db = getDb();
  const r = db.prepare(`INSERT INTO actions (type, payload, status, created_at) VALUES (?, ?, 'pending', ?)`)
    .run(a.type, JSON.stringify(a), new Date().toISOString());
  broadcast("action:enqueued", { id: r.lastInsertRowid });
  return Number(r.lastInsertRowid);
}

export async function apply(asa: AsaClient, id: number): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM actions WHERE id = ?`).get(id) as { id: number; type: string; payload: string; status: string } | undefined;
  if (!row) return { ok: false, error: "not found" };
  if (row.status !== "pending") return { ok: false, error: `already ${row.status}` };
  const a = JSON.parse(row.payload) as Action;
  try {
    switch (a.type) {
      case "update_bid":
        await asa.updateKeywordBid(a.campaign_id, a.ad_group_id, a.keyword_id, a.amount);
        db.prepare(`UPDATE asa_keywords SET bid = ? WHERE id = ?`).run(Number(a.amount), a.keyword_id);
        break;
      case "add_negative": {
        const remote = await asa.addCampaignNegative(a.campaign_id, a.term, a.match_type ?? "EXACT");
        db.prepare(`INSERT OR IGNORE INTO asa_negatives (campaign_id, text, match_type, remote_id, added_at) VALUES (?, ?, ?, ?, ?)`)
          .run(a.campaign_id, a.term, a.match_type ?? "EXACT", remote.id, new Date().toISOString());
        break;
      }
      case "pause_keyword":
        await asa.pauseKeyword(a.campaign_id, a.ad_group_id, a.keyword_id);
        db.prepare(`UPDATE asa_keywords SET status = 'PAUSED' WHERE id = ?`).run(a.keyword_id);
        break;
      case "update_default_bid":
        await asa.updateAdGroupDefaultBid(a.campaign_id, a.ad_group_id, a.amount);
        db.prepare(`UPDATE asa_ad_groups SET default_bid = ? WHERE id = ?`).run(Number(a.amount), a.ad_group_id);
        break;
      case "pause_campaign":
        await asa.pauseCampaign(a.campaign_id);
        db.prepare(`UPDATE asa_campaigns SET status = 'PAUSED', serving_status = 'NOT_RUNNING' WHERE id = ?`).run(a.campaign_id);
        break;
      case "resume_campaign":
        await asa.resumeCampaign(a.campaign_id);
        db.prepare(`UPDATE asa_campaigns SET status = 'ENABLED', serving_status = 'RUNNING' WHERE id = ?`).run(a.campaign_id);
        break;
      case "update_daily_budget":
        await asa.updateCampaignDailyBudget(a.campaign_id, a.amount);
        db.prepare(`UPDATE asa_campaigns SET daily_budget = ? WHERE id = ?`).run(Number(a.amount), a.campaign_id);
        break;
    }
    db.prepare(`UPDATE actions SET status = 'applied', applied_at = ?, result = ? WHERE id = ?`)
      .run(new Date().toISOString(), "ok", id);
    broadcast("action:applied", { id });
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    db.prepare(`UPDATE actions SET status = 'failed', applied_at = ?, error = ? WHERE id = ?`)
      .run(new Date().toISOString(), msg, id);
    broadcast("action:failed", { id, error: msg });
    return { ok: false, error: msg };
  }
}

export function cancel(id: number): void {
  const db = getDb();
  db.prepare(`UPDATE actions SET status = 'cancelled' WHERE id = ? AND status = 'pending'`).run(id);
  broadcast("action:cancelled", { id });
}
