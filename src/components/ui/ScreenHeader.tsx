import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export interface ScreenHeaderProps {
  title: string;
  /** Ha megadod, ide navigál vissza; egyébként a böngésző-előzményben lép. */
  backTo?: string;
  /** Jobb oldali akció (pl. Mentés, ⋯ menü). */
  action?: ReactNode;
  className?: string;
}

export function ScreenHeader({ title, backTo, action, className }: ScreenHeaderProps) {
  const navigate = useNavigate();

  return (
    <header className={`screen-header${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="screen-header__back"
        aria-label="Vissza"
        onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m15 6-6 6 6 6" />
        </svg>
      </button>
      <h1 className="screen-header__title">{title}</h1>
      {action}
    </header>
  );
}
