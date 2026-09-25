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
        <div><h2>Оповещения</h2><div className="muted" style={{ fontSize: 12, marginTop: 5 }}>Контроль расхода, CPI и остановившихся кампаний</div></div>
        <div className="controls">
          <button onClick={runCheck} disabled={checking}>{checking ? "Проверяем…" : "Проверить сейчас"}</button>
        </div>
      </div>

      <div className="card">
        <h3>Правила</h3>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
          <strong>🔥 Burn:</strong> daily spend ≥ $5 with 0 installs<br />
          <strong>💸 High CPI:</strong> 7-day CPI ≥ $2.00 (min 3 installs)<br />
          <strong>⚠️ Stalled:</strong> campaign ENABLED but not RUNNING<br />
          <strong>📈 Spend spike:</strong> today ≥ 2× yesterday (min $5)<br />
          <br />
          Configure via <code>.env</code>: <code>ALERTS_ENABLED=true</code>, <code>TG_BOT_TOKEN</code>, <code>TG_CHAT_ID</code>, <code>ALERT_CPI_THRESHOLD</code>, <code>ALERT_SPEND_NO_INSTALL</code>, <code>ALERT_INTERVAL_MIN</code>.
        </div>
      </div>

      {loading ? <div className="data-state loading">Загружаем оповещения…</div> : rows.length === 0 ? (
        <div className="data-state">Оповещений пока нет. Проверьте конфигурацию и запустите проверку.</div>
      ) : (
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
                <td className="muted" style={{ fontSize: 11 }}>{new Date(a.sent_at).toLocaleString()}</td>
                <td><span className="badge">{a.alert_type}</span></td>
                <td dangerouslySetInnerHTML={{ __html: a.message }} />
                <td>
                  <span className={`badge ${a.delivered ? "ok" : "bad"}`}>{a.delivered ? "отправлено" : "ошибка"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
