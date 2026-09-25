import { Sparkline as ChartSparkline } from "../../../shared/charts/Charts.tsx";

interface Props {
  data: number[];
  labels?: string[];
  title: string;
  value: string;
  /** Kept for call-site compatibility; the chart fills its card width. */
  width?: number;
  height?: number;
  color?: string;
  format?: (n: number) => string;
  onClick?: () => void;
}

/** KPI tile: title, headline value, day-over-day delta and the shared-kit sparkline
 *  (gradient area, 2px line, hover crosshair + tooltip). */
export default function Sparkline({
  data,
  labels = [],
  title,
  value,
  height = 64,
  color = "var(--ds-c1)",
  format = (n) => n.toFixed(2),
  onClick,
}: Props) {
  if (data.length === 0) {
    return (
      <div className="spark" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
        <div className="spark-head">
          <div className="spark-label">{title}</div>
          <div className="spark-value muted">—</div>
        </div>
        <div className="spark-empty" style={{ height }}>Нет данных</div>
      </div>
    );
  }

  const last = data[data.length - 1];
  const prev = data.length > 1 ? data[data.length - 2] : last;
  const delta = last - prev;
  const deltaPct = prev !== 0 ? (delta / prev) * 100 : 0;

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
      <ChartSparkline values={data} labels={labels.length ? labels : undefined} color={color} height={height} fmt={format} label={title} />
    </div>
  );
}
