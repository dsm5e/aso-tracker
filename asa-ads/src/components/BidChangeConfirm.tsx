import { useEffect, useState } from "react";
import { api, type Keyword, type Projection } from "../api.ts";

interface Props {
  keyword: Keyword;
  newBid: number;
  reason?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }
function fmtPct(n: number): string { return `${(n * 100).toFixed(0)}%`; }

export default function BidChangeConfirm({ keyword, newBid, reason, onConfirm, onCancel }: Props) {
  const [proj, setProj] = useState<Projection | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch ROI projection at current rate to inform the projection
  useEffect(() => {
    api.roiKeyword(keyword.id, 100, 14)
      .then(setProj)
      .finally(() => setLoading(false));
  }, [keyword.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  const delta = newBid - keyword.bid;
  const deltaPct = (delta / Math.max(keyword.bid, 0.01)) * 100;
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "same";

  // 14-day daily averages
  const daysWithData = Math.max(1, 14); // approximation
  const avgDailyTaps = keyword.taps / daysWithData;
  const avgDailySpend = keyword.spend / daysWithData;

  // Linear estimate: more bid → proportionally more impressions/taps (capped)
  // True relation is nonlinear (auction dynamics) but this gives an order-of-magnitude
  const bidRatio = newBid / Math.max(keyword.bid, 0.01);
  const tapsMultiplier = direction === "down" ? bidRatio : Math.min(bidRatio, 2.0); // capping at 2x
  const newDailyTaps = avgDailyTaps * tapsMultiplier;
  const newDailySpend = newDailyTaps * newBid;
  const dailySpendDelta = newDailySpend - avgDailySpend;
  const weeklySpend = newDailySpend * 7;
  const monthlySpend = newDailySpend * 30;

  // ROI projection (use existing proj as anchor; adjust by ratio)
  const projAvailable = proj && proj.confidence !== "insufficient";

  return (
    <>
      <div className="drawer-overlay" onClick={onCancel} />
      <div style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(540px, 90vw)",
        background: "var(--bg-1)",
        border: `1px solid ${direction === "up" ? "var(--amber-dim)" : "var(--red-dim)"}`,
        padding: 24,
        zIndex: 200,
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 14, marginBottom: 16, borderBottom: "1px solid var(--line)" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: direction === "up" ? "var(--amber)" : "var(--red)" }}>
              {direction === "up" ? "▲ raise bid" : direction === "down" ? "▼ lower bid" : "≡ set bid"}
            </div>
            <div style={{ fontSize: 16, marginTop: 4, color: "var(--bone)" }}>{keyword.text}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{keyword.campaign_name}</div>
          </div>
          <button className="compact" onClick={onCancel}>esc</button>
        </div>

        <div className="divider" style={{ margin: "0 0 12px" }}>Change</div>
        <table style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td className="muted">Current bid</td>
              <td className="num">{fmtUsd(keyword.bid)}</td>
            </tr>
            <tr>
              <td className="muted">New bid</td>
              <td className={`num ${direction === "up" ? "good" : direction === "down" ? "bad" : ""}`}>
                {fmtUsd(newBid)}{" "}
                <span style={{ fontSize: 10 }}>({deltaPct > 0 ? "+" : ""}{deltaPct.toFixed(0)}%)</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="divider" style={{ margin: "0 0 12px" }}>Spend impact (estimated)</div>
        <table style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td className="muted">Past 14d daily avg</td>
              <td className="num">{fmtUsd(avgDailySpend)} <span className="muted" style={{ fontSize: 10 }}>({avgDailyTaps.toFixed(1)} taps/day)</span></td>
            </tr>
            <tr>
              <td className="muted">Projected daily after change</td>
              <td className={`num ${dailySpendDelta > 0 ? "warn" : ""}`}>
                ≈ {fmtUsd(newDailySpend)}
                <span style={{ fontSize: 10, marginLeft: 4 }}>
                  ({dailySpendDelta >= 0 ? "+" : ""}{fmtUsd(dailySpendDelta)})
                </span>
              </td>
            </tr>
            <tr>
              <td className="muted">Projected weekly</td>
              <td className="num">≈ {fmtUsd(weeklySpend)}</td>
            </tr>
            <tr>
              <td className="muted">Projected monthly</td>
              <td className="num">≈ {fmtUsd(monthlySpend)}</td>
            </tr>
          </tbody>
        </table>

        <div className="divider" style={{ margin: "0 0 12px" }}>ROI prediction</div>
        {loading ? <div className="loading">computing</div> : projAvailable && proj ? (
          <div style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 12, marginBottom: 8 }}>
              <span className={`roi ${proj.verdict.kind}`} style={{ fontSize: 13 }}>{proj.verdict.label}</span>
              <span className="muted" style={{ fontSize: 11 }}>{proj.verdict.reason}</span>
            </div>
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
              At ${100} additional spend → ≈{proj.projected_installs.toFixed(0)} installs, ≈{proj.projected_paid.toFixed(1)} paid, ≈{fmtUsd(proj.projected_revenue)} revenue (ROI {fmtPct(proj.projected_roi)}).
              <br />
              <strong className={direction === "up" ? "good" : "bad"}>
                {direction === "up"
                  ? "↑ Higher bid → больше impressions, выше CPI per install, но в SCALE-зоне может оправдаться."
                  : direction === "down"
                  ? "↓ Lower bid → меньше impressions, рискуешь потерять долю аукциона."
                  : ""}
              </strong>
            </div>
          </div>
        ) : (
          <div style={{ padding: "10px 12px", background: "var(--bg-2)", borderLeft: "2px solid var(--yellow)", fontSize: 11, color: "var(--bone-dim)", marginBottom: 16 }}>
            <strong style={{ color: "var(--yellow)" }}>⚠ Недостаточно данных для ROI.</strong>
            {proj?.next_step && <> {proj.next_step}</>}
          </div>
        )}

        {reason && (
          <div style={{ padding: "8px 12px", background: "var(--bg-3)", fontSize: 11, color: "var(--bone-dim)", borderLeft: "2px solid var(--cyan)", marginBottom: 16 }}>
            <strong style={{ color: "var(--cyan)" }}>Why:</strong> {reason}
          </div>
        )}

        <div className="hint" style={{ fontSize: 10, marginBottom: 14 }}>
          Прогноз базируется на исторических tap-rate. Apple может реагировать иначе из-за learning period (24–72ч). Реальный CPI обычно ниже max bid.
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 10 }}>⌘ + Enter to confirm · Esc to cancel</span>
          <div className="btn-group">
            <button onClick={onCancel}>cancel</button>
            <button className={`primary ${direction === "up" ? "up" : "down"}`} onClick={onConfirm}>
              {direction === "up" ? "↑" : direction === "down" ? "↓" : "→"} apply {fmtUsd(newBid)}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
