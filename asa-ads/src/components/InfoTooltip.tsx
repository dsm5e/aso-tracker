import { useState, useRef, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  title?: string;
}

export default function InfoTooltip({ children, title }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        ref={ref}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "1px solid var(--bone-ghost)",
          color: "var(--bone-mute)",
          fontSize: 9,
          fontWeight: 600,
          cursor: "help",
          marginLeft: 6,
          userSelect: "none",
        }}
      >?</span>
      {open && (
        <div
          style={{
            position: "absolute",
            left: 22,
            top: -4,
            zIndex: 50,
            width: 380,
            padding: "12px 14px",
            background: "var(--bg-3)",
            border: "1px solid var(--amber-dim)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            fontSize: 12,
            color: "var(--bone)",
            lineHeight: 1.55,
            fontFamily: "var(--mono)",
            textTransform: "none",
            letterSpacing: "0.01em",
            fontWeight: 400,
          }}
        >
          {title && (
            <div style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--amber)", marginBottom: 8 }}>
              {title}
            </div>
          )}
          {children}
        </div>
      )}
    </span>
  );
}
