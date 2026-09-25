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
        <div>
          <h2>Обзор Apple Ads</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 5 }}>Все страны · Apple Ads reports · обновляется после синхронизации</div>
        </div>
        <div className="controls">
          <span className="meta">Источник: Apple Ads</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Сегодня</option>
            <option value={3}>3 дня</option>
            <option value={7}>7 дней</option>
            <option value={14}>14 дней</option>
            <option value={30}>30 дней</option>
          </select>
        </div>
      </div>

      <div className="spark-row">
        <Sparkline title="Расход" value={fmtUsd(totals.spend)} data={daily.map((d) => d.spend)} labels={dates} color="var(--ds-c1)" format={fmtUsd} />
        <Sparkline title="Установки" value={String(totals.installs)} data={daily.map((d) => d.installs)} labels={dates} color="var(--ds-c2)" format={(n) => String(Math.round(n))} />
        <Sparkline title="CPI" value={overallCpi > 0 ? fmtUsd(overallCpi) : "—"} data={daily.map((d) => d.cpi)} labels={dates} color="var(--ds-c3)" format={fmtUsd} />
        <Sparkline title="Старты триала" value={String(totals.trials)} data={daily.map((d) => d.trial_starts)} labels={dates} color="var(--ds-c4)" format={(n) => String(Math.round(n))} />
      </div>

      <div className="divider">Динамика</div>
      <HeroChart daily={daily} />

      <div className="divider">Страны</div>
      <GeoHeatmap days={days} />

      <div className="divider" style={{ justifyContent: "space-between" }}>
        Кампании · {rows.length}
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
        <table>
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              <th>Кампания</th>
              <th>Статус</th>
              <th className="num">Дневной лимит</th>
              <th className="num">Расход</th>
              <th className="num">Установки</th>
              <th className="num">CPI</th>
              <th>Решение <InfoTooltip title="Как читать решение">Рекомендация — ориентир на основе доступных затрат, установок и доступной экономики. Откройте прогноз, чтобы увидеть источники и объём выборки.</InfoTooltip></th>
              <th style={{ minWidth: 170 }}>Управление</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isExp = expanded.has(r.id);
              const v = verdicts[r.id];
              return [
                <tr key={r.id} className={flashed.has(r.id) ? "flash" : isExp ? "expanded" : ""}>
                  <td style={{ paddingLeft: 16 }}>
                    <span className={`expand-toggle ${isExp ? "open" : ""}`} onClick={() => toggleExpand(r.id)}>▸</span>
                  </td>
                  <td>
                    <Link to={`/campaigns/${r.id}`} style={{ color: "var(--bone)", fontWeight: 500 }}>{campaignDisplayName(r.name)}</Link>
                    <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>
                      {r.country}{campaignTechnicalName(r.name) ? ` · ${r.name}` : ""}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${r.status === "ENABLED" && r.serving_status === "RUNNING" ? "ok" : "warn"}`}>
                      {r.serving_status === "RUNNING" ? "работает" : r.status === "PAUSED" ? "пауза" : "на проверке"}
                    </span>
                  </td>
                  <td className="num">{fmtUsd(r.daily_budget)}</td>
                  <td className="num">{fmtUsd(r.spend)}</td>
                  <td className="num">{r.installs}</td>
                  <td className={`num ${cls(r.cpi)}`}>{r.cpi > 0 ? fmtUsd(r.cpi) : "—"}</td>
                  <td>
                    {v ? (
                      <button className="compact" onClick={() => setDrawerCid(r.id)} title={v.reason}>
                        <span className={`roi ${v.kind}`}>{v.label}</span>
                      </button>
                    ) : <span className="muted">…</span>}
                  </td>
                  <td>
                    <CampaignControls campaign={r} onChange={() => { void load(); }} />
                  </td>
                </tr>,
                isExp && (
                  <tr key={`${r.id}-exp`} className="expand-row">
                    <td colSpan={9}>
                      <div className="expand-grid">
                        <div className="field"><span className="k">Показы</span><span className="v">{r.impressions.toLocaleString()}</span></div>
                        <div className="field"><span className="k">Тапы</span><span className="v">{r.taps}</span></div>
                        <div className="field"><span className="k">TTR</span><span className="v">{(r.ttr * 100).toFixed(2)}%</span></div>
                        <div className="field"><span className="k">Тап → установка</span><span className="v">{(r.install_rate * 100).toFixed(1)}%</span></div>
                        <div className="field"><span className="k">Старты триала (ASC)</span><span className="v">{r.trial_starts}</span></div>
                        <div className="field"><span className="k">Лимит на весь срок</span><span className="v">{fmtUsd(r.lifetime_budget)}</span></div>
                        <div className="field"><span className="k">Период</span><span className="v" style={{ fontSize: 11 }}>{r.start_time?.slice(0, 10)} → {r.end_time?.slice(0, 10) ?? "—"}</span></div>
                        <div className="field"><span className="k">Стратегия ставок</span><span className="v">{r.bidding_strategy}</span></div>
                      </div>
                      {v?.reason && (
                        <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--bg-1)", borderLeft: `2px solid var(--${v.kind === "scale" ? "amber" : v.kind === "cut" ? "red" : v.kind === "unknown" ? "yellow" : "bone-mute"})`, fontSize: 12, color: "var(--bone-dim)" }}>
                          <span className={`roi ${v.kind}`} style={{ marginRight: 8 }}>{v.label}</span>
                          {v.reason}
                        </div>
                      )}
                      <div style={{ marginTop: 12 }}>
                        <button className="primary" onClick={() => setDrawerCid(r.id)}>Открыть прогноз ROI</button>{" "}
                        <Link to={`/campaigns/${r.id}`}><button>К ключевым словам</button></Link>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
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
