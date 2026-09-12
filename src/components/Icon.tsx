/**
 * A GRUNDO ikonkészlete — flat, egyszínű rajzok, egy vonalvastagsággal.
 *
 * ⚠️ EMOJI HELYETT MINDIG EZ. Nem ízlés kérdése: az emoji minden platformon
 * máshogy néz ki (az Apple, a Google és a Windows kardja három külön kép),
 * színes, és nem tudjuk a szöveghez igazítani. Ez a készlet `currentColor`-ral
 * dolgozik, tehát a szülő adja a színét, és mindkét témában együtt mozog a
 * felirattal. Ugyanaz az elv, mint a `WeatherIcon`-nál.
 *
 * ÚJ IKON IDE KERÜLJÖN, ne külön fájlba szórva.
 */

export type IconName =
  /* Zsákmány-panel */
  | 'cells'
  | 'stolen'
  | 'area'
  | 'gp'
  /* Útvonaltervező */
  | 'pin'
  | 'locate';

export function Icon({ name, size = 28 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  /* MEZŐ — a játék hatszöge, ugyanaz az alak, ami a térképen is látszik. */
  if (name === 'cells') {
    return (
      <svg {...common}>
        <path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" />
      </svg>
    );
  }

  /* ELVETT MEZŐ — keresztezett kardok: itt nem foglalsz, hanem elveszel. */
  if (name === 'stolen') {
    return (
      <svg {...common}>
        <path d="M4 3.5 14.5 14" />
        <path d="M20 3.5 9.5 14" />
        <path d="m13 12.5 3 3" />
        <path d="m11 12.5-3 3" />
        <path d="M7.5 15.5 5 18l1.5 1.5L9 17z" />
        <path d="M16.5 15.5 19 18l-1.5 1.5L15 17z" />
      </svg>
    );
  }

  /* TERÜLET — hajtogatott térkép. */
  if (name === 'area') {
    return (
      <svg {...common}>
        <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z" />
        <path d="M9 4v13" />
        <path d="M15 6.5v13" />
      </svg>
    );
  }

  /* GP — korona: a pont a játék jutalma, nem mértékegység. */
  if (name === 'gp') {
    return (
      <svg {...common}>
        <path d="M3 7.5 6.5 14 12 5.5 17.5 14 21 7.5V18H3z" />
        <path d="M3 18h18" />
      </svg>
    );
  }

  /* KIJELÖLÉS A TÉRKÉPEN — térképtű. */
  if (name === 'pin') {
    return (
      <svg {...common}>
        <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
        <circle cx="12" cy="10" r="2.6" />
      </svg>
    );
  }

  /* JELENLEGI POZÍCIÓ — célkereszt, a térképek szokásos jele. */
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}
