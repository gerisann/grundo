/**
 * Cellahalmazok ÖSSZEVONÁSA egybefüggő területpoligonokká.
 *
 * MIÉRT KELL? Mert a térkép eddig cellánként egy poligont rajzolt. Egy közepes
 * birtok is több ezer feature, és ennek két ára van:
 *
 *   1. A Mapbox a GeoJSON-forrást vektorcsempékre bontja, és a csempénkénti
 *      méretkorlát fölött CSENDBEN eldob feature-öket — kizoomolva több cella
 *      esik egy csempébe, ezért ott „foltokban" hiányzik a terület, bezoomolva
 *      viszont visszatér. Pontosan ezt a jelenséget jelezte a felhasználó.
 *   2. Távolról a cellahatárok úgyis összefolynak: több ezer hatszög kirajzolása
 *      olyan részletért fizet, amit senki nem lát.
 *
 * Az összevonás után egy egybefüggő birtokból EGY feature lesz, a lyukakkal
 * együtt (a H3 a belső gyűrűket is visszaadja).
 *
 * ⚠️ EZ KIZÁRÓLAG MEGJELENÍTÉS. A területszámítás továbbra is cellahalmazokon
 * megy — lásd `AGENTS.md`, 1. és 3. szabály: a hexagonrács a modell, a poligon
 * csak a kép róla. Ebből a modulból SOHA ne kerüljön vissza érték a
 * pontszámításba vagy a birtoklási döntésbe.
 */

import { cellsToMultiPolygon } from 'h3-js';
import type { CellId } from '@/types';

/** GeoJSON MultiPolygon koordináta-tömb: [poligon][gyűrű][pont][lng, lat]. */
export type MultiPolygonCoordinates = [number, number][][][];

/**
 * Egybefüggő területek egy cellahalmazból.
 *
 * A `true` második paraméter GeoJSON-sorrendű koordinátákat kér ([lng, lat]).
 * Enélkül a rács a Föld túloldalára kerülne — ugyanaz a csapda, mint a
 * `cellToBoundary`-nál.
 *
 * A hibát elnyeljük és üres tömböt adunk: egyetlen rossz cellaazonosító miatt
 * ne tűnjön el az egész térképréteg. A hívó ilyenkor egyszerűen nem rajzol.
 */
export function cellsToAreaPolygons(cells: readonly CellId[]): MultiPolygonCoordinates {
  if (cells.length === 0) return [];
  try {
    return cellsToMultiPolygon(cells as string[], true) as MultiPolygonCoordinates;
  } catch {
    return [];
  }
}

/**
 * Cellák csoportosítása megjelenítési kulcs szerint.
 *
 * Az összevonás csak AZONOS kinézetű cellákon végezhető el: két különböző
 * védelmi szintű mező nem olvadhat egyetlen poligonba, mert más az
 * átlátszóságuk. A kulcs ezért a szerep és a szint párja.
 */
export function groupCellsByKey<T extends string>(
  entries: Iterable<{ cell: CellId; key: T }>,
): Map<T, CellId[]> {
  const groups = new Map<T, CellId[]>();
  for (const { cell, key } of entries) {
    const existing = groups.get(key);
    if (existing) existing.push(cell);
    else groups.set(key, [cell]);
  }
  return groups;
}
