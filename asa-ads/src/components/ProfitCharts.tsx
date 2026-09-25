/** Profitability visuals — cost-per-trial bars, ROAS bars and the spend×trials
 *  efficiency scatter, drawn with the shared chart kit. Pure presentation. */
import { HBars, tipProps, useWidth, nice, type TipRow } from "../../../shared/charts/Charts.tsx";

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

const caption: React.CSSProperties = { fontSize: 12, color: "var(--ds-muted)", marginBottom: 8 };

/** Efficiency zone of a geo, relative to the blended cost-per-trial (data-driven,
 *  no LTV assumption): good ≤ blended, warn ≤ 2× blended, bad > 2× or no trials. */
export function zoneColor(costPerTrial: number | null, blended: number): string {
  if (costPerTrial === null) return "var(--ds-bad)";
  if (costPerTrial <= blended) return "var(--ds-good)";
  if (costPerTrial <= blended * 2) return "var(--ds-warn)";
  return "var(--ds-bad)";
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

  // axis max: cap so a single huge "0-trial spend" bar doesn't crush the rest
  const maxCpt = Math.max(blended * 3, ...data.map((d) => d.cpt ?? 0));
  const barVal = (d: typeof data[number]) => (d.cpt === null ? maxCpt : Math.min(d.cpt, maxCpt));

  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div style={caption}>
        Цена триала по странам · зелёный ≤ средней ({fmtUsd(blended)}) · жёлтый ≤ 2× · красный &gt; 2× или нет триалов
      </div>
      <HBars
        max={maxCpt}
        labelWidth={56}
        valueWidth={130}
        marker={{ value: blended, label: `средняя ${fmtUsd(blended)}` }}
        rows={data.map((d) => {
          const c = zoneColor(d.cpt, blended);
          const tip: TipRow[] = [
            [c, "Цена триала", d.cpt === null ? "нет триалов" : fmtUsd(d.cpt)],
            [null, "Расход", fmtUsd(d.spend)],
            [null, "Старты триала", String(d.trials)],
            [null, "Средняя", fmtUsd(blended)],
          ];
          return { label: d.country, value: barVal(d), color: c, tip, text: d.cpt === null ? `0 триалов · ${fmtUsd(d.spend)}` : fmtUsd(d.cpt) };
        })}
      />
    </div>
  );
}

export interface RoasRow { country: string; spend: number; revenue: number; roas: number }

/** Real ROAS per geo — bar ∝ ROAS%, break-even at 100%. good ≥100% · warn ≥50% · bad below / no revenue. */
export function RoasByGeoBars({ rows }: { rows: RoasRow[] }) {
  const data = rows.filter((r) => r.spend > 0).sort((a, b) => b.roas - a.roas);
  if (data.length === 0) return null;

  const maxRoas = Math.max(2, ...data.map((d) => d.roas)); // cap axis at ≥200%
  const color = (roas: number, rev: number) => rev <= 0 ? "var(--ds-bad)" : roas >= 1 ? "var(--ds-good)" : roas >= 0.5 ? "var(--ds-warn)" : "var(--ds-bad)";

  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div style={caption}>
        Реальный ROAS по странам · окупаемость = 100% (выручка = расход) · зелёный ≥100% · жёлтый ≥50%
      </div>
      <HBars
        max={maxRoas}
        labelWidth={56}
        valueWidth={170}
        marker={maxRoas >= 1 ? { value: 1, label: "100%" } : undefined}
        rows={data.map((d) => {
          const c = color(d.roas, d.revenue);
          const tip: TipRow[] = [
            [c, "ROAS", `${(d.roas * 100).toFixed(0)}%`],
            [null, "Выручка", fmtUsd(d.revenue)],
            [null, "Расход", fmtUsd(d.spend)],
          ];
          return {
            label: d.country, value: Math.min(d.roas, maxRoas), color: c, tip,
            text: d.revenue <= 0 ? `$0 / ${fmtUsd(d.spend)}` : `${(d.roas * 100).toFixed(0)}% · ${fmtUsd(d.revenue)}/${fmtUsd(d.spend)}`,
          };
        })}
      />
    </div>
  );
}

/** No kit equivalent: a bubble scatter drawn by the kit rules (grid/axis tokens,
 *  11px muted axis text, 2px strokes) with kit tooltips on every bubble. */
export function EfficiencyScatter({ rows, blended }: { rows: GeoRow[]; blended: number }) {
  const data = rows.filter((r) => r.spend > 0);
  if (data.length === 0) return null;
  return <Scatter data={data} blended={blended} />;
}

function Scatter({ data, blended }: { data: GeoRow[]; blended: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(1000);

  const H = 340;
  const padL = 48, padR = 20, padT = 16, padB = 34;
  const innerW = Math.max(1, W - padL - padR), innerH = H - padT - padB;
  const [maxSpend, xticks] = nice(Math.max(...data.map((d) => d.spend), 1) * 1.08);
  const [maxTrials, yticks] = nice(Math.max(...data.map((d) => d.trials), 3) * 1.15);
  const x = (v: number) => padL + (v / maxSpend) * innerW;
  const y = (v: number) => padT + innerH - (v / maxTrials) * innerH;
  const r = (installs: number) => Math.max(4, Math.min(26, Math.sqrt(installs) * 2.4));

  // break-even diagonal: trials = spend / blended
  const beX2 = maxSpend, beY2 = maxSpend / blended;
  const beClampX = beY2 > maxTrials ? maxTrials * blended : beX2;
  const beClampY = beY2 > maxTrials ? maxTrials : beY2;

  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div style={caption}>
        Эффективность · по горизонтали расход · по вертикали триалы · размер — установки · ниже пунктира цена триала выше средней
      </div>
      <div className="dsc" ref={ref}>
        <svg viewBox={`0 0 ${W} ${H}`} height={H}>
          {yticks.map((t) => (
            <g key={`y${t}`}>
              <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke={t ? "var(--ds-grid)" : "var(--ds-axis)"} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end">{Math.round(t)}</text>
            </g>
          ))}
          {xticks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={H - 12} textAnchor="middle">{`$${Math.round(t)}`}</text>
          ))}
          {/* break-even line */}
          <line x1={x(0)} y1={y(0)} x2={x(beClampX)} y2={y(beClampY)} stroke="var(--ds-muted)" strokeDasharray="3 4" opacity={0.6} />
          {data.map((d) => {
            const cpt = d.trials > 0 ? d.spend / d.trials : null;
            const c = zoneColor(cpt, blended);
            const tip: TipRow[] = [
              [c, "Цена триала", cpt === null ? "нет триалов" : fmtUsd(cpt)],
              [null, "Расход", fmtUsd(d.spend)],
              [null, "Старты триала", String(d.trials)],
              [null, "Установки", String(d.installs)],
            ];
            return (
              <g key={d.country} {...tipProps(d.country, tip)}>
                <circle cx={x(d.spend)} cy={y(d.trials)} r={r(d.installs)} fill={c} fillOpacity={0.55} stroke={c} strokeWidth={2} />
                <text className="lab" x={x(d.spend)} y={y(d.trials) - r(d.installs) - 4} textAnchor="middle">{d.country}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
