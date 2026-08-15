import type { ReactNode } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Kötelező: a csoport neve képernyőolvasónak. */
  label: string;
  size?: 'sm' | 'md';
  /** A teljes szélességet kitölti, egyenlő szélességű elemekkel. */
  block?: boolean;
}

/**
 * Az app leggyakoribb vezérlője: FUTÁS/SÉTA/BRINGA, 50/100/200 m,
 * Globális/Lokális, gyalogos ⇄ kerékpáros réteg-váltó, témamódok.
 *
 * Rádiócsoportként viselkedik: nyilakkal léptethető, és mindig pontosan
 * egy elem aktív.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  block = false,
}: SegmentedControlProps<T>) {
  function move(delta: number) {
    const index = options.findIndex((o) => o.value === value);
    if (index < 0) return;
    const next = options[(index + delta + options.length) % options.length];
    if (next) onChange(next.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={['seg', size === 'sm' ? 'seg--sm' : '', block ? 'seg--block' : '']
        .filter(Boolean)
        .join(' ')}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="seg__item"
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
