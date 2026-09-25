import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { tipProps, type TipRow } from "../../../shared/charts/Charts.tsx";

interface GeoRow {
  country: string;
  impressions: number;
  taps: number;
  installs: number;
  spend: number | null;
  cpi: number | null;
  campaigns: number;
  trials: number;
}

// The API reports unavailable money as null (partial data stays visible), not 0.
function fmtUsd(n: number | null | undefined): string { return n == null ? "—" : `$${n.toFixed(2)}`; }

const FLAGS: Record<string, string> = {
  US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", AU: "🇦🇺", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸",
  NL: "🇳🇱", CH: "🇨🇭", IL: "🇮🇱", SE: "🇸🇪", NO: "🇳🇴", DK: "🇩🇰", FI: "🇫🇮", JP: "🇯🇵",
  TR: "🇹🇷", BR: "🇧🇷", MX: "🇲🇽", SA: "🇸🇦", KR: "🇰🇷", ID: "🇮🇩", TW: "🇹🇼", IE: "🇮🇪",
};

const METRIC_LABEL = { spend: "Расход", installs: "Установки", cpi: "CPI", trials: "Триалы" } as const;

interface Props {
  days: number;
}

export default function GeoHeatmap({ days }: Props) {
  const { selected } = useApp();
  const [rows, setRows] = useState<GeoRow[]>([]);
  const [metric, setMetric] = useState<"spend" | "installs" | "cpi" | "trials">("spend");

  useEffect(() => {
    api.geo(days, selected).then(setRows);
  }, [days, selected]);

  if (rows.length === 0) return null;

  const values = rows.map((r) => Number(r[metric] ?? 0));
  const max = Math.max(...values, 0.0001);

  function intensity(v: number): number {
    return Math.min(1, v / max);
  }

  // Heat = share of the max; CPI is a cost, so it heats in the "bad" color.
  function color(v: number): string {
    const c = metric === "cpi" ? "var(--ds-bad)" : "var(--ds-c1)";
    const i = intensity(v);
    return `color-mix(in srgb, ${c} ${(i * 55).toFixed(0)}%, var(--ds-panel))`;
  }
  const keyColor = metric === "cpi" ? "var(--ds-bad)" : "var(--ds-c1)";
  const tipRows = (r: GeoRow): TipRow[] => [
    [metric === "spend" ? keyColor : null, "Расход", fmtUsd(r.spend)],
    [metric === "installs" ? keyColor : null, "Установки", String(r.installs)],
    [metric === "cpi" ? keyColor : null, "CPI", r.cpi != null && r.cpi > 0 ? fmtUsd(r.cpi) : "—"],
    [metric === "trials" ? keyColor : null, "Старты триала", String(r.trials)],
    [null, "Кампаний", String(r.campaigns)],
  ];

  return (
    <div className="card">
      <div className="card-toolbar">
        <div className="ds-card-title">География · <span className="muted">{rows.length} стран</span></div>
        <div className="ds-seg">
          {(["spend", "installs", "cpi", "trials"] as const).map((m) => (
            <button key={m} className={m === metric ? "on" : ""} onClick={() => setMetric(m)}>{METRIC_LABEL[m]}</button>
          ))}
        </div>
      </div>
      <div className="geo-grid">
        {rows.map((r) => {
          const v = Number(r[metric] ?? 0);
          return (
            <div
              key={r.country}
              {...tipProps(`${FLAGS[r.country] ?? "🏳"} ${r.country}`, tipRows(r))}
              className="geo-cell"
              style={{ background: color(v) }}
            >
              <div className="geo-cell-head">
                <span className="geo-flag">{FLAGS[r.country] ?? "🏳"}</span>
                <span className="geo-code">{r.country}</span>
                <span className="geo-count">×{r.campaigns}</span>
              </div>
              <div className="geo-value">
                {metric === "spend" ? fmtUsd(r.spend) : metric === "cpi" ? (r.cpi != null && r.cpi > 0 ? fmtUsd(r.cpi) : "—") : metric === "installs" ? r.installs : r.trials}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
