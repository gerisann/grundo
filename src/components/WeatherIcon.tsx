import type { WeatherCondition } from '@/lib/api';

/**
 * Időjárás-ikonok — hét állapot, mindegyik nappali és éjszakai változatban.
 *
 * MIÉRT SAJÁT RAJZ, és miért nem emoji? Mert az emoji minden platformon
 * máshogy néz ki (az Apple, a Google és a Windows napja három külön rajz), és
 * a méretét sem tudjuk a szöveghez igazítani. Ez a készlet `currentColor`-ral
 * dolgozik, tehát mindkét témában együtt mozog a felirattal.
 *
 * A KIEMELT ELEM viszont színes marad: a nap sárga, a hold halvány, a
 * villám borostyán — ezek adják a felismerhetőséget. A színek tokenből
 * jönnek (`--weather-*`), nem beégetve.
 */
export function WeatherIcon({
  condition,
  night,
  size = 22,
}: {
  condition: WeatherCondition;
  night: boolean;
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  /** A tiszta ég égiteste: nappal sugaras nap, éjjel hold és két csillag. */
  const luminary =
    night === false ? (
      <g className="wicon__sun">
        <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
        <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
      </g>
    ) : (
      <g className="wicon__moon">
        <path
          d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.3 8.3 0 1 0 20 14.5Z"
          fill="currentColor"
          stroke="none"
        />
        {/* A két csillag CSAK a tiszta éjszakában van jelen — ez különbözteti
            meg a „hold + felhő" állapottól, ahol a felhő takarna. */}
        <path d="M6 5.2 6.6 6.8 8.2 7.4 6.6 8 6 9.6 5.4 8 3.8 7.4 5.4 6.8Z" fill="currentColor" stroke="none" />
        <path d="M16.5 3.4 16.9 4.5 18 4.9 16.9 5.3 16.5 6.4 16.1 5.3 15 4.9 16.1 4.5Z" fill="currentColor" stroke="none" />
      </g>
    );

  /** A kisebb égitest a felhő mögött — a „részben felhős" jellegadója. */
  const peeking =
    night === false ? (
      <g className="wicon__sun">
        <circle cx="8.5" cy="7.5" r="3" fill="currentColor" stroke="none" />
        <path d="M8.5 1.8v1.5M2.8 7.5h1.5M4.3 3.3l1.1 1.1M12.7 3.3l-1.1 1.1" />
      </g>
    ) : (
      <path
        className="wicon__moon"
        d="M12.6 8.4A5 5 0 0 1 6.2 2a5.1 5.1 0 1 0 6.4 6.4Z"
        fill="currentColor"
        stroke="none"
      />
    );

  const cloud = <path d="M6.6 19h10.2a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-10-1.2 3.7 3.7 0 0 0-.5 8.4Z" />;

  switch (condition) {
    case 'clear':
      return <svg {...common}>{luminary}</svg>;

    case 'partly_cloudy':
      return (
        <svg {...common}>
          {peeking}
          {cloud}
        </svg>
      );

    case 'cloudy':
      return (
        <svg {...common}>
          {cloud}
          {/* Egy második, hátsó felhő — enélkül a borult ég ugyanaz a rajz
              lenne, mint a részben felhős, csak égitest nélkül. */}
          <path d="M9 8.6a4.4 4.4 0 0 1 7.4-.3" opacity="0.55" />
        </svg>
      );

    case 'rain':
      return (
        <svg {...common}>
          <path d="M6.6 16.4h10.2a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-10-1.2 3.7 3.7 0 0 0-.5 8.4Z" />
          <g className="wicon__rain">
            <path d="M8.6 19v2.4M12 19.2v2.6M15.4 19v2.4" />
          </g>
        </svg>
      );

    case 'snow':
      return (
        <svg {...common}>
          <path d="M6.6 16.4h10.2a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-10-1.2 3.7 3.7 0 0 0-.5 8.4Z" />
          <g className="wicon__snow">
            <path d="M8.6 19.4v1.8M7.7 19.9l1.8 1M9.5 19.9l-1.8 1" />
            <path d="M15.4 19.4v1.8M14.5 19.9l1.8 1M16.3 19.9l-1.8 1" />
          </g>
        </svg>
      );

    case 'storm':
      return (
        <svg {...common}>
          <path d="M6.6 15.4h10.2a3.6 3.6 0 0 0 .3-7.2 5.2 5.2 0 0 0-10-1.2 3.7 3.7 0 0 0-.5 8.4Z" />
          <path
            className="wicon__bolt"
            d="M12.8 16.2 10 20.2h2.4L11.4 23.4l3.4-4.4h-2.4Z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );

    case 'fog':
      return (
        <svg {...common}>
          <path d="M5.4 8.6h13.2M3.8 12.4h16.4M6 16.2h12M8.4 19.8h7.2" opacity="0.85" />
        </svg>
      );
  }
}
