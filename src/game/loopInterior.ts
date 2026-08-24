import {
  cellToChildren,
  cellToChildrenSize,
  cellToLatLng,
  cellToParent,
  getResolution,
  gridDisk,
  polygonToCells,
} from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import type { CellId, CompactLoopInterior, DetectedLoop } from '@/types';
import { floodFillInterior, LoopTooLargeError } from './loops';

/**
 * Ekkora becsült jelöltrégió alatt a régi, teljes res12 Set gyorsabb és
 * egyszerűbb. Fölötte a hurok belsejét tömören tartjuk.
 */
const COMPACT_ABOVE_CELLS = 40_000;

/**
 * A compact parent két szinttel durvább a játékrácsnál: res12 → res10.
 * Egy teljes parent 49 res12 cellát képvisel. A res10 elég finom ahhoz, hogy
 * a fal körüli pontos határsáv keskeny maradjon, de már nagyságrenddel
 * csökkenti a memóriaigényt.
 */
const COMPACT_PARENT_STEPS = 2;

/**
 * Védőkorlát a TÖMÖR eredményre.
 *
 * 250 000 res10 parent legfeljebb ~12,25 millió res12 cellát (~3 760 km²)
 * képvisel. Ez már egy kb. 200 km kerületű kör teljes területének nagyságrendje,
 * miközben maga a compact halmaz még kezelhető méretű. Ennél nagyobb geometriát
 * továbbra is GPS-/importhibának tekintünk.
 */
const MAX_COMPACT_PARENTS = 250_000;

export interface LoopInteriorGeometry {
  /** Pontos res12 belső cellák a határsávban, vagy kis huroknál a teljes belső. */
  interior: Set<CellId>;
  /** Nagy huroknál a teljesen belső parentek tömör halmaza. */
  compactInterior?: CompactLoopInterior;
  /** A teljes belső pontos res12-egyenértékű cellaszáma. */
  cellCount: number;
}

/**
 * A hurok belsejének felépítése úgy, hogy nagy területnél ne materializáljunk
 * több millió res12 H3 stringet.
 */
export function buildLoopInterior(wall: ReadonlySet<CellId>): LoopInteriorGeometry {
  if (wall.size === 0) return { interior: new Set(), cellCount: 0 };

  if (estimateRegionCells(wall) <= COMPACT_ABOVE_CELLS) {
    const interior = floodFillInterior(wall);
    return { interior, cellCount: interior.size };
  }

  return buildCompactAdaptiveInterior(wall);
}

/** A teljes belső cellaszáma, reprezentációtól függetlenül. */
export function loopInteriorCellCount(loop: DetectedLoop): number {
  return loop.compactInterior?.cellCount ?? loop.interior.size;
}

/** Igaz, ha a res12 cella a hurok belsejében van. */
export function loopInteriorHas(loop: DetectedLoop, cell: CellId): boolean {
  if (loop.interior.has(cell)) return true;
  const compact = loop.compactInterior;
  if (!compact) return false;
  return compact.fullParents.has(cellToParent(cell, compact.parentResolution));
}

/** A fal + belső teljes, res12-egyenértékű cellaszáma. */
export function loopCellCount(loop: DetectedLoop): number {
  // A flood fill definíció szerint a fal és a belső diszjunkt.
  return loop.wall.size + loopInteriorCellCount(loop);
}

export function hasCompactInterior(loop: DetectedLoop): boolean {
  return (loop.compactInterior?.fullParents.size ?? 0) > 0;
}

/**
 * Két hurok belsejének pontos metszetszáma a jelenlegi compact formában.
 *
 * A compact geometriák ugyanazon parentResolutionön készülnek. A kód az
 * explicit határsáv ↔ teljes parent keresztezéseket is beleszámolja, ezért a
 * deduplikáció nem csak közelítés.
 */
export function loopInteriorOverlapCount(a: DetectedLoop, b: DetectedLoop): number {
  const aCompact = a.compactInterior;
  const bCompact = b.compactInterior;

  if (!aCompact && !bCompact) {
    const smaller = a.interior.size <= b.interior.size ? a.interior : b.interior;
    const larger = smaller === a.interior ? b.interior : a.interior;
    let shared = 0;
    for (const cell of smaller) if (larger.has(cell)) shared += 1;
    return shared;
  }

  // Explicit res12 cellák: mindkét irányt külön számoljuk, mert az egyik
  // hurok határsávja a másik teljes parentjébe eshet.
  let shared = 0;
  const explicitSeen = new Set<CellId>();
  for (const cell of a.interior) {
    if (loopInteriorHas(b, cell)) {
      explicitSeen.add(cell);
      shared += 1;
    }
  }
  for (const cell of b.interior) {
    if (!explicitSeen.has(cell) && loopInteriorHas(a, cell)) shared += 1;
  }

  if (!aCompact || !bCompact) return shared;

  if (aCompact.parentResolution !== bCompact.parentResolution) {
    // Jelenleg ez nem fordulhat elő (minden compact belső ugyanazzal a
    // konstanssal készül). Inkább biztonságosan alulbecsüljük a parent-parent
    // részt, mint hogy több millió gyereket bontsunk ki egy ritka hibás állapotban.
    return shared;
  }

  const smallerParents =
    aCompact.fullParents.size <= bCompact.fullParents.size
      ? aCompact.fullParents
      : bCompact.fullParents;
  const largerParents =
    smallerParents === aCompact.fullParents ? bCompact.fullParents : aCompact.fullParents;

  for (const parent of smallerParents) {
    if (largerParents.has(parent)) {
      shared += Number(cellToChildrenSize(parent, GAMEPLAY.H3_RESOLUTION));
    }
  }
  return shared;
}

/**
 * Csak akkor használd, ha ténylegesen szükség van a finom cellákra.
 * Compact parentenként, streamelve bont vissza, tehát nem hoz létre egy újabb
 * többmilliós Setet, de természetesen maga a végigiterálás továbbra is O(n).
 */
export function* iterateLoopInteriorCells(loop: DetectedLoop): IterableIterator<CellId> {
  for (const cell of loop.interior) yield cell;
  const compact = loop.compactInterior;
  if (!compact) return;
  for (const parent of compact.fullParents) {
    for (const child of cellToChildren(parent, GAMEPLAY.H3_RESOLUTION)) yield child;
  }
}

export function* iterateLoopCells(loop: DetectedLoop): IterableIterator<CellId> {
  for (const cell of loop.wall) yield cell;
  yield* iterateLoopInteriorCells(loop);
}

/* ════════════════════════════════════════════════════════════════════════
   Compact adaptív flood fill
   ════════════════════════════════════════════════════════════════════════ */

function buildCompactAdaptiveInterior(wall: ReadonlySet<CellId>): LoopInteriorGeometry {
  const first = wall.values().next().value as CellId | undefined;
  if (first === undefined) return { interior: new Set(), cellCount: 0 };

  const res = getResolution(first);
  const parentResolution = Math.max(0, res - COMPACT_PARENT_STEPS);

  /* 1. Durva menet. */
  const coarseWall = new Set<CellId>();
  for (const cell of wall) coarseWall.add(cellToParent(cell, parentResolution));

  const coarseRegion = candidateRegion(coarseWall, parentResolution);
  const coarseOutside = new Set<CellId>();
  const coarseQueue: CellId[] = [];

  for (const cell of coarseRegion) {
    if (coarseWall.has(cell)) continue;
    for (const near of gridDisk(cell, 1)) {
      if (!coarseRegion.has(near)) {
        coarseOutside.add(cell);
        coarseQueue.push(cell);
        break;
      }
    }
  }
  spreadCoarse(coarseQueue);

  /* 2. Pontos menet csak a falat tartalmazó parentek res12 gyerekein. */
  const band = new Set<CellId>();
  for (const coarse of coarseWall) {
    for (const child of cellToChildren(coarse, res)) band.add(child);
  }

  const fineOutside = new Set<CellId>();
  const fineQueue: CellId[] = [];
  for (const cell of band) {
    if (wall.has(cell)) continue;
    for (const near of gridDisk(cell, 1)) {
      if (band.has(near)) continue;
      const parent = cellToParent(near, parentResolution);
      if (coarseOutside.has(parent) || !coarseRegion.has(parent)) {
        fineOutside.add(cell);
        fineQueue.push(cell);
        break;
      }
    }
  }
  spreadFine(fineQueue);

  /* 3. A finom menet által feltárt kijáratokat visszaterjesztjük durva szintre. */
  for (;;) {
    const opened: CellId[] = [];
    for (const cell of fineOutside) {
      for (const near of gridDisk(cell, 1)) {
        if (band.has(near) || wall.has(near)) continue;
        const parent = cellToParent(near, parentResolution);
        if (coarseRegion.has(parent) && !coarseOutside.has(parent) && !coarseWall.has(parent)) {
          coarseOutside.add(parent);
          opened.push(parent);
        }
      }
    }
    if (opened.length === 0) break;
    spreadCoarse(opened);

    const again: CellId[] = [];
    for (const cell of band) {
      if (wall.has(cell) || fineOutside.has(cell)) continue;
      for (const near of gridDisk(cell, 1)) {
        if (band.has(near)) continue;
        if (coarseOutside.has(cellToParent(near, parentResolution))) {
          fineOutside.add(cell);
          again.push(cell);
          break;
        }
      }
    }
    if (again.length === 0) break;
    spreadFine(again);
  }

  /* 4. Tömör eredmény: teljes parentek + pontos res12 határsáv. */
  const fullParents = new Set<CellId>();
  for (const coarse of coarseRegion) {
    if (!coarseOutside.has(coarse) && !coarseWall.has(coarse)) fullParents.add(coarse);
  }

  if (fullParents.size > MAX_COMPACT_PARENTS) {
    const approximateFineCells =
      fullParents.size * 7 ** COMPACT_PARENT_STEPS + band.size;
    throw new LoopTooLargeError(approximateFineCells);
  }

  const interior = new Set<CellId>();
  for (const cell of band) {
    if (!wall.has(cell) && !fineOutside.has(cell)) interior.add(cell);
  }

  let cellCount = interior.size;
  for (const parent of fullParents) {
    cellCount += Number(cellToChildrenSize(parent, res));
  }

  return {
    interior,
    compactInterior: {
      parentResolution,
      fullParents,
      cellCount,
    },
    cellCount,
  };

  function spreadCoarse(start: CellId[]): void {
    const stack = [...start];
    while (stack.length > 0) {
      const cell = stack.pop()!;
      for (const near of gridDisk(cell, 1)) {
        if (!coarseRegion.has(near) || coarseWall.has(near) || coarseOutside.has(near)) continue;
        coarseOutside.add(near);
        stack.push(near);
      }
    }
  }

  function spreadFine(start: CellId[]): void {
    const stack = [...start];
    while (stack.length > 0) {
      const cell = stack.pop()!;
      for (const near of gridDisk(cell, 1)) {
        if (!band.has(near) || wall.has(near) || fineOutside.has(near)) continue;
        fineOutside.add(near);
        stack.push(near);
      }
    }
  }
}

function candidateRegion(wall: ReadonlySet<CellId>, res: number): Set<CellId> {
  const bounds = boundsOf(wall);
  const estimated = estimateCellCount(bounds.south, bounds.north, bounds.west, bounds.east, res);
  if (estimated > GAMEPLAY.MAX_LOOP_BBOX_CELLS) throw new LoopTooLargeError(Math.round(estimated));

  const boundary: [number, number][] = [
    [bounds.south, bounds.west],
    [bounds.south, bounds.east],
    [bounds.north, bounds.east],
    [bounds.north, bounds.west],
  ];
  return new Set(polygonToCells([boundary], res));
}

function estimateRegionCells(wall: ReadonlySet<CellId>): number {
  const first = wall.values().next().value as CellId | undefined;
  if (first === undefined) return 0;
  const bounds = boundsOf(wall);
  return estimateCellCount(bounds.south, bounds.north, bounds.west, bounds.east, getResolution(first));
}

function boundsOf(wall: ReadonlySet<CellId>): {
  south: number;
  north: number;
  west: number;
  east: number;
} {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const cell of wall) {
    const [lat, lng] = cellToLatLng(cell);
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  const pad = 0.0006;
  return {
    south: minLat - pad,
    north: maxLat + pad,
    west: minLng - pad,
    east: maxLng + pad,
  };
}

function estimateCellCount(
  south: number,
  north: number,
  west: number,
  east: number,
  res: number,
): number {
  const M_PER_DEG = 111_320;
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const heightM = (north - south) * M_PER_DEG;
  const widthM = (east - west) * M_PER_DEG * Math.cos(midLat);
  return Math.abs(heightM * widthM) / cellAreaAt(res);
}

function cellAreaAt(res: number): number {
  return GAMEPLAY.CELL_AREA_M2 * 7 ** (GAMEPLAY.H3_RESOLUTION - res);
}
