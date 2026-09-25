import { useEffect, useState } from "react";
import { api } from "../api.ts";

interface AlertRow {
  id: number;
  campaign_id: number | null;
  alert_type: string;
  message: string;
  sent_at: string;
  delivered: number;
}

interface Props { reloadKey: number }

export default function Alerts({ reloadKey }: Props) {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  async function load(): Promise<void> {
    const data = await api.alerts();
    setRows(data);
  }
  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [reloadKey]);

  async function runCheck(): Promise<void> {
    setChecking(true);
    try {
      const r = await api.checkAlerts();
      alert(`Проверено: ${r.checked} · отправлено: ${r.sent} · пропущено: ${r.skipped}`);
      await load();
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <div><h1 className="ds-page-title">Оповещения</h1><p className="ds-page-sub">Контроль расхода, CPI и остановившихся кампаний</p></div>
        <div className="controls">
          <button onClick={runCheck} disabled={checking}>{checking ? "Проверяем…" : "Проверить сейчас"}</button>
        </div>
      </div>

      <div className="card">
        <h3>Правила</h3>
        <div className="note">
          <strong>🔥 Слив:</strong> расход за день ≥ $5 без установок<br />
          <strong>💸 Дорогой CPI:</strong> CPI за 7 дней ≥ $2.00 (от 3 установок)<br />
          <strong>⚠️ Остановка:</strong> кампания включена, но не показывается<br />
          <strong>📈 Скачок расхода:</strong> сегодня ≥ 2× вчерашнего (от $5)<br />
          <br />
          Настройка в <code>.env</code>: <code>ALERTS_ENABLED=true</code>, <code>TG_BOT_TOKEN</code>, <code>TG_CHAT_ID</code>, <code>ALERT_CPI_THRESHOLD</code>, <code>ALERT_SPEND_NO_INSTALL</code>, <code>ALERT_INTERVAL_MIN</code>.
        </div>
      </div>

      {loading ? <div className="data-state loading">Загружаем оповещения…</div> : rows.length === 0 ? (
        <div className="data-state">Оповещений пока нет. Проверьте конфигурацию и запустите проверку.</div>
      ) : (
        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Отправлено</th>
              <th>Тип</th>
              <th>Сообщение</th>
              <th>Доставлено</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="muted nowrap">{new Date(a.sent_at).toLocaleString()}</td>
                <td><span className="badge">{a.alert_type}</span></td>
                <td dangerouslySetInnerHTML={{ __html: a.message }} />
                <td>
                  <span className={`badge ${a.delivered ? "ok" : "bad"}`}>{a.delivered ? "отправлено" : "ошибка"}</span>
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
