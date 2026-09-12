/**
 * A zsákmány-panel ikonjai — négy rajz, egy vonalvastagsággal.
 *
 * MIÉRT SAJÁT RAJZ, és miért nem emoji? Ugyanaz az ok, mint a
 * `WeatherIcon`-nál: az emoji minden platformon máshogy néz ki (az Apple, a
 * Google és a Windows kardja három külön kép), színes, és nem tudjuk a
 * szöveghez igazítani. Ez a készlet `currentColor`-ral dolgozik, tehát
 * EGYSZÍNŰ, és mindkét témában együtt mozog a felirattal.
 */

export type RewardIconName = 'cells' | 'stolen' | 'area' | 'gp';

export function RewardIcon({ name, size = 28 }: { name: RewardIconName; size?: number }) {
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
  return (
    <svg {...common}>
      <path d="M3 7.5 6.5 14 12 5.5 17.5 14 21 7.5V18H3z" />
      <path d="M3 18h18" />
    </svg>
  );
}
