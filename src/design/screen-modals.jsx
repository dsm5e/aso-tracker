import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Icon, Sparkline, Flag, Badge, Segmented, AppIcon } from './primitives';
import { APPS, EDITOR_LOCALES, EDITOR_KEYWORDS, PROGRESS_FEED } from './data';

// Keywords Editor + Snapshot Progress + App Adder + Command Palette

// ===================== Keywords Editor =====================
const KeywordChip = ({ kw, validated, onRemove }) => (
  <div style={{
    display: "inline-flex", alignItems: "center", gap: 6,
    height: 28, padding: "0 6px 0 10px",
    borderRadius: 8,
    background: "var(--bg-raised)",
    boxShadow: `inset 0 0 0 1px ${validated ? "var(--border)" : "var(--neg)"}`,
    fontSize: 12.5, fontWeight: 500, letterSpacing: "-0.005em",
  }}>
    <span>{kw}</span>
    {validated ? (
      <span title="Validated with Apple autocomplete" style={{ display: "inline-flex", color: "var(--pos)" }}>
        <Icon name="check-circle" size={11} stroke={2.2} />
      </span>
    ) : (
      <span title="Not in Apple autocomplete" style={{ display: "inline-flex", color: "var(--neg)" }}>
        <Icon name="alert" size={11} stroke={2} />
      </span>
    )}
    <button onClick={onRemove} className="btn btn-ghost" style={{ padding: 0, width: 18, height: 18, borderRadius: 4, color: "var(--text-faint)" }}>
      <Icon name="x" size={10} stroke={2.2} />
    </button>
  </div>
);

const KeywordsEditorScreen = ({ theme, onClose, onBack }) => {
  const [sel, setSel] = useState("US");
  const [input, setInput] = useState("");
  const [kws, setKws] = useState(EDITOR_KEYWORDS);
  const [query, setQuery] = useState("");

  const visible = EDITOR_LOCALES.filter(l => (l.name + l.code).toLowerCase().includes(query.toLowerCase()));
  const current = EDITOR_LOCALES.find(l => l.code === sel);

  return (
    <div className="app" data-theme={theme} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 28px", borderBottom: "1px solid var(--border-subtle)" }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="chevron-left" size={13}/> Nomly</button>
        <span style={{ color: "var(--text-faint)", fontSize: 11 }}>/</span>
        <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Keywords</h1>
        <Badge>446 total · 34 locales</Badge>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm"><Icon name="upload" size={12}/> Import CSV</button>
        <button className="btn btn-sm"><Icon name="download" size={12}/> Export</button>
        <button className="btn btn-primary btn-sm"><Icon name="check" size={12}/> Validate all with Apple</button>
      </header>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "320px 1fr", minHeight: 0 }}>
        {/* Left — locales */}
        <aside style={{ borderRight: "1px solid var(--border-subtle)", padding: "16px 16px 16px 28px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-sunken)", borderRadius: 8, padding: "0 10px", height: 30, boxShadow: "inset 0 0 0 1px var(--border-subtle)" }}>
            <Icon name="search" size={12} stroke={1.8} style={{ color: "var(--text-muted)" }} />
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search locales…" style={{ flex: 1, fontSize: 12 }} />
          </div>
          <div className="label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Locales</span><span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--text-faint)" }}>{visible.length}</span>
          </div>
          <div className="scroll" style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: 1, marginLeft: -6, marginRight: -6 }}>
            {visible.map(l => {
              const active = l.code === sel;
              return (
                <button key={l.code} onClick={() => setSel(l.code)} className="btn btn-ghost" style={{
                  height: 34, justifyContent: "flex-start", padding: "0 10px",
                  background: active ? "var(--bg-sunken)" : "transparent",
                  boxShadow: active ? "inset 0 0 0 1px var(--border-subtle)" : "none",
                  borderRadius: 8,
                }}>
                  <Flag code={l.code} size={14} />
                  <span style={{ flex: 1, textAlign: "left", fontWeight: active ? 500 : 400, color: active ? "var(--text)" : "var(--text-2)" }}>{l.name}</span>
                  <span className="num" style={{ fontSize: 11, color: "var(--text-muted)" }}>{l.count}</span>
                </button>
              );
            })}
          </div>
          <button className="btn btn-sm btn-ghost" style={{ justifyContent: "flex-start", marginTop: 4, color: "var(--accent)" }}>
            <Icon name="plus" size={12}/> Add locale
          </button>
        </aside>

        {/* Right — keywords */}
        <section style={{ padding: "24px 28px", overflow: "auto", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Flag code={sel} size={20}/>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>{current.name}</h2>
                <Badge>{current.count} keywords</Badge>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                <span className="delta-pos">14 validated</span> · <span className="delta-neg">3 unverified</span> · 1 duplicate
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm"><Icon name="layers" size={12} /> Bulk paste</button>
              <button className="btn btn-sm"><Icon name="check" size={12} /> Validate locale</button>
              <button className="btn btn-sm btn-ghost" style={{ color: "var(--neg)" }}><Icon name="x" size={12} /> Remove locale</button>
            </div>
          </div>

          {/* Add input */}
          <div style={{
            background: "var(--bg-raised)",
            borderRadius: 14,
            boxShadow: "inset 0 0 0 1px var(--border)",
            padding: "6px 8px 6px 16px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <Icon name="plus" size={14} style={{ color: "var(--accent)" }} />
            <input
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && input.trim()) { setKws([{ kw: input.trim(), validated: false }, ...kws]); setInput(""); } }}
              placeholder="Add keyword… (press Enter, or comma-separate to add multiple)"
              style={{ flex: 1, fontSize: 14, fontWeight: 500, padding: "10px 0", color: "var(--text)" }}
            />
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Will check Apple autocomplete</span>
            <button className="btn btn-primary btn-sm" disabled={!input}><Icon name="plus" size={11}/> Add</button>
          </div>

          {/* Keywords list */}
          <div>
            <div className="label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span>Tracked keywords</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="check-circle" size={10} style={{ color: "var(--pos)" }} /> <span style={{ fontSize: 10.5 }}>validated</span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="alert" size={10} style={{ color: "var(--neg)" }} /> <span style={{ fontSize: 10.5 }}>unverified</span>
                </span>
              </span>
            </div>
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 6,
              padding: 16,
              background: "var(--bg-sunken)",
              borderRadius: 14, boxShadow: "inset 0 0 0 1px var(--border-subtle)",
            }}>
              {kws.map((k,i) => <KeywordChip key={i} kw={k.kw} validated={k.validated} onRemove={() => setKws(kws.filter((_,j)=>j!==i))} />)}
            </div>
          </div>

          {/* Competitor research suggestions */}
          <div style={{
            background: "var(--bg-raised)", borderRadius: 14, boxShadow: "inset 0 0 0 1px var(--border)",
            padding: 18,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 2 }}>
                  <Icon name="bolt" size={12} style={{ color: "var(--accent)", marginRight: 6 }} />
                  Apple autocomplete suggestions
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Real search phrases starting with terms you track in {current.name}</div>
              </div>
              <button className="btn btn-sm btn-ghost">Refresh</button>
            </div>
            <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["food diary ios","meal tracker free","ramen app","food journal app","what did i eat today","diet diary","calorie journal","picky eater meals"].map(s => (
                <button key={s} className="chip" style={{ cursor: "pointer", height: 28, paddingRight: 6 }}>
                  <span>{s}</span>
                  <Icon name="plus" size={11} style={{ color: "var(--accent)" }} />
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

// ===================== Snapshot Progress =====================
const ProgressRow = ({ item }) => {
  const tone = item.rank == null ? "unranked" : item.rank <= 10 ? "top10" : item.rank <= 50 ? "top50" : "unranked";
  const color = tone === "top10" ? "var(--pos)" : tone === "top50" ? "var(--neg)" : "var(--text-muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", fontSize: 12.5 }}>
      <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1, letterSpacing: "-0.005em" }}>{item.kw}</span>
      <span className="num" style={{ color, fontWeight: 600, fontSize: 13 }}>
        {item.rank == null ? "— not ranked" : `#${item.rank}`}
      </span>
      <span className="dot" style={{ background: color }} />
    </div>
  );
};

const SnapshotPanel = ({ onClose, rateLimited = false }) => {
  const total = 446 * 49;
  const done = Math.floor(total * 0.32);
  return (
    <div style={{
      position: "absolute", right: 0, top: 0, bottom: 0,
      width: 420,
      background: "var(--bg-raised)",
      borderLeft: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      boxShadow: "-20px 0 40px -20px rgba(0,0,0,0.18)",
    }}>
      {rateLimited && (
        <div style={{
          background: "#FFE8E2",
          color: "#8A2820",
          padding: "10px 16px",
          fontSize: 12, fontWeight: 500,
          display: "flex", alignItems: "center", gap: 10,
          borderBottom: "1px solid #F4C8BE",
        }}>
          <Icon name="alert" size={14} />
          iTunes rate-limited your IP. Waiting <span className="mono" style={{ fontWeight: 600 }}>01:47</span>…
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" style={{ color: "#8A2820" }}>Retry now</button>
        </div>
      )}

      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: 999, background: "var(--accent)", animation: "pulse 1.4s infinite" }} />
          <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em" }}>Running snapshot</div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost"><Icon name="pause" size={11}/></button>
          <button className="btn btn-sm" style={{ color: "var(--neg)" }}>Abort</button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={12}/></button>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
          <span className="hero-num" style={{ fontSize: 26, lineHeight: 1 }}>32<span style={{ fontSize: 16, color: "var(--text-muted)" }}>%</span></span>
          <span className="num" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{done.toLocaleString()} / {total.toLocaleString()} combos</span>
          <div style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>ETA 4m 12s</span>
        </div>
        {/* Progress bar */}
        <div style={{ height: 4, background: "var(--bg-sunken)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: "32%", height: "100%", background: "var(--accent)", borderRadius: 999 }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-faint)", marginTop: 6 }}>
          <span>8 workers · 250ms delay · 2 retries</span>
          <span>18/49 locales</span>
        </div>
      </div>

      <div className="scroll" style={{ flex: 1, overflow: "auto", paddingBottom: 20 }}>
        {PROGRESS_FEED.map((section, si) => (
          <div key={section.locale}>
            <div style={{
              position: "sticky", top: 0, zIndex: 1,
              background: "var(--bg-sunken)",
              padding: "8px 14px",
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.08em",
              borderTop: si > 0 ? "1px solid var(--border-subtle)" : "none",
              borderBottom: "1px solid var(--border-subtle)",
            }}>
              <Flag code={section.locale} size={13} />
              {section.locale === "US" ? "United States" : section.locale === "GB" ? "United Kingdom" : "Germany"}
              <div style={{ flex: 1 }} />
              <span className="num" style={{ fontSize: 10.5, letterSpacing: 0, textTransform: "none", fontWeight: 500 }}>
                {section.items.length}/{section.locale === "US" ? 58 : section.locale === "GB" ? 42 : 38}
              </span>
            </div>
            {section.items.map((it, i) => <ProgressRow key={i} item={it} />)}
          </div>
        ))}

        {/* Pending locales */}
        <div style={{
          padding: "8px 14px",
          fontSize: 11, fontWeight: 500, color: "var(--text-faint)",
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--bg-sunken)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span className="dot dot-gray" /> 31 more locales queued · FR, JP, CA, AU, NL, SE…
        </div>
      </div>
    </div>
  );
};

// ===================== App Adder Modal =====================
const AppAdderModal = ({ onClose }) => {
  const [step, setStep] = useState("form"); // form | testing | confirmed
  const [iTunesId, setITunesId] = useState("6471234567");
  const [bundle, setBundle] = useState("com.example.myapp");
  const [name, setName] = useState("Nomly");
  const [emoji, setEmoji] = useState("🍜");

  useEffect(() => {
    if (step === "testing") {
      const t = setTimeout(() => setStep("confirmed"), 1200);
      return () => clearTimeout(t);
    }
  }, [step]);

  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(10,10,10,0.34)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 40, backdropFilter: "blur(4px)",
    }}>
      <div style={{
        width: 540, background: "var(--bg-raised)",
        borderRadius: 18, boxShadow: "0 20px 60px -20px rgba(0,0,0,0.4), inset 0 0 0 1px var(--border)",
        overflow: "hidden",
      }}>
        <div style={{ padding: "20px 24px 0 24px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>Add an app</h2>
            <p style={{ margin: "4px 0 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>We'll look it up on iTunes to confirm the ID is right.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="x" size={12}/></button>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* iTunes ID + test button */}
          <div>
            <label className="label" style={{ display: "block", marginBottom: 6 }}>iTunes App ID</label>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{
                flex: 1, display: "inline-flex", alignItems: "center", gap: 8,
                background: "var(--bg-sunken)", borderRadius: 10, padding: "0 12px", height: 36,
                boxShadow: "inset 0 0 0 1px var(--border-subtle)",
              }}>
                <span style={{ color: "var(--text-faint)", fontSize: 12 }}>id=</span>
                <input className="mono" value={iTunesId} onChange={e=>setITunesId(e.target.value)} placeholder="1234567890" style={{ flex: 1, fontSize: 13, fontWeight: 500 }} />
              </div>
              <button className="btn" onClick={() => setStep("testing")} disabled={step === "testing"}>
                {step === "testing" ? <><span className="spin"><Icon name="refresh" size={12}/></span> Testing…</> : <><Icon name="bolt" size={12}/> Test connection</>}
              </button>
            </div>
          </div>

          {/* Test result card */}
          {(step === "testing" || step === "confirmed") && (
            <div style={{
              background: step === "confirmed" ? "var(--pos-tint)" : "var(--bg-sunken)",
              border: `1px solid ${step === "confirmed" ? "rgba(16,185,129,0.3)" : "var(--border-subtle)"}`,
              borderRadius: 12, padding: 14,
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 11,
                background: "linear-gradient(135deg, #FFD7C4 0%, #FF8A6A 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24,
              }}>{emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em" }}>Nomly: Food Journal</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Health & Fitness · com.example.myapp · v2.1.4 · 12,842 ratings</div>
              </div>
              {step === "confirmed" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--pos)", fontSize: 12, fontWeight: 500 }}>
                  <Icon name="check-circle" size={14} stroke={2.2} /> Match confirmed
                </span>
              ) : (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Looking up…</span>
              )}
            </div>
          )}

          {/* Match / display / emoji */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="label" style={{ display: "block", marginBottom: 6 }}>Bundle match</label>
              <div style={{
                display: "inline-flex", alignItems: "center", width: "100%",
                background: "var(--bg-sunken)", borderRadius: 10, padding: "0 12px", height: 36,
                boxShadow: "inset 0 0 0 1px var(--border-subtle)",
              }}>
                <input className="mono" value={bundle} onChange={e=>setBundle(e.target.value)} style={{ flex: 1, fontSize: 12.5 }} />
              </div>
            </div>
            <div>
              <label className="label" style={{ display: "block", marginBottom: 6 }}>Display name</label>
              <div style={{
                display: "inline-flex", alignItems: "center", width: "100%",
                background: "var(--bg-sunken)", borderRadius: 10, padding: "0 12px", height: 36,
                boxShadow: "inset 0 0 0 1px var(--border-subtle)",
              }}>
                <input value={name} onChange={e=>setName(e.target.value)} style={{ flex: 1, fontSize: 13, fontWeight: 500 }} />
              </div>
            </div>
          </div>

          <div>
            <label className="label" style={{ display: "block", marginBottom: 6 }}>Emoji</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["🍜","🌊","🕯️","📓","🎯","🧭","☕","🌱","🪴","🛠️","🎧","🗺️"].map(e => (
                <button key={e} onClick={()=>setEmoji(e)} style={{
                  width: 36, height: 36, borderRadius: 9,
                  background: emoji === e ? "var(--accent-tint)" : "var(--bg-sunken)",
                  boxShadow: emoji === e ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 1px var(--border-subtle)",
                  fontSize: 18, border: 0, cursor: "pointer",
                }}>{e}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-sunken)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={step !== "confirmed"}>
            <Icon name="plus" size={11}/> Add app & start tracking
          </button>
        </div>
      </div>
      <style>{`
        .spin { display: inline-flex; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.2)} }
      `}</style>
    </div>
  );
};

// ===================== Command Palette =====================
const CommandPalette = ({ onClose }) => {
  const [q, setQ] = useState("ra");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = [
    { group: "Apps", items: [
      { icon: "🍜", label: "Nomly", sub: "446 keywords · 34 locales" },
      { icon: "🌊", label: "Waverly", sub: "182 keywords · 13 locales" },
      { icon: "🕯️", label: "Dimmer", sub: "298 keywords · 17 locales" },
    ]},
    { group: "Keywords", items: [
      { icon: "tag", label: "ramen finder", sub: "Nomly · US · #7 ↑2" },
      { icon: "tag", label: "surf forecast", sub: "Waverly · US · #5 ↑14" },
      { icon: "tag", label: "raining", sub: "Waverly · GB · #19 ↓4" },
    ]},
    { group: "Actions", items: [
      { icon: "play", label: "Run snapshot — all apps", kbd: ["⌘","R"] },
      { icon: "plus", label: "Add an app…", kbd: ["⌘","⇧","A"] },
      { icon: "globe", label: "Open locale: United States", kbd: [] },
      { icon: "download", label: "Export JSONL", kbd: [] },
    ]},
  ];

  return (
    <div onClick={onClose} style={{
      position: "absolute", inset: 0,
      background: "rgba(10,10,10,0.38)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "12vh 0 0 0",
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        width: 620, background: "var(--bg-raised)",
        borderRadius: 16, boxShadow: "0 28px 80px -20px rgba(0,0,0,0.5), inset 0 0 0 1px var(--border)",
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <Icon name="search" size={15} stroke={1.8} style={{ color: "var(--text-muted)" }} />
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search apps, keywords, locales, actions…" style={{ flex: 1, fontSize: 15, fontWeight: 500 }} />
          <span className="kbd">esc</span>
        </div>
        <div style={{ padding: 8, maxHeight: 420, overflow: "auto" }}>
          {items.map((group, gi) => (
            <div key={group.group}>
              <div style={{ padding: "10px 12px 6px", fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>{group.group}</div>
              {group.items.map((it, i) => {
                const active = gi === 1 && i === 0;
                const iconIsEmoji = typeof it.icon === "string" && it.icon.length <= 3 && !/^[a-z-]+$/.test(it.icon);
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 12px", borderRadius: 8,
                    background: active ? "var(--accent-tint)" : "transparent",
                    boxShadow: active ? "inset 0 0 0 1px rgba(255,92,60,0.3)" : "none",
                    cursor: "pointer",
                  }}>
                    {iconIsEmoji ? (
                      <span style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: "var(--bg-sunken)", display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13,
                      }}>{it.icon}</span>
                    ) : (
                      <span style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: active ? "rgba(255,255,255,0.6)" : "var(--bg-sunken)",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        color: active ? "var(--accent)" : "var(--text-muted)",
                      }}><Icon name={it.icon} size={12} stroke={2} /></span>
                    )}
                    <span style={{ fontSize: 13.5, fontWeight: 500, color: active ? "var(--accent)" : "var(--text)", letterSpacing: "-0.005em" }}>
                      {q && it.label.toLowerCase().includes(q.toLowerCase()) ? (
                        <>
                          {it.label.slice(0, it.label.toLowerCase().indexOf(q.toLowerCase()))}
                          <mark style={{ background: "transparent", color: active ? "var(--accent)" : "var(--accent)", fontWeight: 700 }}>
                            {it.label.slice(it.label.toLowerCase().indexOf(q.toLowerCase()), it.label.toLowerCase().indexOf(q.toLowerCase()) + q.length)}
                          </mark>
                          {it.label.slice(it.label.toLowerCase().indexOf(q.toLowerCase()) + q.length)}
                        </>
                      ) : it.label}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--text-muted)", flex: 1 }}>{it.sub}</span>
                    {it.kbd && it.kbd.map((k, ki) => <span key={ki} className="kbd">{k}</span>)}
                    {active && <Icon name="arrow-right" size={12} style={{ color: "var(--accent)" }} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{
          borderTop: "1px solid var(--border-subtle)", background: "var(--bg-sunken)",
          padding: "8px 14px", display: "flex", alignItems: "center", gap: 14,
          fontSize: 11, color: "var(--text-muted)",
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span className="kbd">↑</span><span className="kbd">↓</span> navigate</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span className="kbd">↵</span> select</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span className="kbd">⌘</span><span className="kbd">↵</span> open in new</span>
          <div style={{ flex: 1 }} />
          <span>ASO Tracker</span>
        </div>
      </div>
    </div>
  );
};

export { KeywordsEditorScreen, SnapshotPanel, AppAdderModal, CommandPalette };