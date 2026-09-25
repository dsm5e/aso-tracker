import { useEffect, useState } from "react";
import { api, type SearchTermSuggestion } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { campaignDisplayName } from "../lib/campaignNames.ts";
import Dropdown from "../components/Dropdown.tsx";
import FillPage from "../components/FillPage.tsx";
import { useCountry } from "../lib/CountryContext.tsx";
import { ScopeBadge } from "../components/CountrySwitcher.tsx";
import { NEGATIVES_GLOBAL_HINT } from "../lib/countries.ts";

interface Props { reloadKey: number }

export default function SearchTerms({ reloadKey }: Props) {
  const { selected: appSel } = useApp();
  const { country, isWorld, label } = useCountry();
  const [recs, setRecs] = useState<SearchTermSuggestion[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "negative" | "add_as_keyword">("all");

  useEffect(() => {
    setLoading(true);
    // Storefront mode reads the search-term × country report (Apple splits
    // search terms by countryOrRegion), so thresholds apply to that country.
    api.stRecs(days, appSel, country).then(setRecs).finally(() => setLoading(false));
  }, [days, reloadKey, appSel, country]);

  const filtered = recs.filter((r) => filter === "all" || r.suggestion === filter);

  async function applyNegative(r: SearchTermSuggestion): Promise<void> {
    const { id } = await api.enqueueAction({
      type: "add_negative",
      campaign_id: r.campaign_id,
      term: r.term,
      match_type: "EXACT",
    });
    const res = await api.applyAction(id);
    if (!res.ok) alert(`Не удалось применить действие: ${res.error}`);
  }

  return (
    <FillPage>
      <div className="topbar">
        <div className="title-with-scope">
          <h1 className="ds-page-title" title={`Фактические запросы Apple Ads: чистка нерелевантного трафика и поиск новых ключей · ${isWorld ? "все страны" : `только витрина «${label}» (отчёт Apple по странам)`}`}>Поисковые запросы</h1>
          <ScopeBadge />
        </div>
        <div className="controls">
          <Dropdown ariaLabel="Фильтр" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "all", label: `Все (${recs.length})` }, { value: "negative", label: `В минус-слова (${recs.filter((r) => r.suggestion === "negative").length})` }, { value: "add_as_keyword", label: `Кандидаты (${recs.filter((r) => r.suggestion === "add_as_keyword").length})` }]} />
          <Dropdown ariaLabel="Период" value={days} onChange={(v) => setDays(v)} options={[{ value: 7, label: "7 дней" }, { value: 14, label: "14 дней" }, { value: 30, label: "30 дней" }]} />
        </div>
      </div>

      {loading ? <div className="data-state loading">Загружаем поисковые запросы…</div> : filtered.length === 0 ? (
        <div className="data-state">{isWorld ? "Нет запросов для этого фильтра. Возможно, синхронизация ещё не собрала search terms." : `Нет запросов с рекомендацией в стране «${label}» за период. Разбивка по странам появляется после «Обновить данные».`}</div>
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Запрос</th>
              <th>Кампания</th>
              <th>Рекомендация</th>
              <th className="num">Показы</th>
              <th className="num">Тапы</th>
              <th className="num">Установки</th>
              <th className="num">Расход</th>
              <th>Причина</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => (
              <tr key={`${r.campaign_id}-${r.term}-${idx}`}>
                <td className="nowrap"><strong>{r.term}</strong></td>
                <td className="muted cell-clip cell-campaign" title={campaignDisplayName(r.campaign_name)}>{campaignDisplayName(r.campaign_name)}</td>
                <td>
                  <span className={`badge ${r.suggestion === "negative" ? "bad" : "ok"}`}>
                    {r.suggestion === "negative" ? "→ в минус-слова" : "→ проверить ключ"}
                  </span>
                </td>
                <td className="num">{r.impressions}</td>
                <td className="num">{r.taps}</td>
                <td className="num">{r.installs}</td>
                <td className="num">${r.spend.toFixed(2)}</td>
                <td className="muted cell-clip cell-flex" title={r.reason}>{r.reason}</td>
                <td className="nowrap">
                  {r.suggestion === "negative" && (
                    <button className="compact danger" disabled={!isWorld} onClick={() => applyNegative(r)} title={isWorld ? "Добавить запрос минус-словом (EXACT) в эту кампанию" : NEGATIVES_GLOBAL_HINT}>В минус</button>
                  )}
                  {r.suggestion === "add_as_keyword" && (
                    <span className="note" title="Добавить после проверки владельца и группы">вручную</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </FillPage>
  );
}
