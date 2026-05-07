import type { ReactNode } from 'react';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}

export function Tabs<T extends string = string>({ items, value, onChange, className = '' }: TabsProps<T>) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--line-1)',
      }}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            style={{
              appearance: 'none',
              border: 0,
              background: 'transparent',
              height: 32,
              padding: '0 12px',
              fontSize: 12,
              fontWeight: 500,
              color: active ? 'var(--fg-0)' : 'var(--fg-2)',
              cursor: 'pointer',
              borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
              transition: 'color .12s, border-color .12s',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
