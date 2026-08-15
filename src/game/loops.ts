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
export function detectLoops(path: readonly CellId[]): DetectedLoop[] {
  const loops: DetectedLoop[] = [];
  const lastSeenAt = new Map<CellId, number>();

  for (let i = 0; i < path.length; i++) {
    const cell = path[i]!;
    const previous = lastSeenAt.get(cell);

    if (previous !== undefined && i - previous >= GAMEPLAY.MIN_LOOP_STEPS) {
      const wall = new Set(path.slice(previous, i + 1));
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
