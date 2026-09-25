import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Campaign, type DailyTotals } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import Sparkline from "../components/Sparkline.tsx";
import HeroChart from "../components/HeroChart.tsx";
import GeoHeatmap from "../components/GeoHeatmap.tsx";
import CampaignControls from "../components/CampaignControls.tsx";
import RoiDrawer from "../components/RoiDrawer.tsx";
import { exportRows } from "../lib/csv.ts";
import InfoTooltip from "../components/InfoTooltip.tsx";
import { campaignDisplayName, campaignTechnicalName } from "../lib/campaignNames.ts";
import Dropdown from "../components/Dropdown.tsx";
import { verdictLabel } from "../lib/verdictLabel.ts";

interface Props { reloadKey: number }

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }
function cls(cpi: number): string {
  if (cpi === 0) return "muted";
  if (cpi <= 0.4) return "good";
  if (cpi <= 1.0) return "";
  return "bad";
}

interface VerdictMap { [campaignId: number]: { kind: "scale" | "hold" | "cut" | "unknown"; label: string; reason: string; confidence: string } }

export default function Dashboard({ reloadKey }: Props) {
  const { selected } = useApp();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [daily, setDaily] = useState<DailyTotals[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flashed, setFlashed] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [verdicts, setVerdicts] = useState<VerdictMap>({});
  const [drawerCid, setDrawerCid] = useState<number | null>(null);
  const prevRef = useRef<Map<number, Campaign>>(new Map());

  async function load(): Promise<void> {
    const [data, dailyData] = await Promise.all([api.campaigns(days, selected), api.daily(days, undefined, selected)]);

    const newFlash = new Set<number>();
    for (const c of data) {
      const prev = prevRef.current.get(c.id);
      if (prev && (prev.installs !== c.installs || prev.spend !== c.spend || prev.daily_budget !== c.daily_budget)) {
        newFlash.add(c.id);
      }
      prevRef.current.set(c.id, c);
    }
    setRows(data);
    setDaily(dailyData);
    if (newFlash.size > 0) {
      setFlashed(newFlash);
      setTimeout(() => setFlashed(new Set()), 1600);
    }

    // Compute verdicts in parallel
    const v: VerdictMap = {};
    await Promise.all(data.map(async (c) => {
      try {
        const proj = await api.roiCampaign(c.id, 1000, days);
        v[c.id] = { ...proj.verdict, confidence: proj.confidence };
      } catch {
        v[c.id] = { kind: "unknown", label: "—", reason: "", confidence: "insufficient" };
      }
    }));
    setVerdicts(v);
  }

  useEffect(() => {
    setLoading(true);
    setError("");
    load().catch((reason: unknown) => {
      console.error(reason);
      setError(reason instanceof Error ? reason.message : "Не удалось получить данные Apple Ads");
    }).finally(() => setLoading(false));
  }, [days, reloadKey, selected]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      spend: acc.spend + r.spend,
      installs: acc.installs + r.installs,
      taps: acc.taps + r.taps,
      impressions: acc.impressions + r.impressions,
      trials: acc.trials + r.trial_starts,
    }), { spend: 0, installs: 0, taps: 0, impressions: 0, trials: 0 });
  }, [rows]);

  const overallCpi = totals.installs > 0 ? totals.spend / totals.installs : 0;

  const dates = daily.map((d) => d.date);

  function toggleExpand(cid: number): void {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(cid)) next.delete(cid); else next.add(cid);
      return next;
    });
  }

  const drawerCamp = drawerCid ? rows.find((r) => r.id === drawerCid) : null;

  return (
    <>
      <div className="topbar">
        <h1 className="ds-page-title" title="Все страны · источник: отчёты Apple Ads · обновляется после синхронизации">Обзор Apple Ads</h1>
        <div className="controls">
          <Dropdown ariaLabel="Период" value={days} onChange={(v) => setDays(v)} options={[{ value: 1, label: "Сегодня" }, { value: 3, label: "3 дня" }, { value: 7, label: "7 дней" }, { value: 14, label: "14 дней" }, { value: 30, label: "30 дней" }]} />
        </div>
      </div>

      <div className="spark-row">
        <Sparkline title="Расход" value={fmtUsd(totals.spend)} data={daily.map((d) => d.spend)} labels={dates} color="var(--ds-c1)" format={fmtUsd} />
        <Sparkline title="Установки" value={String(totals.installs)} data={daily.map((d) => d.installs)} labels={dates} color="var(--ds-c2)" format={(n) => String(Math.round(n))} />
        <Sparkline title="CPI" lowerIsBetter value={overallCpi > 0 ? fmtUsd(overallCpi) : "—"} data={daily.map((d) => d.cpi)} labels={dates} color="var(--ds-c3)" format={fmtUsd} />
        <Sparkline title="Старты триала" value={String(totals.trials)} data={daily.map((d) => d.trial_starts)} labels={dates} color="var(--ds-c4)" format={(n) => String(Math.round(n))} />
      </div>

      <h2 className="ds-h2">Динамика</h2>
      <HeroChart daily={daily} />

      <h2 className="ds-h2">Страны</h2>
      <GeoHeatmap days={days} />

      <div className="section-head">
        <h2 className="ds-h2">Кампании · {rows.length}</h2>
        <button className="compact" onClick={() => exportRows(
          `campaigns-${new Date().toISOString().slice(0, 10)}.csv`,
          ["name", "country", "status", "daily_budget", "spend", "impressions", "taps", "installs", "cpi", "trial_starts"],
          rows as unknown as Array<Record<string, unknown>>,
        )}>Экспорт CSV</button>
      </div>

      {error && rows.length === 0 ? <div className="data-state error">Не удалось обновить обзор: {error}</div> : loading && rows.length === 0 ? (
        <div className="data-state loading">Загружаем показатели…</div>
      ) : rows.length === 0 ? (
        <div className="data-state">Нет данных за этот период. Запустите синхронизацию.</div>
      ) : (
        <div className="table-wrap table-tall">
        <table>
          <thead>
            <tr>
              <th className="col-toggle" />
              <th>Кампания</th>
              <th>Статус</th>
              <th className="num">Расход</th>
              <th className="num">Установки</th>
              <th className="num">CPI</th>
              <th>Решение <InfoTooltip title="Как читать решение">Рекомендация — ориентир на основе доступных затрат, установок и доступной экономики. Откройте прогноз, чтобы увидеть источники и объём выборки.</InfoTooltip></th>
              <th className="col-controls">Управление</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isExp = expanded.has(r.id);
              const v = verdicts[r.id];
              return [
                <tr key={r.id} className={flashed.has(r.id) ? "flash" : isExp ? "expanded" : ""}>
                  <td className="col-toggle">
                    <span className={`expand-toggle ${isExp ? "open" : ""}`} onClick={() => toggleExpand(r.id)}>▸</span>
                  </td>
                  <td className="cell-name" title={r.name}>
                    <Link to={`/campaigns/${r.id}`} className="row-link">{campaignDisplayName(r.name)}</Link>
                    <div className="cell-sub">
                      {r.country}{campaignTechnicalName(r.name) ? ` · ${r.name}` : ""}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${r.status === "ENABLED" && r.serving_status === "RUNNING" ? "ok" : "warn"}`}>
                      {r.serving_status === "RUNNING" ? "работает" : r.status === "PAUSED" ? "пауза" : "на проверке"}
                    </span>
                  </td>
                  <td className="num">{fmtUsd(r.spend)}</td>
                  <td className="num">{r.installs}</td>
                  <td className={`num ${cls(r.cpi)}`}>{r.cpi > 0 ? fmtUsd(r.cpi) : "—"}</td>
                  <td>
                    {v ? (
                      <button className="compact" onClick={() => setDrawerCid(r.id)} title={v.reason}>
                        <span className={`roi ${v.kind}`}>{verdictLabel(v.label)}</span>
                      </button>
                    ) : <span className="muted">…</span>}
                  </td>
                  <td>
                    <CampaignControls campaign={r} onChange={() => { void load(); }} />
                  </td>
                </tr>,
                isExp && (
                  <tr key={`${r.id}-exp`} className="expand-row">
                    <td colSpan={8}>
                      <div className="expand-grid">
                        <div className="field"><span className="k">Показы</span><span className="v">{r.impressions.toLocaleString()}</span></div>
                        <div className="field"><span className="k">Тапы</span><span className="v">{r.taps}</span></div>
                        <div className="field"><span className="k">TTR</span><span className="v">{(r.ttr * 100).toFixed(2)}%</span></div>
                        <div className="field"><span className="k">Тап → установка</span><span className="v">{(r.install_rate * 100).toFixed(1)}%</span></div>
                        <div className="field"><span className="k">Старты триала (ASC)</span><span className="v">{r.trial_starts}</span></div>
                        <div className="field"><span className="k">Лимит на весь срок</span><span className="v">{fmtUsd(r.lifetime_budget)}</span></div>
                        <div className="field"><span className="k">Период</span><span className="v">{r.start_time?.slice(0, 10)} → {r.end_time?.slice(0, 10) ?? "—"}</span></div>
                        <div className="field"><span className="k">Стратегия ставок</span><span className="v">{r.bidding_strategy}</span></div>
                      </div>
                      {v?.reason && (
                        <div className={`callout callout-gap ${v.kind === "scale" ? "good" : v.kind === "cut" ? "bad" : v.kind === "hold" ? "warn" : ""}`}>
                          <span className={`roi ${v.kind} inline-label`}>{verdictLabel(v.label)}</span>
                          {v.reason}
                        </div>
                      )}
                      <div className="btn-group callout-gap">
                        <button className="primary" onClick={() => setDrawerCid(r.id)}>Открыть прогноз ROI</button>
                        <Link to={`/campaigns/${r.id}`} className="btn">К ключевым словам</Link>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
        </div>
      )}

      {drawerCid && drawerCamp && (
        <RoiDrawer
          campaignId={drawerCid}
          campaignName={campaignDisplayName(drawerCamp.name)}
          onClose={() => setDrawerCid(null)}
        />
      )}
    </>
  );
}
