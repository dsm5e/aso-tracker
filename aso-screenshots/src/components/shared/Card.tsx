import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return <div className={['panel', className].filter(Boolean).join(' ')}>{children}</div>;
}

export interface CardSectionProps {
  title?: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
  className?: string;
}

function CardSection({ title, rightSlot, children, className = '' }: CardSectionProps) {
  return (
    <div className={['panel-section', className].filter(Boolean).join(' ')}>
      {(title !== undefined || rightSlot !== undefined) && (
        <h4 className="panel-section-title">
          {title}
          {rightSlot}
        </h4>
      )}
      {children}
    </div>
  );
}

Card.Section = CardSection;
