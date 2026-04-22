import React, { useState } from 'react';
import { Icon, Sparkline, Flag, Delta, PositionDelta, RankPill, Badge, AppIcon, Segmented, mkSpark } from './primitives';
import { APPS, KEYWORD_ROWS } from './data';

// App Detail — Rankings tab with table, filters, competitor drawer

const CompetitorAvatar = ({ name, i = 0 }) => {
  const palette = [
    "linear-gradient(135deg,#E8F0FF,#6B8FD6)",
    "linear-gradient(135deg,#FFE8E0,#FF8A6A)",
    "linear-gradient(135deg,#E8F5E8,#4AB880)",
    "linear-gradient(135deg,#F4EBFF,#9B6FD6)",
    "linear-gradient(135deg,#FFF4E0,#E0A020)",
  ];
  const letter = name.replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase() || "•";
  return (
    <div style={{
      width: 18, height: 18, borderRadius: 5,
      background: palette[i % palette.length],
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: 9.5, fontWeight: 700, color: "rgba(0,0,0,0.65)",
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
    }}>{letter}</div>
  );
};

const CompetitorStack = ({ items }) => {
  if (!items || items.length === 0) return <span style={{ color: "var(--text-faint)", fontSize: 11.5 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ display: "inline-flex" }}>
        {items.slice(0, 4).map((n, i) => (
          <div key={i} style={{ marginLeft: i === 0 ? 0 : -5 }}>
            <CompetitorAvatar name={n} i={i} />
          </div>
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: "var(--text-muted)", letterSpacing: "-0.005em", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {items[0]}{items.length > 1 && <span style={{ color: "var(--text-faint)" }}>, {items[1]}</span>}
      </span>
    </div>
  );
};

const BigMetric = ({ label, value, delta, tone, suffix, spark, accent }) => (
  <div style={{ flex: 1, minWidth: 0, padding: "18px 22px", borderRight: "1px solid var(--border-subtle)" }}>
    <div className="label" style={{ marginBottom: 10 }}>{label}</div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
      <span className="hero-num" style={{ fontSize: 40, color: accent ? "var(--accent)" : "var(--text)", lineHeight: 1 }}>
        {value}{suffix && <span style={{ fontSize: 20, color: "var(--text-muted)", marginLeft: 3 }}>{suffix}</span>}
      </span>
      {delta != null && (
        <span className={`num ${tone === "pos" ? "delta-pos" : tone === "neg" ? "delta-neg" : ""}`} style={{ fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 2 }}>
          <span>{delta > 0 ? "↑" : delta < 0 ? "↓" : ""}</span>
          {delta === 0 ? "—" : Math.abs(delta)}
          <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--text-muted)", marginLeft: 4 }}>7d</span>
        </span>
      )}
    </div>
    {spark && <div style={{ color: "var(--text-muted)" }}><Sparkline data={spark} width={180} height={26} tone={tone === "pos" ? "pos" : "neg"} /></div>}
  </div>
);

const RankingsTable = ({ rows, onRowClick, selectedIdx }) => (
  <div style={{ background: "var(--bg-raised)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--border)", overflow: "hidden" }}>
    <table className="table">
      <thead>
        <tr>
          <th style={{ width: 70 }}>Locale</th>
          <th>Keyword</th>
          <th style={{ width: 92 }}>Today</th>
          <th style={{ width: 92 }}>Yesterday</th>
          <th style={{ width: 92 }}>7d ago</th>
          <th style={{ width: 92 }}>30d ago</th>
          <th style={{ width: 120 }}>30d trend</th>
          <th style={{ width: 230 }}>Top-5 competitors</th>
          <th style={{ width: 32 }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const delta = r.yesterday && r.today ? r.yesterday - r.today : 0;
          const sparkBase = r.today || 80;
          const spark = mkSpark(r.kw.length * 3 + i, 30, sparkBase, 12, (r.w4 - (r.today || 80)) / 30);
          const reversed = spark.map(v => 100 - v); // since lower rank is better, invert visually
          const tone = delta > 0 ? "pos" : delta < 0 ? "neg" : "neutral";
          const selected = i === selectedIdx;
          return (
            <tr key={i} className="hover-row" onClick={() => onRowClick?.(i)} style={{ cursor: "pointer", background: selected ? "var(--bg-hover)" : undefined }}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Flag code={r.locale} size={14} />
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{r.locale}</span>
                </div>
              </td>
              <td>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", letterSpacing: "-0.005em" }}>{r.kw}</span>
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <RankPill rank={r.today} />
                  <PositionDelta fromRank={r.yesterday} toRank={r.today} />
                </div>
              </td>
              <td><span className="num" style={{ fontSize: 12.5, color: "var(--text-2)" }}>{r.yesterday ? `#${r.yesterday}` : "—"}</span></td>
              <td><span className="num" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{r.w1 ? `#${r.w1}` : "—"}</span></td>
              <td><span className="num" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{r.w4 ? `#${r.w4}` : "—"}</span></td>
              <td>
                <div style={{ color: "var(--text-muted)" }}>
                  <Sparkline data={reversed} width={100} height={20} tone={tone === "pos" ? "pos" : tone === "neg" ? "neg" : "neutral"} />
                </div>
              </td>
              <td><CompetitorStack items={r.top5} /></td>
              <td style={{ textAlign: "right", color: "var(--text-faint)" }}>
                <Icon name="chevron-right" size={13} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const CompetitorDrawer = ({ row, onClose }) => {
  if (!row) return null;
  return (
    <div style={{
      width: 320, flex: "none",
      background: "var(--bg-raised)",
      borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--border)",
      padding: 20, display: "flex", flexDirection: "column", gap: 16,
      alignSelf: "flex-start",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="label" style={{ marginBottom: 4 }}>Keyword</div>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>{row.kw}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 11.5, color: "var(--text-muted)" }}>
            <Flag code={row.locale} size={12} /> {row.locale} · App Store
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={12} /></button>
      </div>

      <div style={{ background: "var(--bg-sunken)", borderRadius: 10, padding: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Your rank</div>
          <div className="hero-num" style={{ fontSize: 28, color: row.today <= 10 ? "var(--pos)" : row.today <= 50 ? "var(--neg)" : "var(--text-muted)" }}>#{row.today || "—"}</div>
        </div>
        <PositionDelta fromRank={row.yesterday} toRank={row.today} />
      </div>

      <div>
        <div className="label" style={{ marginBottom: 8 }}>Top-5 results today</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {row.top5.map((c, i) => {
            const isYou = c === "Nomly";
            return (
              <div key={c} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 8,
                background: isYou ? "var(--accent-tint)" : "transparent",
              }}>
                <span className="num" style={{ fontSize: 11, color: "var(--text-muted)", width: 14, fontWeight: 500 }}>#{i + 1}</span>
                <CompetitorAvatar name={c} i={i} />
                <span style={{ fontSize: 12.5, fontWeight: 500, color: isYou ? "var(--accent)" : "var(--text)" }}>{c}</span>
                {isYou && <Badge tone="accent">YOU</Badge>}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12 }}>
        <div className="label" style={{ marginBottom: 8 }}>Position history</div>
        <div style={{ color: "var(--text-muted)" }}>
          <Sparkline data={mkSpark(row.kw.length + 9, 30, 100 - (row.today || 40), 12, -0.1)} width={280} height={44} tone="accent" strokeWidth={1.6} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-faint)", marginTop: 4 }}>
          <span>30d ago</span><span>today</span>
        </div>
      </div>
    </div>
  );
};

const AppDetailScreen = ({ theme, app = APPS[0], onBack, onCmdK, onToggleTheme }) => {
  const [tab, setTab] = useState("rankings");
  const [localeFilter, setLocaleFilter] = useState("ALL");
  const [selectedRow, setSelectedRow] = useState(0);

  const rows = localeFilter === "ALL" ? KEYWORD_ROWS : KEYWORD_ROWS.filter(r => r.locale === localeFilter);

  return (
    <div className="app" data-theme={theme} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* header */}
      <header style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "18px 28px",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <Icon name="chevron-left" size={13} /> Overview
        </button>
        <span style={{ color: "var(--text-faint)", fontSize: 11 }}>/</span>
        <AppIcon bg={app.iconBg} emoji={app.emoji} size={28} rounded={8} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>{app.name}</div>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{app.bundle} · iTunes {app.iTunesId}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          <Icon name="clock" size={11} stroke={1.8} /> Last snapshot {app.snapshotEpoch}
        </div>
        <button className="btn btn-sm"><Icon name="history" size={12} /> History</button>
        <button className="btn btn-primary btn-sm"><Icon name="play" size={11} /> Run snapshot</button>
      </header>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 40px" }}>
        {/* Big metric strip */}
        <div style={{
          background: "var(--bg-raised)", borderRadius: 20,
          boxShadow: "inset 0 0 0 1px var(--border)",
          display: "flex", marginBottom: 20, overflow: "hidden",
        }}>
          <BigMetric label="Total keywords" value={app.keywords} spark={mkSpark(1, 30, 420, 20, 0.8)} tone="pos" delta={14} />
          <BigMetric label="Ranked" value={app.ranked} delta={app.weekDelta.ranked} tone="pos" spark={mkSpark(2, 30, 290, 18, 0.7)} />
          <BigMetric label="Avg position" value={app.avgPos.toFixed(1)} delta={-app.weekDelta.avg} tone={app.weekDelta.avg < 0 ? "pos" : "neg"} spark={mkSpark(3, 30, 28, 4, -0.1)} />
          <BigMetric label="In Top 10" value={app.top10} delta={app.weekDelta.top10} tone="pos" accent spark={mkSpark(4, 30, 37, 6, 0.2)} />
        </div>

        {/* Tabs + filters */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "rankings", label: "Rankings", icon: "list" },
              { value: "keywords", label: "Keywords", icon: "tag" },
              { value: "locales",  label: "Locales",  icon: "globe" },
              { value: "history",  label: "History",  icon: "history" },
            ]}
          />
          <div style={{ flex: 1 }} />
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-sunken)", borderRadius: 8, padding: "0 10px", height: 28, boxShadow: "inset 0 0 0 1px var(--border-subtle)", width: 220 }}>
            <Icon name="search" size={12} stroke={1.8} style={{ color: "var(--text-muted)" }} />
            <input placeholder="Filter keywords…" style={{ flex: 1, fontSize: 12 }} />
            <span className="kbd">/</span>
          </div>
          <Segmented
            size="sm"
            value={localeFilter}
            onChange={setLocaleFilter}
            options={[
              { value: "ALL", label: "All" },
              { value: "US", label: "🇺🇸 US" },
              { value: "GB", label: "🇬🇧 GB" },
              { value: "DE", label: "🇩🇪 DE" },
              { value: "JP", label: "🇯🇵 JP" },
              { value: "FR", label: "🇫🇷 FR" },
            ]}
          />
          <button className="btn btn-sm"><Icon name="filter" size={12} /> Position</button>
          <button className="btn btn-sm"><Icon name="download" size={12} /> Export</button>
        </div>

        {/* Table + drawer */}
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <RankingsTable rows={rows} selectedIdx={selectedRow} onRowClick={setSelectedRow} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px", fontSize: 11.5, color: "var(--text-muted)" }}>
              <span>Showing {rows.length} of {app.keywords} keywords</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Sort: <b style={{ color: "var(--text-2)", fontWeight: 500 }}>Today ↑</b></span>
                <span className="kbd">↑</span><span className="kbd">↓</span>
                <span style={{ color: "var(--text-faint)" }}>navigate</span>
              </span>
            </div>
          </div>
          <CompetitorDrawer row={rows[selectedRow]} onClose={() => setSelectedRow(-1)} />
        </div>
      </div>
    </div>
  );
};

export { AppDetailScreen };