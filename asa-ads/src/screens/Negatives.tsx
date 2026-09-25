import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { exportRows } from "../lib/csv.ts";
import { campaignDisplayName } from "../lib/campaignNames.ts";
import FillPage from "../components/FillPage.tsx";

interface NegRow {
  id: number;
  campaign_id: number;
  campaign_name: string;
  country: string;
  text: string;
  match_type: string;
  remote_id: number | null;
  added_at: string;
}

export default function Negatives() {
  const { selected: appSel } = useApp();
  const [rows, setRows] = useState<NegRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    api.negatives(appSel).then(setRows).finally(() => setLoading(false));
  }, [appSel]);

  const filtered = rows.filter((r) =>
    !filter ||
    r.text.toLowerCase().includes(filter.toLowerCase()) ||
    (r.campaign_name ?? "").toLowerCase().includes(filter.toLowerCase()),
  );

  function doExport(): void {
    exportRows(
      `negatives-${new Date().toISOString().slice(0, 10)}.csv`,
      ["text", "match_type", "campaign_name", "country", "added_at", "remote_id"],
      filtered as unknown as Array<Record<string, unknown>>,
    );
  }

  return (
    <FillPage>
      <div className="topbar">
        <h1 className="ds-page-title" title="Все страны выбранного приложения · защита от нерелевантных запросов и пересечения кампаний">Минус-слова</h1>
        <div className="controls">
          <input type="text" aria-label="Поиск минус-слов" placeholder="Найти слово или кампанию" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button onClick={doExport} disabled={filtered.length === 0}>Экспорт CSV</button>
        </div>
      </div>

      <div className="page-stats fold">
        <span>Всего <b>{rows.length}</b></span>
        {filter && <span>По фильтру <b>{filtered.length}</b></span>}
        <span className="page-stats-note">Блокируют нерелевантные показы и пересечение владельцев ключей · добавляются из поисковых запросов или через подтверждённую очередь</span>
      </div>

      {loading ? <div className="data-state loading">Загружаем минус-слова…</div> : filtered.length === 0 ? (
        <div className="data-state">Нет минус-слов по этому фильтру.</div>
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Слово</th>
              <th title="Тип соответствия">Тип</th>
              <th>Кампания</th>
              <th>Страна</th>
              <th>Добавлено</th>
              <th className="num">ID Apple</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.text}</strong></td>
                <td><span className="badge">{r.match_type}</span></td>
                <td className="muted cell-clip" title={r.campaign_name ? campaignDisplayName(r.campaign_name) : undefined}>{r.campaign_name ? campaignDisplayName(r.campaign_name) : "—"}</td>
                <td>{r.country === "WW" ? "Мультигео" : r.country ?? "—"}</td>
                <td className="muted nowrap">{new Date(r.added_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="num muted">{r.remote_id ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </FillPage>
  );
}
