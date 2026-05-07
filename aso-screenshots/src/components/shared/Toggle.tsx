export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      data-on={checked ? 'true' : 'false'}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
    >
      <i />
    </button>
  );
}
