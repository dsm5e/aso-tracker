import { useId, useState, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  title?: string;
}

export default function InfoTooltip({ children, title }: Props) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  return (
    <span className="info-tooltip">
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
        <div id={tooltipId} role="tooltip" className="ds-pop info-tooltip-pop">
          {title && <div className="info-tooltip-title">{title}</div>}
          {children}
        </div>
      )}
    </span>
  );
}
