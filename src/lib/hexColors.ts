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

export const ROLE_COLOR: Record<HexRole, string> = {
  /** Rögzítés közbeni nyom. */
  trail: '#8b5cf6',
  /** A tiéd, védve (2-es szint vagy fölötte). */
  interior: '#4c1d95',
  /** A tiéd, 1-es szinten — ma egyetlen bezárással elvehető. */
  stolen: '#c4b5fd',
  /** Másé. */
  rival: '#ef4444',
  /** Szabad. */
  free: '#94a3b8',
};

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
  free: 0.05,
};
