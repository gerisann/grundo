import type { ReactNode } from 'react';

export type ChipVariant = 'default' | 'accent' | 'gold' | 'territory' | 'success';

export interface ChipProps {
  variant?: ChipVariant;
  icon?: ReactNode;
  children: ReactNode;
}

/** Kompakt jelölő: terület, GP, szint, PR, PRO jelvény. */
export function Chip({ variant = 'default', icon, children }: ChipProps) {
  return (
    <span className={['chip', variant === 'default' ? '' : `chip--${variant}`].filter(Boolean).join(' ')}>
      {icon}
      {children}
    </span>
  );
}
