import type { CSSProperties, ReactNode } from 'react';
import './optionSwitch.css';

/**
 * Csúszkás választó — a Grund képernyő réteg-váltójának formája, általánosan.
 *
 * Miért nem `SegmentedControl`? Mert ott minden elem külön gomb-doboz, és
 * kettőnél az „egyik VAGY másik" viszony nem látszik. Itt egyetlen pirulán
 * fut a csúszka: egy pillantásra kiderül, melyik oldalon állsz.
 *
 * ⚠️ KETTŐ VAGY HÁROM elemre való. Négytől a feliratok mobilon már törnek —
 * ott a `SegmentedControl` a helyes választás.
 *
 * A `LayerSwitch` szándékosan külön maradt: az `role="switch"`, mert két
 * egymást kizáró RÉTEG között billen, nem egy listából választ.
 */

export interface OptionSwitchItem<T extends string> {
  value: T;
  label: string;
  /** Elhagyható vezérikon a felirat előtt. */
  icon?: ReactNode;
}

export interface OptionSwitchProps<T extends string> {
  options: readonly OptionSwitchItem<T>[];
  /** `null`: nincs kiválasztott elem — a csúszka ilyenkor nem látszik. */
  value: T | null;
  onChange: (value: T) => void;
  /** Kötelező: a csoport neve képernyőolvasónak. */
  label: string;
}

export function OptionSwitch<T extends string>({
  options,
  value,
  onChange,
  label,
}: OptionSwitchProps<T>) {
  const index = options.findIndex((option) => option.value === value);
  const active = index < 0 ? 0 : index;

  function move(delta: number) {
    const next = options[(active + delta + options.length) % options.length];
    if (next) onChange(next.value);
  }

  /*
    A kiválasztott érték a gyökér `data-value`-jában is ott van: erre
    horgonyozhat a hívó, ha a csúszka színét állásonként cserélné — lásd
    `--optsw-thumb` és a rögzítés képernyő mozgásforma-színeit.
  */
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`optsw${index < 0 ? ' optsw--unset' : ''}`}
      data-value={value ?? undefined}
      style={
        {
          '--optsw-count': options.length,
          '--optsw-active': active,
        } as CSSProperties
      }
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
      {/* A csúszka a feliratok ALATT fut, ezért egyik állásban sem takar. */}
      <span className="optsw__thumb" aria-hidden="true" />
      {options.map((option, position) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (index < 0 && position === 0) ? 0 : -1}
            className={`optsw__option${checked ? ' optsw__option--on' : ''}`}
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
