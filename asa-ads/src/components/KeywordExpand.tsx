import { useEffect, useState } from "react";
import { api, type Keyword, type Projection } from "../api.ts";
import Sparkline from "./Sparkline.tsx";
import { verdictLabel } from "../lib/verdictLabel.ts";
import { useCountry } from "../lib/CountryContext.tsx";

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
  const { country, isWorld, label } = useCountry();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.keywordDaily(keyword.id, 14, country),
      api.roiKeyword(keyword.id, spend, 14),
    ]).then(([d, p]) => {
      setDaily(d);
      setProj(p);
    }).finally(() => setLoading(false));
  }, [country, keyword.id, spend]);

  return (
    <div className="expand-grid kw-expand">
      {/* Left: history charts */}
      <div>
        <div className="field-label">История за 14 дней{isWorld ? "" : ` · ${label}`}</div>
        <div className="kw-expand-sparks">
          <Sparkline
            title="Показы"
            value={String(daily.reduce((a, d) => a + d.impressions, 0))}
            data={daily.map((d) => d.impressions)}
            labels={daily.map((d) => d.date)}
            color="var(--ds-c1)"
            width={260}
            height={50}
            format={(n) => String(Math.round(n))}
          />
          <Sparkline
            title="Расход"
            value={fmtUsd(daily.reduce((a, d) => a + d.spend, 0))}
            data={daily.map((d) => d.spend)}
            labels={daily.map((d) => d.date)}
            color="var(--ds-c2)"
            width={260}
            height={50}
            format={fmtUsd}
          />
          <Sparkline
            title="Установки"
            value={String(daily.reduce((a, d) => a + d.installs, 0))}
            data={daily.map((d) => d.installs)}
            labels={daily.map((d) => d.date)}
            color="var(--ds-c3)"
            width={260}
            height={50}
            format={(n) => String(Math.round(n))}
          />
          <Sparkline
            title="CPT"
            lowerIsBetter
            value={daily.length ? fmtUsd(daily.reduce((a, d) => a + d.spend, 0) / Math.max(1, daily.reduce((a, d) => a + d.taps, 0))) : "—"}
            data={daily.map((d) => d.cpt)}
            labels={daily.map((d) => d.date)}
            color="var(--ds-c4)"
            width={260}
            height={50}
            format={fmtUsd}
          />
        </div>
      </div>

      {/* Right: ROI projection */}
      <div>
        <div className="field-label" title={isWorld ? undefined : "Прогноз строится по ключу целиком (все страны кампании)"}>Сценарий расхода{isWorld ? "" : " · все страны"}</div>
        <div className="ds-seg kw-expand-block">
          {SPEND_LEVELS.map((s) => (
            <button key={s} className={s === spend ? "on" : ""} onClick={() => setSpend(s)}>${s}</button>
          ))}
        </div>

        {loading || !proj ? <div className="loading">Считаем прогноз…</div> : (
          <>
            <div className={`roi ${proj.verdict.kind}`}>{verdictLabel(proj.verdict.label)}</div>
            <div className="note kw-expand-block">{proj.verdict.reason}</div>

            {proj.next_step && (
              <div className="callout warn kw-expand-block">
                <span className="callout-title">Следующий шаг</span>
                {proj.next_step}
              </div>
            )}

            <table>
              <tbody>
                <tr><td className="muted">Достоверность</td><td className="num"><span className={`badge ${proj.confidence === "high" ? "ok" : proj.confidence === "medium" ? "cyan" : "warn"}`}>{confidenceLabel(proj.confidence)}</span></td></tr>
                <tr><td className="muted">Установка → триал</td><td className="num cyan">{fmtPct(proj.install_to_trial_rate)}</td></tr>
                <tr><td className="muted">Прогноз установок</td><td className="num">{proj.projected_installs.toFixed(0)}</td></tr>
                <tr><td className="muted">Прогноз триалов</td><td className="num">{proj.projected_trials.toFixed(0)}</td></tr>
                <tr><td className="muted">Прогноз оплат</td><td className="num">{proj.projected_paid.toFixed(1)}</td></tr>
                <tr><td className="muted">Оценка выручки</td><td className="num good">{fmtUsd(proj.projected_revenue)}</td></tr>
                <tr><td className="muted">ROI</td><td className={`num ${proj.projected_roi > 0.5 ? "good" : proj.projected_roi > 0 ? "" : "bad"}`}>{(proj.projected_roi * 100).toFixed(0)}%</td></tr>
                {proj.paid_so_far > 0 && (
                  <tr>
                    <td className="muted">ROAS к текущему моменту {proj.revenue_source === "real" ? <span className="badge ok">факт</span> : <span className="badge cyan">собирается</span>}</td>
                    <td className={`num ${proj.roas_so_far >= 1 ? "good" : "bad"}`}>{proj.roas_so_far.toFixed(2)}× <span className="muted small">({proj.paid_so_far} оплат)</span></td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function confidenceLabel(value: Projection["confidence"]): string {
  return ({ high: "высокая", medium: "средняя", low: "низкая", insufficient: "недостаточно данных" })[value];
}
