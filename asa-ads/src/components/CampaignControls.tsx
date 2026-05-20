import { useState } from "react";
import type { Campaign } from "../api.ts";
import { api } from "../api.ts";

interface Props {
  campaign: Campaign;
  onChange?: () => void;
}

export default function CampaignControls({ campaign, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [bud, setBud] = useState(String(campaign.daily_budget));

  async function togglePause(): Promise<void> {
    if (busy) return;
    const isEnabled = campaign.status === "ENABLED";
    setBusy(true);
    try {
      const { id } = await api.enqueueAction({
        type: isEnabled ? "pause_campaign" : "resume_campaign",
        campaign_id: campaign.id,
      });
      const r = await api.applyAction(id);
      if (!r.ok) alert(`Failed: ${r.error}`);
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  async function saveBudget(): Promise<void> {
    const n = Number(bud);
    if (!Number.isFinite(n) || n <= 0) { alert("Invalid amount"); return; }
    if (Math.abs(n - campaign.daily_budget) < 0.005) { setEditing(false); return; }
    setBusy(true);
    try {
      const { id } = await api.enqueueAction({
        type: "update_daily_budget",
        campaign_id: campaign.id,
        amount: n.toFixed(2),
      });
      const r = await api.applyAction(id);
      if (!r.ok) alert(`Failed: ${r.error}`);
      setEditing(false);
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="btn-group" onClick={(e) => e.stopPropagation()}>
      {editing ? (
        <>
          <input
            type="number"
            step="1"
            min="1"
            value={bud}
            onChange={(e) => setBud(e.target.value)}
            style={{ width: 60 }}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") void saveBudget(); if (e.key === "Escape") setEditing(false); }}
          />
          <button className="compact primary" disabled={busy} onClick={saveBudget}>save</button>
          <button className="compact" onClick={() => setEditing(false)}>×</button>
        </>
      ) : (
        <button className="compact" onClick={() => setEditing(true)} title="Edit daily budget">
          edit ${campaign.daily_budget.toFixed(0)}
        </button>
      )}
      <button
        className={`compact ${campaign.status === "ENABLED" ? "down" : "up"}`}
        disabled={busy}
        onClick={togglePause}
        title={campaign.status === "ENABLED" ? "Pause campaign" : "Resume campaign"}
      >
        {campaign.status === "ENABLED" ? "❚❚" : "▶"}
      </button>
    </div>
  );
}
