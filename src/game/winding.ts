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
 * A pont körül VALAHA elért legnagyobb szögelfordulás, teljes körökben.
 *
 * Három dolgot old meg egyszerre, és mindhárom mért esetből jött:
 *
 * 1. **Nincs záró húr.** Egy zárt görbe szögösszege pontosan egész többszöröse a
 *    teljes körnek. Húrral lezárva egy hosszú hazasétálás hamis körüljárást
 *    vinne be — emiatt esett ki két cella egy bezárt területből.
 *
 * 2. **A farok nem tekerhet vissza.** Ha a nyom a kör után elsétál, a szögösszeg
 *    csökkenhet. Amit a játékos egyszer körbejárt, azt egy hazasétálás nem
 *    veheti el: két kör + 1,7 km elsétálás után a cellák egy része 2× helyett
 *    1×-en maradt. Ezért a FUTÓ MAXIMUMOT tartjuk.
 *
 * 3. **Az irány nem számít.** Abszolút értéket nézünk, tehát a bejárás
 *    megfordítása nem változtat semmit.
 */
function turnsAround(projected: ProjectedPath, cx: number, cy: number): number {
  const { xs, ys } = projected;
  let total = 0;
  let peak = 0;
  let ax = xs[0]! - cx;
  let ay = ys[0]! - cy;

  for (let i = 1; i < xs.length; i += 1) {
    const bx = xs[i]! - cx;
    const by = ys[i]! - cy;
    total += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    const reached = Math.abs(total);
    if (reached > peak) peak = reached;
    ax = bx;
    ay = by;
  }
  return peak / TAU;
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

  const turnsAt = (cell: CellId): number => {
    const [lat, lng] = cellToLatLng(cell);
    const turns = turnsAround(projected, lng * mPerDegLng, lat * M_PER_DEG_LAT);
    return Math.floor(turns + FULL_TURN_TOLERANCE);
  };

  // ── 1. A görbén kívüli cellák régiónként ────────────────────────────────
  const offPath: CellId[] = [];
  for (const cell of wanted) {
    if (!onPath.has(cell)) offPath.push(cell);
  }

  for (const seed of offPath) {
    if (counts.has(seed)) continue;
    const turns = turnsAt(seed);

    const queue: CellId[] = [seed];
    counts.set(seed, turns);
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const near of gridDisk(current, 1)) {
        if (near === current || onPath.has(near) || !wanted.has(near)) continue;
        if (counts.has(near)) continue;
        counts.set(near, turns);
        queue.push(near);
      }
    }
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
