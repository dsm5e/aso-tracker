import { useEffect, useState } from "react";
import { api, type ActionRow } from "../api.ts";
import FillPage from "../components/FillPage.tsx";

interface Props { reloadKey: number }

const ACTION_LABEL: Record<string, string> = {
  update_bid: "Ставка ключа",
  update_default_bid: "Ставка группы",
  add_negative: "Минус-слово",
  create_campaign_negative: "Минус-слово кампании",
  pause_keyword: "Пауза ключа",
  platform_pause_keyword: "Пауза ключа",
  pause_campaign: "Пауза кампании",
  resume_campaign: "Запуск кампании",
  update_daily_budget: "Дневной бюджет",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "ждёт подтверждения",
  applied: "применено",
  failed: "ошибка",
  cancelled: "отменено",
};

/** Human-readable parameters; the raw JSON stays in the cell tooltip. */
function summarizePayload(payload: string): string {
  try {
    const p = JSON.parse(payload) as Record<string, unknown>;
    const d = (p.data && typeof p.data === "object" ? p.data : p) as Record<string, unknown>;
    const parts: string[] = [];
    if (d.term ?? d.text) parts.push(`«${String(d.term ?? d.text)}»`);
    if (d.amount !== undefined) parts.push(`$${String(d.amount)}`);
    if (d.keyword_id ?? d.keywordId) parts.push(`ключ ${String(d.keyword_id ?? d.keywordId)}`);
    if (d.campaign_id ?? d.campaignId) parts.push(`кампания ${String(d.campaign_id ?? d.campaignId)}`);
    return parts.length ? parts.join(" · ") : payload;
  } catch {
    return payload;
  }
}

/** Apple readback as words; the raw JSON stays in the cell tooltip. */
function summarizeResult(result: string | null, error: string | null): string {
  if (error) return error;
  if (!result) return "—";
  try {
    const r = JSON.parse(result) as { verified?: unknown };
    if (r.verified === true) return "подтверждено Apple";
    if (r.verified === false) return "не подтверждено";
  } catch { /* not JSON — show as is */ }
  return result;
}

/** "24.09.2026, 14:10" — same-length timestamps keep the column steady. */
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

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
    <FillPage>
      <div className="topbar">
        <h1 className="ds-page-title" title="Все изменения проходят через подтверждение, журнал и readback Apple Ads">Очередь действий</h1>
        {rows.length > 0 && <span className="meta">{rows.length} записей</span>}
      </div>
      {loading ? <div className="data-state loading">Загружаем очередь…</div> : rows.length === 0 ? (
        <div className="empty">Очередь пуста. Действия появятся здесь после подтверждения на экранах ключевых слов и поисковых запросов.</div>
      ) : (
        <div className="table-wrap">
        <table className="actions-table">
          <thead>
            <tr>
              <th>ID</th><th>Тип</th><th>Параметры</th><th>Статус</th><th>Создано → применено</th><th>Результат</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={flashed.has(a.id) ? "flash" : ""}>
                <td className="muted">#{a.id}</td>
                <td><span className="badge" title={a.type}>{ACTION_LABEL[a.type] ?? a.type}</span></td>
                <td className="cell-clip" title={a.payload}>
                  {summarizePayload(a.payload)}
                </td>
                <td>
                  <span className={`badge ${a.status === "applied" ? "ok" : a.status === "failed" ? "bad" : a.status === "pending" ? "warn" : ""}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </td>
                <td
                  className="muted nowrap"
                  title={`Создано: ${new Date(a.created_at).toLocaleString("ru-RU")}${a.applied_at ? `\nПрименено: ${new Date(a.applied_at).toLocaleString("ru-RU")}` : ""}`}
                >
                  {fmtWhen(a.created_at)}
                  {a.applied_at && fmtWhen(a.applied_at) !== fmtWhen(a.created_at) && <> → {fmtWhen(a.applied_at).slice(-5)}</>}
                </td>
                <td className="muted cell-clip cell-flex" title={a.result ?? a.error ?? undefined}>{summarizeResult(a.result, a.error)}</td>
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
    </FillPage>
  );
}
