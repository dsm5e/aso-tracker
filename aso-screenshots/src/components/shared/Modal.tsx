import type { ReactNode } from 'react';
import { useEffect } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
}

export function Modal({ open, onClose, children, width = 720, className = '' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={['panel', className].filter(Boolean).join(' ')}
        style={{
          width,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 48px)',
          boxShadow: 'var(--shadow-pop)',
          overflow: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
