import { useMemo, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';
import { useDismiss } from './useDismiss';
import './Picker.css';

export type PickerOption = {
  value: string;
  label: string;
  /** Leading visual (icon, flag) shown in the row and, for the active value, in the button. */
  lead?: ReactNode;
  /** Muted trailing text (e.g. a storefront code). Also matched by search. */
  hint?: string;
};

/** A 40px button with label + chevron that opens a `ds-pop` list (admin `ms-btn` / `ms-pop`). */
export default function Picker({
  value,
  options,
  onChange,
  label,
  searchPlaceholder = 'Поиск',
  searchFrom = 8,
  className,
  align = 'start',
}: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  /** Accessible name of the control. */
  label: string;
  searchPlaceholder?: string;
  /** Show the search field when there are at least this many options. */
  searchFrom?: number;
  className?: string;
  /** Which edge of the button the popover lines up with. */
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setQuery(''); };
  useDismiss(rootRef, open, close);

  const active = options.find((option) => option.value === value);
  const searchable = options.length >= searchFrom;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      option.label.toLocaleLowerCase().includes(needle) || option.hint?.toLocaleLowerCase().includes(needle)
    );
  }, [options, query]);

  const pick = (next: string) => {
    onChange(next);
    close();
  };

  return (
    <div className={`picker ${className ?? ''}`} ref={rootRef}>
      <button
        type="button"
        className="picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${active?.label ?? ''}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {active?.lead}
        <span className="picker-value">{active?.label ?? '—'}</span>
        <Icon name="chevronDown" className="picker-caret" />
      </button>
      {open && (
        <div className={`ds-pop picker-pop ${align === 'end' ? 'picker-pop-end' : ''}`}>
          {searchable && (
            <label className="picker-search">
              <Icon name="search" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && filtered[0]) pick(filtered[0].value); }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </label>
          )}
          <div className="picker-list" role="listbox" aria-label={label}>
            {filtered.map((option) => (
              <button
                type="button"
                role="option"
                key={option.value}
                aria-selected={option.value === value}
                className="ds-pop-row"
                onClick={() => pick(option.value)}
              >
                {option.lead}
                <span className="picker-row-label">{option.label}</span>
                {option.hint && <small>{option.hint}</small>}
                {option.value === value && <Icon name="check" className="picker-check" />}
              </button>
            ))}
            {filtered.length === 0 && <div className="picker-empty">Ничего не найдено</div>}
          </div>
        </div>
      )}
    </div>
  );
}
