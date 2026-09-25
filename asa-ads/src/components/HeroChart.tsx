import { useState } from "react";
import type { DailyTotals } from "../api.ts";
import { Legend, LineChart, SERIES } from "../../../shared/charts/Charts.tsx";

interface Props {
  daily: DailyTotals[];
}

type Metric = "spend" | "installs" | "cpi" | "trial_starts" | "ttr";

const METRICS: { key: Metric; label: string; format: (n: number) => string }[] = [
  { key: "spend", label: "Расход", format: (n) => `$${n.toFixed(2)}` },
  { key: "installs", label: "Установки", format: (n) => String(Math.round(n)) },
  { key: "cpi", label: "CPI", format: (n) => `$${n.toFixed(2)}` },
  { key: "trial_starts", label: "Старты триала", format: (n) => String(Math.round(n)) },
  { key: "ttr", label: "TTR", format: (n) => `${(n * 100).toFixed(2)}%` },
];

const CURRENT = SERIES[0];
const WEEK_AGO = "var(--ds-subtle)";

export default function HeroChart({ daily }: Props) {
  const [metric, setMetric] = useState<Metric>("spend");
  const m = METRICS.find((x) => x.key === metric)!;

  if (daily.length === 0) return null;

  const values = daily.map((d) => Number(d[metric] ?? 0));
  const labels = daily.map((d) => d.date.slice(5));
  // WoW overlay: the same metric 7 days earlier, aligned to today's x.
  const weekAgo = values.map((_, i) => (i >= 7 ? values[i - 7] : null));

  return (
    <div className="card" style={{ padding: "14px 18px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
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
        <div style={{ fontSize: 12, color: "var(--ds-muted)" }}>
          Последняя точка · <b style={{ color: "var(--ds-text)" }}>{m.format(values[values.length - 1] ?? 0)}</b>
        </div>
      </div>
      <Legend line items={[[CURRENT, `${m.label} · текущий период`], [WEEK_AGO, "Неделей ранее"]]} />
      <LineChart
        labels={labels}
        yFmt={m.format}
        series={[
          { label: m.label, color: CURRENT, values, end: true },
          { label: "Неделей ранее", color: WEEK_AGO, values: weekAgo, dashed: true, width: 1.5 },
        ]}
      />
      <div style={{ fontSize: 12, color: "var(--ds-muted)", marginTop: 4 }}>
        Сплошная линия — текущий период; пунктир — те же дни неделей ранее. Это сравнение тренда, а не прогноз.
      </div>
    </div>
  );
}
