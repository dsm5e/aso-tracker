import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'ghost' | 'ai' | 'danger';
type Size = 'default' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClass: Record<Variant, string> = {
  default: '',
  primary: 'btn--primary',
  ghost: 'btn--ghost',
  ai: 'btn--ai',
  danger: 'btn--danger',
};

const sizeClass: Record<Size, string> = {
  default: '',
  lg: 'btn--lg',
  icon: 'btn--icon',
};

export function Button({
  variant = 'default',
  size = 'default',
  leftIcon,
  rightIcon,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const classes = ['btn', variantClass[variant], sizeClass[size], className].filter(Boolean).join(' ');
  return (
    <button className={classes} {...rest}>
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
