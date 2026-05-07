import type { ReactNode } from 'react';

export interface SegmentedItem<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  items,
  value,
  onChange,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div className={['seg', className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <button
          key={item.value}
          className={item.value === value ? 'active' : ''}
          onClick={() => !item.disabled && onChange(item.value)}
          type="button"
          disabled={item.disabled}
          style={item.disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          title={item.disabled ? 'Generate an AI render first to enable Enhanced view' : undefined}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
