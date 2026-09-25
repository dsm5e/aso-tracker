import { useEffect, useState } from "react";
import { api, type SearchTermSuggestion } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { campaignDisplayName } from "../lib/campaignNames.ts";
import Dropdown from "../components/Dropdown.tsx";

interface Props { reloadKey: number }

export default function SearchTerms({ reloadKey }: Props) {
  const { selected: appSel } = useApp();
  const [recs, setRecs] = useState<SearchTermSuggestion[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "negative" | "add_as_keyword">("all");

  useEffect(() => {
    setLoading(true);
    api.stRecs(days, appSel).then(setRecs).finally(() => setLoading(false));
  }, [days, reloadKey, appSel]);

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
    <>
      <div className="topbar">
        <div><h1 className="ds-page-title">Поисковые запросы</h1><p className="ds-page-sub">Фактические запросы Apple Ads: чистка нерелевантного трафика и поиск новых ключей</p></div>
        <div className="controls">
          <Dropdown ariaLabel="Фильтр" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "all", label: `Все (${recs.length})` }, { value: "negative", label: `В минус-слова (${recs.filter((r) => r.suggestion === "negative").length})` }, { value: "add_as_keyword", label: `Кандидаты (${recs.filter((r) => r.suggestion === "add_as_keyword").length})` }]} />
          <Dropdown ariaLabel="Период" value={days} onChange={(v) => setDays(v)} options={[{ value: 7, label: "7 дней" }, { value: 14, label: "14 дней" }, { value: 30, label: "30 дней" }]} />
        </div>
      </div>

      {loading ? <div className="data-state loading">Загружаем поисковые запросы…</div> : filtered.length === 0 ? (
        <div className="data-state">Нет запросов для этого фильтра. Возможно, синхронизация ещё не собрала search terms.</div>
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Запрос</th>
              <th>Кампания</th>
              <th>Рекомендация</th>
              <th className="num">Показы</th>
              <th className="num">Taps</th>
              <th className="num">Установки</th>
              <th className="num">Расход</th>
              <th>Причина</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => (
              <tr key={`${r.campaign_id}-${r.term}-${idx}`}>
                <td><strong>{r.term}</strong></td>
                <td className="muted">{campaignDisplayName(r.campaign_name)}</td>
                <td>
                  <span className={`badge ${r.suggestion === "negative" ? "bad" : "ok"}`}>
                    {r.suggestion === "negative" ? "→ в минус-слова" : "→ проверить ключ"}
                  </span>
                </td>
                <td className="num">{r.impressions}</td>
                <td className="num">{r.taps}</td>
                <td className="num">{r.installs}</td>
                <td className="num">${r.spend.toFixed(2)}</td>
                <td className="muted col-reason">{r.reason}</td>
                <td>
                  {r.suggestion === "negative" && (
                    <button className="danger" onClick={() => applyNegative(r)}>Добавить минус-слово</button>
                  )}
                  {r.suggestion === "add_as_keyword" && (
                    <span className="note">Добавить после проверки владельца и группы</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
