import type { ReactNode } from 'react';

export interface ListRowProps {
  label: string;
  description?: string;
  /** Jobb oldali érték, pl. „95 kg" vagy „Automatikus". */
  value?: ReactNode;
  onClick?: () => void;
  /** Jobbra mutató nyíl — akkor is látszik, ha nincs érték. */
  chevron?: boolean;
  disabled?: boolean;
}

/** Beállítás-sor. Kattinthatóként gomb, egyébként sima sor. */
export function ListRow({ label, description, value, onClick, chevron, disabled }: ListRowProps) {
  const content = (
    <>
      <span className="row__text">
        <span className="row__label">{label}</span>
        {description ? <span className="row__desc">{description}</span> : null}
      </span>
      {value ? <span className="row__value">{value}</span> : null}
      {chevron || onClick ? (
        <svg
          className="row__chevron"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      ) : null}
    </>
  );

  if (!onClick) return <div className="row">{content}</div>;

  return (
    <button type="button" className="row" onClick={onClick} disabled={disabled}>
      {content}
    </button>
  );
}

/** Sorok csoportja kártyaként. */
export function List({ children }: { children: ReactNode }) {
  return <div className="list">{children}</div>;
}
