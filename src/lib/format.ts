/**
 * Megjelenítési formázók. A területet SEHOL ne formázd kézzel — mindig
 * a `formatArea()`-t hívd, különben szétcsúszik a mértékegység-logika.
 *
 * docs/03-jatekszabalyok.md → A terület megjelenítése
 */

const hu = (opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat('hu-HU', opts);

/** 1 000 000 m² fölött váltunk km²-re. */

/**
 * Terület MINDIG km²-ben, három tizedesjeggyel.
 *   0,001 km²  ·  0,072 km²  ·  1,845 km²  ·  55,830 km²
 *
 * Miért nem m²? Mert a valós számok gyorsan hatjegyűek lesznek („143 104 m²"),
 * és egy hatjegyű szám nem mond semmit — nincs mihez viszonyítani. A km² a
 * térképen is értelmezhető nagyságrend.
 *
 * AMIT EZ ÁLDOZ: három tizedesjegy km²-ben ezer négyzetméteres felbontás, egy
 * hexagon viszont 307 m². Néhány mezőnyi terület ezért „0,000 km²"-ként
 * jelenik meg. Ez tudatos csere: a kezdő felhasználó pár mezője úgyis
 * jelentéktelen, a nagyságrend viszont az első pillanattól olvasható.
 */
export function formatArea(m2: number): string {
  return `${hu({ minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(m2 / 1_000_000)} km²`;
}

/** Előjeles területváltozás: `+0,840 km²` / `−0,021 km²` */
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
