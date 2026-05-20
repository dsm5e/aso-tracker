import { useEffect, useRef, useState } from "react";

interface Item {
  id: "aso" | "shot" | "vid" | "asa";
  label: string;
  hint: string;
  glyph: string;
  href: string;
}

// When running standalone at :5193, navigate to the keywords origin (:5173).
// When proxied via :5173/asa/, use relative paths.
const TRACKER_ORIGIN =
  typeof window !== "undefined" && window.location.port === "5193"
    ? "http://localhost:5173"
    : "";

const ITEMS: Item[] = [
  { id: "aso",  label: "ASO",         hint: "Keywords & rankings", glyph: "◇", href: `${TRACKER_ORIGIN}/` },
  { id: "shot", label: "Screenshots", hint: "App Store visuals",   glyph: "▤", href: `${TRACKER_ORIGIN}/studio/` },
  { id: "vid",  label: "Video",       hint: "Ad video pipeline",   glyph: "▶", href: `${TRACKER_ORIGIN}/video/` },
  { id: "asa",  label: "ASA Ads",     hint: "Search Ads ROI",      glyph: "$", href: `${TRACKER_ORIGIN}/asa/` },
];

export default function StudioSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = ITEMS.find((i) => i.id === "asa")!;

  return (
    <div ref={ref} style={{ position: "relative", margin: "0 12px 14px" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "8px 10px",
          background: open ? "var(--bg-3)" : "var(--bg-2)",
          border: "1px solid var(--line)",
          color: "var(--bone)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{
          width: 24, height: 24,
          background: "linear-gradient(135deg, var(--amber), #d97706)",
          color: "var(--void)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 12,
          flex: "none",
        }}>◆</span>
        <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--bone-mute)" }}>
            ASO Studio
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--amber)" }}>
            {active.label}
          </span>
        </span>
        <span style={{ color: "var(--bone-mute)", fontSize: 10 }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          background: "var(--bg-1)",
          border: "1px solid var(--amber-dim)",
          boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
          zIndex: 100,
          padding: 4,
        }}>
          {ITEMS.map((it) => {
            const isActive = it.id === "asa";
            return (
              <a
                key={it.id}
                href={it.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  background: isActive ? "var(--bg-3)" : "transparent",
                  color: "var(--bone)",
                  textDecoration: "none",
                  borderLeft: isActive ? "2px solid var(--amber)" : "2px solid transparent",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-2)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  width: 22, height: 22,
                  background: it.id === "aso" ? "linear-gradient(135deg, #FF8C42, #F25C1F)"
                    : it.id === "shot" ? "linear-gradient(135deg, #7C3AED, #A78BFA)"
                    : it.id === "vid" ? "linear-gradient(135deg, #14B8A6, #5EEAD4)"
                    : "linear-gradient(135deg, var(--amber), #d97706)",
                  color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 11,
                  flex: "none",
                }}>{it.glyph}</span>
                <span style={{ display: "flex", flexDirection: "column", flex: 1, lineHeight: 1.3 }}>
                  <span style={{ fontSize: 12, color: "var(--bone)" }}>{it.label}</span>
                  <span style={{ fontSize: 10, color: "var(--bone-mute)", letterSpacing: "0.02em" }}>{it.hint}</span>
                </span>
                {isActive && <span style={{ color: "var(--amber)", fontSize: 10 }}>✓</span>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
