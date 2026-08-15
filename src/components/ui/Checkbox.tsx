import type { ReactNode } from 'react';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  error?: string;
}

/** Jelölőnégyzet — az ÁSZF-elfogadáshoz és hasonlókhoz. */
export function Checkbox({ checked, onChange, children, error }: CheckboxProps) {
  return (
    <div>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        className="check"
        onClick={() => onChange(!checked)}
      >
        <span className="check__box" aria-hidden="true">
          {checked ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12 5 5L19 7" />
            </svg>
          ) : null}
        </span>
        <span className="check__text">{children}</span>
      </button>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
