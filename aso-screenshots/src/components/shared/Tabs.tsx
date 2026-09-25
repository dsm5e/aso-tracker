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
  // Tabs share the segmented-control look (DESIGN.md: active = accent-soft + accent 600).
  return (
    <div className={['seg', className].filter(Boolean).join(' ')} role="tablist">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'active' : ''}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
