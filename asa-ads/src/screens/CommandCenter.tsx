import { useEffect, useMemo, useState } from "react";
import { api, type AccountHealth, type CommandCenterData, type CommandGeoRow } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { exportRows } from "../lib/csv.ts";
import InfoTooltip from "../components/InfoTooltip.tsx";
import Dropdown from "../components/Dropdown.tsx";

interface Props { reloadKey: number }

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }

/** "My App: Tagline" → "My App". */
function shortAppName(name: string | null | undefined): string | undefined {
  return name ? name.split(":")[0].split(" — ")[0].trim() : undefined;
}

const VERDICT_STYLE: Record<CommandGeoRow["verdict"], { label: string; kind: string }> = {
  "scale": { label: "Масштабировать", kind: "scale" },
  "hold": { label: "Держать", kind: "hold" },
  "cut": { label: "Сократить", kind: "cut" },
  "no-data": { label: "Мало данных", kind: "unknown" },
};

function snapshotAgeDays(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400_000);
}

export default function CommandCenter({ reloadKey }: Props) {
  const { apps, selected, setSelected } = useApp();
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [health, setHealth] = useState<AccountHealth | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // A matrix joins app-specific Apple Ads, attribution and ASO data, so it is
  // always built for one app. Under "all apps" it shows the top-spend app
  // (the list comes sorted by 14-day spend) and lets you switch inline.
  const [localApp, setLocalApp] = useState<number | null>(null);
  const appId = selected !== "all" ? selected : (localApp ?? apps[0]?.app_id);
  const shownApp = apps.find((a) => a.app_id === appId);
  const pickApp = (id: number): void => { if (selected === "all") setLocalApp(id); else setSelected(id); };
  const appOptions = apps.map((a) => ({ value: a.app_id, label: shortAppName(a.app_name) ?? `Приложение ${a.app_id}` }));

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

  if (!appId) {
    return <div className="data-state">Нет приложений с кампаниями Apple Ads. Нажмите «Обновить данные» слева, чтобы загрузить кампании.</div>;
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="ds-page-title">Матрица решений</h1>
          <p className="ds-page-sub">
            {shortAppName(shownApp?.app_name) ?? `Приложение ${appId}`} · страны × Apple Ads × органика × выручка
            {selected === "all" && localApp === null ? " · выбрано по наибольшему расходу за 14 дней" : ""}
          </p>
        </div>
        <div className="controls">
          <span className="meta">Источник: Apple Ads, Adapty, ASO</span>
          {appOptions.length > 1 && <Dropdown ariaLabel="Приложение" value={appId} onChange={pickApp} options={appOptions} />}
          <Dropdown ariaLabel="Период" value={days} onChange={(v) => setDays(v)} options={[{ value: 7, label: "7 дней" }, { value: 14, label: "14 дней" }, { value: 30, label: "30 дней" }, { value: 90, label: "90 дней" }]} />
        </div>
      </div>

      {health?.billingSuspected && (
        <div className="callout bad callout-block">
          <span className="callout-title">Аккаунт на удержании</span>
          <span>
            {health.onHold}/{health.totalEnabled} включённых кампаний находятся в ON_HOLD и не получают показы. Проверьте биллинг Apple Ads.
          </span>
        </div>
      )}

      <div className="spark-row">
        <div className="card stat"><div className="muted">Расход · {days} дней</div><div className="big">{fmtUsd(totals.spend)}</div></div>
        <div className="card stat"><div className="muted">Установки</div><div className="big">{totals.installs}</div></div>
        <div className="card stat"><div className="muted">Выручка</div><div className={`big${data?.revenueSource ? " good" : ""}`}>{data?.revenueSource ? fmtUsd(totals.revenue) : "нет источника"}</div></div>
        <div className="card stat"><div className="muted">Смешанный ROAS <InfoTooltip title="ROAS">Фактическая выручка, делённая на расход за одинаковое окно. Без подключённой выручки показатель не строится.</InfoTooltip></div><div className={`big ${!data?.revenueSource ? "" : totals.roas >= 1 ? "good" : "bad"}`}>{data?.revenueSource ? `${(totals.roas * 100).toFixed(0)}%` : "—"}</div></div>
        <div className="card stat">
          <div className="muted">Снимок ASO</div>
          <div className={`big big-sm ${snapAge !== null && snapAge > 7 ? "warn" : ""}`}>
            {data?.aso.snapshotDate ? `${data.aso.snapshotDate}${snapAge !== null && snapAge > 7 ? ` · устарел на ${snapAge} дн.` : ""}` : "нет данных"}
          </div>
        </div>
      </div>

      {data?.revenueError && <div className="callout bad callout-block">Ошибка источника выручки: {data.revenueError}</div>}

      <div className="section-head">
        <h2 className="ds-h2">Решения по странам · {data?.rows.length ?? 0}</h2>
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
        <div className="data-state">Нет расхода по странам за {days} дней. Увеличьте период или выберите другое приложение.</div>
      ) : (
        <div className="table-wrap">
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
                <tr key={r.country} className={r.onHold > 0 ? "row-muted" : undefined}>
                  <td className="strong">
                    {r.country}
                    {r.onHold > 0 && <span className="muted inline-gap" title="Кампания на удержании (ON_HOLD)">⏸</span>}
                  </td>
                  <td className="num">{fmtUsd(r.spend)}</td>
                  <td className="num">{r.installs}</td>
                  <td className="num">{r.cpi > 0 ? fmtUsd(r.cpi) : "—"}</td>
                  <td className="num">{r.trials}</td>
                  <td className="num">{r.paid}</td>
                  <td className={`num ${r.revenue > 0 ? "good" : "muted"}`}>{r.revenue > 0 ? fmtUsd(r.revenue) : "—"}</td>
                  <td className={`num ${r.roas === null ? "muted" : r.roas >= 1 ? "good" : r.roas >= 0.5 ? "warn" : "bad"}`}>
                    {r.roas === null ? "—" : `${(r.roas * 100).toFixed(0)}%`}
                  </td>
                  <td>
                    <span className={`roi ${v.kind}`} title={r.reason}>{v.label}</span>
                  </td>
                  <td>
                    {r.aso ? (
                      <span className="small">
                        <b>{r.aso.top10}</b>/{r.aso.tracked} в топ-10 · средняя {r.aso.avgPos ?? "—"}
                        {r.aso.best.length > 0 && (
                          <span className="muted"> · {r.aso.best.map((b) => `${b.keyword} #${b.position}`).join(" · ")}</span>
                        )}
                      </span>
                    ) : (
                      <span className="muted small">не отслеживается</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      <div className="note section-foot">
        Выручка считается по стране стора и включает органику там, где атрибуция смешанная, — это ориентир, а не точная выручка по ключу.
        Органика — последний снимок позиций Keywords для этого стора; если он устарел, обновите снимок в Keywords.
      </div>
    </>
  );
}
