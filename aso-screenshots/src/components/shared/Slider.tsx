import type { InputHTMLAttributes } from 'react';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, className = '', ...rest }: SliderProps) {
  return (
    <input
      type="range"
      className={['slider', className].filter(Boolean).join(' ')}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      {...rest}
    />
  );
}
