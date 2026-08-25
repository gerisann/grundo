/**
 * A CELLASZÍN-PALETTA — a felhasználó választott területszíne.
 *
 * KÖZÖS kliens/szerver modul: a profil szerkesztője, a térkép és a Firestore-
 * szabály ugyanebből a listából dolgozik. Ha a paletta két helyen élne, egy új
 * szín felvétele némán érvénytelen értéket engedne be az adatbázisba.
 *
 * ⚠️ A KULCS AZ, AMI TÁROLÓDIK, nem a hexkód. Így a paletta finomhangolható
 * (árnyalat, kontraszt, téma) anélkül, hogy a felhasználók adatát migrálni
 * kellene — a `slate` marad `slate`, akkor is, ha holnap sötétebbre vesszük.
 *
 * A kulcs angol, a címke magyar: a kód nyelve angol, a felületé magyar.
 */

/** A 16 alapszín — mindenkinek jár. */
export const FREE_CELL_COLORS = {
  purple: { hex: '#7C3AED', label: 'Lila' },
  violet: { hex: '#A855F7', label: 'Ibolya' },
  indigo: { hex: '#4F46E5', label: 'Indigó' },
  blue: { hex: '#2563EB', label: 'Kék' },
  sky: { hex: '#0EA5E9', label: 'Égkék' },
  cyan: { hex: '#06B6D4', label: 'Cián' },
  teal: { hex: '#0D9488', label: 'Pávakék' },
  green: { hex: '#16A34A', label: 'Zöld' },
  lime: { hex: '#65A30D', label: 'Limezöld' },
  yellow: { hex: '#EAB308', label: 'Sárga' },
  amber: { hex: '#F59E0B', label: 'Borostyán' },
  orange: { hex: '#EA580C', label: 'Narancs' },
  red: { hex: '#DC2626', label: 'Piros' },
  rose: { hex: '#E11D48', label: 'Rózsa' },
  pink: { hex: '#DB2777', label: 'Rózsaszín' },
  slate: { hex: '#475569', label: 'Palaszürke' },
} as const;

/** A 8 prémium szín — csak Pro-előfizetéssel választható. */
export const PRO_CELL_COLORS = {
  'electric-purple': { hex: '#C026FF', label: 'Neonlila' },
  'electric-blue': { hex: '#00A3FF', label: 'Neonkék' },
  aqua: { hex: '#00E5C3', label: 'Akvamarin' },
  'acid-green': { hex: '#76E600', label: 'Méregzöld' },
  gold: { hex: '#FFB800', label: 'Arany' },
  coral: { hex: '#FF5A5F', label: 'Korall' },
  'hot-pink': { hex: '#FF2D95', label: 'Neonpink' },
  ice: { hex: '#8BE9FD', label: 'Jég' },
} as const;

export type FreeCellColor = keyof typeof FREE_CELL_COLORS;
export type ProCellColor = keyof typeof PRO_CELL_COLORS;
export type CellColor = FreeCellColor | ProCellColor;

export const CELL_COLORS = { ...FREE_CELL_COLORS, ...PRO_CELL_COLORS } as const;

export const FREE_CELL_COLOR_KEYS = Object.keys(FREE_CELL_COLORS) as FreeCellColor[];
export const PRO_CELL_COLOR_KEYS = Object.keys(PRO_CELL_COLORS) as ProCellColor[];

/**
 * Az alapértelmezett szín.
 *
 * SZÁNDÉKOSAN a `purple`: a hexkódja (#7C3AED) pontosan megegyezik a korábbi
 * `--territory-own` tokennel, tehát aki nem választ színt, annak a térképe
 * ugyanúgy néz ki, mint a funkció bevezetése előtt.
 */
export const DEFAULT_CELL_COLOR: FreeCellColor = 'purple';

/**
 * ⚠️ `Object.hasOwn`, NEM az `in` operátor.
 *
 * Az `in` a PROTOTÍPUS-LÁNCOT is nézi, tehát a `'toString'` és a
 * `'constructor'` érvényes színnek számítana. A feloldás ilyenkor egy
 * függvényt adna vissza, aminek nincs `hex` mezője — a térképen `undefined`
 * színnel próbálnánk rajzolni. A teszt ezt el is kapta.
 */
export function isCellColor(value: unknown): value is CellColor {
  return typeof value === 'string' && Object.hasOwn(CELL_COLORS, value);
}

export function isProCellColor(value: unknown): value is ProCellColor {
  return typeof value === 'string' && Object.hasOwn(PRO_CELL_COLORS, value);
}

/**
 * A tárolt érték feloldása hexkóddá.
 *
 * Védekező: hiányzó, ismeretlen vagy sérült érték esetén az alapértelmezett
 * színt adja. Egy elgépelt kulcs miatt ne tűnjön el valakinek a területe a
 * térképről — a rossz szín is jobb, mint a láthatatlan birtok.
 */
export function cellColorHex(value: unknown): string {
  return isCellColor(value) ? CELL_COLORS[value].hex : CELL_COLORS[DEFAULT_CELL_COLOR].hex;
}

/** A választható színek egy adott előfizetési szinten. */
export function availableCellColors(isPro: boolean): CellColor[] {
  return isPro ? [...FREE_CELL_COLOR_KEYS, ...PRO_CELL_COLOR_KEYS] : [...FREE_CELL_COLOR_KEYS];
}
