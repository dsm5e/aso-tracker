import { useEffect, useState } from "react";
import { api, type ActionRow } from "../api.ts";

interface Props { reloadKey: number }

export default function Actions({ reloadKey }: Props) {
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [flashed, setFlashed] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    api.actions()
      .then((data) => {
        setRows(prev => {
          const prevIds = new Set(prev.map((p) => p.id));
          const newOnes = data.filter((d) => !prevIds.has(d.id));
          if (newOnes.length > 0) {
            const fl = new Set(newOnes.map((n) => n.id));
            setFlashed(fl);
            setTimeout(() => setFlashed(new Set()), 1400);
          }
          return data;
        });
      })
      .finally(() => setLoading(false));
  }, [reloadKey]);

  async function applyOne(id: number): Promise<void> {
    const r = await api.applyAction(id);
    if (!r.ok) alert(`Не удалось применить действие: ${r.error}`);
  }
  async function cancelOne(id: number): Promise<void> {
    await api.cancelAction(id);
  }

  return (
    <>
      <div className="topbar">
        <div><h1 className="ds-page-title">Очередь действий</h1><p className="ds-page-sub">Все изменения проходят через подтверждение, журнал и readback Apple Ads</p></div>
      </div>
      {loading ? <div className="data-state loading">Загружаем очередь…</div> : rows.length === 0 ? (
        <div className="empty">Очередь пуста. Действия появятся здесь после подтверждения на экранах ключевых слов и поисковых запросов.</div>
      ) : (
        <div className="table-wrap">
        <table className="actions-table">
          <thead>
            <tr>
              <th>ID</th><th>Тип</th><th>Параметры</th><th>Статус</th><th>Создано</th><th>Применено</th><th>Результат</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={flashed.has(a.id) ? "flash" : ""}>
                <td>#{a.id}</td>
                <td><span className="badge">{a.type}</span></td>
                <td className="cell-clip" title={a.payload}>
                  <code>{a.payload}</code>
                </td>
                <td>
                  <span className={`badge ${a.status === "applied" ? "ok" : a.status === "failed" ? "bad" : a.status === "pending" ? "warn" : ""}`}>
                    {a.status}
                  </span>
                </td>
                <td className="muted nowrap">{new Date(a.created_at).toLocaleString()}</td>
                <td className="muted nowrap">{a.applied_at ? new Date(a.applied_at).toLocaleString() : "—"}</td>
                <td className="muted cell-clip" title={a.result ?? a.error ?? undefined}>{a.result ?? a.error ?? "—"}</td>
                <td className="nowrap">
                  {a.status === "pending" && (
                    <div className="btn-group">
                      <button onClick={() => applyOne(a.id)}>Применить</button>
                      <button className="danger" onClick={() => cancelOne(a.id)}>Отменить</button>
                    </div>
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
