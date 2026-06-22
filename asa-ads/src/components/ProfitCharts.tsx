/** Profitability visuals — cost-per-trial bars + spend×trials efficiency scatter.
 *  Inline SVG, matches HeroChart aesthetic (phosphor terminal). Pure presentation. */

export interface GeoRow {
  country: string;
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  cpi: number;
  campaigns: number;
  trials: number;
}

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }

/** Efficiency zone of a geo, relative to the blended cost-per-trial (data-driven,
 *  no LTV assumption): green ≤ blended, amber ≤ 2× blended, red > 2× or no trials. */
export function zoneColor(costPerTrial: number | null, blended: number): string {
  if (costPerTrial === null) return "var(--red)";
  if (costPerTrial <= blended) return "var(--green)";
  if (costPerTrial <= blended * 2) return "var(--amber)";
  return "var(--red)";
}

export function CostPerTrialBars({ rows, blended }: { rows: GeoRow[]; blended: number }) {
  // cost-per-trial asc; 0-trial geos (slivers of waste) sink to the bottom by spend.
  const data = rows
    .filter((r) => r.spend > 0)
    .map((r) => ({ ...r, cpt: r.trials > 0 ? r.spend / r.trials : null }))
    .sort((a, b) => {
      if (a.cpt === null && b.cpt === null) return b.spend - a.spend;
      if (a.cpt === null) return 1;
      if (b.cpt === null) return -1;
      return a.cpt - b.cpt;
    });
  if (data.length === 0) return null;

  const rowH = 22;
  const padL = 56, padR = 60, padT = 8, padB = 22;
  const W = 1000;
  const H = padT + padB + data.length * rowH;
  const innerW = W - padL - padR;
  // axis max: cap so a single huge "0-trial spend" bar doesn't crush the rest
  const maxCpt = Math.max(blended * 3, ...data.map((d) => d.cpt ?? 0));
  const barVal = (d: typeof data[number]) => (d.cpt === null ? maxCpt : Math.min(d.cpt, maxCpt));
  const x = (v: number) => padL + (v / maxCpt) * innerW;

  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div className="muted" style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
        Cost per trial · green ≤ blended ({fmtUsd(blended)}) · amber ≤ 2× · red &gt; 2× / no trials
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height: "auto" }}>
        {/* blended reference line */}
        <line x1={x(blended)} y1={padT} x2={x(blended)} y2={H - padB} stroke="var(--cyan)" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.7" />
        <text x={x(blended)} y={H - 8} textAnchor="middle" fill="var(--cyan)" fontSize="10" fontFamily="var(--mono)">{fmtUsd(blended)}</text>
        {data.map((d, i) => {
          const y = padT + i * rowH;
          const c = zoneColor(d.cpt, blended);
          const w = x(barVal(d)) - padL;
          return (
            <g key={d.country}>
              <text x={padL - 8} y={y + rowH / 2 + 3} textAnchor="end" fill="var(--bone)" fontSize="11" fontFamily="var(--mono)">{d.country}</text>
              <rect x={padL} y={y + 3} width={Math.max(1, w)} height={rowH - 8} fill={c} opacity={d.cpt === null ? 0.32 : 0.62} rx="1" />
              <text x={x(barVal(d)) + 6} y={y + rowH / 2 + 3} fill="var(--bone-dim)" fontSize="10" fontFamily="var(--mono)">
                {d.cpt === null ? `0 trials · ${fmtUsd(d.spend)}` : fmtUsd(d.cpt)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function EfficiencyScatter({ rows, blended }: { rows: GeoRow[]; blended: number }) {
  const data = rows.filter((r) => r.spend > 0);
  if (data.length === 0) return null;

  const W = 1000, H = 360;
  const padL = 48, padR = 20, padT = 16, padB = 34;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const maxSpend = Math.max(...data.map((d) => d.spend), 1) * 1.08;
  const maxTrials = Math.max(...data.map((d) => d.trials), 3) * 1.15;
  const x = (v: number) => padL + (v / maxSpend) * innerW;
  const y = (v: number) => padT + innerH - (v / maxTrials) * innerH;
  const r = (installs: number) => Math.max(4, Math.min(26, Math.sqrt(installs) * 2.4));

  // break-even diagonal: trials = spend / blended
  const beX2 = maxSpend, beY2 = maxSpend / blended;
  const beClampX = beY2 > maxTrials ? maxTrials * blended : beX2;
  const beClampY = beY2 > maxTrials ? maxTrials : beY2;

  const xticks = [0, maxSpend * 0.25, maxSpend * 0.5, maxSpend * 0.75, maxSpend];
  const yticks = [0, maxTrials * 0.25, maxTrials * 0.5, maxTrials * 0.75, maxTrials];

  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div className="muted" style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
        Efficiency · X spend · Y trials · bubble = installs · below dashed line = above-blended cost/trial
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height: "auto" }}>
        {yticks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--line)" strokeWidth="0.5" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fill="var(--bone-mute)" fontSize="9" fontFamily="var(--mono)">{Math.round(t)}</text>
          </g>
        ))}
        {xticks.map((t, i) => (
          <text key={`x${i}`} x={x(t)} y={H - 10} textAnchor="middle" fill="var(--bone-mute)" fontSize="9" fontFamily="var(--mono)">{fmtUsd(t)}</text>
        ))}
        {/* break-even line */}
        <line x1={x(0)} y1={y(0)} x2={x(beClampX)} y2={y(beClampY)} stroke="var(--cyan)" strokeWidth="1" strokeDasharray="5 4" opacity="0.7" />
        {data.map((d) => {
          const cpt = d.trials > 0 ? d.spend / d.trials : null;
          const c = zoneColor(cpt, blended);
          return (
            <g key={d.country}>
              <circle cx={x(d.spend)} cy={y(d.trials)} r={r(d.installs)} fill={c} opacity="0.45" stroke={c} strokeWidth="1" />
              <text x={x(d.spend)} y={y(d.trials) - r(d.installs) - 3} textAnchor="middle" fill="var(--bone-dim)" fontSize="9" fontFamily="var(--mono)">{d.country}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
