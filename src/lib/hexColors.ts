/**
 * A hexagon-szerepek színe — a térkép és a jelmagyarázat KÖZÖS forrása.
 *
 * Külön fájlban, mert a `MapView` behúzza a mapbox-gl-t (521 kB), a
 * jelmagyarázatnak viszont csak a színek kellenek. Ha onnan importálná, a
 * Terület képernyő lusta betöltése értelmét vesztené.
 *
 * A két helyen külön definiált szín korábban el is tért: a térkép borostyánnal
 * rajzolta a saját, 1-es szintű területet, a jelmagyarázat halványlilával.
 */

import type { HexRole } from '@/components/HexMap';

/** CSS-tokenek, hogy a Mapbox és a DOM-jelmagyarázat ugyanazt a két témás
 * palettát használja. A MapView a tényleges értéket kirajzoláskor oldja fel. */
export const ROLE_COLOR: Record<HexRole, string> = {
  /** Rögzítés közbeni nyom. */
  trail: 'var(--trail-pending)',
  /** A tiéd, védve (2-es szint vagy fölötte). */
  interior: 'var(--territory-own)',
  /** A tiéd, 1-es szinten — ma egyetlen bezárással elvehető. */
  stolen: 'var(--territory-own)',
  /** Másé. */
  rival: 'var(--territory-rival)',
  /** Szabad. */
  free: 'var(--territory-neutral)',
};

export const RIVAL_MAX_COLOR = 'var(--territory-rival-max)';

/**
 * Szerepenkénti kitöltés-átlátszóság.
 *
 * Nem elég a színárnyalat: 18%-os egységes átlátszóságnál a két saját szín
 * gyakorlatilag megkülönböztethetetlen volt egymástól a térképen — a
 * felhasználó jogosan írta, hogy „csupa egyforma lila mezőt látok".
 *
 * A védett terület sűrűbb és sötétebb, az egyszintű halvány: így a különbség
 * akkor is látszik, ha valaki nem tudja fejből a színkódokat.
 */
export const ROLE_FILL_OPACITY: Record<HexRole, number> = {
  trail: 0.2,
  interior: 0.42,
  stolen: 0.14,
  rival: 0.24,
  free: 0.006,
};

/**
 * A szabad rács csak tájékozódási segéd: a térképnek kell dominálnia mögötte.
 * A foglalt/aktív cellák erősek maradnak, csak a teljes háttérhálót halkítjuk.
 */
export const ROLE_LINE_OPACITY: Record<HexRole, number> = {
  trail: 0.85,
  interior: 0.82,
  stolen: 0.68,
  rival: 0.82,
  free: 0.14,
};
