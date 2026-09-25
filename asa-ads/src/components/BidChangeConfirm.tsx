import { useEffect, useState } from "react";
import { api, type Keyword, type Projection } from "../api.ts";
import { campaignDisplayName } from "../lib/campaignNames.ts";

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
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog-head">
          <div>
            <div className={`dialog-kicker ${direction === "up" ? "accent-text" : "bad"}`}>
              {direction === "up" ? "Повысить ставку" : direction === "down" ? "Снизить ставку" : "Изменить ставку"}
            </div>
            <div className="dialog-title">{keyword.text}</div>
            <div className="dialog-sub">{campaignDisplayName(keyword.campaign_name)}</div>
          </div>
          <button className="compact" onClick={onCancel}>Esc</button>
        </div>

        <div className="dialog-section">Изменение</div>
        <table className="dialog-table">
          <tbody>
            <tr>
              <td className="muted">Текущая ставка</td>
              <td className="num">{fmtUsd(keyword.bid)}</td>
            </tr>
            <tr>
              <td className="muted">Новая ставка</td>
              <td className={`num ${direction === "up" ? "good" : direction === "down" ? "bad" : ""}`}>
                {fmtUsd(newBid)}{" "}
                <span className="small">({deltaPct > 0 ? "+" : ""}{deltaPct.toFixed(0)}%)</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="dialog-section">Изменение расхода (оценка)</div>
        <table className="dialog-table">
          <tbody>
            <tr>
              <td className="muted">Среднее за 14 дней</td>
              <td className="num">{fmtUsd(avgDailySpend)} <span className="small muted">({avgDailyTaps.toFixed(1)} тапов в день)</span></td>
            </tr>
            <tr>
              <td className="muted">Прогноз в день после изменения</td>
              <td className={`num ${dailySpendDelta > 0 ? "warn" : ""}`}>
                ≈ {fmtUsd(newDailySpend)}
                <span className="small">
                  ({dailySpendDelta >= 0 ? "+" : ""}{fmtUsd(dailySpendDelta)})
                </span>
              </td>
            </tr>
            <tr>
              <td className="muted">Прогноз в неделю</td>
              <td className="num">≈ {fmtUsd(weeklySpend)}</td>
            </tr>
            <tr>
              <td className="muted">Прогноз в месяц</td>
              <td className="num">≈ {fmtUsd(monthlySpend)}</td>
            </tr>
          </tbody>
        </table>

        <div className="dialog-section">Прогноз ROI</div>
        {loading ? <div className="loading">Считаем…</div> : projAvailable && proj ? (
          <div className="dialog-block">
            <div className="row dialog-verdict">
              <span className={`roi ${proj.verdict.kind}`}>{proj.verdict.label}</span>
              <span className="note">{proj.verdict.reason}</span>
            </div>
            <div className="note">
              При дополнительных ${100} → примерно {proj.projected_installs.toFixed(0)} установок, {proj.projected_paid.toFixed(1)} оплат и {fmtUsd(proj.projected_revenue)} выручки (ROI {fmtPct(proj.projected_roi)}).
              <br />
              <strong className={direction === "up" ? "good" : "bad"}>
                {direction === "up"
                  ? "↑ Более высокая ставка даёт больше показов и обычно повышает CPI; это оправдано только при подтверждённой экономике."
                  : direction === "down"
                  ? "↓ Более низкая ставка даёт меньше показов и может снизить долю аукциона."
                  : ""}
              </strong>
            </div>
          </div>
        ) : (
          <div className="callout warn dialog-block">
            <strong>Недостаточно данных для ROI.</strong>
            {proj?.next_step && <> {proj.next_step}</>}
          </div>
        )}

        {reason && (
          <div className="callout dialog-block">
            <strong>Причина:</strong> {reason}
          </div>
        )}

        <div className="hint dialog-block">
          Прогноз базируется на исторических tap-rate. Apple может реагировать иначе из-за learning period (24–72ч). Реальный CPI обычно ниже max bid.
        </div>

        <div className="dialog-foot">
          <span className="note">⌘ + Enter — подтвердить · Esc — отменить</span>
          <div className="btn-group">
            <button onClick={onCancel}>Отменить</button>
            <button className={`primary ${direction === "up" ? "up" : "down"}`} onClick={onConfirm}>
              {direction === "up" ? "↑" : direction === "down" ? "↓" : "→"} Применить {fmtUsd(newBid)}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
