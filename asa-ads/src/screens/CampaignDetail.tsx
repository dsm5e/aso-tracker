import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Campaign, type DailyTotals, type Keyword, type BidRec } from "../api.ts";
import Sparkline from "../components/Sparkline.tsx";
import CampaignControls from "../components/CampaignControls.tsx";
import BidChangeConfirm from "../components/BidChangeConfirm.tsx";

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }
function fmtPct(n: number): string { return `${(n * 100).toFixed(1)}%`; }

export default function CampaignDetail() {
  const { id } = useParams();
  const cid = Number(id);
  const [campaign, setCampaign] = useState<Campaign | undefined>();
  const [daily, setDaily] = useState<DailyTotals[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [recs, setRecs] = useState<BidRec[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [pendingChange, setPendingChange] = useState<{ keyword: Keyword; newBid: number; reason?: string } | null>(null);

  async function load(): Promise<void> {
    const [allCamps, d, kw, r] = await Promise.all([
      api.campaigns(days),
      api.daily(days, cid),
      api.keywords(days, cid),
      api.bidRecs(days, cid),
    ]);
    setCampaign(allCamps.find((c) => c.id === cid));
    setDaily(d);
    setKeywords(kw);
    setRecs(r);
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [cid, days]);

  const recMap = new Map(recs.map((r) => [r.keyword_id, r]));
  const dates = daily.map((d) => d.date);

  function requestBidChange(kw: Keyword, newBid: number, reason?: string): void {
    const amount = Math.max(0.05, Math.round(newBid * 100) / 100);
    if (Math.abs(amount - kw.bid) < 0.005) return;
    setPendingChange({ keyword: kw, newBid: amount, reason });
  }

  async function executeBidChange(kw: Keyword, newBid: number): Promise<void> {
    if (busy.has(kw.id)) return;
    const amount = Math.max(0.05, Math.round(newBid * 100) / 100);
    setBusy((s) => new Set(s).add(kw.id));
    setPendingChange(null);
    try {
      const { id } = await api.enqueueAction({
        type: "update_bid",
        campaign_id: kw.campaign_id,
        ad_group_id: kw.ad_group_id,
        keyword_id: kw.id,
        amount: amount.toFixed(2),
      });
      const r = await api.applyAction(id);
      if (!r.ok) alert(`Failed: ${r.error}`);
      await load();
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(kw.id);
        return next;
      });
    }
  }

  if (loading && !campaign) return <div className="empty">Loading…</div>;
  if (!campaign) return <div className="empty">Campaign not found. <Link to="/">Back</Link></div>;

  return (
    <>
      {pendingChange && (
        <BidChangeConfirm
          keyword={pendingChange.keyword}
          newBid={pendingChange.newBid}
          reason={pendingChange.reason}
          onConfirm={() => executeBidChange(pendingChange.keyword, pendingChange.newBid)}
          onCancel={() => setPendingChange(null)}
        />
      )}
      <div className="topbar">
        <div>
          <Link to="/" className="muted" style={{ fontSize: 12 }}>← Dashboard</Link>
          <h2 style={{ marginTop: 4 }}>{campaign.name}</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {campaign.country} · {campaign.bidding_strategy} · daily {fmtUsd(campaign.daily_budget)} · lifetime {fmtUsd(campaign.lifetime_budget)} · {campaign.status}
          </div>
        </div>
        <div className="controls" style={{ alignItems: "center" }}>
          <CampaignControls campaign={campaign} onChange={() => void load()} />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
      </div>

      <div className="spark-row">
        <Sparkline title="Spend / day" value={fmtUsd(campaign.spend)} data={daily.map((d) => d.spend)} labels={dates} color="#4ade80" format={fmtUsd} />
        <Sparkline title="Installs / day" value={String(campaign.installs)} data={daily.map((d) => d.installs)} labels={dates} color="#60a5fa" format={(n) => String(Math.round(n))} />
        <Sparkline title="CPI" value={campaign.cpi > 0 ? fmtUsd(campaign.cpi) : "—"} data={daily.map((d) => d.cpi)} labels={dates} color="#facc15" format={fmtUsd} />
        <Sparkline title="Impressions / day" value={String(campaign.impressions)} data={daily.map((d) => d.impressions)} labels={dates} color="#a78bfa" format={(n) => String(Math.round(n))} />
      </div>

      <div className="card">
        <h3>Keywords ({keywords.length}) · {recs.length} recommendations</h3>
      </div>

      <table>
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Match</th>
            <th>Status</th>
            <th className="num">Bid</th>
            <th className="num">Imp</th>
            <th className="num">Taps</th>
            <th className="num">Inst</th>
            <th className="num">CPT</th>
            <th className="num">Spend</th>
            <th>Recommendation</th>
            <th style={{ minWidth: 200 }}>Quick bid</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((k) => {
            const rec = recMap.get(k.id);
            const isBusy = busy.has(k.id);
            const alreadyAtRec = rec && Math.abs(k.bid - rec.recommended_bid) < 0.005;
            const down10 = Math.max(0.05, Math.round(k.bid * 0.9 * 100) / 100);
            const up10 = Math.round(k.bid * 1.1 * 100) / 100;
            const delta = rec ? rec.recommended_bid - rec.current_bid : 0;
            return (
              <tr key={k.id}>
                <td>{k.text}</td>
                <td><span className="badge">{k.match_type}</span></td>
                <td><span className={`badge ${k.status === "ACTIVE" ? "ok" : "warn"}`}>{k.status.toLowerCase()}</span></td>
                <td className="num">{fmtUsd(k.bid)}</td>
                <td className="num">{k.impressions}</td>
                <td className="num">{k.taps}</td>
                <td className="num">{k.installs}</td>
                <td className="num">{k.cpt > 0 ? fmtUsd(k.cpt) : "—"}</td>
                <td className="num">{fmtUsd(k.spend)}</td>
                <td>
                  {rec && !alreadyAtRec ? (
                    <span title={rec.reason} className="muted" style={{ fontSize: 11 }}>
                      <span className={`badge ${rec.confidence === "high" ? "ok" : rec.confidence === "medium" ? "warn" : ""}`}>
                        {delta > 0 ? "↑" : "↓"} {fmtUsd(rec.recommended_bid)}
                      </span>{" "}
                      {rec.reason}
                    </span>
                  ) : <span className="muted">—</span>}
                </td>
                <td>
                  <div className="btn-group">
                    <button className="compact down" disabled={isBusy || k.bid <= 0.05} onClick={() => requestBidChange(k, down10, "Lower bid 10%")} title={`Lower 10% → ${fmtUsd(down10)}`}>−10%</button>
                    <button className="compact up" disabled={isBusy} onClick={() => requestBidChange(k, up10, "Raise bid 10%")} title={`Raise 10% → ${fmtUsd(up10)}`}>+10%</button>
                    {rec && !alreadyAtRec && (
                      <button className={`compact ${delta > 0 ? "primary up" : "down"}`} disabled={isBusy} onClick={() => requestBidChange(k, rec.recommended_bid, rec.reason)} title={rec.reason}>
                        → {fmtUsd(rec.recommended_bid)}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="divider">Daily breakdown</div>
      <div style={{ fontSize: 12, color: "var(--bone-dim)" }}>
        <table style={{ marginTop: 8, fontSize: 12 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Imp</th>
              <th className="num">Taps</th>
              <th className="num">TTR</th>
              <th className="num">Inst</th>
              <th className="num">CPI</th>
              <th className="num">Spend</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td className="num">{d.impressions}</td>
                <td className="num">{d.taps}</td>
                <td className="num">{fmtPct(d.ttr)}</td>
                <td className="num">{d.installs}</td>
                <td className="num">{d.cpi > 0 ? fmtUsd(d.cpi) : "—"}</td>
                <td className="num">{fmtUsd(d.spend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
