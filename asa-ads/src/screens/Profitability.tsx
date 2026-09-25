import { useEffect, useMemo, useState } from "react";
import { api, type DailyTotals } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { useCountry } from "../lib/CountryContext.tsx";
import { ScopeBadge } from "../components/CountrySwitcher.tsx";
import Sparkline from "../components/Sparkline.tsx";
import HeroChart from "../components/HeroChart.tsx";
import { CostPerTrialBars, EfficiencyScatter, RoasByGeoBars, zoneColor, type GeoRow } from "../components/ProfitCharts.tsx";
import { exportRows } from "../lib/csv.ts";
import Dropdown from "../components/Dropdown.tsx";

interface Props { reloadKey: number }

interface RevRow { country: string; trials: number; paid: number; revenueUsd: number }

function fmtUsd(n: number): string { return `$${n.toFixed(2)}`; }

/** Storefronts under this spend in the window are pooled in charts. */
const MIN_CHART_SPEND = 5;

export default function Profitability({ reloadKey }: Props) {
  const { selected } = useApp();
  const { country, isWorld, label } = useCountry();
  const [feed, setFeed] = useState(false);
  const [geo, setGeo] = useState<GeoRow[]>([]);
  const [daily, setDaily] = useState<DailyTotals[]>([]);
  const [rev, setRev] = useState<RevRow[]>([]);
  const [revDaily, setRevDaily] = useState<Array<{ date: string; revenueUsd: number }>>([]);
  const [revError, setRevError] = useState("");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [projSpend, setProjSpend] = useState(100);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.geo(days, selected, country), api.daily(days, undefined, selected, country), api.revenue(days, selected, country)])
      .then(([g, d, r]) => { setGeo(g); setDaily(d); setRev(r.rows ?? []); setRevDaily(r.daily ?? []); setRevError(r.error ?? ""); setFeed(r.feed ?? (r.rows ?? []).length > 0); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [country, days, reloadKey, selected]);

  const revByCountry = useMemo(() => {
    const m = new Map<string, RevRow>();
    for (const r of rev) m.set(r.country.toUpperCase(), r);
    return m;
  }, [rev]);
  // A storefront without attributed rows still has a feed: its revenue is 0.
  const hasRevenue = feed || rev.length > 0;

  // Merge spend/installs (ASA) with trials/paid/revenue per geo. With an
  // Adapty feed the trials are Apple Ads-attributed (0 when Adapty has none);
  // without one they are all App Store Connect trial starts in the storefront.
  const merged = useMemo(() => geo.filter((g) => g.spend > 0).map((g) => {
    const r = revByCountry.get(g.country.toUpperCase());
    const trials = hasRevenue ? (r?.trials ?? 0) : g.trials;
    const paid = r ? r.paid : 0;
    const revenue = r ? r.revenueUsd : 0;
    return {
      country: g.country, spend: g.spend, installs: g.installs, trials, paid, revenue,
      impressions: g.impressions, taps: g.taps, campaigns: g.campaigns,
      cpt: trials > 0 ? g.spend / trials : null,
      cpi: g.cpi,
      roas: g.spend > 0 ? revenue / g.spend : 0,
    };
  }).sort((a, b) => b.spend - a.spend), [geo, revByCountry, hasRevenue]);

  // Per-country ratios on a few cents of spend are noise (one trial on $0.07 is
  // "$0.07 per trial", $4 revenue on $0.04 is "10000% ROAS"). Charts and the
  // scenario show storefronts with real spend and pool the tail into one row.
  const chartRows = useMemo(() => {
    const big = merged.filter((r) => r.spend >= MIN_CHART_SPEND);
    const tail = merged.filter((r) => r.spend < MIN_CHART_SPEND);
    if (tail.length === 0) return big;
    const sum = (k: "spend" | "installs" | "trials" | "paid" | "revenue" | "impressions" | "taps") => tail.reduce((acc, r) => acc + r[k], 0);
    const spend = sum("spend"), trials = sum("trials"), installs = sum("installs"), revenue = sum("revenue");
    return [...big, {
      country: `Прочие ${tail.length}`, spend, installs, trials, paid: sum("paid"), revenue,
      impressions: sum("impressions"), taps: sum("taps"), campaigns: 0,
      cpt: trials > 0 ? spend / trials : null,
      cpi: installs > 0 ? spend / installs : 0,
      roas: spend > 0 ? revenue / spend : 0,
    }];
  }, [merged]);

  const t = useMemo(() => {
    const spend = merged.reduce((s, r) => s + r.spend, 0);
    const installs = merged.reduce((s, r) => s + r.installs, 0);
    const trials = merged.reduce((s, r) => s + r.trials, 0);
    const paid = merged.reduce((s, r) => s + r.paid, 0);
    const revenue = merged.reduce((s, r) => s + r.revenue, 0);
    return {
      spend, installs, trials, paid, revenue,
      cpt: trials > 0 ? spend / trials : 0,
      roas: spend > 0 ? revenue / spend : 0,
    };
  }, [merged]);

  const dates = daily.map((d) => d.date);
  const dailyCpt = daily.map((d) => (d.trial_starts > 0 ? d.spend / d.trial_starts : 0));
  // Adapty revenue per install-cohort day, aligned to the spend days.
  const revByDate = new Map(revDaily.map((r) => [r.date, r.revenueUsd]));
  const dailyRevenue = daily.map((d) => revByDate.get(d.date) ?? 0);
  const dailyRoas = daily.map((d, i) => (d.spend > 0 ? (dailyRevenue[i] / d.spend) * 100 : 0));
  const fmtPct = (n: number) => `${n.toFixed(0)}%`;

  function roasClass(roas: number, hasRev: boolean): string {
    if (!hasRev) return "muted";
    if (roas >= 1) return "good";
    if (roas >= 0.5) return "warn";
    return "bad";
  }

  return (
    <>
      <div className="topbar">
        <div className="title-with-scope">
          <h1 className="ds-page-title" title={`${isWorld ? "Все страны выбранного приложения" : label} · факт выручки и прогноз показываются раздельно · ${hasRevenue ? "расход Apple Ads × атрибуция Adapty" : "расход Apple Ads × триалы App Store Connect"}`}>Экономика</h1>
          <ScopeBadge />
        </div>
        <div className="controls">
          <span className="meta">{hasRevenue ? "Apple Ads × Adapty" : "Apple Ads × App Store Connect"}</span>
          <Dropdown ariaLabel="Период" value={days} onChange={(v) => setDays(v)} options={[{ value: 7, label: "7 дней" }, { value: 14, label: "14 дней" }, { value: 30, label: "30 дней" }, { value: 90, label: "90 дней" }]} />
        </div>
      </div>

      <div className="spark-row">
        <Sparkline title="Расход" value={fmtUsd(t.spend)} data={daily.map((d) => d.spend)} labels={dates} color="var(--ds-c1)" format={fmtUsd} />
        {hasRevenue ? (
          <Sparkline title="Выручка" value={fmtUsd(t.revenue)} data={dailyRevenue} labels={dates} color="var(--ds-c2)" format={fmtUsd} />
        ) : (
          <Sparkline title="Старты триала" value={String(t.trials)} data={daily.map((d) => d.trial_starts)} labels={dates} color="var(--ds-c2)" format={(n) => String(Math.round(n))} />
        )}
        {hasRevenue ? (
          <Sparkline title="ROAS" value={t.roas > 0 ? `${(t.roas * 100).toFixed(0)}%` : "—"} data={dailyRoas} labels={dates} color="var(--ds-c3)" format={fmtPct} />
        ) : (
          <Sparkline title="Цена триала" lowerIsBetter value={t.cpt > 0 ? fmtUsd(t.cpt) : "—"} data={dailyCpt} labels={dates} color="var(--ds-c3)" format={fmtUsd} />
        )}
        <Sparkline title="Установки" value={String(t.installs)} data={daily.map((d) => d.installs)} labels={dates} color="var(--ds-c4)" format={(n) => String(Math.round(n))} />
      </div>

      <h2 className="ds-h2">Динамика</h2>
      <HeroChart daily={daily} />

      {hasRevenue && (
        <>
          <h2 className="ds-h2">ROAS по странам</h2>
          <p className="note">Страны с расходом от ${MIN_CHART_SPEND} за период; остальные сложены в «Прочие». Полный список — в таблице ниже.</p>
          <RoasByGeoBars rows={chartRows.map((r) => ({ country: r.country, spend: r.spend, revenue: r.revenue, roas: r.roas }))} />

          <h2 className="ds-h2">Калькулятор сценария</h2>
          <div className="card">
            <div className="row calc-row">
              <label className="field-label calc-label" htmlFor="calc-spend">Вложить</label>
              <input id="calc-spend" className="calc-input" type="number" value={projSpend} min={0} step={50}
                onChange={(e) => setProjSpend(Math.max(0, Number(e.target.value)))} />
              <span className="note">$ в страну → ожидаемая выручка при её текущем ROAS (линейно, пока хватает поискового спроса)</span>
            </div>
            {(() => {
              const profitable = chartRows.filter((r) => r.revenue > 0 && !r.country.startsWith("Прочие")).sort((a, b) => b.roas - a.roas);
              if (profitable.length === 0) return <div className="note">Пока нет стран с выручкой — сценарий появится после первых оплат.</div>;
              return (
                <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Страна</th><th className="num">ROAS</th><th className="num">Вложить</th><th className="num">Выручка</th><th className="num">Итог</th></tr>
                  </thead>
                  <tbody>
                    {profitable.map((r) => {
                      const proj = projSpend * r.roas;
                      const net = proj - projSpend;
                      return (
                        <tr key={r.country}>
                          <td className="strong">{r.country}</td>
                          <td className={`num ${r.roas >= 1 ? "good" : "warn"}`}>{(r.roas * 100).toFixed(0)}%</td>
                          <td className="num">{fmtUsd(projSpend)}</td>
                          <td className="num good">{fmtUsd(proj)}</td>
                          <td className={`num ${net >= 0 ? "good" : "bad"}`}>{net >= 0 ? "+" : ""}{fmtUsd(net)}</td>
                        </tr>
                      );
                    })}
                    <tr className="tot">
                      <td>В среднем</td>
                      <td className="num muted">{(t.roas * 100).toFixed(0)}%</td>
                      <td className="num muted">{fmtUsd(projSpend)}</td>
                      <td className="num muted">{fmtUsd(projSpend * t.roas)}</td>
                      <td className="num muted">{projSpend * t.roas - projSpend >= 0 ? "+" : ""}{fmtUsd(projSpend * t.roas - projSpend)}</td>
                    </tr>
                  </tbody>
                </table>
                </div>
              );
            })()}
            <div className="note section-foot">
              Линейно по наблюдаемому ROAS при небольшом числе оплат — это ориентир, а не гарантия. Поисковый спрос ниши ограничивает, сколько бюджета страна реально примет.
            </div>
          </div>
        </>
      )}

      <h2 className="ds-h2">Цена триала по странам</h2>
      <p className="note">{hasRevenue ? "Триалы из Apple Ads по атрибуции Adapty (страна профиля). " : ""}Страны с расходом от ${MIN_CHART_SPEND}; остальные — в «Прочие».</p>
      {revError && <div className="callout bad callout-block">Adapty недоступен ({revError}) — триалы и выручка показаны без атрибуции. Обновите страницу через минуту.</div>}
      {!hasRevenue && merged.length > 0 && (
        <div className="callout warn callout-block">
          Нет атрибуции Adapty для этого выбора: триалы — все старты триала App Store Connect в стране, включая органику,
          поэтому цена триала здесь занижена. Точная цена триала из Apple Ads — у приложения с подключённым Adapty (выберите его слева).
        </div>
      )}
      {merged.length === 0 ? (
        <div className="data-state">{loading ? "Загружаем данные…" : `Нет расхода Apple Ads за ${days} дней. Увеличьте период или нажмите «Обновить данные».`}</div>
      ) : (
        <CostPerTrialBars rows={chartRows} blended={t.cpt || 1} />
      )}

      <h2 className="ds-h2">Карта эффективности</h2>
      {merged.length > 0 && <EfficiencyScatter rows={chartRows} blended={t.cpt || 1} />}

      <div className="section-head">
        <h2 className="ds-h2">Разбивка по странам · {merged.length}{hasRevenue ? " · фактический ROAS" : ""}</h2>
        <button className="compact" onClick={() => exportRows(
          `profitability-${new Date().toISOString().slice(0, 10)}.csv`,
          ["country", "spend", "installs", "trials", "paid", "revenue", "roas", "cpi", "cpt"],
          merged.map((r) => ({ ...r, cpt: r.cpt ?? "" })) as unknown as Array<Record<string, unknown>>,
        )}>Экспорт CSV</button>
      </div>

      {merged.length > 0 && (
        <div className="table-wrap table-tall">
        <table>
          <thead>
            <tr>
              <th>Страна</th>
              <th className="num">Расход</th>
              <th className="num">Установки</th>
              <th className="num">Триалы</th>
              {hasRevenue && <th className="num">Оплаты</th>}
              {hasRevenue && <th className="num">Выручка</th>}
              <th className="num">{hasRevenue ? "ROAS" : "Цена триала"}</th>
              <th>Оценка</th>
            </tr>
          </thead>
          <tbody>
            {merged.map((r) => {
              const cptColor = zoneColor(r.cpt, t.cpt || 1);
              const rClass = roasClass(r.roas, hasRevenue);
              const verdict = hasRevenue
                ? (r.revenue === 0 ? (r.spend > 1 ? "нет выручки" : "—") : r.roas >= 1 ? "в плюсе" : r.roas >= 0.5 ? "следить" : "в минусе")
                : (r.cpt === null ? "без триалов" : r.cpt <= (t.cpt || 1) ? "дешевле среднего" : r.cpt <= (t.cpt || 1) * 2 ? "следить" : "дорого");
              // cost-per-trial zones come from the chart palette (data-driven color)
              const tone = hasRevenue ? { className: rClass } : { style: { color: cptColor } };
              return (
                <tr key={r.country}>
                  <td className="strong">{r.country === "WW" ? <span title="Мультигео-кампании, для которых ещё нет разбивки по странам — обновите данные">Мультигео</span> : r.country}</td>
                  <td className="num">{fmtUsd(r.spend)}</td>
                  <td className="num">{r.installs}</td>
                  <td className="num">{r.trials}</td>
                  {hasRevenue && <td className="num">{r.paid}</td>}
                  {hasRevenue && <td className={`num ${r.revenue > 0 ? "good" : "muted"}`}>{fmtUsd(r.revenue)}</td>}
                  <td className={`num ${tone.className ?? ""}`} style={tone.style}>
                    {hasRevenue ? (r.revenue > 0 ? `${(r.roas * 100).toFixed(0)}%` : "—") : (r.cpt === null ? "—" : fmtUsd(r.cpt))}
                  </td>
                  <td><span className={`roi ${tone.className ?? ""}`} style={tone.style}>{verdict}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
