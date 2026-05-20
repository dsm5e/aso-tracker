import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";

interface GeoRow {
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

const FLAGS: Record<string, string> = {
  US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦", AU: "🇦🇺", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸",
  NL: "🇳🇱", CH: "🇨🇭", IL: "🇮🇱", SE: "🇸🇪", NO: "🇳🇴", DK: "🇩🇰", FI: "🇫🇮", JP: "🇯🇵",
  TR: "🇹🇷", BR: "🇧🇷", MX: "🇲🇽", SA: "🇸🇦", KR: "🇰🇷", ID: "🇮🇩", TW: "🇹🇼", IE: "🇮🇪",
};

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

  function color(v: number): string {
    const c = metric === "cpi" ? "var(--red)" : "var(--amber)";
    const i = intensity(v);
    return `color-mix(in srgb, ${c} ${(i * 100).toFixed(0)}%, transparent)`;
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div className="muted" style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase" }}>Geo · {rows.length} countries</div>
        <div className="btn-group">
          {(["spend", "installs", "cpi", "trials"] as const).map((m) => (
            <button key={m} className={`compact ${m === metric ? "primary" : ""}`} onClick={() => setMetric(m)}>{m}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 6 }}>
        {rows.map((r) => {
          const v = Number(r[metric] ?? 0);
          return (
            <div
              key={r.country}
              title={`${r.country} · spend ${fmtUsd(r.spend)} · installs ${r.installs} · CPI ${fmtUsd(r.cpi)} · ${r.campaigns} campaigns`}
              style={{
                padding: "8px 10px",
                background: color(v),
                border: "1px solid var(--line)",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 16 }}>{FLAGS[r.country] ?? "🏳"}</span>
                <span style={{ fontSize: 11, letterSpacing: "0.05em", color: "var(--bone)" }}>{r.country}</span>
                <span className="muted" style={{ fontSize: 9, marginLeft: "auto" }}>×{r.campaigns}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--bone)", fontVariantNumeric: "tabular-nums" }}>
                {metric === "spend" ? fmtUsd(r.spend) : metric === "cpi" ? (r.cpi > 0 ? fmtUsd(r.cpi) : "—") : metric === "installs" ? r.installs : r.trials}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
