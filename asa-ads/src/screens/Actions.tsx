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
    if (!r.ok) alert(`Failed: ${r.error}`);
  }
  async function cancelOne(id: number): Promise<void> {
    await api.cancelAction(id);
  }

  return (
    <>
      <div className="topbar">
        <h2>Actions queue</h2>
      </div>
      {loading ? <div className="empty">Loading…</div> : rows.length === 0 ? (
        <div className="empty">Очередь пуста. Действия будут появляться сюда после Apply на Keywords/Search Terms.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Type</th><th>Payload</th><th>Status</th><th>Created</th><th>Applied</th><th>Result</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={flashed.has(a.id) ? "flash" : ""}>
                <td>#{a.id}</td>
                <td><span className="badge">{a.type}</span></td>
                <td className="muted" style={{ fontSize: 11 }}>
                  <code>{a.payload}</code>
                </td>
                <td>
                  <span className={`badge ${a.status === "applied" ? "ok" : a.status === "failed" ? "bad" : a.status === "pending" ? "warn" : ""}`}>
                    {a.status}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: 11 }}>{new Date(a.created_at).toLocaleString()}</td>
                <td className="muted" style={{ fontSize: 11 }}>{a.applied_at ? new Date(a.applied_at).toLocaleString() : "—"}</td>
                <td className="muted" style={{ fontSize: 11 }}>{a.result ?? a.error ?? "—"}</td>
                <td>
                  {a.status === "pending" && (
                    <>
                      <button onClick={() => applyOne(a.id)}>Apply</button>{" "}
                      <button className="danger" onClick={() => cancelOne(a.id)}>Cancel</button>
                    </>
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
