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

import { cellToChildren, cellToParent, getResolution } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';

/**
 * Felső korlát a KIRAJZOLT cellákra.
 *
 * ⚠️ ÉLES HIBA JAVÍTÁSA (2026-09-05) — ÉS A KORLÁT ÉRTELME IS MEGVÁLTOZOTT.
 *
 * A régi kód a plafon fölött egyszerűen ABBAHAGYTA a kibontást. Jamal
 * 2026-09-04-i, 159 km-es köre ezt élesben mutatta meg: a valódi 148 717
 * cellából 120 000 került a térképre, **28 717 (19 %) néma csonkolással
 * eltűnt**. Rosszabb: a `Set` beszúrási sorrendje szerint esett ki, ami
 * mértanilag önkényes — a folt közepén nyíltak egyenes szélű lyukak. A
 * felhasználó ebből annyit lát, hogy a térkép hazudik.
 *
 * MÉRÉS, ami eldöntötte a javítás irányát (2026-09-05, ugyanez az aktivitás,
 * asztali gép, a `hexAreas.cellsToAreaPolygons` láncán):
 *
 *   - teljes kibontás res12-re: 148 713 cella, **155 ms**;
 *   - a poligonná olvasztás: **1 707 ms**.
 *
 * Vagyis a plafon a teljes költségnek a töredékét spórolta (~0,3 s), cserébe
 * a terület ötödét eldobta. Ez rossz csere, ezért a plafon feljebb került.
 *
 * ⚠️ DE A PLAFON EMELÉSE ÖNMAGÁBAN KEVÉS — ezt a
 * `server/src/routes/activities.ts` kommentje már egyszer kimondta: „a plafon
 * emelése CSAK ELTOLJA a határt". Ezért a plafon fölött MOST NEM CSONKOLUNK,
 * hanem DURVÍTUNK: a teljes halmaz egy szinttel feljebbi felbontásra megy
 * (lásd `coarsenToFit`). Az eredmény a szélén néhány méterrel pontatlanabb,
 * de HIÁNYTALAN — és egy teljes, kicsit durvább folt sokkal használhatóbb,
 * mint egy pontos, de lyukas.
 */
const MAX_RENDERED_CELLS = 200_000;

/**
 * A legdurvább felbontás, ameddig elmegyünk.
 *
 * Res9 hatszög ~0,1 km² — ennél durvább folt már nem a megtett kör alakját
 * mutatná. Ha egy aktivitás még ezen a szinten sem fér a plafon alá, az nem
 * megjelenítési kérdés: ott a mentés a hibás, és inkább lássuk a torzót.
 */
const MIN_COARSE_RESOLUTION = 9;

/**
 * Egyetlen, EGYSÉGES felbontású cellahalmaz — ez a szerződés a hívó felé.
 *
 * ⚠️ NEM KOZMETIKA, HANEM KÖVETELMÉNY: a térkép a `h3-js`
 * `cellsToMultiPolygon`-jával olvasztja poligonná a halmazt
 * (`lib/hexAreas.ts`), az pedig VEGYES felbontású bemenetre hibás alakot ad.
 * Ezért nem adhatjuk át egyszerűen a tömör `parents` listát, akármilyen
 * csábítóan olcsó is lenne — előbb egy közös szintre kell hozni mindent.
 */
export function expandActivityCells(
  cells: readonly string[] | undefined,
  parents: readonly string[] | undefined,
): string[] {
  const out = new Set<string>(cells ?? []);
  for (const parent of parents ?? []) {
    // A már res12 index önmagát adja vissza — nem kell külön ágat írni rá.
    if (getResolution(parent) >= GAMEPLAY.H3_RESOLUTION) {
      out.add(parent);
      continue;
    }
    for (const child of cellToChildren(parent, GAMEPLAY.H3_RESOLUTION)) {
      out.add(child);
    }
  }
  return coarsenToFit(out);
}

/**
 * Ha a halmaz nem fér a plafon alá, egy szinttel durvábbra váltunk — és ezt
 * addig ismételjük, amíg befér vagy elérjük a `MIN_COARSE_RESOLUTION`-t.
 *
 * A durvítás MINDIG a teljes halmazon fut, sosem egy részhalmazon: ettől
 * marad hiánytalan a folt. Egy szint ~7-szeresére csökkenti a darabszámot,
 * tehát a gyakorlatban egy-két lépés bőven elég.
 */
function coarsenToFit(cells: ReadonlySet<string>): string[] {
  if (cells.size <= MAX_RENDERED_CELLS) return [...cells];

  let resolution = GAMEPLAY.H3_RESOLUTION - 1;
  while (resolution >= MIN_COARSE_RESOLUTION) {
    const coarse = new Set<string>();
    for (const cell of cells) coarse.add(cellToParent(cell, resolution));
    if (coarse.size <= MAX_RENDERED_CELLS) return [...coarse];
    resolution -= 1;
  }

  // Ide csak hibás adat juttathat el. A `MIN_COARSE_RESOLUTION` szintű halmaz
  // még mindig teljes — inkább az, mint egy önkényesen elvágott res12 lista.
  const floor = new Set<string>();
  for (const cell of cells) floor.add(cellToParent(cell, MIN_COARSE_RESOLUTION));
  return [...floor];
}
