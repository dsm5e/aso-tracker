import { useId, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  title?: string;
}

export default function InfoTooltip({ children, title }: Props) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-label={title ? `Пояснение: ${title}` : "Пояснение к метрике"}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
      >?</button>
      {open && (
        <div
          id={tooltipId}
          role="tooltip"
          style={{
            position: "absolute",
            left: 22,
            top: -4,
            zIndex: 50,
            width: 380,
            padding: "12px 14px",
            background: "var(--bg-3)",
            border: "1px solid var(--line)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.24)",
            fontSize: 12,
            color: "var(--bone)",
            lineHeight: 1.55,
            fontFamily: "var(--sans)",
            textTransform: "none",
            letterSpacing: "0.01em",
            fontWeight: 400,
          }}
        >
          {title && (
              <div style={{ fontSize: 12, fontWeight: 650, color: "var(--amber)", marginBottom: 8 }}>
              {title}
            </div>
          )}
          {children}
        </div>
      )}
    </span>
  );
}
