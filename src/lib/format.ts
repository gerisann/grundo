/**
 * Megjelenítési formázók. A területet SEHOL ne formázd kézzel — mindig
 * a `formatArea()`-t hívd, különben szétcsúszik a mértékegység-logika.
 *
 * docs/03-jatekszabalyok.md → A terület megjelenítése
 */

const hu = (opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat('hu-HU', opts);

/** 1 000 000 m² fölött váltunk km²-re. */
export const AREA_KM2_THRESHOLD_M2 = 1_000_000;

/**
 * Terület m²-ben, 1 km² fölött km²-ben.
 *   9 421 m²  ·  184 500 m²  ·  1,84 km²  ·  55,83 km²
 *
 * @param forceUnit listákhoz: egy ranglistán belül mindig egységes legyen a
 *        mértékegység, ezért ott a legnagyobb elem alapján kell rögzíteni.
 */
export function formatArea(m2: number, forceUnit?: 'm2' | 'km2'): string {
  const unit = forceUnit ?? (m2 >= AREA_KM2_THRESHOLD_M2 ? 'km2' : 'm2');
  if (unit === 'km2') {
    return `${hu({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(m2 / 1_000_000)} km²`;
  }
  return `${hu({ maximumFractionDigits: 0 }).format(m2)} m²`;
}

/** Egy lista egységes mértékegysége a legnagyobb elem alapján. */
export function areaUnitFor(values: readonly number[]): 'm2' | 'km2' {
  return Math.max(0, ...values) >= AREA_KM2_THRESHOLD_M2 ? 'km2' : 'm2';
}

/** Előjeles területváltozás: `+840 000 m²` / `−21 400 m²` */
export function formatAreaDelta(m2: number): string {
  const sign = m2 > 0 ? '+' : m2 < 0 ? '−' : '';
  return `${sign}${formatArea(Math.abs(m2))}`;
}

export function formatGp(gp: number): string {
  return `${hu({ maximumFractionDigits: 0 }).format(gp)} GP`;
}

export function formatDistance(meters: number, unit: 'km' | 'mi' = 'km'): string {
  if (unit === 'mi') {
    return `${hu({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(meters / 1609.344)} mi`;
  }
  return `${hu({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(meters / 1000)} km`;
}

/** Tempó másodperc/km-ből: `7:40` */
export function formatPace(secondsPerKm: number): string {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '--:--';
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Időtartam: `52:24` vagy `1:04:18` */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, '0')}`
    : `${mm}:${String(s).padStart(2, '0')}`;
}

export function formatElevation(meters: number): string {
  const sign = meters > 0 ? '+' : '';
  return `${sign}${hu({ maximumFractionDigits: 0 }).format(meters)} m`;
}

/** `1×` … `5×` */
export function formatDefense(level: number): string {
  return `${level}×`;
}
