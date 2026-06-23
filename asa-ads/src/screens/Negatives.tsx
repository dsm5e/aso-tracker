import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import { exportRows } from "../lib/csv.ts";

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
    <>
      <div className="topbar">
        <h2>Negative Keywords</h2>
        <div className="controls">
          <input type="text" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button onClick={doExport} disabled={filtered.length === 0}>Export CSV</button>
        </div>
      </div>

      <div className="card">
        <div className="hint">
          Negatives blocked from matching on ASA. Added via Search Terms cleanup or manually.
          Total: <strong>{rows.length}</strong>. Filtered: <strong>{filtered.length}</strong>.
        </div>
      </div>

      {loading ? <div className="loading">loading</div> : filtered.length === 0 ? (
        <div className="empty">no negatives yet · use Search Terms screen to add some</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Term</th>
              <th>Match</th>
              <th>Campaign</th>
              <th>Country</th>
              <th>Added</th>
              <th className="num">Remote ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.text}</strong></td>
                <td><span className="badge">{r.match_type}</span></td>
                <td className="muted" style={{ fontSize: 11 }}>{r.campaign_name ?? "—"}</td>
                <td>{r.country ?? "—"}</td>
                <td className="muted" style={{ fontSize: 11 }}>{new Date(r.added_at).toLocaleString()}</td>
                <td className="num muted">{r.remote_id ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
