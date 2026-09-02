/**
 * Körüljárási szám — hányszor kerülte meg a nyomvonal az adott cellát.
 *
 * MIÉRT VAN EZ A MODUL
 *
 * A védelem nem attól nő, hogy a hurokdetektor hány bezárást talált, hanem
 * attól, hogy a játékos hányszor futotta körbe a cellát. Ez a kettő nem
 * ugyanaz: a H3-rácson egy kifelé táguló spirál minden sarokérintésénél
 * levezethető egy újabb, nagyobb kompozit ciklus, tehát három fizikai körből
 * hat „bezárás" is lehet — ugyanaz a geometria visszafelé bejárva viszont
 * csak kettőt ad. Mérve, három körös spirálra: `{1:191, 2:79, 3:224}` oda és
 * `{1:496}` vissza, azaz visszafelé a védelem teljesen eltűnt.
 *
 * A körüljárási szám tisztán geometriai: a bejárás megfordítása csak az
 * ELŐJELÉT fordítja meg, a nagyságát nem. Ezért ebből olvassuk ki, hogy egy
 * cella az aktivitás során hány jóváírást kap. A hurokdetektor továbbra is azt
 * dönti el, MELY cellák kerülnek szóba; ez a modul azt, hogy HÁNYSZOR.
 *
 * KÖZÖS MODUL: se DOM, se Firebase, se Node API.
 */

import { cellToLatLng, gridDisk } from 'h3-js';
import type { CellId } from '@/types';
import { ringOf } from './neighbours';

const TAU = Math.PI * 2;
const M_PER_DEG_LAT = 111_320;

/**
 * Meddig keresünk a görbén KÍVÜLI szomszédot egy falcellának.
 * A nyomvonal helyenként két-három cella vastag (sarkok, GPS-remegés), ezért
 * az egygyűrűs környezet néha teljesen a görbén van.
 */
const MAX_INHERIT_RINGS = 3;

/**
 * Mennyivel lehet kevesebb egy teljes körnél a szögösszeg ahhoz, hogy még
 * megtett körnek számítson.
 *
 * KEREKÍTENI NEM SZABAD. Egy félig megtett kör szögösszege is elérheti a
 * következő egész közelét: a saját terület három oldalát újrafutva ~1,75 teljes
 * kör jön ki, ami kerekítve már 2 lenne. Mérve, a háromnégyzetes útvonalon a
 * védelem emiatt 280 GPS-ponttal a nagy kör bezárása ELŐTT ugrott 2×-re.
 *
 * Ezért lefelé csonkolunk, de adunk egy kis ráhagyást: a nyomvonal vége nem
 * mindig pontosan a kezdőcellában van, és ilyenkor a zárás egy-két cellányi
 * hézagja hiányozna a teljes körből.
 */
const FULL_TURN_TOLERANCE = 0.1;

/**
 * A nyomvonal síkba vetítve, hogy a szögösszeg olcsón számolható legyen.
 *
 * Egy aktivitás néhány km-es kiterjedésű, ezért egy fix referencia-szélességgel
 * vett equirectangular vetítés hibája nagyságrendekkel a cellaméret alatt van.
 * A szögösszeghez amúgy is csak a pontok egymáshoz képesti helyzete számít.
 */
interface ProjectedPath {
  xs: Float64Array;
  ys: Float64Array;
  mPerDegLng: number;
}

function projectPath(path: readonly CellId[]): ProjectedPath | null {
  const first = path[0];
  if (first === undefined) return null;

  const [refLat] = cellToLatLng(first);
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
  const xs = new Float64Array(path.length);
  const ys = new Float64Array(path.length);

  for (let i = 0; i < path.length; i += 1) {
    const [lat, lng] = cellToLatLng(path[i]!);
    xs[i] = lng * mPerDegLng;
    ys[i] = lat * M_PER_DEG_LAT;
  }
  return { xs, ys, mPerDegLng };
}

/**
 * Hányszor tett meg a nyomvonal egy TELJES kört a pont körül.
 *
 * Nem a szögösszeget adjuk vissza, hanem egy racsnit: valahányszor a
 * szögelfordulás az utolsó jóváírás óta összegyűjt egy teljes kört — BÁRMELYIK
 * IRÁNYBAN —, az egy bekerítés.
 *
 * Négy dolgot old meg egyszerre, és mindegyik mért esetből jött:
 *
 * 1. **Az ellentétes irányú körök nem olthatják ki egymást.** Ez volt a
 *    legmakacsabb hiba. Egy négykörös útvonalon a második kör az óramutatóval
 *    ellentétesen ment, a negyedik vele egyezően; az előjeles összegük nulla,
 *    ezért az érintett doboz 2× helyett 1×-en maradt. A játékszabály szerint
 *    viszont mindkettő egy-egy érvényes bekerítés.
 *
 * 2. **Egy félig megtett kör nem számít.** A régi terület három oldalát
 *    újrafutva a szögösszeg ~0,75 kör; a racsni ilyenkor nem lép. Kerekítéssel
 *    a védelem 280 GPS-ponttal a kör bezárása előtt ugrott.
 *
 * 3. **A farok nem vehet vissza semmit.** A racsni csak felfelé számol, tehát
 *    az elsétálás nem tudja visszatekerni a már megtett kört.
 *
 * 4. **Az irány nem számít.** A bejárás megfordítása minden szögkülönbség
 *    előjelét megfordítja, a teljes körök számát nem.
 *
 * A `FULL_TURN_TOLERANCE` ráhagyás azért kell, mert a nyom vége nem mindig
 * pontosan a kezdőcellában van, és ilyenkor a zárás egy-két cellányi hézagja
 * hiányozna a teljes körből.
 */
function encirclementsAround(projected: ProjectedPath, cx: number, cy: number): number {
  const { xs, ys } = projected;
  const threshold = TAU * (1 - FULL_TURN_TOLERANCE);
  let total = 0;
  let anchor = 0;
  let laps = 0;
  let ax = xs[0]! - cx;
  let ay = ys[0]! - cy;

  for (let i = 1; i < xs.length; i += 1) {
    const bx = xs[i]! - cx;
    const by = ys[i]! - cy;
    total += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    ax = bx;
    ay = by;

    while (Math.abs(total - anchor) >= threshold) {
      laps += 1;
      anchor += Math.sign(total - anchor) * TAU;
    }
  }
  return laps;
}

/**
 * Cellánkénti körüljárási szám a megadott nyomvonalra és cellahalmazra.
 *
 * ── Miért komponensenként számolunk ──────────────────────────────────────
 * A görbén kívüli, egymással szomszédos cellák körüljárási száma szükségképpen
 * AZONOS: ha két cellát a görbe elválasztana, nem lennének szomszédosak. A H3-n
 * mind a hat szomszéd élszomszéd, tehát nincs átlós szivárgás, és ez pontosan
 * igaz. Ezért régiónként egyszer számolunk, nem cellánként.
 *
 * Ez nem közelítés, hanem ugyanaz az eredmény olcsóbban: egy 836 cellás
 * nyomvonalon 3544 claim-cellára a naiv változat 66 ms volt.
 *
 * ── A falcellák külön esete ──────────────────────────────────────────────
 * Egy falcella közepe RAJTA van a görbén, ezért a szögösszege nem konvergál
 * egész értékhez: mérve a falcellák harmada-fele fél-egész közelében állt, és
 * 0 és 7 között szóródott. Ezek tehát nem önmagukra számolnak, hanem a
 * legközelebbi, görbén kívüli szomszédaik közül a legnagyobb értéket öröklik —
 * a fal ahhoz a régióhoz tartozik, amelyiket határolja.
 */
function cellX(cell: CellId, mPerDegLng: number): number {
  return cellToLatLng(cell)[1] * mPerDegLng;
}

function cellY(cell: CellId): number {
  return cellToLatLng(cell)[0] * M_PER_DEG_LAT;
}

export function windingCounts(
  path: readonly CellId[],
  cells: Iterable<CellId>,
): Map<CellId, number> {
  const wanted = new Set<CellId>(cells);
  const counts = new Map<CellId, number>();
  const projected = projectPath(path);
  if (projected === null) {
    for (const cell of wanted) counts.set(cell, 0);
    return counts;
  }

  const onPath = new Set<CellId>(path);
  const { mPerDegLng } = projected;

  const turnsAt = (cell: CellId): number =>
    encirclementsAround(projected, cellX(cell, mPerDegLng), cellY(cell));

  // ── 1. A görbén kívüli cellák régiónként ────────────────────────────────
  const offPath: CellId[] = [];
  for (const cell of wanted) {
    if (!onPath.has(cell)) offPath.push(cell);
  }

  /**
   * ⚠️ A RÉGIÓ ÉRTÉKE NEM FÜGGHET ATTÓL, MELYIK CELLÁJÁVAL TALÁLKOZTUNK
   * ELŐSZÖR.
   *
   * Elvben a régió minden cellája ugyanannyi körüljárást lát (ha a görbe
   * elválasztaná őket, nem lennének szomszédok), ezért mindegy volt, hol
   * mérünk. A gyakorlatban azonban az `encirclementsAround` racsnija egy
   * TŰRÉSSEL dolgozik (`FULL_TURN_TOLERANCE`), és a régió peremén két
   * szomszédos cella a küszöb két oldalára eshet. Amíg a bejárás sorrendje
   * véletlenül stabil volt, ez nem látszott.
   *
   * MÉRVE (2026-09-02): a kitöltés belső halmazának bejárási sorrendjét
   * megváltoztatva a kifelé tartó spirál magja 3× helyett 2×-en maradt —
   * vagyis a felhasználó VÉDELMI SZINTJE függött egy `Set` beszúrási
   * sorrendjétől. A modul fejlécében álló ígéret („a kliens és a szerver
   * bitre ugyanazt adja") ezzel csendben megdőlt volna, amint a két oldal
   * más úton állítja elő ugyanazt a halmazt.
   *
   * Ezért előbb ÖSSZEGYŰJTJÜK a régiót, és utána a régió
   * LEXIKOGRÁFIKUSAN LEGKISEBB celláján mérünk. Ez a választás önmagában nem
   * „jobb" a többinél — az viszont, hogy nem a véletlenen múlik.
   */
  for (const seed of offPath) {
    if (counts.has(seed)) continue;

    const region: CellId[] = [seed];
    const queue: CellId[] = [seed];
    // Foglaló érték: a régió tagjait már most jelöljük, hogy a bejárás ne
    // fusson kétszer. A végleges értéket alább írjuk felül.
    counts.set(seed, 0);
    let representative = seed;

    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const near of ringOf(current)) {
        if (near === current || onPath.has(near) || !wanted.has(near)) continue;
        if (counts.has(near)) continue;
        counts.set(near, 0);
        region.push(near);
        queue.push(near);
        if (near < representative) representative = near;
      }
    }

    const turns = turnsAt(representative);
    for (const cell of region) counts.set(cell, turns);
  }

  // ── 2. A görbén lévő cellák a szomszédos régiótól örökölnek ─────────────
  for (const cell of wanted) {
    if (!onPath.has(cell)) continue;

    let inherited = 0;
    for (let ring = 1; ring <= MAX_INHERIT_RINGS; ring += 1) {
      let found = false;
      for (const near of gridDisk(cell, ring)) {
        if (near === cell || onPath.has(near)) continue;
        const known = counts.get(near);
        if (known === undefined) continue;
        found = true;
        if (known > inherited) inherited = known;
      }
      if (found) break;
    }
    counts.set(cell, inherited);
  }

  return counts;
}
