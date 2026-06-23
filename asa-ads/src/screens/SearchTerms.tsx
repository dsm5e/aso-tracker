import { useEffect, useState } from "react";
import { api, type SearchTermSuggestion } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";

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
    if (!res.ok) alert(`Failed: ${res.error}`);
  }

  return (
    <>
      <div className="topbar">
        <h2>Search Terms — cleanup & discovery</h2>
        <div className="controls">
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All ({recs.length})</option>
            <option value="negative">Negatives ({recs.filter((r) => r.suggestion === "negative").length})</option>
            <option value="add_as_keyword">Discovery ({recs.filter((r) => r.suggestion === "add_as_keyword").length})</option>
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
      </div>

      {loading ? <div className="empty">Loading…</div> : filtered.length === 0 ? (
        <div className="empty">Nothing to clean up. (либо нет search_terms — нужен sync, либо всё уже обработано.)</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Term</th>
              <th>Campaign</th>
              <th>Suggestion</th>
              <th className="num">Imp</th>
              <th className="num">Taps</th>
              <th className="num">Inst</th>
              <th className="num">Spend</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => (
              <tr key={`${r.campaign_id}-${r.term}-${idx}`}>
                <td><strong>{r.term}</strong></td>
                <td className="muted" style={{ fontSize: 11 }}>{r.campaign_name}</td>
                <td>
                  <span className={`badge ${r.suggestion === "negative" ? "bad" : "ok"}`}>
                    {r.suggestion === "negative" ? "→ negative" : "→ add keyword"}
                  </span>
                </td>
                <td className="num">{r.impressions}</td>
                <td className="num">{r.taps}</td>
                <td className="num">{r.installs}</td>
                <td className="num">${r.spend.toFixed(2)}</td>
                <td className="muted" style={{ fontSize: 12 }}>{r.reason}</td>
                <td>
                  {r.suggestion === "negative" && (
                    <button className="danger" onClick={() => applyNegative(r)}>Add negative</button>
                  )}
                  {r.suggestion === "add_as_keyword" && (
                    <span className="muted" style={{ fontSize: 11 }}>Add manually (need ad group)</span>
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
