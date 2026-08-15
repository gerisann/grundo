import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Üres állapot. A GRUNDO-ban ez nem melléktermék: az app első napjaiban a
 * felhasználó szinte csak üres állapotokat lát (nincs terület, nincs jelvény,
 * nincs kihívás), és ezek mondják meg neki, mit csináljon.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty">
      {icon ? (
        <span className="empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h2 className="empty__title">{title}</h2>
      {description ? <p className="empty__desc">{description}</p> : null}
      {action}
    </div>
  );
}
