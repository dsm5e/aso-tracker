import { useState } from "react";

interface Props {
  data: number[];
  labels?: string[];
  title: string;
  value: string;
  width?: number;
  height?: number;
  color?: string;
  format?: (n: number) => string;
  onClick?: () => void;
}

export default function Sparkline({
  data,
  labels = [],
  title,
  value,
  width = 280,
  height = 64,
  color = "var(--amber)",
  format = (n) => n.toFixed(2),
  onClick,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="spark" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
        <div className="spark-head">
          <div className="spark-label">{title}</div>
          <div className="spark-value muted">—</div>
        </div>
        <div className="spark-empty" style={{ height }}>no data</div>
      </div>
    );
  }
  const max = Math.max(...data, 0.0001);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pad = 4;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fillPath = `${path} L${(pad + (data.length - 1) * stepX).toFixed(1)},${(pad + innerH).toFixed(1)} L${pad.toFixed(1)},${(pad + innerH).toFixed(1)} Z`;

  const last = data[data.length - 1];
  const prev = data.length > 1 ? data[data.length - 2] : last;
  const delta = last - prev;
  const deltaPct = prev !== 0 ? (delta / prev) * 100 : 0;

  function handleMove(e: React.MouseEvent<SVGSVGElement>): void {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) * (width / rect.width) - pad;
    if (stepX === 0) return;
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(x / stepX)));
    setHover(idx);
  }

  const gradId = `grad-${title.replace(/[^a-zA-Z0-9]/g, "")}-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="spark" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <div className="spark-head">
        <div className="spark-label">{title}</div>
        <div className="spark-value">{value}</div>
        {data.length > 1 && (
          <div className={`spark-delta ${delta > 0 ? "good" : delta < 0 ? "bad" : "muted"}`}>
            {delta > 0 ? "↑" : delta < 0 ? "↓" : "·"} {Math.abs(deltaPct).toFixed(0)}%
          </div>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill={`url(#${gradId})`} vectorEffect="non-scaling-stroke" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <>
            <line x1={points[hover][0]} y1={pad} x2={points[hover][0]} y2={height - pad}
              stroke={color} strokeWidth="0.5" strokeDasharray="2 2" opacity="0.5" vectorEffect="non-scaling-stroke" />
            <circle cx={points[hover][0]} cy={points[hover][1]} r="3" fill={color} />
          </>
        )}
        {hover === null && points.length > 0 && (
          <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="2" fill={color} />
        )}
      </svg>
      {hover !== null && (
        <div style={{ fontSize: 10, color: "var(--bone-mute)", letterSpacing: "0.05em", marginTop: 4, textAlign: "right" }}>
          {labels[hover] ? `${labels[hover].slice(5)} · ` : ""}{format(data[hover])}
        </div>
      )}
    </div>
  );
}
