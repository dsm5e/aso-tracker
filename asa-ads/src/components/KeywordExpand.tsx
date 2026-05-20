import { useEffect, useState } from "react";
import { api, type Keyword, type Projection } from "../api.ts";
import Sparkline from "./Sparkline.tsx";

interface Props {
  keyword: Keyword;
}

const SPEND_LEVELS = [25, 50, 100, 250, 500, 1000];

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }
function fmtPct(n: number): string { return `${(n * 100).toFixed(0)}%`; }

export default function KeywordExpand({ keyword }: Props) {
  const [daily, setDaily] = useState<Array<{ date: string; impressions: number; taps: number; installs: number; spend: number; cpt: number; cpi: number }>>([]);
  const [proj, setProj] = useState<Projection | null>(null);
  const [spend, setSpend] = useState(100);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.keywordDaily(keyword.id, 14),
      api.roiKeyword(keyword.id, spend, 14),
    ]).then(([d, p]) => {
      setDaily(d);
      setProj(p);
    }).finally(() => setLoading(false));
  }, [keyword.id, spend]);

  return (
    <div className="expand-grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
      {/* Left: history charts */}
      <div>
        <div className="muted" style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 8 }}>14-day history</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Sparkline
            title="Impressions"
            value={String(daily.reduce((a, d) => a + d.impressions, 0))}
            data={daily.map((d) => d.impressions)}
            labels={daily.map((d) => d.date)}
            color="#a78bfa"
            width={260}
            height={50}
            format={(n) => String(Math.round(n))}
          />
          <Sparkline
            title="Spend"
            value={fmtUsd(daily.reduce((a, d) => a + d.spend, 0))}
            data={daily.map((d) => d.spend)}
            labels={daily.map((d) => d.date)}
            color="#ffb000"
            width={260}
            height={50}
            format={fmtUsd}
          />
          <Sparkline
            title="Installs"
            value={String(daily.reduce((a, d) => a + d.installs, 0))}
            data={daily.map((d) => d.installs)}
            labels={daily.map((d) => d.date)}
            color="#5ce1e6"
            width={260}
            height={50}
            format={(n) => String(Math.round(n))}
          />
          <Sparkline
            title="CPT"
            value={daily.length ? fmtUsd(daily.reduce((a, d) => a + d.spend, 0) / Math.max(1, daily.reduce((a, d) => a + d.taps, 0))) : "—"}
            data={daily.map((d) => d.cpt)}
            labels={daily.map((d) => d.date)}
            color="#ff5c5c"
            width={260}
            height={50}
            format={fmtUsd}
          />
        </div>
      </div>

      {/* Right: ROI projection */}
      <div>
        <div className="muted" style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 8 }}>Spend scenario</div>
        <div className="btn-group" style={{ flexWrap: "wrap", marginBottom: 12 }}>
          {SPEND_LEVELS.map((s) => (
            <button key={s} className={`compact ${s === spend ? "primary" : ""}`} onClick={() => setSpend(s)}>${s}</button>
          ))}
        </div>

        {loading || !proj ? <div className="loading">computing</div> : (
          <>
            <div className={`roi ${proj.verdict.kind}`} style={{ fontSize: 14, marginBottom: 6 }}>{proj.verdict.label}</div>
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 12 }}>{proj.verdict.reason}</div>

            {proj.next_step && (
              <div style={{ padding: "8px 10px", background: "var(--bg-1)", borderLeft: "2px solid var(--yellow)", fontSize: 11, color: "var(--bone-dim)", lineHeight: 1.5, marginBottom: 12 }}>
                <span style={{ color: "var(--yellow)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Next step</span>
                {proj.next_step}
              </div>
            )}

            <table style={{ fontSize: 11 }}>
              <tbody>
                <tr><td className="muted">Conf</td><td className="num"><span className={`badge ${proj.confidence === "high" ? "ok" : proj.confidence === "medium" ? "cyan" : "warn"}`}>{proj.confidence}</span></td></tr>
                <tr><td className="muted">Inst → trial</td><td className="num cyan">{fmtPct(proj.install_to_trial_rate)}</td></tr>
                <tr><td className="muted">Proj. installs</td><td className="num">{proj.projected_installs.toFixed(0)}</td></tr>
                <tr><td className="muted">Proj. trials</td><td className="num">{proj.projected_trials.toFixed(0)}</td></tr>
                <tr><td className="muted">Proj. paid</td><td className="num">{proj.projected_paid.toFixed(1)}</td></tr>
                <tr><td className="muted">Est. revenue</td><td className="num good">{fmtUsd(proj.projected_revenue)}</td></tr>
                <tr><td className="muted">ROI</td><td className={`num ${proj.projected_roi > 0.5 ? "good" : proj.projected_roi > 0 ? "" : "bad"}`}>{(proj.projected_roi * 100).toFixed(0)}%</td></tr>
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
