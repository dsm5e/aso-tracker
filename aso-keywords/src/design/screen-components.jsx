import React, { useState } from 'react';
import { Icon, Sparkline, Flag, LocaleFlagDot, Delta, PositionDelta, RankPill, Badge, AppIcon, Segmented, mkSpark } from './primitives';

// Component library sheet

const Section = ({ title, sub, children, cols = 2 }) => (
  <div style={{ marginBottom: 28 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
      <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</h3>
      <div style={{ flex: 1, height: 1, background: "var(--border-subtle)" }} />
      {sub && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</span>}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
      {children}
    </div>
  </div>
);

const Cell = ({ label, children, span = 1, align = "center" }) => (
  <div style={{
    gridColumn: `span ${span}`,
    background: "var(--bg-raised)",
    borderRadius: 12,
    boxShadow: "inset 0 0 0 1px var(--border)",
    padding: 18,
    display: "flex", flexDirection: "column", gap: 14,
    minHeight: 100,
  }}>
    <div className="label">{label}</div>
    <div style={{ display: "flex", alignItems: align === "start" ? "flex-start" : "center", justifyContent: align === "start" ? "flex-start" : "center", gap: 10, flex: 1, flexWrap: "wrap" }}>
      {children}
    </div>
  </div>
);

const MetricTileDemo = ({ tone, value, delta, label }) => (
  <div style={{
    padding: "14px 16px", borderRadius: 14, width: 160,
    background: "var(--bg-sunken)", boxShadow: "inset 0 0 0 1px var(--border-subtle)",
  }}>
    <div className="label" style={{ fontSize: 10.5, marginBottom: 8 }}>{label}</div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
      <span className="hero-num" style={{ fontSize: 26, lineHeight: 1 }}>{value}</span>
      <Delta value={delta} />
    </div>
    <div style={{ color: "var(--text-muted)" }}>
      <Sparkline data={mkSpark(value * 3, 12, 50, 10, tone === "pos" ? 0.5 : tone === "neg" ? -0.5 : 0)} width={120} height={16} tone={tone} />
    </div>
  </div>
);

const ComponentLibraryScreen = ({ theme }) => {
  const [snapState, setSnapState] = useState("default");

  return (
    <div className="app" data-theme={theme} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header style={{ padding: "22px 28px 18px 28px", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>Component library</h1>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· primitives & variants</span>
        </div>
      </header>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 40px" }}>
        {/* Colors */}
        <Section title="Tokens · Colors" sub="Accent, surfaces, semantic" cols={4}>
          {[
            { name: "Coral · accent", var: "--accent", hex: "#FF5C3C" },
            { name: "Emerald · positive", var: "--pos", hex: "#10B981" },
            { name: "Amber · negative", var: "--neg", hex: "#E0A020" },
            { name: "Warm off-white · bg", var: "--bg", hex: "#FAFAF7" },
            { name: "Border inset", var: "--border", hex: "#E8E6E1" },
            { name: "Text primary", var: "--text", hex: "#121212" },
            { name: "Text muted", var: "--text-muted", hex: "#6E6B63" },
            { name: "Sunken", var: "--bg-sunken", hex: "#F4F3EE" },
          ].map(c => (
            <div key={c.var} style={{
              background: "var(--bg-raised)", borderRadius: 12, boxShadow: "inset 0 0 0 1px var(--border)",
              padding: 14, display: "flex", flexDirection: "column", gap: 10,
            }}>
              <div style={{ height: 48, borderRadius: 8, background: `var(${c.var})`, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.05)" }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{c.name}</div>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{c.var} · {c.hex}</div>
              </div>
            </div>
          ))}
        </Section>

        {/* Typography */}
        <Section title="Tokens · Typography" sub="Inter, tabular-nums for data" cols={1}>
          <div style={{ background: "var(--bg-raised)", borderRadius: 12, boxShadow: "inset 0 0 0 1px var(--border)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { sz: 48, w: 600, name: "Hero · 48/-0.035em", sample: "1,248" },
              { sz: 32, w: 600, name: "Display · 32/-0.03em", sample: "27.4" },
              { sz: 22, w: 600, name: "Title · 22/-0.02em", sample: "Good morning, James" },
              { sz: 17, w: 600, name: "Heading · 17/-0.015em", sample: "Nomly" },
              { sz: 13, w: 500, name: "Body · 13", sample: "food diary app" },
              { sz: 11, w: 500, name: "Label · 11/uppercase/0.06em", sample: "TOP 10" },
              { sz: 12, w: 500, name: "Mono · SF Mono", sample: "com.example.myapp", mono: true },
            ].map(t => (
              <div key={t.name} style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                <div style={{ width: 260, fontSize: 11, color: "var(--text-muted)" }}>{t.name}</div>
                <div className={t.mono ? "mono" : (t.sample.match(/[0-9]/) ? "hero-num" : "")} style={{
                  fontSize: t.sz,
                  fontWeight: t.w,
                  letterSpacing: t.sz >= 32 ? "-0.03em" : t.sz >= 22 ? "-0.02em" : t.sz >= 17 ? "-0.015em" : "-0.005em",
                  color: "var(--text)",
                  textTransform: t.name.includes("Label") ? "uppercase" : "none",
                }}>{t.sample}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* Metric tiles */}
        <Section title="Metric tile" sub="number + delta + sparkline" cols={3}>
          <Cell label="Positive"><MetricTileDemo label="TOP 10" value="42" delta={5} tone="pos" /></Cell>
          <Cell label="Negative"><MetricTileDemo label="AVG POSITION" value="34.7" delta={-3} tone="neg" /></Cell>
          <Cell label="Neutral"><MetricTileDemo label="RANKED" value="241" delta={0} tone="neutral" /></Cell>
        </Section>

        {/* Rank pills + deltas */}
        <Section title="Rank pill + position delta" cols={4}>
          <Cell label="Top 10"><RankPill rank={6} /><PositionDelta fromRank={8} toRank={6} /></Cell>
          <Cell label="Top 50"><RankPill rank={31} /><PositionDelta fromRank={22} toRank={31} /></Cell>
          <Cell label="Unranked"><RankPill rank={128} /><PositionDelta fromRank={95} toRank={128} /></Cell>
          <Cell label="Not ranked"><RankPill rank={null} /></Cell>
        </Section>

        {/* Buttons */}
        <Section title="Buttons" cols={4}>
          <Cell label="Primary">
            <button className="btn btn-primary btn-sm"><Icon name="play" size={11}/> Run snapshot</button>
            <button className="btn btn-primary"><Icon name="plus" size={12}/> Add app</button>
          </Cell>
          <Cell label="Secondary">
            <button className="btn btn-sm">Export</button>
            <button className="btn">Settings</button>
          </Cell>
          <Cell label="Ghost">
            <button className="btn btn-ghost btn-sm">Cancel</button>
            <button className="btn btn-ghost"><Icon name="x" size={13}/></button>
          </Cell>
          <Cell label="Run snapshot · 3 states">
            <button className="btn btn-primary btn-sm"><Icon name="play" size={11}/> Run snapshot</button>
            <button className="btn btn-primary btn-sm" disabled style={{opacity:0.85}}>
              <span className="spin" style={{display:"inline-flex",animation:"spin 1s linear infinite"}}><Icon name="refresh" size={11}/></span> Running… 32%
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--accent)", color: "#fff", borderRadius: 10, padding: "0 12px", height: 32, fontSize: 12.5, fontWeight: 500 }}>
              <span className="num">32%</span>
              <div style={{ width: 60, height: 3, background: "rgba(255,255,255,0.3)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: "32%", height: "100%", background: "#fff" }} />
              </div>
              <span style={{ opacity: 0.8 }}>4m 12s</span>
            </div>
          </Cell>
        </Section>

        {/* Chips / Keyword chip */}
        <Section title="Keyword chip" sub="editable, removable, validated badge" cols={2}>
          <Cell label="Validated">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 6px 0 10px", borderRadius: 8, background: "var(--bg-raised)", boxShadow: "inset 0 0 0 1px var(--border)", fontSize: 12.5, fontWeight: 500 }}>
              <span>food diary app</span>
              <Icon name="check-circle" size={11} stroke={2.2} style={{ color: "var(--pos)" }} />
              <button className="btn btn-ghost" style={{ padding: 0, width: 18, height: 18, borderRadius: 4, color: "var(--text-faint)" }}><Icon name="x" size={10} stroke={2.2} /></button>
            </div>
          </Cell>
          <Cell label="Unverified">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 6px 0 10px", borderRadius: 8, background: "var(--bg-raised)", boxShadow: "inset 0 0 0 1px var(--neg)", fontSize: 12.5, fontWeight: 500 }}>
              <span>hyperfood journal</span>
              <Icon name="alert" size={11} stroke={2} style={{ color: "var(--neg)" }} />
              <button className="btn btn-ghost" style={{ padding: 0, width: 18, height: 18, borderRadius: 4, color: "var(--text-faint)" }}><Icon name="x" size={10} stroke={2.2} /></button>
            </div>
          </Cell>
        </Section>

        {/* Locale flag-dot */}
        <Section title="Locale flag-dot" cols={4}>
          <Cell label="Top 10"><LocaleFlagDot code="US" status="pos" /> <span className="mono" style={{fontSize:11,color:"var(--text-muted)"}}>US</span></Cell>
          <Cell label="Top 50"><LocaleFlagDot code="DE" status="neg" /> <span className="mono" style={{fontSize:11,color:"var(--text-muted)"}}>DE</span></Cell>
          <Cell label="Unranked"><LocaleFlagDot code="KR" status="gray" /> <span className="mono" style={{fontSize:11,color:"var(--text-muted)"}}>KR</span></Cell>
          <Cell label="Locale row">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 6px", borderRadius: 8, background: "var(--bg-sunken)", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
              <Flag code="GB" size={13} />
              <span className="num" style={{ fontSize: 11, fontWeight: 500, color: "var(--text-2)" }}>#8</span>
              <span className="dot dot-pos" />
            </div>
          </Cell>
        </Section>

        {/* Sparklines */}
        <Section title="Sparkline · tones" cols={3}>
          <Cell label="Positive trend (30d)"><Sparkline data={mkSpark(1, 30, 50, 15, 1)} width={200} height={34} tone="pos" /></Cell>
          <Cell label="Negative trend (30d)"><Sparkline data={mkSpark(2, 30, 80, 12, -0.8)} width={200} height={34} tone="neg" /></Cell>
          <Cell label="Accent / history"><Sparkline data={mkSpark(3, 30, 50, 20, 0.2)} width={200} height={34} tone="accent" /></Cell>
        </Section>

        {/* Progress feed row */}
        <Section title="Progress feed row" sub="snapshot in progress" cols={1}>
          <Cell label="Locale header + three position states" align="start">
            <div style={{ width: "100%", background: "var(--bg-sunken)", borderRadius: 10, overflow: "hidden", boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
              <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--border-subtle)" }}>
                <Flag code="US" size={13} /> United States <div style={{ flex: 1 }} /><span className="num" style={{fontSize:10.5,letterSpacing:0,textTransform:"none",fontWeight:500}}>34/58</span>
              </div>
              {[
                { kw: "food diary app", rank: 6, color: "var(--pos)" },
                { kw: "meal tracker", rank: 12, color: "var(--neg)" },
                { kw: "kid friendly food", rank: null, color: "var(--text-muted)" },
              ].map((r,i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", fontSize: 12.5, background: "var(--bg-raised)", borderBottom: i < 2 ? "1px solid var(--border-subtle)" : "none" }}>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{r.kw}</span>
                  <span className="num" style={{ color: r.color, fontWeight: 600, fontSize: 13 }}>{r.rank == null ? "— not ranked" : `#${r.rank}`}</span>
                  <span className="dot" style={{ background: r.color }} />
                </div>
              ))}
            </div>
          </Cell>
        </Section>

        {/* Mover chip */}
        <Section title="Mover chip · winners & losers" cols={2}>
          <Cell label="Positive">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 28, padding: "0 10px", borderRadius: 999, background: "var(--pos-tint)", color: "var(--pos)" }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-2)" }}>food diary app</span>
              <span className="num" style={{ fontSize: 11.5, fontWeight: 600 }}>↑18</span>
              <span className="num" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>#34→#16</span>
            </div>
          </Cell>
          <Cell label="Negative">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 28, padding: "0 10px", borderRadius: 999, background: "var(--neg-tint)", color: "var(--neg)" }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-2)" }}>calorie counter</span>
              <span className="num" style={{ fontSize: 11.5, fontWeight: 600 }}>↓9</span>
              <span className="num" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>#22→#31</span>
            </div>
          </Cell>
        </Section>

        {/* Segmented + Keyboard */}
        <Section title="Segmented · Keyboard" cols={2}>
          <Cell label="Tabs">
            <Segmented value="rankings" onChange={()=>{}} options={[
              { value: "rankings", label: "Rankings", icon: "list" },
              { value: "keywords", label: "Keywords", icon: "tag" },
              { value: "history", label: "History", icon: "history" },
            ]} />
          </Cell>
          <Cell label="Keyboard">
            <span className="kbd">⌘</span><span className="kbd">K</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>search</span>
            <span style={{ width: 16 }} />
            <span className="kbd">⌘</span><span className="kbd">R</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>run snapshot</span>
            <span style={{ width: 16 }} />
            <span className="kbd">/</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>focus filter</span>
          </Cell>
        </Section>

        {/* Rankings row states */}
        <Section title="Rankings table row · states" cols={1}>
          <Cell label="Default / hover / selected" align="start">
            <table className="table" style={{ width: "100%", background: "var(--bg-raised)", borderRadius: 12, boxShadow: "inset 0 0 0 1px var(--border)", overflow: "hidden" }}>
              <thead><tr>
                <th style={{width:70}}>Locale</th><th>Keyword</th><th style={{width:90}}>Today</th><th style={{width:90}}>Yesterday</th><th style={{width:110}}>Trend</th><th>Competitors</th>
              </tr></thead>
              <tbody>
                <tr>
                  <td><Flag code="US" size={14}/> <span className="mono" style={{fontSize:11,color:"var(--text-muted)"}}>US</span></td>
                  <td><span style={{fontSize:13,fontWeight:500}}>food diary app</span></td>
                  <td><RankPill rank={6}/> <PositionDelta fromRank={8} toRank={6}/></td>
                  <td><span className="num" style={{fontSize:12.5,color:"var(--text-2)"}}>#8</span></td>
                  <td><div style={{color:"var(--text-muted)"}}><Sparkline data={mkSpark(7,30,50,12,0.3)} width={100} height={20} tone="pos"/></div></td>
                  <td style={{fontSize:11.5,color:"var(--text-muted)"}}>MyFitnessPal, Lose It!</td>
                </tr>
                <tr style={{ background: "var(--bg-hover)" }}>
                  <td><Flag code="GB" size={14}/> <span className="mono" style={{fontSize:11,color:"var(--text-muted)"}}>GB</span></td>
                  <td><span style={{fontSize:13,fontWeight:500}}>meal tracker</span> <Badge tone="accent" size="sm">hover</Badge></td>
                  <td><RankPill rank={9}/> <PositionDelta fromRank={10} toRank={9}/></td>
                  <td><span className="num" style={{fontSize:12.5,color:"var(--text-2)"}}>#10</span></td>
                  <td><div style={{color:"var(--text-muted)"}}><Sparkline data={mkSpark(9,30,50,12,-0.1)} width={100} height={20} tone="neutral"/></div></td>
                  <td style={{fontSize:11.5,color:"var(--text-muted)"}}>MyFitnessPal, Nutracheck</td>
                </tr>
                <tr style={{ background: "var(--accent-tint)", boxShadow: "inset 3px 0 0 var(--accent)" }}>
                  <td><Flag code="JP" size={14}/> <span className="mono" style={{fontSize:11,color:"var(--text-muted)"}}>JP</span></td>
                  <td><span style={{fontSize:13,fontWeight:600,color:"var(--accent)"}}>ラーメン 探す</span> <Badge tone="accent" size="sm">selected</Badge></td>
                  <td><RankPill rank={14}/> <PositionDelta fromRank={17} toRank={14}/></td>
                  <td><span className="num" style={{fontSize:12.5,color:"var(--text-2)"}}>#17</span></td>
                  <td><div style={{color:"var(--text-muted)"}}><Sparkline data={mkSpark(11,30,50,15,0.5)} width={100} height={20} tone="pos"/></div></td>
                  <td style={{fontSize:11.5,color:"var(--text-muted)"}}>Tabelog, GuruNavi</td>
                </tr>
              </tbody>
            </table>
          </Cell>
        </Section>

        {/* Empty state */}
        <Section title="Empty state · onboarding" cols={1}>
          <div style={{ background: "var(--bg-raised)", borderRadius: 16, boxShadow: "inset 0 0 0 1px var(--border)", padding: 40, display: "flex", alignItems: "center", gap: 40 }}>
            <div style={{ flex: 1 }}>
              <Badge tone="accent">Welcome</Badge>
              <h2 style={{ margin: "10px 0 6px 0", fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>Track your first app</h2>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Three steps, about five minutes. You'll be watching positions by the end of this coffee.</p>
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button className="btn btn-primary"><Icon name="plus" size={12}/> Add an app</button>
                <button className="btn">Read docs</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {[
                { n: 1, title: "Add app", sub: "iTunes ID + bundle", icon: "plus", done: true },
                { n: 2, title: "Add keywords", sub: "paste or CSV", icon: "tag", done: false },
                { n: 3, title: "Run snapshot", sub: "~5 min", icon: "play", done: false },
              ].map(s => (
                <div key={s.n} style={{
                  width: 150, padding: 16, borderRadius: 12,
                  background: s.done ? "var(--accent-tint)" : "var(--bg-sunken)",
                  boxShadow: `inset 0 0 0 1px ${s.done ? "rgba(255,92,60,0.3)" : "var(--border-subtle)"}`,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: s.done ? "var(--accent)" : "var(--bg-raised)",
                    color: s.done ? "#fff" : "var(--text-muted)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    marginBottom: 12, boxShadow: s.done ? "none" : "inset 0 0 0 1px var(--border)",
                  }}><Icon name={s.done ? "check" : s.icon} size={13} stroke={2.2} /></div>
                  <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>{s.n}. {s.title}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{s.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
};

export { ComponentLibraryScreen };