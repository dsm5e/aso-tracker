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
    load().catch(console.error).finally(() => setLoading(false));
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
        <h2>Dashboard</h2>
        <div className="controls">
          <span className="meta">{new Date().toISOString().replace("T", " ").slice(0, 16)}Z</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Today</option>
            <option value={3}>3D</option>
            <option value={7}>7D</option>
            <option value={14}>14D</option>
            <option value={30}>30D</option>
          </select>
        </div>
      </div>

      <div className="spark-row">
        <Sparkline title="Spend" value={fmtUsd(totals.spend)} data={daily.map((d) => d.spend)} labels={dates} color="#ffb000" format={fmtUsd} />
        <Sparkline title="Installs" value={String(totals.installs)} data={daily.map((d) => d.installs)} labels={dates} color="#5ce1e6" format={(n) => String(Math.round(n))} />
        <Sparkline title="CPI" value={overallCpi > 0 ? fmtUsd(overallCpi) : "—"} data={daily.map((d) => d.cpi)} labels={dates} color="#ff5c5c" format={fmtUsd} />
        <Sparkline title="Trials (ASC)" value={String(totals.trials)} data={daily.map((d) => d.trial_starts)} labels={dates} color="#88c87a" format={(n) => String(Math.round(n))} />
      </div>

      <div className="divider">Trend</div>
      <HeroChart daily={daily} />

      <div className="divider">Geography</div>
      <GeoHeatmap days={days} />

      <div className="divider" style={{ justifyContent: "space-between" }}>
        Campaigns · {rows.length} total
        <button className="compact" onClick={() => exportRows(
          `campaigns-${new Date().toISOString().slice(0, 10)}.csv`,
          ["name", "country", "status", "daily_budget", "spend", "impressions", "taps", "installs", "cpi", "trial_starts"],
          rows as unknown as Array<Record<string, unknown>>,
        )}>export csv</button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="loading">loading</div>
      ) : rows.length === 0 ? (
        <div className="empty">no data · run sync</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 24 }} />
              <th>Campaign</th>
              <th>Status</th>
              <th className="num">Daily</th>
              <th className="num">Spend</th>
              <th className="num">Inst</th>
              <th className="num">CPI</th>
              <th>Verdict</th>
              <th style={{ minWidth: 170 }}>Controls</th>
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
                    <Link to={`/campaigns/${r.id}`} style={{ color: "var(--bone)", fontWeight: 500 }}>{r.name}</Link>
                    <div className="muted" style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 2 }}>{r.country}</div>
                  </td>
                  <td>
                    <span className={`badge ${r.status === "ENABLED" && r.serving_status === "RUNNING" ? "ok" : "warn"}`}>
                      {r.serving_status === "RUNNING" ? "run" : r.status === "PAUSED" ? "paused" : "hold"}
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
                        <div className="field"><span className="k">Impressions</span><span className="v">{r.impressions.toLocaleString()}</span></div>
                        <div className="field"><span className="k">Taps</span><span className="v">{r.taps}</span></div>
                        <div className="field"><span className="k">TTR</span><span className="v">{(r.ttr * 100).toFixed(2)}%</span></div>
                        <div className="field"><span className="k">Install Rate</span><span className="v">{(r.install_rate * 100).toFixed(1)}%</span></div>
                        <div className="field"><span className="k">Trials (country, ASC)</span><span className="v">{r.trial_starts}</span></div>
                        <div className="field"><span className="k">Lifetime budget cap</span><span className="v">{fmtUsd(r.lifetime_budget)}</span></div>
                        <div className="field"><span className="k">Start → End</span><span className="v" style={{ fontSize: 11 }}>{r.start_time?.slice(0, 10)} → {r.end_time?.slice(0, 10) ?? "—"}</span></div>
                        <div className="field"><span className="k">Bidding</span><span className="v">{r.bidding_strategy}</span></div>
                      </div>
                      {v?.reason && (
                        <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--bg-1)", borderLeft: `2px solid var(--${v.kind === "scale" ? "amber" : v.kind === "cut" ? "red" : v.kind === "unknown" ? "yellow" : "bone-mute"})`, fontSize: 12, color: "var(--bone-dim)" }}>
                          <span className={`roi ${v.kind}`} style={{ marginRight: 8 }}>{v.label}</span>
                          {v.reason}
                        </div>
                      )}
                      <div style={{ marginTop: 12 }}>
                        <button className="primary" onClick={() => setDrawerCid(r.id)}>open ROI projection →</button>{" "}
                        <Link to={`/campaigns/${r.id}`}><button>drill into keywords →</button></Link>
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
          campaignName={drawerCamp.name}
          onClose={() => setDrawerCid(null)}
        />
      )}
    </>
  );
}
