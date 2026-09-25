import { useEffect, useId, useRef, useState } from "react";

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Single-select toolbar dropdown: a 40px ds-btn that opens a ds-pop list
 *  (same look as the admin dashboard's .ms-btn / .ms-pop). */
export default function Dropdown<T extends string | number>({ value, options, onChange, ariaLabel }: Props<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="dd" ref={rootRef}>
      <button
        type="button"
        className="dd-btn"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{current?.label ?? String(value)}</span>
        <svg className="dd-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="ds-pop dd-pop" role="listbox" id={listId} aria-label={ariaLabel}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="ds-pop-row"
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
