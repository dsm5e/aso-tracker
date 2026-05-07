import type { ReactNode } from 'react';

type Variant = 'default' | 'ai' | 'success' | 'warn';

export interface PillProps {
  variant?: Variant;
  withDot?: boolean;
  children: ReactNode;
  className?: string;
}

const variantClass: Record<Variant, string> = {
  default: '',
  ai: 'pill--ai',
  success: 'pill--success',
  warn: 'pill--warn',
};

export function Pill({ variant = 'default', withDot, children, className = '' }: PillProps) {
  return (
    <span className={['pill', variantClass[variant], className].filter(Boolean).join(' ')}>
      {withDot && <span className="dot" />}
      {children}
    </span>
  );
}
