/**
 * A CELLASZÍN-PALETTA — a felhasználó választott területszíne.
 *
 * KÖZÖS kliens/szerver modul: a profil szerkesztője, a térkép és a Firestore-
 * szabály ugyanebből a listából dolgozik. A KULCS tárolódik, nem a hexkód,
 * ezért a paletta árnyalatai adatmigráció nélkül finomhangolhatók.
 *
 * A kulcsok kompatibilitási okból maradnak stabilak. A látható színt és a
 * magyar címkét az itt lévő paletta határozza meg.
 */

/** A 16 alapszín — mindenkinek jár. A sorrend a hexagonpaletta sorrendje. */
export const FREE_CELL_COLORS = {
  purple: { hex: '#DDC3A1', label: 'Bézs' },
  violet: { hex: '#E1A344', label: 'Aranybarna' },
  indigo: { hex: '#D1712F', label: 'Réznarancs' },
  blue: { hex: '#BD505C', label: 'Málnapiros' },
  sky: { hex: '#E06E70', label: 'Korallrózsaszín' },
  cyan: { hex: '#CB5043', label: 'Téglapiros' },
  teal: { hex: '#8F3A40', label: 'Bordó' },
  green: { hex: '#76462D', label: 'Dióbarna' },
  lime: { hex: '#566F49', label: 'Olívazöld' },
  yellow: { hex: '#418D7A', label: 'Türkizzöld' },
  amber: { hex: '#315F89', label: 'Acélkék' },
  orange: { hex: '#5B4A69', label: 'Szilvalila' },
  red: { hex: '#2D5653', label: 'Petrol' },
  rose: { hex: '#709EAA', label: 'Palakék' },
  pink: { hex: '#7F7F7F', label: 'Szürke' },
  slate: { hex: '#2E2E2E', label: 'Antracit' },
} as const;

/** A 12 prémium szín — csak Pro-előfizetéssel választható. */
export const PRO_CELL_COLORS = {
  'electric-blue': { hex: '#2879FD', label: 'Elektromos kék' },
  aqua: { hex: '#00E4FE', label: 'Neoncián' },
  ice: { hex: '#01FEA9', label: 'Neonmenta' },
  coral: { hex: '#FF6000', label: 'Neonnarancs' },
  gold: { hex: '#FFD502', label: 'Neon arany' },
  'acid-green': { hex: '#E3FF00', label: 'Savzöld' },
  'neon-green': { hex: '#01FF1F', label: 'Neonzöld' },
  'neon-red': { hex: '#FD012F', label: 'Neonpiros' },
  'hot-pink': { hex: '#FF00A8', label: 'Neonpink' },
  'deep-green': { hex: '#027501', label: 'Mélyzöld' },
  'deep-indigo': { hex: '#0D034D', label: 'Mély indigó' },
  'electric-purple': { hex: '#7C00FF', label: 'Neonlila' },
} as const;

export type FreeCellColor = keyof typeof FREE_CELL_COLORS;
export type ProCellColor = keyof typeof PRO_CELL_COLORS;
export type CellColor = FreeCellColor | ProCellColor;

export const CELL_COLORS = { ...FREE_CELL_COLORS, ...PRO_CELL_COLORS } as const;

export const FREE_CELL_COLOR_KEYS = Object.keys(FREE_CELL_COLORS) as FreeCellColor[];
export const PRO_CELL_COLOR_KEYS = Object.keys(PRO_CELL_COLORS) as ProCellColor[];

/** Az alapértelmezett szín a normál paletta legfelső cellája. */
export const DEFAULT_CELL_COLOR: FreeCellColor = 'purple';

/**
 * ⚠️ `Object.hasOwn`, NEM az `in` operátor.
 *
 * Az `in` a prototípus-láncot is nézi, ezért például a `toString` tévesen
 * érvényes színnek számítana.
 */
export function isCellColor(value: unknown): value is CellColor {
  return typeof value === 'string' && Object.hasOwn(CELL_COLORS, value);
}

export function isProCellColor(value: unknown): value is ProCellColor {
  return typeof value === 'string' && Object.hasOwn(PRO_CELL_COLORS, value);
}

/** Ismeretlen vagy hiányzó értéknél az alapértelmezett színre esik vissza. */
export function cellColorHex(value: unknown): string {
  return isCellColor(value) ? CELL_COLORS[value].hex : CELL_COLORS[DEFAULT_CELL_COLOR].hex;
}

/** A választható színek egy adott előfizetési szinten. */
export function availableCellColors(isPro: boolean): CellColor[] {
  return isPro ? [...FREE_CELL_COLOR_KEYS, ...PRO_CELL_COLOR_KEYS] : [...FREE_CELL_COLOR_KEYS];
}
