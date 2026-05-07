import type { InputHTMLAttributes, ReactNode } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  rightSlot?: ReactNode;
}

export function Input({ label, hint, rightSlot, className = '', ...rest }: InputProps) {
  const inputClasses = ['input', className].filter(Boolean).join(' ');
  if (!label && !hint && !rightSlot) {
    return <input className={inputClasses} {...rest} />;
  }
  return (
    <div className="field">
      {label !== undefined && (
        <label className="field-label">
          {label}
          {rightSlot}
        </label>
      )}
      <input className={inputClasses} {...rest} />
      {hint !== undefined && <span className="field-hint">{hint}</span>}
    </div>
  );
}
