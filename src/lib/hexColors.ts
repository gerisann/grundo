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
  interior: '#7c3aed',
  /** A tiéd, 1-es szinten — ma egyetlen bezárással elvehető. */
  stolen: '#a78bfa',
  /** Másé. */
  rival: '#ef4444',
  /** Szabad. */
  free: '#94a3b8',
};
