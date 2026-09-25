import { useEffect, useState } from "react";
import { api, type SearchTermSuggestion } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { campaignDisplayName } from "../lib/campaignNames.ts";

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
        <div><h2>Поисковые запросы</h2><div className="muted" style={{ fontSize: 12, marginTop: 5 }}>Фактические запросы Apple Ads: чистка нерелевантного трафика и поиск новых ключей</div></div>
        <div className="controls">
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">Все ({recs.length})</option>
            <option value="negative">В минус-слова ({recs.filter((r) => r.suggestion === "negative").length})</option>
            <option value="add_as_keyword">Кандидаты ({recs.filter((r) => r.suggestion === "add_as_keyword").length})</option>
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 дней</option>
            <option value={14}>14 дней</option>
            <option value={30}>30 дней</option>
          </select>
        </div>
      </div>

      {loading ? <div className="data-state loading">Загружаем поисковые запросы…</div> : filtered.length === 0 ? (
        <div className="data-state">Нет запросов для этого фильтра. Возможно, синхронизация ещё не собрала search terms.</div>
      ) : (
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
                <td className="muted" style={{ fontSize: 11 }}>{campaignDisplayName(r.campaign_name)}</td>
                <td>
                  <span className={`badge ${r.suggestion === "negative" ? "bad" : "ok"}`}>
                    {r.suggestion === "negative" ? "→ в минус-слова" : "→ проверить ключ"}
                  </span>
                </td>
                <td className="num">{r.impressions}</td>
                <td className="num">{r.taps}</td>
                <td className="num">{r.installs}</td>
                <td className="num">${r.spend.toFixed(2)}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.reason}</td>
                <td>
                  {r.suggestion === "negative" && (
                    <button className="danger" onClick={() => applyNegative(r)}>Добавить минус-слово</button>
                  )}
                  {r.suggestion === "add_as_keyword" && (
                    <span className="muted" style={{ fontSize: 11 }}>Добавить после проверки владельца и группы</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
