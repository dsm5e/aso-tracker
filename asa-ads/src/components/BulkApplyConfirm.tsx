import { useEffect } from "react";
import type { BidRec, Keyword } from "../api.ts";
import { campaignDisplayName } from "../lib/campaignNames.ts";

interface Props {
  items: Array<{ keyword: Keyword; rec: BidRec }>;
  onConfirm: () => void;
  onCancel: () => void;
}

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }

export default function BulkApplyConfirm({ items, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  // Aggregate impact
  let ups = 0, downs = 0, sames = 0;
  let estDailyDelta = 0;
  let highConfCount = 0;

  for (const { keyword: k, rec } of items) {
    const delta = rec.recommended_bid - k.bid;
    if (delta > 0.005) ups++;
    else if (delta < -0.005) downs++;
    else sames++;
    if (rec.confidence === "high") highConfCount++;
    // Estimate daily spend change: 14d avg taps × new bid - old daily spend
    const avgDailyTaps = k.taps / 14;
    const oldDaily = k.spend / 14;
    const newDaily = avgDailyTaps * rec.recommended_bid * (rec.recommended_bid / Math.max(k.bid, 0.01));
    estDailyDelta += (Math.min(newDaily, oldDaily * 2.5) - oldDaily); // cap 2.5x
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onCancel} />
      <div style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(640px, 92vw)",
        maxHeight: "85vh",
        overflowY: "auto",
        background: "var(--bg-1)",
        border: "1px solid var(--amber-dim)",
        padding: 24,
        zIndex: 200,
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 14, marginBottom: 16, borderBottom: "1px solid var(--line)" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--amber)" }}>
              ▮ Групповое изменение
            </div>
            <div style={{ fontSize: 16, marginTop: 4, color: "var(--bone)" }}>
              Применить рекомендации по ставкам для {items.length} ключ{items.length === 1 ? "а" : items.length < 5 ? "ей" : "ей"}
            </div>
          </div>
          <button className="compact" onClick={onCancel}>Esc</button>
        </div>

        <div className="hint" style={{ marginBottom: 16 }}>
          Для каждого ключа будет создано подтверждённое действие с новой ставкой. Технический путь API <code style={{ color: "var(--cyan)" }}>PUT /targetingkeywords/bulk</code>. Действия попадут в очередь и останутся в журнале; деньги расходуются только когда Apple начинает показывать рекламу.
        </div>

        <div className="divider" style={{ margin: "0 0 12px" }}>Сводка влияния</div>
        <table style={{ marginBottom: 16 }}>
          <tbody>
            <tr>
              <td className="muted">Всего изменений</td>
              <td className="num">{items.length} ключ(ей)</td>
            </tr>
            <tr>
              <td className="muted">▲ Повышения</td>
              <td className="num good">{ups}</td>
            </tr>
            <tr>
              <td className="muted">▼ Снижения</td>
              <td className="num bad">{downs}</td>
            </tr>
            {sames > 0 && (
              <tr>
                <td className="muted">≡ Без изменений</td>
                <td className="num muted">{sames}</td>
              </tr>
            )}
            <tr>
              <td className="muted">Высокая достоверность</td>
              <td className="num">{highConfCount} / {items.length}</td>
            </tr>
            <tr>
              <td className="muted">Оценка изменения расхода в день</td>
              <td className={`num ${estDailyDelta > 0 ? "warn" : estDailyDelta < 0 ? "good" : ""}`}>
                {estDailyDelta >= 0 ? "+" : ""}{fmtUsd(estDailyDelta)}/день
              </td>
            </tr>
            <tr>
              <td className="muted">≈ Изменение расхода в неделю</td>
              <td className="num">{estDailyDelta >= 0 ? "+" : ""}{fmtUsd(estDailyDelta * 7)}</td>
            </tr>
          </tbody>
        </table>

        <div className="divider" style={{ margin: "0 0 12px" }}>Предпросмотр (первые 8)</div>
        <div className="table-wrap" style={{ maxHeight: 220, overflow: "auto", marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Ключ</th>
                <th>Кампания</th>
                <th className="num">Ставка →</th>
                <th>Достоверность</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 8).map(({ keyword: k, rec }) => {
                const dir = rec.recommended_bid > k.bid ? "good" : rec.recommended_bid < k.bid ? "bad" : "";
                return (
                  <tr key={k.id}>
                    <td>{k.text}</td>
                    <td className="muted" style={{ fontSize: 10 }}>{campaignDisplayName(k.campaign_name)}</td>
                    <td className={`num ${dir}`}>
                      {fmtUsd(k.bid)} → {fmtUsd(rec.recommended_bid)}
                    </td>
                    <td>
                      <span className={`badge ${rec.confidence === "high" ? "ok" : rec.confidence === "medium" ? "cyan" : "warn"}`}>
                        {rec.confidence}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items.length > 8 && (
            <div className="muted" style={{ fontSize: 10, padding: "8px 12px" }}>… и ещё {items.length - 8}</div>
          )}
        </div>

        <div className="hint" style={{ fontSize: 10, marginBottom: 14 }}>
          ⚠ Действия выполняются последовательно. На 100 ключей потребуется около 30 секунд. Откат доступен через очередь действий или новым изменением ставок.
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 10 }}>⌘ + Enter — подтвердить · Esc — отменить</span>
          <div className="btn-group">
            <button onClick={onCancel}>Отменить</button>
            <button className="primary" onClick={onConfirm}>
              Применить для {items.length} ключ{items.length === 1 ? "а" : items.length < 5 ? "ей" : "ей"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
