export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * Kapcsoló felirattal és magyarázattal — a Beállítások alapeleme.
 * A teljes sor kattintható, nem csak a kapcsoló (mobilon ez sokat számít).
 */
export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="switch-row"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-row__text">
        <span className="switch-row__label">{label}</span>
        {description ? <span className="switch-row__desc">{description}</span> : null}
      </span>
      <span className="switch" aria-checked={checked} aria-hidden="true">
        <span className="switch__knob" />
      </span>
    </button>
  );
}
