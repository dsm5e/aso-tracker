import { useState } from "react";
import type { DailyTotals } from "../api.ts";

interface Props {
  daily: DailyTotals[];
}

type Metric = "spend" | "installs" | "cpi" | "trial_starts" | "ttr";

const METRICS: { key: Metric; label: string; color: string; format: (n: number) => string }[] = [
  { key: "spend", label: "Spend", color: "#ffb000", format: (n) => `$${n.toFixed(2)}` },
  { key: "installs", label: "Installs", color: "#5ce1e6", format: (n) => String(Math.round(n)) },
  { key: "cpi", label: "CPI", color: "#ff5c5c", format: (n) => `$${n.toFixed(2)}` },
  { key: "trial_starts", label: "Trials", color: "#88c87a", format: (n) => String(Math.round(n)) },
  { key: "ttr", label: "TTR", color: "#a78bfa", format: (n) => `${(n * 100).toFixed(2)}%` },
];

export default function HeroChart({ daily }: Props) {
  const [metric, setMetric] = useState<Metric>("spend");
  const [hover, setHover] = useState<number | null>(null);
  const m = METRICS.find((x) => x.key === metric)!;

  if (daily.length === 0) return null;

  const values = daily.map((d) => Number(d[metric] ?? 0));
  const dates = daily.map((d) => d.date);

  // WoW overlay: shift by 7 days
  const wowValues = values.slice(0, Math.max(0, values.length - 7));

  // padding
  const W = 1000;
  const H = 220;
  const padL = 50;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = Math.max(...values, ...wowValues, 0.0001);
  const min = 0; // metrics are non-negative
  const range = max - min || 1;

  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;

  const pts = values.map((v, i) => [padL + i * stepX, padT + innerH - ((v - min) / range) * innerH] as const);
  const wowPts = wowValues.map((v, i) => {
    const idx = i + 7;
    if (idx >= values.length) return null;
    return [padL + idx * stepX, padT + innerH - ((v - min) / range) * innerH] as const;
  }).filter((p): p is readonly [number, number] => p !== null);

  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const wowPath = wowPts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fill = `${path} L${(padL + (values.length - 1) * stepX).toFixed(1)},${(padT + innerH).toFixed(1)} L${padL.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  // Y ticks
  const ticks = [0, max * 0.25, max * 0.5, max * 0.75, max];

  function handleMove(e: React.MouseEvent<SVGSVGElement>): void {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const scale = W / rect.width;
    const x = (e.clientX - rect.left) * scale - padL;
    if (stepX === 0) return;
    const idx = Math.max(0, Math.min(values.length - 1, Math.round(x / stepX)));
    setHover(idx);
  }

  return (
    <div className="card" style={{ padding: "14px 18px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="btn-group">
          {METRICS.map((mm) => (
            <button
              key={mm.key}
              className={`compact ${mm.key === metric ? "primary" : ""}`}
              onClick={() => setMetric(mm.key)}
            >
              {mm.label}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {hover !== null ? `${dates[hover]} · ${m.format(values[hover])}` : `last ${m.format(values[values.length - 1] ?? 0)}`}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" onMouseMove={handleMove} onMouseLeave={() => setHover(null)} style={{ display: "block", width: "100%", height: "auto" }}>
        <defs>
          <linearGradient id={`hero-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={m.color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={m.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid */}
        {ticks.map((t, i) => {
          const y = padT + innerH - ((t - min) / range) * innerH;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--line)" strokeWidth="0.5" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fill="var(--bone-mute)" fontSize="10" fontFamily="var(--mono)">
                {m.format(t)}
              </text>
            </g>
          );
        })}
        {/* X labels — show every nth date */}
        {dates.map((d, i) => {
          const interval = Math.max(1, Math.floor(dates.length / 6));
          if (i % interval !== 0 && i !== dates.length - 1) return null;
          return (
            <text key={i} x={padL + i * stepX} y={H - 6} textAnchor="middle" fill="var(--bone-mute)" fontSize="10" fontFamily="var(--mono)">
              {d.slice(5)}
            </text>
          );
        })}
        {/* WoW overlay (lighter) */}
        {wowPath && <path d={wowPath} fill="none" stroke={m.color} strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />}
        {/* Main */}
        <path d={fill} fill={`url(#hero-${metric})`} />
        <path d={path} fill="none" stroke={m.color} strokeWidth="1.75" />
        {/* Hover */}
        {hover !== null && (
          <>
            <line x1={pts[hover][0]} y1={padT} x2={pts[hover][0]} y2={padT + innerH} stroke={m.color} strokeWidth="0.5" strokeDasharray="2 2" opacity="0.6" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="3.5" fill={m.color} />
          </>
        )}
      </svg>
      <div className="muted" style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 4 }}>
        — solid = current period · — dashed = same metric 7 days earlier (WoW)
      </div>
    </div>
  );
}
