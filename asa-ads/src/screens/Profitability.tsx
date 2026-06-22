import { useEffect, useMemo, useState } from "react";
import { api, type DailyTotals } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import Sparkline from "../components/Sparkline.tsx";
import HeroChart from "../components/HeroChart.tsx";
import { CostPerTrialBars, EfficiencyScatter, RoasByGeoBars, zoneColor, type GeoRow } from "../components/ProfitCharts.tsx";
import { exportRows } from "../lib/csv.ts";

interface Props { reloadKey: number }

interface RevRow { country: string; trials: number; paid: number; revenueUsd: number }

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }

export default function Profitability({ reloadKey }: Props) {
  const { selected } = useApp();
  const [geo, setGeo] = useState<GeoRow[]>([]);
  const [daily, setDaily] = useState<DailyTotals[]>([]);
  const [rev, setRev] = useState<RevRow[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [projSpend, setProjSpend] = useState(100);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.geo(days, selected), api.daily(days, undefined, selected), api.revenue(days, selected)])
      .then(([g, d, r]) => { setGeo(g); setDaily(d); setRev(r.rows ?? []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days, reloadKey, selected]);

  const revByCountry = useMemo(() => {
    const m = new Map<string, RevRow>();
    for (const r of rev) m.set(r.country.toUpperCase(), r);
    return m;
  }, [rev]);
  const hasRevenue = rev.length > 0;

  // Merge spend/installs (ASA) with real trials/paid/revenue (Adapty) per geo.
  const merged = useMemo(() => geo.filter((g) => g.spend > 0).map((g) => {
    const r = revByCountry.get(g.country.toUpperCase());
    const trials = r ? r.trials : g.trials;
    const paid = r ? r.paid : 0;
    const revenue = r ? r.revenueUsd : 0;
    return {
      country: g.country, spend: g.spend, installs: g.installs, trials, paid, revenue,
      cpt: trials > 0 ? g.spend / trials : null,
      cpi: g.cpi,
      roas: g.spend > 0 ? revenue / g.spend : 0,
    };
  }).sort((a, b) => b.spend - a.spend), [geo, revByCountry]);

  const t = useMemo(() => {
    const spend = merged.reduce((s, r) => s + r.spend, 0);
    const installs = merged.reduce((s, r) => s + r.installs, 0);
    const trials = merged.reduce((s, r) => s + r.trials, 0);
    const paid = merged.reduce((s, r) => s + r.paid, 0);
    const revenue = merged.reduce((s, r) => s + r.revenue, 0);
    return {
      spend, installs, trials, paid, revenue,
      cpt: trials > 0 ? spend / trials : 0,
      roas: spend > 0 ? revenue / spend : 0,
    };
  }, [merged]);

  const dates = daily.map((d) => d.date);
  const dailyCpt = daily.map((d) => (d.trial_starts > 0 ? d.spend / d.trial_starts : 0));

  function roasColor(roas: number, hasRev: boolean): string {
    if (!hasRev) return "var(--bone-mute)";
    if (roas >= 1) return "var(--green)";
    if (roas >= 0.5) return "var(--amber)";
    return "var(--red)";
  }

  return (
    <>
      <div className="topbar">
        <h2>Profitability</h2>
        <div className="controls">
          <span className="meta">{hasRevenue ? "spend × Adapty revenue (real ROAS)" : "spend × trials · ASC"}</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7D</option>
            <option value={14}>14D</option>
            <option value={30}>30D</option>
            <option value={90}>90D</option>
          </select>
        </div>
      </div>

      <div className="spark-row">
        <Sparkline title="Spend" value={fmtUsd(t.spend)} data={daily.map((d) => d.spend)} labels={dates} color="var(--amber)" format={fmtUsd} />
        {hasRevenue ? (
          <Sparkline title="Revenue" value={fmtUsd(t.revenue)} data={daily.map((d) => d.spend)} labels={dates} color="var(--green)" format={fmtUsd} />
        ) : (
          <Sparkline title="Trials" value={String(t.trials)} data={daily.map((d) => d.trial_starts)} labels={dates} color="var(--green)" format={(n) => String(Math.round(n))} />
        )}
        {hasRevenue ? (
          <Sparkline title="ROAS" value={t.roas > 0 ? `${(t.roas * 100).toFixed(0)}%` : "—"} data={dailyCpt} labels={dates} color="var(--cyan)" format={fmtUsd} />
        ) : (
          <Sparkline title="Cost / trial" value={t.cpt > 0 ? fmtUsd(t.cpt) : "—"} data={dailyCpt} labels={dates} color="var(--cyan)" format={fmtUsd} />
        )}
        <Sparkline title={hasRevenue ? "Paid" : "Installs"} value={String(hasRevenue ? t.paid : t.installs)} data={daily.map((d) => d.installs)} labels={dates} color="var(--red)" format={(n) => String(Math.round(n))} />
      </div>

      <div className="divider">Payback trend</div>
      <HeroChart daily={daily} />

      {hasRevenue && (
        <>
          <div className="divider">ROAS by geo</div>
          <RoasByGeoBars rows={merged.map((r) => ({ country: r.country, spend: r.spend, revenue: r.revenue, roas: r.roas }))} />

          <div className="divider">Payback projector</div>
          <div className="card" style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em" }}>Pour</span>
              <input type="number" value={projSpend} min={0} step={50}
                onChange={(e) => setProjSpend(Math.max(0, Number(e.target.value)))}
                style={{ width: 96 }} />
              <span className="muted" style={{ fontSize: 11 }}>$ into a geo → projected revenue at its current ROAS (linear, holds only up to search-volume ceiling)</span>
            </div>
            {(() => {
              const profitable = merged.filter((r) => r.revenue > 0).sort((a, b) => b.roas - a.roas);
              if (profitable.length === 0) return <div className="muted" style={{ fontSize: 12 }}>no geo with revenue yet</div>;
              return (
                <table>
                  <thead>
                    <tr><th>Geo</th><th className="num">ROAS</th><th className="num">Pour</th><th className="num">→ Revenue</th><th className="num">Net</th></tr>
                  </thead>
                  <tbody>
                    {profitable.map((r) => {
                      const proj = projSpend * r.roas;
                      const net = proj - projSpend;
                      return (
                        <tr key={r.country}>
                          <td style={{ fontWeight: 500 }}>{r.country}</td>
                          <td className="num" style={{ color: r.roas >= 1 ? "var(--green)" : "var(--amber)" }}>{(r.roas * 100).toFixed(0)}%</td>
                          <td className="num">{fmtUsd(projSpend)}</td>
                          <td className="num" style={{ color: "var(--green)" }}>{fmtUsd(proj)}</td>
                          <td className="num" style={{ color: net >= 0 ? "var(--green)" : "var(--red)" }}>{net >= 0 ? "+" : ""}{fmtUsd(net)}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="muted">Blended</td>
                      <td className="num muted">{(t.roas * 100).toFixed(0)}%</td>
                      <td className="num muted">{fmtUsd(projSpend)}</td>
                      <td className="num muted">{fmtUsd(projSpend * t.roas)}</td>
                      <td className="num muted">{projSpend * t.roas - projSpend >= 0 ? "+" : ""}{fmtUsd(projSpend * t.roas - projSpend)}</td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
            <div className="muted" style={{ fontSize: 10, marginTop: 8 }}>
              ⚠ Linear at observed ROAS — early Adapty log (~from 06-21) + thin paid counts; treat as directional, not a guarantee. Niche search volume caps how much a geo can actually absorb.
            </div>
          </div>
        </>
      )}

      <div className="divider">Cost per trial by geo</div>
      {geo.length === 0 ? (
        <div className="empty">{loading ? "loading" : "no data · run sync"}</div>
      ) : (
        <CostPerTrialBars rows={geo} blended={t.cpt || 1} />
      )}

      <div className="divider">Efficiency map</div>
      {geo.length > 0 && <EfficiencyScatter rows={geo} blended={t.cpt || 1} />}

      <div className="divider" style={{ justifyContent: "space-between" }}>
        Geo breakdown · {merged.length}{hasRevenue ? " · real ROAS" : ""}
        <button className="compact" onClick={() => exportRows(
          `profitability-${new Date().toISOString().slice(0, 10)}.csv`,
          ["country", "spend", "installs", "trials", "paid", "revenue", "roas", "cpi", "cpt"],
          merged.map((r) => ({ ...r, cpt: r.cpt ?? "" })) as unknown as Array<Record<string, unknown>>,
        )}>export csv</button>
      </div>

      {merged.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Geo</th>
              <th className="num">Spend</th>
              <th className="num">Inst</th>
              <th className="num">Trials</th>
              {hasRevenue && <th className="num">Paid</th>}
              {hasRevenue && <th className="num">Revenue</th>}
              <th className="num">{hasRevenue ? "ROAS" : "Cost / trial"}</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {merged.map((r) => {
              const cptColor = zoneColor(r.cpt, t.cpt || 1);
              const rColor = roasColor(r.roas, hasRevenue);
              const verdict = hasRevenue
                ? (r.revenue === 0 ? (r.spend > 1 ? "no revenue" : "—") : r.roas >= 1 ? "profit" : r.roas >= 0.5 ? "watch" : "underwater")
                : (r.cpt === null ? "waste" : r.cpt <= (t.cpt || 1) ? "efficient" : r.cpt <= (t.cpt || 1) * 2 ? "watch" : "weak");
              const vColor = hasRevenue ? rColor : cptColor;
              return (
                <tr key={r.country}>
                  <td style={{ fontWeight: 500 }}>{r.country}</td>
                  <td className="num">{fmtUsd(r.spend)}</td>
                  <td className="num">{r.installs}</td>
                  <td className="num">{r.trials}</td>
                  {hasRevenue && <td className="num">{r.paid}</td>}
                  {hasRevenue && <td className="num" style={{ color: r.revenue > 0 ? "var(--green)" : "var(--bone-mute)" }}>{fmtUsd(r.revenue)}</td>}
                  <td className="num" style={{ color: hasRevenue ? rColor : cptColor }}>
                    {hasRevenue ? (r.revenue > 0 ? `${(r.roas * 100).toFixed(0)}%` : "—") : (r.cpt === null ? "—" : fmtUsd(r.cpt))}
                  </td>
                  <td><span className="roi" style={{ color: vColor, borderColor: vColor }}>{verdict}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
