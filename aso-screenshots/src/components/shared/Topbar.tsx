import type { ReactNode } from 'react';

export interface TopbarProps {
  brand: ReactNode;
  steps?: ReactNode;
  actions?: ReactNode;
}

export function Topbar({ brand, steps, actions }: TopbarProps) {
  return (
    <div className="topbar">
      <div className="topbar-brand">{brand}</div>
      <div className="topbar-steps">{steps}</div>
      <div className="topbar-actions">{actions}</div>
    </div>
  );
}
