/**
 * Az aktivitás elfoglalt celláinak KIBONTÁSA a megjelenítéshez.
 *
 * MIÉRT KELL EZ? Mert a szerver egy nagy hurok belsejét nem res12 cellánként
 * küldi el, hanem tömören: a `activityCells` a falat és a pontos határsávot
 * tartalmazza, a `activityCellParents` pedig a hurok BELSEJÉT, H3-compactolt
 * (vegyes, ≤ res10) indexekkel.
 *
 * ⚠️ ÉLES HIBA JAVÍTÁSA (2026-08-29). Amíg a kliens csak az `activityCells`-t
 * rajzolta, a nagy hurkok közepe üresen maradt: egy háromhurkos aktivitásnál
 * a 15 745 foglalt cellából 9 163 (58 %) hiányzott, és a „nyolcas" alsó fele
 * kitöltetlen volt. Ugyanaz a 9 163 cella tömören MINDÖSSZE 85 index (~1 kB) —
 * ezért érkezik így, és ezért kell itt kibontani.
 */

import { cellToChildren, getResolution } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';

/**
 * Felső korlát a KIRAJZOLT cellákra.
 *
 * Nem adatvédelem és nem játékszabály: a térkép ennél több hatszöget úgysem
 * tud értelmesen megjeleníteni, egy elszabadult geometria viszont enélkül
 * megfagyasztaná a böngészőt. A hurok belseje 40 000 cella fölött kerül a
 * compact ágra, tehát a tipikus eset bőven elfér.
 */
const MAX_RENDERED_CELLS = 120_000;

export function expandActivityCells(
  cells: readonly string[] | undefined,
  parents: readonly string[] | undefined,
): string[] {
  const out = new Set<string>(cells ?? []);
  for (const parent of parents ?? []) {
    if (out.size >= MAX_RENDERED_CELLS) break;
    // A már res12 index önmagát adja vissza — nem kell külön ágat írni rá.
    if (getResolution(parent) >= GAMEPLAY.H3_RESOLUTION) {
      out.add(parent);
      continue;
    }
    for (const child of cellToChildren(parent, GAMEPLAY.H3_RESOLUTION)) {
      out.add(child);
      if (out.size >= MAX_RENDERED_CELLS) break;
    }
  }
  return [...out];
}
