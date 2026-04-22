import React, { useState, useEffect, useMemo, useRef } from 'react';

// Shared primitives for ASO Tracker

// ===================== Icons =====================
const Icon = ({ name, size = 14, stroke = 1.6, style, ...rest }) => {
  const s = { width: size, height: size, display: "inline-block", flex: "none", ...style };
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round", style: s, ...rest };
  switch (name) {
    case "arrow-up": return <svg {...common}><path d="M12 19V5M5 12l7-7 7 7"/></svg>;
    case "arrow-down": return <svg {...common}><path d="M12 5v14M19 12l-7 7-7-7"/></svg>;
    case "arrow-right": return <svg {...common}><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
    case "play": return <svg {...common}><path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none"/></svg>;
    case "refresh": return <svg {...common}><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case "x": return <svg {...common}><path d="M18 6 6 18M6 6l12 12"/></svg>;
    case "search": return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>;
    case "settings": return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>;
    case "command": return <svg {...common}><path d="M18 3a3 3 0 000 6h-3V6a3 3 0 00-3-3 3 3 0 00-3 3v3H6a3 3 0 000 6 3 3 0 003-3v-3h6v3a3 3 0 003 3 3 3 0 000-6h-3V9h3a3 3 0 000-6z"/></svg>;
    case "chevron-right": return <svg {...common}><path d="M9 18l6-6-6-6"/></svg>;
    case "chevron-down": return <svg {...common}><path d="M6 9l6 6 6-6"/></svg>;
    case "chevron-left": return <svg {...common}><path d="M15 18l-6-6 6-6"/></svg>;
    case "check": return <svg {...common}><path d="M20 6L9 17l-5-5"/></svg>;
    case "check-circle": return <svg {...common}><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg>;
    case "alert": return <svg {...common}><path d="M10.3 3.9L2 18a1.8 1.8 0 001.6 2.7h16.8A1.8 1.8 0 0022 18l-8.3-14a1.9 1.9 0 00-3.4 0z"/><path d="M12 9v4M12 17h0"/></svg>;
    case "grid": return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
    case "list": return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>;
    case "globe": return <svg {...common}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>;
    case "filter": return <svg {...common}><path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/></svg>;
    case "download": return <svg {...common}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>;
    case "upload": return <svg {...common}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>;
    case "more": return <svg {...common}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;
    case "tag": return <svg {...common}><path d="M20.6 13.4L13.4 20.6a2 2 0 01-2.8 0L2 12V2h10l8.6 8.6a2 2 0 010 2.8z"/><path d="M7 7h.01"/></svg>;
    case "clock": return <svg {...common}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>;
    case "trending-up": return <svg {...common}><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>;
    case "trending-down": return <svg {...common}><path d="M23 18l-9.5-9.5-5 5L1 6"/><path d="M17 18h6v-6"/></svg>;
    case "history": return <svg {...common}><path d="M1 4v6h6"/><path d="M3.5 15a9 9 0 102.1-9.4L1 10"/><path d="M12 7v5l4 2"/></svg>;
    case "layers": return <svg {...common}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>;
    case "sun": return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
    case "moon": return <svg {...common}><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>;
    case "keyboard": return <svg {...common}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 14h10"/></svg>;
    case "bolt": return <svg {...common}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" stroke="none"/></svg>;
    case "pause": return <svg {...common}><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></svg>;
    default: return null;
  }
};

// ===================== Sparkline =====================
const Sparkline = ({ data, width = 64, height = 20, tone = "accent", fill = true, strokeWidth = 1.4, className = "" }) => {
  const { path, area, endX, endY } = useMemo(() => {
    if (!data || data.length === 0) return { path: "", area: "", endX: 0, endY: 0 };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const step = width / (data.length - 1);
    const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 3) - 1.5]);
    const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
    const area = `${path} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`;
    return { path, area, endX: pts[pts.length - 1][0], endY: pts[pts.length - 1][1] };
  }, [data, width, height]);
  const id = useMemo(() => "spark-" + Math.random().toString(36).slice(2, 8), []);
  return (
    <svg width={width} height={height} className={`spark-${tone} ${className}`} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} stroke="none" style={{ color: `var(--${tone === "pos" ? "pos" : tone === "neg" ? "neg" : tone === "accent" ? "accent" : "text-muted"})` }} />}
      <path className="line" d={path} fill="none" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={endX} cy={endY} r={1.8} fill="currentColor" style={{ color: `var(--${tone === "pos" ? "pos" : tone === "neg" ? "neg" : tone === "accent" ? "accent" : "text-muted"})` }} />
    </svg>
  );
};

// ===================== Flag (emoji + fallback) =====================
const FLAG = {
  US: "🇺🇸", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", JP: "🇯🇵", CN: "🇨🇳", KR: "🇰🇷",
  CA: "🇨🇦", AU: "🇦🇺", NL: "🇳🇱", ES: "🇪🇸", IT: "🇮🇹", SE: "🇸🇪", BR: "🇧🇷",
  MX: "🇲🇽", IN: "🇮🇳", RU: "🇷🇺", PL: "🇵🇱", TR: "🇹🇷", NO: "🇳🇴", DK: "🇩🇰",
  FI: "🇫🇮", CH: "🇨🇭", AT: "🇦🇹", BE: "🇧🇪", IE: "🇮🇪", NZ: "🇳🇿", SG: "🇸🇬",
  HK: "🇭🇰", TW: "🇹🇼", ZA: "🇿🇦", AR: "🇦🇷", CL: "🇨🇱", CO: "🇨🇴", PT: "🇵🇹",
  // additions from real Nomly tracking
  SA: "🇸🇦", BD: "🇧🇩", CZ: "🇨🇿", GR: "🇬🇷", IL: "🇮🇱", HR: "🇭🇷", HU: "🇭🇺",
  ID: "🇮🇩", MY: "🇲🇾", PK: "🇵🇰", RO: "🇷🇴", SK: "🇸🇰", SI: "🇸🇮", TH: "🇹🇭",
  UA: "🇺🇦", VN: "🇻🇳", IS: "🇮🇸",
  // regional variants fallback to country flag
  "IN-HI": "🇮🇳", "IN-GU": "🇮🇳", "IN-KN": "🇮🇳", "IN-ML": "🇮🇳",
  "IN-MR": "🇮🇳", "IN-OR": "🇮🇳", "IN-PA": "🇮🇳", "IN-TA": "🇮🇳", "IN-TE": "🇮🇳",
  "ES-CA": "🇪🇸",
};
const Flag = ({ code, size = 14 }) => (
  <span className="flag" style={{ fontSize: size, width: size + 4, height: Math.round(size * 0.75) }}>{FLAG[code] || "🏳️"}</span>
);

// ===================== Locale-flag-dot widget =====================
const LocaleFlagDot = ({ code, status = "pos", compact = false }) => (
  <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
    <Flag code={code} size={compact ? 14 : 16} />
    <span className={`dot dot-${status}`} style={{ position: "absolute", right: -2, bottom: -2, border: "2px solid var(--bg-raised)", width: 8, height: 8 }} />
  </span>
);

// ===================== Delta =====================
const Delta = ({ value, suffix = "", inline = false, size = "sm" }) => {
  if (value === 0 || value === null || value === undefined) {
    return <span className="num delta-neutral" style={{ fontWeight: 500, fontSize: size === "lg" ? 13 : 11.5 }}>—</span>;
  }
  const pos = value > 0;
  const tone = pos ? "delta-pos" : "delta-neg";
  const arrow = pos ? "↑" : "↓";
  return (
    <span className={`num ${tone}`} style={{ display: "inline-flex", alignItems: "center", gap: 2, fontWeight: 500, fontSize: size === "lg" ? 13 : 11.5, letterSpacing: "-0.01em" }}>
      <span style={{ fontSize: size === "lg" ? 13 : 11 }}>{arrow}</span>
      {Math.abs(value)}{suffix}
    </span>
  );
};

// Position delta — convention: lower is better (rank 1 > rank 10)
// so a decrease in rank is positive
const PositionDelta = ({ fromRank, toRank }) => {
  if (fromRank == null || toRank == null) return <span className="num delta-neutral" style={{ fontSize: 11.5 }}>—</span>;
  const diff = fromRank - toRank; // positive means improved (moved up)
  if (diff === 0) return <span className="num delta-neutral" style={{ fontSize: 11.5 }}>—</span>;
  const pos = diff > 0;
  return (
    <span className={`num ${pos ? "delta-pos" : "delta-neg"}`} style={{ display: "inline-flex", alignItems: "center", gap: 2, fontWeight: 500, fontSize: 11.5 }}>
      <span>{pos ? "↑" : "↓"}</span>{Math.abs(diff)}
    </span>
  );
};

// ===================== Rank pill =====================
const RankPill = ({ rank }) => {
  if (rank == null || rank === 0) {
    return <span className="num" style={{ color: "var(--text-faint)", fontSize: 13, fontWeight: 500 }}>—</span>;
  }
  const tone = rank <= 10 ? "pos" : rank <= 50 ? "neg" : "unranked";
  const color = tone === "pos" ? "var(--pos)" : tone === "neg" ? "var(--neg)" : "var(--text-muted)";
  return (
    <span className="num" style={{ color, fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.015em" }}>#{rank}</span>
  );
};

// ===================== App icon (real iTunes artwork or faux emoji) =====================
const AppIcon = ({ bg, emoji, iconUrl, size = 40, rounded = 10 }) => {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        width={size}
        height={size}
        alt=""
        style={{
          width: size, height: size, borderRadius: rounded,
          objectFit: 'cover', flex: 'none',
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
        }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: rounded,
      background: bg || 'linear-gradient(135deg, #E5D8F5 0%, #7B4AC3 100%)',
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.52, flex: "none",
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.06)",
    }}>{emoji}</div>
  );
};

// ===================== Segmented control =====================
const Segmented = ({ options, value, onChange, size = "md" }) => (
  <div style={{
    display: "inline-flex",
    background: "var(--bg-sunken)",
    borderRadius: size === "sm" ? 8 : 10,
    padding: 2,
    boxShadow: "inset 0 0 0 1px var(--border-subtle)",
    gap: 1,
  }}>
    {options.map(o => {
      const active = o.value === value;
      return (
        <button key={o.value} onClick={() => onChange?.(o.value)} className="btn btn-ghost"
          style={{
            height: size === "sm" ? 22 : 26,
            padding: size === "sm" ? "0 8px" : "0 10px",
            borderRadius: size === "sm" ? 6 : 8,
            fontSize: size === "sm" ? 11.5 : 12,
            fontWeight: 500,
            background: active ? "var(--bg-raised)" : "transparent",
            color: active ? "var(--text)" : "var(--text-muted)",
            boxShadow: active ? "0 0 0 1px var(--border), 0 1px 2px rgba(0,0,0,0.04)" : "none",
          }}>
          {o.icon && <Icon name={o.icon} size={12} />}
          {o.label}
        </button>
      );
    })}
  </div>
);

// ===================== Badge =====================
const Badge = ({ children, tone = "neutral", size = "sm" }) => {
  const toneMap = {
    neutral: { bg: "var(--neutral-tint)", fg: "var(--text-muted)" },
    pos: { bg: "var(--pos-tint)", fg: "var(--pos)" },
    neg: { bg: "var(--neg-tint)", fg: "var(--neg)" },
    accent: { bg: "var(--accent-tint)", fg: "var(--accent)" },
  };
  const t = toneMap[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      height: size === "sm" ? 18 : 22, padding: size === "sm" ? "0 6px" : "0 8px",
      borderRadius: 5,
      fontSize: size === "sm" ? 10.5 : 11.5, fontWeight: 500, letterSpacing: "-0.005em",
      background: t.bg, color: t.fg,
    }}>{children}</span>
  );
};

// Random helpers for mock data
function rng(seed) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}
function mkSpark(seed, len = 30, base = 50, amp = 20, trend = 0) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(base + Math.sin(i / 4 + seed) * amp * 0.4 + (r() - 0.5) * amp + trend * i);
  }
  return out;
}

// Expose globally for other <script type="text/babel"> files
export {
  Icon, Sparkline, Flag, FLAG, LocaleFlagDot, Delta, PositionDelta,
  RankPill, AppIcon, Segmented, Badge, rng, mkSpark,
};