import { useEffect, useMemo, useState } from "react";
import { api, type BidRec, type Keyword } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import KeywordExpand from "../components/KeywordExpand.tsx";
import BidChangeConfirm from "../components/BidChangeConfirm.tsx";
import BulkApplyConfirm from "../components/BulkApplyConfirm.tsx";
import { exportRows } from "../lib/csv.ts";

interface Props { reloadKey: number }

function fmtBid(n: number): string { return `$${n.toFixed(2)}`; }

export default function Keywords({ reloadKey }: Props) {
  const { selected: appSel } = useApp();
  const [rows, setRows] = useState<Keyword[]>([]);
  const [recs, setRecs] = useState<BidRec[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [flashed, setFlashed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sortBy, setSortBy] = useState<"spend" | "installs" | "cpt" | "imp">("spend");
  const [pendingChange, setPendingChange] = useState<{ keyword: Keyword; newBid: number; reason?: string } | null>(null);
  const [pendingBulk, setPendingBulk] = useState<Array<{ keyword: Keyword; rec: BidRec }> | null>(null);

  async function load(): Promise<void> {
    const [k, r] = await Promise.all([api.keywords(days, undefined, appSel), api.bidRecs(days, undefined, appSel)]);
    setRows(k);
    setRecs(r);
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [days, reloadKey, appSel]);

  function toggleExpand(id: number): void {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const recMap = useMemo(() => new Map(recs.map((r) => [r.keyword_id, r])), [recs]);
  const counts = useMemo(() => ({
    active: rows.filter((r) => r.status === "ACTIVE").length,
    paused: rows.filter((r) => r.status === "PAUSED").length,
    orphan: rows.filter((r) => r.status === "ACTIVE" && r.campaign_serving_status && r.campaign_serving_status !== "RUNNING").length,
  }), [rows]);
  const filtered = useMemo(() => {
    const fl = rows.filter((r) => {
      if (statusFilter === "active" && r.status !== "ACTIVE") return false;
      if (statusFilter === "paused" && r.status !== "PAUSED") return false;
      return !filter ||
        r.text.toLowerCase().includes(filter.toLowerCase()) ||
        r.campaign_name.toLowerCase().includes(filter.toLowerCase());
    });
    fl.sort((a, b) => {
      // Surface ACTIVE before PAUSED when metrics tie at 0 (PAUSED keywords sink to bottom regardless of sort key).
      if (statusFilter === "all" && a.status !== b.status) {
        if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
        if (b.status === "ACTIVE" && a.status !== "ACTIVE") return 1;
      }
      switch (sortBy) {
        case "spend": return b.spend - a.spend;
        case "installs": return b.installs - a.installs;
        case "cpt": return b.cpt - a.cpt;
        case "imp": return b.impressions - a.impressions;
      }
    });
    return fl;
  }, [rows, filter, sortBy, statusFilter]);
  const kwMap = useMemo(() => new Map(rows.map((k) => [k.id, k])), [rows]);

  function flashRow(kid: number): void {
    setFlashed((s) => new Set(s).add(kid));
    setTimeout(() => setFlashed((s) => {
      const next = new Set(s);
      next.delete(kid);
      return next;
    }), 1400);
  }

  function requestBidChange(kw: Keyword, newBid: number, reason?: string): void {
    const amount = Math.max(0.05, Math.round(newBid * 100) / 100);
    if (Math.abs(kw.bid - amount) < 0.005) return;
    setPendingChange({ keyword: kw, newBid: amount, reason });
  }

  async function executeBidChange(kw: Keyword, newBid: number): Promise<void> {
    if (busy.has(kw.id)) return;
    const amount = Math.max(0.05, Math.round(newBid * 100) / 100);
    setBusy((s) => new Set(s).add(kw.id));
    setPendingChange(null);
    try {
      const { id } = await api.enqueueAction({
        type: "update_bid",
        campaign_id: kw.campaign_id,
        ad_group_id: kw.ad_group_id,
        keyword_id: kw.id,
        amount: amount.toFixed(2),
      });
      const r = await api.applyAction(id);
      if (!r.ok) { alert(`Failed: ${r.error}`); return; }
      setRows((prev) => prev.map((row) => row.id === kw.id ? { ...row, bid: amount } : row));
      flashRow(kw.id);
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(kw.id);
        return next;
      });
    }
  }

  function toggle(id: number): void {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllVisible(rec: boolean): void {
    setSelected(new Set(filtered.filter((k) => !rec || recMap.has(k.id)).map((k) => k.id)));
  }
  function selectByConfidence(conf: "high" | "medium"): void {
    const wanted = new Set<number>();
    for (const r of recs) {
      if (r.confidence === conf || (conf === "high" && r.confidence === "high")) {
        wanted.add(r.keyword_id);
      }
    }
    setSelected(wanted);
  }

  function requestBulkApply(): void {
    if (selected.size === 0) return;
    const items: Array<{ keyword: Keyword; rec: BidRec }> = [];
    for (const kid of selected) {
      const kw = kwMap.get(kid);
      const rec = recMap.get(kid);
      if (kw && rec) items.push({ keyword: kw, rec });
    }
    if (items.length === 0) return;
    setPendingBulk(items);
  }

  async function bulkApply(): Promise<void> {
    if (!pendingBulk) return;
    const items = pendingBulk;
    setPendingBulk(null);
    setBulkRunning(true);
    let ok = 0, fail = 0;
    for (const { keyword: kw, rec } of items) {
      try {
        const { id } = await api.enqueueAction({
          type: "update_bid",
          campaign_id: kw.campaign_id,
          ad_group_id: kw.ad_group_id,
          keyword_id: kw.id,
          amount: rec.recommended_bid.toFixed(2),
        });
        const r = await api.applyAction(id);
        if (r.ok) {
          ok++;
          setRows((prev) => prev.map((row) => row.id === kw.id ? { ...row, bid: rec.recommended_bid } : row));
          flashRow(kw.id);
        } else {
          fail++;
        }
      } catch {
        fail++;
      }
    }
    setBulkRunning(false);
    setSelected(new Set());
    alert(`Done: ${ok} applied, ${fail} failed`);
    void load();
  }

  const selectedWithRec = [...selected].filter((id) => recMap.has(id)).length;

  return (
    <>
      <div className="topbar">
        <h2>Keywords</h2>
        <div className="controls">
          <input type="text" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="btn-group" title="Filter by keyword status">
            <button className={`compact ${statusFilter === "all" ? "primary" : ""}`} onClick={() => setStatusFilter("all")}>All {rows.length}</button>
            <button className={`compact ${statusFilter === "active" ? "primary" : ""}`} onClick={() => setStatusFilter("active")}>Active {counts.active}</button>
            <button className={`compact ${statusFilter === "paused" ? "primary" : ""}`} onClick={() => setStatusFilter("paused")}>Paused {counts.paused}</button>
          </div>
          {counts.orphan > 0 && (
            <span className="badge warn" title="Active keywords whose campaign is not RUNNING — they spend $0 even though the keyword is ACTIVE">⚠ {counts.orphan} orphan</span>
          )}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="spend">↓ Spend</option>
            <option value="installs">↓ Installs</option>
            <option value="cpt">↓ CPT</option>
            <option value="imp">↓ Impressions</option>
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={3}>3D</option>
            <option value={7}>7D</option>
            <option value={14}>14D</option>
            <option value={30}>30D</option>
          </select>
          <button onClick={() => exportRows(
            `keywords-${new Date().toISOString().slice(0, 10)}.csv`,
            ["text", "campaign_name", "country", "match_type", "bid", "status", "impressions", "taps", "installs", "spend", "cpt"],
            filtered as unknown as Array<Record<string, unknown>>,
          )}>export csv</button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <strong>{recs.length}</strong> рекомендаций
            {selected.size > 0 && <> · выбрано с рекомендацией: {selectedWithRec}</>}
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Быстрый выбор:</div>
          </div>
          <div className="btn-group">
            <button className="compact" onClick={() => selectByConfidence("high")} title="Только рекомендации с высокой уверенностью (winners)">Только надёжные</button>
            <button className="compact" onClick={() => selectAllVisible(true)} title="Все ключи у которых есть рекомендация">Все с рекомендацией</button>
            <button className="compact" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Снять выбор</button>
            <button
              className="primary"
              disabled={selectedWithRec === 0 || bulkRunning}
              onClick={requestBulkApply}
              title="Покажет окно с прогнозом impact и подтверждением перед применением"
            >
              {bulkRunning ? `Применяю… (${selected.size})` : `Применить выбранные (${selectedWithRec})`}
            </button>
          </div>
        </div>
      </div>

      {pendingChange && (
        <BidChangeConfirm
          keyword={pendingChange.keyword}
          newBid={pendingChange.newBid}
          reason={pendingChange.reason}
          onConfirm={() => executeBidChange(pendingChange.keyword, pendingChange.newBid)}
          onCancel={() => setPendingChange(null)}
        />
      )}

      {pendingBulk && (
        <BulkApplyConfirm
          items={pendingBulk}
          onConfirm={() => void bulkApply()}
          onCancel={() => setPendingBulk(null)}
        />
      )}

      {loading ? <div className="empty">Loading…</div> : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((k) => selected.has(k.id))}
                  onChange={(e) => {
                    if (e.target.checked) selectAllVisible(false);
                    else setSelected(new Set());
                  }}
                />
              </th>
              <th>Keyword</th>
              <th>Campaign</th>
              <th>Match</th>
              <th>Status</th>
              <th className="num">Bid</th>
              <th className="num">Imp</th>
              <th className="num">Taps</th>
              <th className="num">Inst</th>
              <th className="num">CPT</th>
              <th className="num">Spend</th>
              <th>Recommendation</th>
              <th style={{ minWidth: 200 }}>Quick bid</th>
            </tr>
          </thead>
          <tbody>
            {filtered.flatMap((k) => {
              const rec = recMap.get(k.id);
              const delta = rec ? rec.recommended_bid - rec.current_bid : 0;
              const isBusy = busy.has(k.id);
              const alreadyAtRec = rec && Math.abs(k.bid - rec.recommended_bid) < 0.005;
              const down10 = Math.max(0.05, Math.round(k.bid * 0.9 * 100) / 100);
              const up10 = Math.round(k.bid * 1.1 * 100) / 100;
              const isExp = expanded.has(k.id);
              return [
                <tr key={k.id} className={flashed.has(k.id) ? "flash" : isExp ? "expanded" : ""}>
                  <td>
                    <input type="checkbox" checked={selected.has(k.id)} onChange={() => toggle(k.id)} disabled={!rec} />
                  </td>
                  <td>
                    <span className={`expand-toggle ${isExp ? "open" : ""}`} style={{ marginRight: 6 }} onClick={() => toggleExpand(k.id)}>▸</span>
                    {k.text}
                  </td>
                  <td className="muted" style={{ fontSize: 11 }}>{k.campaign_name}</td>
                  <td><span className="badge">{k.match_type}</span></td>
                  <td>
                    <span className={`badge ${k.status === "ACTIVE" ? "ok" : "warn"}`}>{k.status.toLowerCase()}</span>
                    {k.status === "ACTIVE" && k.campaign_serving_status && k.campaign_serving_status !== "RUNNING" && (
                      <span className="badge warn" title={`Campaign serving: ${k.campaign_serving_status}`} style={{ marginLeft: 4 }}>⚠ camp</span>
                    )}
                  </td>
                  <td className="num">{fmtBid(k.bid)}</td>
                  <td className="num">{k.impressions}</td>
                  <td className="num">{k.taps}</td>
                  <td className="num">{k.installs}</td>
                  <td className="num">{k.cpt > 0 ? fmtBid(k.cpt) : "—"}</td>
                  <td className="num">{fmtBid(k.spend)}</td>
                  <td>
                    {rec && !alreadyAtRec ? (
                      <span title={rec.reason}>
                        <span className={`badge ${rec.confidence === "high" ? "ok" : rec.confidence === "medium" ? "warn" : ""}`}>
                          {delta > 0 ? "↑" : "↓"} {fmtBid(rec.recommended_bid)}
                        </span>{" "}
                        <span className="muted" style={{ fontSize: 11 }}>{rec.reason}</span>
                      </span>
                    ) : flashed.has(k.id) ? (
                      <span className="badge ok">✓ updated</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <div className="btn-group">
                      <button className="compact down" disabled={isBusy || k.bid <= 0.05} onClick={() => requestBidChange(k, down10, `Lower bid 10% to test cheaper auction position`)} title={`Lower 10% → ${fmtBid(down10)}`}>−10%</button>
                      <button className="compact up" disabled={isBusy} onClick={() => requestBidChange(k, up10, `Raise bid 10% to outbid more often`)} title={`Raise 10% → ${fmtBid(up10)}`}>+10%</button>
                      {rec && !alreadyAtRec && (
                        <button className={`compact ${delta > 0 ? "primary up" : "down"}`} disabled={isBusy} onClick={() => requestBidChange(k, rec.recommended_bid, rec.reason)} title={rec.reason}>
                          → {fmtBid(rec.recommended_bid)}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>,
                isExp && (
                  <tr key={`${k.id}-exp`} className="expand-row">
                    <td colSpan={13}>
                      <KeywordExpand keyword={k} />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
