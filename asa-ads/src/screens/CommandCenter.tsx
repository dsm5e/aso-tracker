import { useEffect, useMemo, useState } from "react";
import { api, type AccountHealth, type CommandCenterData, type CommandGeoRow } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { exportRows } from "../lib/csv.ts";
import InfoTooltip from "../components/InfoTooltip.tsx";

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
  const { selected } = useApp();
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [health, setHealth] = useState<AccountHealth | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // A matrix joins app-specific Apple Ads, attribution and ASO data. Never pick
  // an arbitrary first app when the portfolio selector is active.
  const appId = selected !== "all" ? selected : undefined;

  useEffect(() => {
    if (!appId) return;
    setLoading(true);
    setError("");
    Promise.all([api.commandCenter(appId, days), api.accountHealth()])
      .then(([d, h]) => { setData(d); setHealth(h); })
      .catch((reason: unknown) => {
        console.error(reason);
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить матрицу решений");
      })
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

  if (!appId) return <div className="data-state">Выберите приложение слева, чтобы построить матрицу по всем его странам. Портфель не смешивается с воронкой одного приложения.</div>;

  return (
    <>
      <div className="topbar">
        <div>
          <h2>Матрица решений</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 5 }}>Страны текущего приложения · ASA × органика × выручка</div>
        </div>
        <div className="controls">
          <span className="meta">Источник: Apple Ads, Adapty, ASO</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 дней</option>
            <option value={14}>14 дней</option>
            <option value={30}>30 дней</option>
            <option value={90}>90 дней</option>
          </select>
        </div>
      </div>

      {health?.billingSuspected && (
        <div className="card" style={{ padding: "12px 16px", borderColor: "var(--red)", marginBottom: 12 }}>
          <span style={{ color: "var(--red)", fontWeight: 600 }}>Аккаунт на удержании</span>
          <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
            {health.onHold}/{health.totalEnabled} включённых кампаний находятся в ON_HOLD и не получают показы. Проверьте биллинг Apple Ads.
          </span>
        </div>
      )}

      <div className="spark-row">
        <div className="card stat"><div className="muted">Расход · {days} дней</div><div className="big" style={{ color: "var(--amber)" }}>{fmtUsd(totals.spend)}</div></div>
        <div className="card stat"><div className="muted">Установки</div><div className="big">{totals.installs}</div></div>
        <div className="card stat"><div className="muted">Выручка</div><div className="big" style={{ color: "var(--green)" }}>{data?.revenueSource ? fmtUsd(totals.revenue) : "нет источника"}</div></div>
        <div className="card stat"><div className="muted">Смешанный ROAS <InfoTooltip title="ROAS">Фактическая выручка, делённая на расход за одинаковое окно. Без подключённой выручки показатель не строится.</InfoTooltip></div><div className="big" style={{ color: totals.roas >= 1 ? "var(--green)" : "var(--red)" }}>{data?.revenueSource ? `${(totals.roas * 100).toFixed(0)}%` : "—"}</div></div>
        <div className="card stat">
          <div className="muted">Снимок ASO</div>
          <div className="big" style={{ color: snapAge !== null && snapAge > 7 ? "var(--amber)" : "var(--bone)" }}>
            {data?.aso.snapshotDate ? `${data.aso.snapshotDate}${snapAge !== null && snapAge > 7 ? ` · устарел на ${snapAge} дн.` : ""}` : "нет данных"}
          </div>
        </div>
      </div>

      {data?.revenueError && <div className="data-state error" style={{ minHeight: 0, margin: "6px 0" }}>Ошибка источника выручки: {data.revenueError}</div>}

      <div className="divider" style={{ justifyContent: "space-between" }}>
        Решения по странам · {data?.rows.length ?? 0}
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
          )}>Экспорт CSV</button>
        )}
      </div>

      {error && !data ? <div className="data-state error">{error}</div> : loading && !data ? (
        <div className="data-state loading">Загружаем данные по странам…</div>
      ) : (data?.rows.length ?? 0) === 0 ? (
        <div className="data-state">Нет данных по странам в выбранном окне.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Страна</th>
              <th className="num">Расход</th>
              <th className="num">Установки</th>
              <th className="num">CPI</th>
              <th className="num">Триалы</th>
              <th className="num">Оплаты</th>
              <th className="num">Выручка</th>
              <th className="num">ROAS</th>
              <th>Решение</th>
              <th>Органика (топ-10 / средняя / лучшие)</th>
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
                      <span className="muted" style={{ fontSize: 11 }}>не отслеживается</span>
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
