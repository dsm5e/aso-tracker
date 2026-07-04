import { useEffect, useMemo, useState } from "react";
import { api, type AccountHealth, type CommandCenterData, type CommandGeoRow } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { exportRows } from "../lib/csv.ts";

interface Props { reloadKey: number }

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }

const VERDICT_STYLE: Record<CommandGeoRow["verdict"], { label: string; color: string }> = {
  "scale": { label: "SCALE", color: "var(--green)" },
  "hold": { label: "HOLD", color: "var(--amber)" },
  "cut": { label: "CUT", color: "var(--red)" },
  "no-data": { label: "NO DATA", color: "var(--bone-mute)" },
};

function snapshotAgeDays(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400_000);
}

export default function CommandCenter({ reloadKey }: Props) {
  const { selected, apps, setSelected } = useApp();
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [health, setHealth] = useState<AccountHealth | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  // Command Center is per-app; auto-pick the top spender when "all" is selected.
  const appId = selected !== "all" ? selected : apps[0]?.app_id;

  useEffect(() => {
    if (!appId) return;
    setLoading(true);
    Promise.all([api.commandCenter(appId, days), api.accountHealth()])
      .then(([d, h]) => { setData(d); setHealth(h); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [appId, days, reloadKey]);

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const installs = rows.reduce((s, r) => s + r.installs, 0);
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const paid = rows.reduce((s, r) => s + r.paid, 0);
    return { spend, installs, revenue, paid, roas: spend > 0 ? revenue / spend : 0 };
  }, [data]);

  const snapAge = snapshotAgeDays(data?.aso.snapshotDate ?? null);

  if (!appId) return <div className="empty">no apps yet · run sync</div>;

  return (
    <>
      <div className="topbar">
        <h2>Command Center</h2>
        <div className="controls">
          {selected === "all" && apps.length > 1 && (
            <select value={appId} onChange={(e) => setSelected(Number(e.target.value))}>
              {apps.map((a) => <option key={a.app_id} value={a.app_id}>{a.app_name ?? a.app_id}</option>)}
            </select>
          )}
          <span className="meta">ASA × revenue × organic ASO — one verdict per geo</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7D</option>
            <option value={14}>14D</option>
            <option value={30}>30D</option>
            <option value={90}>90D</option>
          </select>
        </div>
      </div>

      {health?.billingSuspected && (
        <div className="card" style={{ padding: "12px 16px", borderColor: "var(--red)", marginBottom: 12 }}>
          <span style={{ color: "var(--red)", fontWeight: 600 }}>🚨 Account on hold</span>
          <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
            {health.onHold}/{health.totalEnabled} enabled campaigns are ON_HOLD — nothing is serving.
            Check Apple Ads → Billing (card declined?). Nobody notices this without an alert; the TG rule fires daily until fixed.
          </span>
        </div>
      )}

      <div className="spark-row">
        <div className="card stat"><div className="muted">Spend {days}d</div><div className="big" style={{ color: "var(--amber)" }}>{fmtUsd(totals.spend)}</div></div>
        <div className="card stat"><div className="muted">Installs</div><div className="big">{totals.installs}</div></div>
        <div className="card stat"><div className="muted">Revenue</div><div className="big" style={{ color: "var(--green)" }}>{data?.revenueSource ? fmtUsd(totals.revenue) : "no feed"}</div></div>
        <div className="card stat"><div className="muted">Blended ROAS</div><div className="big" style={{ color: totals.roas >= 1 ? "var(--green)" : "var(--red)" }}>{data?.revenueSource ? `${(totals.roas * 100).toFixed(0)}%` : "—"}</div></div>
        <div className="card stat">
          <div className="muted">ASO snapshot</div>
          <div className="big" style={{ color: snapAge !== null && snapAge > 7 ? "var(--amber)" : "var(--bone)" }}>
            {data?.aso.snapshotDate ? `${data.aso.snapshotDate}${snapAge !== null && snapAge > 7 ? ` · ${snapAge}d old` : ""}` : "none"}
          </div>
        </div>
      </div>

      {data?.revenueError && <div className="muted" style={{ fontSize: 11, margin: "6px 0" }}>revenue feed error: {data.revenueError}</div>}

      <div className="divider" style={{ justifyContent: "space-between" }}>
        Geo verdicts · {data?.rows.length ?? 0}
        {data && data.rows.length > 0 && (
          <button className="compact" onClick={() => exportRows(
            `command-center-${new Date().toISOString().slice(0, 10)}.csv`,
            ["country", "spend", "installs", "cpi", "trials", "paid", "revenue", "roas", "verdict", "aso_top10", "aso_avg"],
            data.rows.map((r) => ({
              country: r.country, spend: r.spend, installs: r.installs, cpi: r.cpi,
              trials: r.trials, paid: r.paid, revenue: r.revenue,
              roas: r.roas === null ? "" : Math.round(r.roas * 100) / 100,
              verdict: r.verdict, aso_top10: r.aso?.top10 ?? "", aso_avg: r.aso?.avgPos ?? "",
            })) as unknown as Array<Record<string, unknown>>,
          )}>export csv</button>
        )}
      </div>

      {loading && !data ? (
        <div className="empty">loading</div>
      ) : (data?.rows.length ?? 0) === 0 ? (
        <div className="empty">no geo data · run sync</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Geo</th>
              <th className="num">Spend</th>
              <th className="num">Inst</th>
              <th className="num">CPI</th>
              <th className="num">Trials</th>
              <th className="num">Paid</th>
              <th className="num">Revenue</th>
              <th className="num">ROAS</th>
              <th>Verdict</th>
              <th>Organic (top-10 / avg pos / best)</th>
            </tr>
          </thead>
          <tbody>
            {data!.rows.map((r) => {
              const v = VERDICT_STYLE[r.verdict];
              return (
                <tr key={r.country} style={r.onHold > 0 ? { opacity: 0.75 } : undefined}>
                  <td style={{ fontWeight: 500 }}>
                    {r.country}
                    {r.onHold > 0 && <span className="muted" title="campaign on hold" style={{ marginLeft: 6, fontSize: 10 }}>⏸</span>}
                  </td>
                  <td className="num">{fmtUsd(r.spend)}</td>
                  <td className="num">{r.installs}</td>
                  <td className="num">{r.cpi > 0 ? fmtUsd(r.cpi) : "—"}</td>
                  <td className="num">{r.trials}</td>
                  <td className="num">{r.paid}</td>
                  <td className="num" style={{ color: r.revenue > 0 ? "var(--green)" : "var(--bone-mute)" }}>{r.revenue > 0 ? fmtUsd(r.revenue) : "—"}</td>
                  <td className="num" style={{ color: r.roas === null ? "var(--bone-mute)" : r.roas >= 1 ? "var(--green)" : r.roas >= 0.5 ? "var(--amber)" : "var(--red)" }}>
                    {r.roas === null ? "—" : `${(r.roas * 100).toFixed(0)}%`}
                  </td>
                  <td>
                    <span className="roi" style={{ color: v.color, borderColor: v.color }} title={r.reason}>{v.label}</span>
                  </td>
                  <td>
                    {r.aso ? (
                      <span style={{ fontSize: 11 }}>
                        <b>{r.aso.top10}</b>/{r.aso.tracked} in top-10 · avg {r.aso.avgPos ?? "—"}
                        {r.aso.best.length > 0 && (
                          <span className="muted"> · {r.aso.best.map((b) => `${b.keyword} #${b.position}`).join(" · ")}</span>
                        )}
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: 11 }}>not tracked</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="muted" style={{ fontSize: 10, marginTop: 10 }}>
        Revenue = store-country grain (includes organic where attribution is blended) — directional, not per-keyword truth.
        Organic column = latest aso-keywords snapshot for the matching storefront; run a snapshot in Keywords if stale.
      </div>
    </>
  );
}
