import { useEffect, useMemo, useState } from "react";
import { api, type BidRec, type Keyword } from "../api.ts";
import { useApp } from "../lib/AppContext.tsx";
import KeywordExpand from "../components/KeywordExpand.tsx";
import BidChangeConfirm from "../components/BidChangeConfirm.tsx";
import BulkApplyConfirm from "../components/BulkApplyConfirm.tsx";
import { exportRows } from "../lib/csv.ts";
import { campaignDisplayName } from "../lib/campaignNames.ts";
import Dropdown from "../components/Dropdown.tsx";
import FillPage from "../components/FillPage.tsx";

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
    <FillPage>
      <div className="topbar">
        <h1 className="ds-page-title" title="Все страны выбранного приложения · ставки меняются только после подтверждения">Ключевые слова</h1>
        <div className="controls">
          <input type="text" aria-label="Поиск ключевых слов" placeholder="Найти ключ или кампанию" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="ds-seg" title="Фильтр по статусу ключа">
            <button className={statusFilter === "all" ? "on" : ""} onClick={() => setStatusFilter("all")}>Все {rows.length}</button>
            <button className={statusFilter === "active" ? "on" : ""} onClick={() => setStatusFilter("active")}>Активные {counts.active}</button>
            <button className={statusFilter === "paused" ? "on" : ""} onClick={() => setStatusFilter("paused")}>Пауза {counts.paused}</button>
          </div>
          <Dropdown ariaLabel="Сортировка" value={sortBy} onChange={(v) => setSortBy(v as typeof sortBy)} options={[{ value: "spend", label: "↓ Расход" }, { value: "installs", label: "↓ Установки" }, { value: "cpt", label: "↓ CPT" }, { value: "imp", label: "↓ Показы" }]} />
          <Dropdown ariaLabel="Период" value={days} onChange={(v) => setDays(v)} options={[{ value: 3, label: "3 дня" }, { value: 7, label: "7 дней" }, { value: 14, label: "14 дней" }, { value: 30, label: "30 дней" }]} />
        </div>
      </div>

      <div className="list-bar">
        <span className="list-bar-count" title="Отметьте ключи или выберите группой — ставки меняются только после подтверждения.">
          <b>{recs.length}</b> рекомендаций{selected.size > 0 && <> · выбрано: <b>{selectedWithRec}</b></>}
        </span>
        <div className="btn-group">
          <button className="compact" onClick={() => selectByConfidence("high")} title="Только рекомендации с высокой уверенностью">Только надёжные</button>
          <button className="compact" onClick={() => selectAllVisible(true)} title="Все ключи, у которых есть рекомендация">Все с рекомендацией</button>
          <button className="compact" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Снять выбор</button>
          <button
            className="compact primary"
            disabled={selectedWithRec === 0 || bulkRunning}
            onClick={requestBulkApply}
            title="Покажет окно с прогнозом и подтверждением перед применением"
          >
            {bulkRunning ? `Применяю… (${selected.size})` : `Применить (${selectedWithRec})`}
          </button>
        </div>
        <span className="spacer" />
        {counts.orphan > 0 && (
          <span className="badge warn" title="Активные ключи в неработающих кампаниях; расходов и показов по ним не будет.">без показа: {counts.orphan}</span>
        )}
        <button className="compact" title="Экспорт отфильтрованных ключей в CSV" onClick={() => exportRows(
          `keywords-${new Date().toISOString().slice(0, 10)}.csv`,
          ["text", "campaign_name", "country", "match_type", "bid", "status", "impressions", "taps", "installs", "spend", "cpt"],
          filtered as unknown as Array<Record<string, unknown>>,
        )}>CSV</button>
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

      {loading ? <div className="data-state loading">Загружаем ключевые слова…</div> : filtered.length === 0 ? <div className="data-state">По этому фильтру нет ключевых слов.</div> : (
        <div className="table-wrap">
        <table className="keywords-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((k) => selected.has(k.id))}
                  onChange={(e) => {
                    if (e.target.checked) selectAllVisible(false);
                    else setSelected(new Set());
                  }}
                />
              </th>
              <th>Ключевое слово</th>
              <th>Кампания</th>
              <th title="Тип соответствия">Тип</th>
              <th>Статус</th>
              <th className="num">Ставка</th>
              <th className="num">Показы</th>
              <th className="num">Тапы</th>
              <th className="num">Установки</th>
              <th className="num">CPT</th>
              <th className="num">Расход</th>
              <th>Рекомендация</th>
              <th className="col-bid">Изменение ставки</th>
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
                  <td className="nowrap">
                    <span className={`expand-toggle inline-label ${isExp ? "open" : ""}`} onClick={() => toggleExpand(k.id)}>▸</span>
                    {k.text}
                  </td>
                  <td className="muted cell-clip" title={campaignDisplayName(k.campaign_name)}>{campaignDisplayName(k.campaign_name)}</td>
                  <td><span className="badge">{k.match_type}</span></td>
                  <td>
                    <span className={`badge ${k.status === "ACTIVE" ? "ok" : "warn"}`}>{k.status === "ACTIVE" ? "активен" : "пауза"}</span>
                    {k.status === "ACTIVE" && k.campaign_serving_status && k.campaign_serving_status !== "RUNNING" && (
                      <span className="badge warn inline-gap" title={`Кампания не показывается: ${k.campaign_serving_status}`}>⚠ кампания</span>
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
                      <span title={rec.reason} className="rec-cell">
                        <span className={`badge ${rec.confidence === "high" ? "ok" : rec.confidence === "medium" ? "warn" : ""}`}>
                          {delta > 0 ? "↑" : "↓"} {fmtBid(rec.recommended_bid)}
                        </span>
                        <span className="rec-reason">{rec.reason}</span>
                      </span>
                    ) : flashed.has(k.id) ? (
                      <span className="badge ok">✓ обновлено</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <div className="btn-group">
                      <button className="compact down" disabled={isBusy || k.bid <= 0.05} onClick={() => requestBidChange(k, down10, "Снизить ставку на 10% для контролируемого теста") } title={`Снизить на 10% → ${fmtBid(down10)}`}>−10%</button>
                      <button className="compact up" disabled={isBusy} onClick={() => requestBidChange(k, up10, "Повысить ставку на 10% для контролируемого теста")} title={`Повысить на 10% → ${fmtBid(up10)}`}>+10%</button>
                      {rec && !alreadyAtRec && (
                        <button className={`compact ${delta > 0 ? "up" : "down"}`} disabled={isBusy} onClick={() => requestBidChange(k, rec.recommended_bid, rec.reason)} title={rec.reason}>
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
        </div>
      )}
    </FillPage>
  );
}
