import React, { useState } from 'react';
import { Icon, Sparkline, Flag, FLAG, LocaleFlagDot, Delta, Badge, AppIcon, mkSpark } from './primitives';
import { APPS as APPS_MOCK, LOCALE_STATS as LOCALE_STATS_MOCK, statusFromAvg } from './data';

// Dashboard (home) — app card groups

// ----- Metric tile -----
const MetricTile = ({ label, value, delta, tone = "neutral", spark, suffix = "" }) => {
  const deltaTone = delta == null ? "neutral" : delta > 0 ? (tone === "inverted" ? "neg" : "pos") : (tone === "inverted" ? "pos" : "neg");
  return (
    <div style={{
      flex: 1,
      padding: "14px 16px 14px",
      borderRadius: 14,
      background: "var(--tile-bg)",
      boxShadow: "inset 0 0 0 1px var(--border-subtle)",
      minWidth: 0,
    }}>
      <div className="label" style={{ fontSize: 11.5, marginBottom: 8, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: spark ? 6 : 0 }}>
        <span className="hero-num" style={{ fontSize: 30, color: "var(--text)", lineHeight: 1 }}>
          {value}<span style={{ fontSize: 16, color: "var(--text-muted)", marginLeft: 2 }}>{suffix}</span>
        </span>
        {delta != null && (
          <span className={`num ${deltaTone === "pos" ? "delta-pos" : "delta-neg"}`} style={{ fontSize: 12.5, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 2 }}>
            <span>{delta > 0 ? "↑" : "↓"}</span>{Math.abs(delta)}
          </span>
        )}
      </div>
      {spark && (
        <div style={{ marginTop: 4, color: "var(--text-muted)" }}>
          <Sparkline data={spark} width={120} height={18} tone={deltaTone === "pos" ? "pos" : "neg"} strokeWidth={1.4} />
        </div>
      )}
    </div>
  );
};

// ----- Locale strip -----
const LocaleStrip = ({ stats }) => {
  const ranked = stats.filter((s) => s.avg != null);
  const unrankedCount = stats.length - ranked.length;
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "2px 0" }}>
      {ranked.map(s => (
        <div key={s.code} title={`${s.code} · avg #${s.avg}`} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 8px 5px 6px", borderRadius: 8,
          background: "var(--bg-sunken)",
          boxShadow: "inset 0 0 0 1px var(--border-subtle)",
        }}>
          <Flag code={s.code} size={13} />
          <span className="num" style={{
            fontSize: 12, fontWeight: 500,
            color: "var(--text-2)",
          }}>{`#${s.avg}`}</span>
          <span className={`dot dot-${statusFromAvg(s.avg)}`} />
        </div>
      ))}
      {unrankedCount > 0 && (
        <div title={`${unrankedCount} locales with no data yet — run a snapshot for them`} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px 5px 10px", borderRadius: 8,
          background: "var(--bg-sunken)",
          boxShadow: "inset 0 0 0 1px var(--border-subtle)",
          color: "var(--text-muted)",
          fontSize: 12, fontWeight: 500,
        }}>
          <span className="dot dot-gray" />
          +{unrankedCount} unranked
        </div>
      )}
    </div>
  );
};

// ----- Winner/Loser chip -----
const MoverChip = ({ item, tone }) => (
  <div style={{
    display: "inline-flex", alignItems: "center", gap: 8,
    height: 28, padding: "0 10px 0 10px",
    borderRadius: 999,
    background: tone === "pos" ? "var(--pos-tint)" : "var(--neg-tint)",
    color: tone === "pos" ? "var(--pos)" : "var(--neg)",
  }}>
    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)", letterSpacing: "-0.005em" }}>{item.kw}</span>
    <span className="num" style={{ fontSize: 12.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 2 }}>
      <span>{tone === "pos" ? "↑" : "↓"}</span>{Math.abs(item.delta)}
    </span>
    <span className="num" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
      #{item.from}→#{item.to}
    </span>
  </div>
);

// ----- App card -----
const AppCard = ({ app, onOpen, onRun, localeStats: localeStatsProp }) => {
  const localeStats = localeStatsProp || LOCALE_STATS_MOCK[app.name] || [];
  const spark = mkSpark(app.id.length * 7, 30, 50, 14, -0.3);

  return (
    <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <AppIcon bg={app.iconBg} emoji={app.emoji} iconUrl={app.iconUrl} size={44} rounded={11} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em" }}>{app.name}</h3>
            <Badge>{app.keywords} keywords</Badge>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{app.tagline}</span>
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>·</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, color: "var(--text-muted)" }}>
              <Icon name="clock" size={11} stroke={1.8} />
              Snapshot {app.lastSnapshot}
            </span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onOpen}>
          Open
          <Icon name="arrow-right" size={12} />
        </button>
      </div>

      {/* Metric tiles */}
      <div style={{ display: "flex", gap: 10 }}>
        <MetricTile label="Top 10" value={app.top10} delta={app.weekDelta.top10} spark={mkSpark(app.id.length + 1, 14, app.top10, 6, 0.2)} />
        <MetricTile label="Top 50" value={app.top50} delta={app.weekDelta.top50} spark={mkSpark(app.id.length + 2, 14, app.top50, 12, -0.3)} />
        <MetricTile label="Not ranked" value={app.unranked} delta={-app.weekDelta.ranked} tone="inverted" spark={mkSpark(app.id.length + 3, 14, app.unranked, 10, 0.1)} />
        <MetricTile label="Avg position" value={app.avgPos.toFixed(1)} delta={app.weekDelta.avg} tone="inverted" spark={mkSpark(app.id.length + 4, 14, app.avgPos, 4, -0.05)} />
      </div>

      {/* Locale strip */}
      <div>
        <div className="label" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span>Locales · {localeStats.length} tracked</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginLeft: "auto", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span className="dot dot-pos" /> <span style={{ fontSize: 11.5 }}>Top 10</span></span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span className="dot dot-neg" /> <span style={{ fontSize: 11.5 }}>Top 50</span></span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span className="dot dot-gray" /> <span style={{ fontSize: 11.5 }}>Unranked</span></span>
          </span>
        </div>
        <LocaleStrip stats={localeStats} />
      </div>

      {/* Movers */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="trending-up" size={11} stroke={2} style={{ color: "var(--pos)" }} />
            Biggest winners this week
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {app.winners.map(w => <MoverChip key={w.kw} item={w} tone="pos" />)}
          </div>
        </div>
        <div style={{ width: 1, background: "var(--border-subtle)", alignSelf: "stretch" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="trending-down" size={11} stroke={2} style={{ color: "var(--neg)" }} />
            Biggest losers this week
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {app.losers.map(l => <MoverChip key={l.kw} item={l} tone="neg" />)}
          </div>
        </div>
      </div>
    </div>
  );
};

// ----- Top bar -----
const TopBar = ({ theme, onToggleTheme, onCmdK, active = "Overview", onNavigate }) => (
  <header style={{
    display: "flex", alignItems: "center", gap: 16,
    padding: "18px 28px",
    borderBottom: "1px solid var(--border-subtle)",
    background: "var(--bg)",
    position: "sticky", top: 0, zIndex: 10,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 7,
        background: "var(--accent)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: "-0.03em",
      }}>◇</div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em" }}>ASO Tracker</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", letterSpacing: "0.02em" }}>v0.4.1 · self-hosted</div>
      </div>
    </div>

    <div style={{ width: 1, height: 22, background: "var(--border)" }} />

    <nav style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {[
        { label: "Overview" },
        { label: "Keywords" },
      ].map(n => {
        const isActive = n.label === active;
        return (
          <button key={n.label} className="btn btn-ghost btn-sm"
            onClick={() => onNavigate?.(n.label)}
            style={{
              color: isActive ? "var(--text)" : "var(--text-muted)",
              background: isActive ? "var(--bg-sunken)" : "transparent",
              fontWeight: isActive ? 500 : 400,
            }}>{n.label}</button>
        );
      })}
    </nav>

    <div style={{ flex: 1 }} />

    <button className="btn btn-ghost btn-sm" onClick={onCmdK} style={{
      color: "var(--text-muted)", gap: 10, paddingLeft: 10, width: 260, justifyContent: "space-between",
      background: "var(--bg-sunken)", boxShadow: "inset 0 0 0 1px var(--border-subtle)",
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="search" size={12} stroke={1.8} />
        Search App Store to track…
      </span>
      <span style={{ display: "inline-flex", gap: 2 }}>
        <span className="kbd">⌘</span><span className="kbd">K</span>
      </span>
    </button>

    <button className="btn btn-sm" onClick={onToggleTheme} title="Toggle theme">
      <Icon name={theme === "dark" ? "sun" : "moon"} size={13} />
    </button>
    <button className="btn btn-sm">
      <Icon name="settings" size={13} />
    </button>
    <div style={{
      width: 30, height: 30, borderRadius: 999,
      background: "linear-gradient(135deg, #FFC9B8 0%, #FF5C3C 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontSize: 12, fontWeight: 600,
      boxShadow: "inset 0 0 0 1.5px var(--bg-raised)",
    }}>JS</div>
  </header>
);

// ----- Overview summary strip (top of dashboard) -----
const OverviewStrip = ({ apps }) => {
  const APPS = apps;
  const totalKw = APPS.reduce((a, b) => a + b.keywords, 0);
  const totalRanked = APPS.reduce((a, b) => a + b.ranked, 0);
  const totalTop10 = APPS.reduce((a, b) => a + b.top10, 0);
  const weekWins = APPS.reduce((a, b) => a + (b.weekDelta?.top10 || 0), 0);
  return (
    <div style={{
      display: "flex", alignItems: "stretch", gap: 0,
      background: "var(--bg-raised)",
      borderRadius: 20,
      boxShadow: "inset 0 0 0 1px var(--border)",
      padding: 0,
      overflow: "hidden",
    }}>
      {[
        { label: "Apps", value: APPS.length, sub: "tracked" },
        { label: "Keywords", value: totalKw.toLocaleString(), sub: `${totalRanked} ranked` },
        { label: "In Top 10", value: totalTop10, sub: "across all apps", tone: "accent" },
        { label: "Net movement · 7d", value: (weekWins > 0 ? "+" : "") + weekWins, sub: "Top-10 keywords", deltaTone: weekWins >= 0 ? "pos" : "neg" },
        { label: "Last activity", value: "2m", sub: "Waverly · running", clock: true },
      ].map((c, i) => (
        <div key={i} style={{
          flex: 1, padding: "18px 24px",
          borderLeft: i === 0 ? "none" : "1px solid var(--border-subtle)",
          display: "flex", flexDirection: "column", justifyContent: "center", gap: 4,
          minWidth: 0,
        }}>
          <div className="label" style={{ fontSize: 11.5 }}>{c.label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="hero-num" style={{
              fontSize: 28,
              color: c.tone === "accent" ? "var(--accent)" : c.deltaTone === "pos" ? "var(--pos)" : c.deltaTone === "neg" ? "var(--neg)" : "var(--text)",
            }}>{c.value}</span>
            {c.clock && <span className="dot dot-pos" style={{ animation: "pulse 2s infinite" }} />}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
};

const DashboardScreen = ({ theme = "light", onToggleTheme, onCmdK, onOpenApp, onRunAll, onNavigate, onAddApp, apps: appsProp, localeStatsByApp = {} }) => {
  const apps = appsProp ?? APPS_MOCK;
  const totalKw = apps.reduce((a, b) => a + b.keywords, 0);
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return (
  <div className="app" data-theme={theme} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
    <TopBar theme={theme} onToggleTheme={onToggleTheme} onCmdK={onCmdK} active="Overview" onNavigate={onNavigate} />
    <div style={{ flex: 1, overflow: "auto", padding: "24px 28px 40px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>Good morning</h1>
          <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 2 }}>{today} · {apps.length} apps · {totalKw.toLocaleString()} keywords tracked</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" onClick={onAddApp}>
            <Icon name="plus" size={12} /> Add app
          </button>
          <button className="btn btn-primary btn-sm" onClick={onRunAll}>
            <Icon name="refresh" size={12} /> Run all snapshots
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <OverviewStrip apps={apps} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {apps.map(app => <AppCard key={app.id} app={app} localeStats={localeStatsByApp[app.id]} onOpen={() => onOpenApp?.(app)} />)}
      </div>
    </div>
  </div>
  );
};

export { DashboardScreen, TopBar };