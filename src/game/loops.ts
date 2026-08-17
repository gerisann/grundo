/**
 * Bezárás-felismerés és a közrezárt terület megtalálása.
 *
 * Ez a GRUNDO legfontosabb algoritmusa. A hexagon-rács miatt nem poligon-
 * algebra, hanem flood fill: determinisztikus, egészszám-alapú, és nem tud
 * érvénytelen geometriát előállítani. Emiatt a kliens és a szerver bitre
 * ugyanazt az eredményt adja.
 *
 * Szabály (docs/03-jatekszabalyok.md): a bezárás bármely ÖNMETSZÉS. Nem kell
 * visszaérni a rajthoz, és egy aktivitás alatt több bezárás is lehet.
 */

import { cellToLatLng, polygonToCells, gridDisk, getResolution } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import type { CellId, DetectedLoop } from '@/types';

export class LoopTooLargeError extends Error {
  constructor(public readonly candidateCells: number) {
    super(`A hurok túl nagy (${candidateCells} cella) — valószínűleg GPS-hiba.`);
    this.name = 'LoopTooLargeError';
  }
}

/**
 * Végigmegy a cellaláncon, és minden önmetszésnél megpróbálja bezárni a hurkot.
 *
 * Az ismételt kör (körbe-körbe futás) újra detektálódik — ez szándékos:
 * pontosan ez adja a védelemnövelést és a 2–5× pontszorzót.
 */
/**
 * A falból CSAK a körökön fekvő mezők maradnak.
 *
 * A fal a két találkozás között bejárt cellák halmaza — kitérőkkel és
 * összekötő szakaszokkal együtt. Kétféle mező kerül bele feleslegesen:
 *
 *   ZSÁKUTCA — kimész néhány mezőt és ugyanazon jössz vissza. Ezeknek csak
 *   egy szomszédjuk van a falban, mint egy kinyúló ujjnak.
 *
 *   ÖSSZEKÖTŐ FOLYOSÓ — két bezárt terület között átmész egy vonalon, majd
 *   ugyanazon jössz vissza. Ezeknek KÉT szomszédjuk van, tehát a zsákutca-
 *   szabály nem fogja meg őket — mégsem részei egyetlen körnek sem.
 *
 * A közös bennük, hogy egyik sem fekszik körön. Gráfelméletben az ilyen élek
 * a HIDAK: olyan él, amit elvágva a gráf szétesik. Egy körön fekvő él sosem
 * híd, hiszen a kör másik fele megkerüli.
 *
 * Az eljárás tehát: megkeressük a hidakat, elvágjuk őket, és eldobjuk azokat
 * a cellákat, amiknek ezután nem marad éle. Ez egy menetben elintézi mindkét
 * esetet — a kinyúló ujjakat és az összekötő folyosókat is.
 *
 * A VALÓDI kört nem érinti: ott minden él körön fekszik, tehát egyik sem híd.
 *
 * A metszés a flood fill ELŐTT fut. Ha utána tennénk, egy befelé mutató
 * kitérő cellái se falként, se belsőként nem szerepelnének — lyuk maradna a
 * területben. Így viszont a levágott cellák a belsőhöz kerülnek, ami helyes.
 */
export function pruneDeadEnds(wall: ReadonlySet<CellId>): Set<CellId> {
  const neighbours = new Map<CellId, CellId[]>();
  for (const cell of wall) {
    const list: CellId[] = [];
    for (const near of gridDisk(cell, 1)) {
      if (near !== cell && wall.has(near)) list.push(near);
    }
    neighbours.set(cell, list);
  }

  const bridges = findBridges(neighbours);
  const kept = new Set<CellId>();

  for (const [cell, list] of neighbours) {
    // Marad, ha van legalább egy éle, ami NEM híd — azaz körön fekszik.
    if (list.some((near) => !bridges.has(edgeKey(cell, near)))) kept.add(cell);
  }

  return kept;
}

function edgeKey(a: CellId, b: CellId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Hídkeresés (Tarjan), ITERATÍVAN.
 *
 * Rekurzívan rövidebb lenne, de egy hosszú aktivitás fala több ezer cellából
 * áll, és egy elnyúlt útvonalon a mélység is ennyi lehet — az pedig
 * veremtúlcsordulás. A saját veremmel kezelt változat ettől mentes.
 */
function findBridges(neighbours: ReadonlyMap<CellId, readonly CellId[]>): Set<string> {
  const bridges = new Set<string>();
  const discovered = new Map<CellId, number>();
  const lowest = new Map<CellId, number>();
  let time = 0;

  for (const root of neighbours.keys()) {
    if (discovered.has(root)) continue;

    // [cella, szülő, hányadik szomszédnál tartunk]
    const stack: [CellId, CellId | null, number][] = [[root, null, 0]];
    discovered.set(root, time);
    lowest.set(root, time);
    time += 1;

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const [cell, parent, index] = frame;
      const list = neighbours.get(cell) ?? [];

      if (index < list.length) {
        frame[2] += 1;
        const near = list[index]!;
        if (near === parent) continue;

        if (discovered.has(near)) {
          // Visszaél: a mélyebb pont ennél nem lehet magasabb.
          lowest.set(cell, Math.min(lowest.get(cell)!, discovered.get(near)!));
        } else {
          discovered.set(near, time);
          lowest.set(near, time);
          time += 1;
          stack.push([near, cell, 0]);
        }
        continue;
      }

      stack.pop();
      if (parent !== null) {
        lowest.set(parent, Math.min(lowest.get(parent)!, lowest.get(cell)!));
        // Ha a részfából nem vezet vissza él a szülő fölé, az él HÍD.
        if (lowest.get(cell)! > discovered.get(parent)!) {
          bridges.add(edgeKey(parent, cell));
        }
      }
    }
  }

  return bridges;
}

export function detectLoops(path: readonly CellId[]): DetectedLoop[] {
  const loops: DetectedLoop[] = [];
  const lastSeenAt = new Map<CellId, number>();

  for (let i = 0; i < path.length; i++) {
    const cell = path[i]!;
    const previous = lastSeenAt.get(cell);

    if (previous !== undefined && i - previous >= GAMEPLAY.MIN_LOOP_STEPS) {
      // A zsákutcákat a bezárás ELŐTT vágjuk le: ami csak egy szomszéddal
      // érintkezik, az nem része a körnek. Lásd `pruneDeadEnds`.
      const wall = pruneDeadEnds(new Set(path.slice(previous, i + 1)));
      let interior: Set<CellId>;
      try {
        interior = floodFillInterior(wall);
      } catch (err) {
        if (err instanceof LoopTooLargeError) {
          lastSeenAt.set(cell, i);
          continue;
        }
        throw err;
      }

      if (interior.size >= GAMEPLAY.MIN_INTERIOR_CELLS) {
        loops.push({ wall, interior, fromIndex: previous, toIndex: i });
        // A felhasznált szakaszt "elfogyasztjuk", hogy a következő kör
        // önálló bezárásként detektálódjon.
        for (let k = previous; k < i; k++) lastSeenAt.delete(path[k]!);
      }
    }

    lastSeenAt.set(cell, i);
  }

  return loops;
}

/**
 * A fal által közrezárt cellák megkeresése.
 *
 * 1. jelöltrégió: a fal befoglaló doboza + margó, cellákra bontva
 * 2. a régió peremcelláiból induló szélességi bejárás, a fal akadály
 * 3. amit kívülről nem értünk el → belső
 */
export function floodFillInterior(wall: ReadonlySet<CellId>): Set<CellId> {
  const first = wall.values().next().value as CellId | undefined;
  if (first === undefined) return new Set();
  const res = getResolution(first);

  // A méretkorlát a polyfill ELŐTT dől el — lásd candidateRegion().
  const candidates = candidateRegion(wall, res);

  // A régió pereme: minden olyan cella, amelynek van szomszédja a régión kívül.
  const queue: CellId[] = [];
  const outside = new Set<CellId>();
  for (const cell of candidates) {
    if (wall.has(cell)) continue;
    for (const n of gridDisk(cell, 1)) {
      if (!candidates.has(n)) {
        outside.add(cell);
        queue.push(cell);
        break;
      }
    }
  }

  // Szélességi bejárás kívülről befelé, a falon nem lépünk át.
  while (queue.length > 0) {
    const cell = queue.pop()!;
    for (const n of gridDisk(cell, 1)) {
      if (!candidates.has(n) || wall.has(n) || outside.has(n)) continue;
      outside.add(n);
      queue.push(n);
    }
  }

  const interior = new Set<CellId>();
  for (const cell of candidates) {
    if (!wall.has(cell) && !outside.has(cell)) interior.add(cell);
  }
  return interior;
}

/** A fal befoglaló doboza + margó, cellákra bontva. */
function candidateRegion(wall: ReadonlySet<CellId>, res: number): Set<CellId> {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const cell of wall) {
    const [lat, lng] = cellToLatLng(cell);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  // ~60 m margó, hogy a peremcellák biztosan a falon kívül essenek
  const pad = 0.0006;
  const south = minLat - pad;
  const north = maxLat + pad;
  const west = minLng - pad;
  const east = maxLng + pad;

  // A méretkorlátot a polyfill ELŐTT kell ellenőrizni.
  //
  // Ha utána tennénk, egy vonat- vagy repülőút befoglaló doboza milliárdos
  // nagyságrendű cellahalmazt generálna, mielőtt egyáltalán megnéznénk, hogy
  // túl nagy-e — ami memóriát fal és percekre megállítja a feldolgozást.
  // A doboz területéből becsülni olcsó és elég pontos.
  const estimated = estimateCellCount(south, north, west, east);
  if (estimated > GAMEPLAY.MAX_LOOP_BBOX_CELLS) {
    throw new LoopTooLargeError(estimated);
  }

  const boundary: [number, number][] = [
    [south, west],
    [south, east],
    [north, east],
    [north, west],
  ];

  return new Set(polygonToCells([boundary], res));
}

/** Hány cella férne a befoglaló dobozba? Közelítés, a polyfill elkerülésére. */
function estimateCellCount(south: number, north: number, west: number, east: number): number {
  const M_PER_DEG = 111_320;
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const heightM = (north - south) * M_PER_DEG;
  const widthM = (east - west) * M_PER_DEG * Math.cos(midLat);
  return Math.abs(heightM * widthM) / GAMEPLAY.CELL_AREA_M2;
}

/** Egy bezárás összes megszerzett cellája: a fal és a belső együtt. */
export function loopCells(loop: DetectedLoop): Set<CellId> {
  const all = new Set<CellId>(loop.interior);
  for (const cell of loop.wall) all.add(cell);
  return all;
}
