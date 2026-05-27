import { useEffect, useState } from "react";
import { api, type Projection } from "../api.ts";

interface Props {
  campaignId: number;
  campaignName: string;
  onClose: () => void;
}

const SPEND_LEVELS = [50, 100, 250, 500, 1000, 2500, 5000];

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }
function fmtPct(n: number): string { return `${(n * 100).toFixed(0)}%`; }

export default function RoiDrawer({ campaignId, campaignName, onClose }: Props) {
  const [proj, setProj] = useState<Projection | null>(null);
  const [spend, setSpend] = useState(1000);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.roiCampaign(campaignId, spend, 14)
      .then(setProj)
      .finally(() => setLoading(false));
  }, [campaignId, spend]);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div className="drawer-title">ROI Projection</div>
          <button className="compact" onClick={onClose}>✕ close</button>
        </div>

        <div style={{ marginBottom: 6, fontSize: 11, color: "var(--bone-mute)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Campaign</div>
        <div style={{ marginBottom: 18, fontSize: 14, color: "var(--bone)" }}>{campaignName}</div>

        <div className="divider">Scenario</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 18 }}>
          {SPEND_LEVELS.map((s) => (
            <button
              key={s}
              className={s === spend ? "primary" : ""}
              onClick={() => setSpend(s)}
            >
              ${s}
            </button>
          ))}
        </div>

        {loading || !proj ? (
          <div className="loading">computing</div>
        ) : (
          <>
            <div className="divider">Verdict</div>
            <div style={{ marginBottom: 18 }}>
              <div className={`roi ${proj.verdict.kind}`} style={{ fontSize: 18, marginBottom: 8 }}>
                {proj.verdict.label}
              </div>
              <div style={{ fontSize: 12, color: "var(--bone-dim)", lineHeight: 1.5 }}>
                {proj.verdict.reason}
              </div>
              {proj.next_step && (
                <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg-3)", border: "1px solid var(--line)", borderLeft: "2px solid var(--yellow)", fontSize: 11, color: "var(--bone-dim)", lineHeight: 1.5 }}>
                  <span style={{ color: "var(--yellow)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Next step</span>
                  {proj.next_step}
                </div>
              )}
            </div>

            <div className="divider">Projection at ${proj.proposed_spend}</div>
            <table style={{ marginBottom: 18 }}>
              <tbody>
                <tr><td className="muted">Confidence</td><td className="num"><span className={`badge ${proj.confidence === "high" ? "ok" : proj.confidence === "medium" ? "cyan" : "warn"}`}>{proj.confidence}</span></td></tr>
                <tr><td className="muted">Projected installs</td><td className="num">{proj.projected_installs.toFixed(0)}</td></tr>
                <tr><td className="muted">Projected trials</td><td className="num">{proj.projected_trials.toFixed(0)}</td></tr>
                <tr><td className="muted">Projected paid</td><td className="num">{proj.projected_paid.toFixed(1)}</td></tr>
                <tr><td className="muted">Est. revenue (LTV $30)</td><td className="num good">{fmtUsd(proj.projected_revenue)}</td></tr>
                <tr><td className="muted">ROI</td><td className={`num ${proj.projected_roi > 0.5 ? "good" : proj.projected_roi > 0 ? "" : "bad"}`}>{(proj.projected_roi * 100).toFixed(0)}%</td></tr>
                <tr><td className="muted">CPA trial</td><td className="num">{fmtUsd(proj.projected_cpa_trial)}</td></tr>
                <tr><td className="muted">CPA paid</td><td className="num">{fmtUsd(proj.projected_cpa_paid)}</td></tr>
              </tbody>
            </table>

            <div className="divider">Inputs</div>
            <table style={{ marginBottom: 18 }}>
              <tbody>
                <tr><td className="muted">Spend so far</td><td className="num">{fmtUsd(proj.spend_so_far)}</td></tr>
                <tr><td className="muted">Installs so far</td><td className="num">{proj.installs_so_far}</td></tr>
                <tr><td className="muted">Days running</td><td className="num">{proj.days_running}</td></tr>
                <tr><td className="muted">CPI</td><td className="num">{proj.cpi > 0 ? fmtUsd(proj.cpi) : "—"}</td></tr>
                <tr><td className="muted">Install → Trial rate</td><td className="num cyan">{fmtPct(proj.install_to_trial_rate)}</td></tr>
              </tbody>
            </table>

            {proj.paid_so_far > 0 && (
              <>
                <div className="divider">
                  Measured so far{" "}
                  {proj.revenue_source === "real"
                    ? <span className="badge ok">REAL · AdServices</span>
                    : <span className="badge cyan">building…</span>}
                </div>
                <table style={{ marginBottom: 18 }}>
                  <tbody>
                    <tr><td className="muted">Paid (attributed)</td><td className="num">{proj.paid_so_far}</td></tr>
                    <tr><td className="muted">Revenue so far</td><td className="num good">{fmtUsd(proj.revenue_so_far)}</td></tr>
                    <tr><td className="muted">ROAS so far</td><td className={`num ${proj.roas_so_far >= 1 ? "good" : "bad"}`}>{proj.roas_so_far.toFixed(2)}×</td></tr>
                  </tbody>
                </table>
              </>
            )}

            <div style={{ fontSize: 11, color: "var(--bone-mute)", lineHeight: 1.6, padding: "10px 12px", border: "1px solid var(--line-soft)", background: "var(--bg-1)" }}>
              <strong style={{ color: "var(--bone-dim)" }}>Source:</strong> {proj.trial_rate_source}
              <br />
              <strong style={{ color: "var(--bone-dim)" }}>Assumes:</strong>{" "}
              {proj.revenue_source === "real"
                ? "LTV $30 на REAL conversion (AdServices-атрибуция × Adapty revenue) — детерминистично, не оценка."
                : "trial→paid 30%, LTV $30 — оценка по country-average (нет ASA-атрибуции для этого ключа)."}
            </div>
          </>
        )}
      </div>
    </>
  );
}
