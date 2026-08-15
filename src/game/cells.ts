/**
 * Nyomvonal → cellalánc.
 *
 * Tiszta függvények, se I/O, se platformfüggés — ez a modul azonos módon fut
 * a telefonon (élő előnézet) és a szerveren (hiteles számítás).
 */

import { latLngToCell, gridPathCells, gridDistance } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import type { ActivityType, CellId, Layer, TracePoint } from '@/types';

export function layerOf(type: ActivityType): Layer {
  return type === 'ride' ? 'bike' : 'foot';
}

export interface CellPathResult {
  /** összefüggő cellalánc — szomszédos elemek mindig élszomszédok */
  path: CellId[];
  /** eldobott pontok száma (pontatlanság miatt) */
  droppedPoints: number;
  /** hány helyen kellett a megengedettnél nagyobb hézagot kitölteni */
  largeGaps: number;
}

/**
 * A GPS-mintákból összefüggő cellaláncot képez.
 *
 * A hézagkitöltés kritikus: ha a jel kihagy, két minta között 50 m is lehet,
 * és egy lyukas "fal" mellett a flood fill kiszivárogna. A hatszögrácsnak
 * mind a 6 szomszédja élszomszéd (nincs átlós szivárgás, mint négyzetrácson),
 * ezért egy összefüggő lánc mindig vízhatlan.
 */
export function traceToCellPath(points: readonly TracePoint[]): CellPathResult {
  const res = GAMEPLAY.H3_RESOLUTION;
  const path: CellId[] = [];
  let droppedPoints = 0;
  let largeGaps = 0;

  for (const p of points) {
    if (p.accuracy !== undefined && p.accuracy > GAMEPLAY.MAX_GPS_ACCURACY_M) {
      droppedPoints++;
      continue;
    }

    const cell = latLngToCell(p.lat, p.lng, res);
    const last = path[path.length - 1];

    if (last === undefined) {
      path.push(cell);
      continue;
    }
    if (last === cell) continue; // ugyanabban a cellában maradtunk

    const steps = gridDistance(last, cell);
    if (steps > GAMEPLAY.MAX_GRID_PATH_CELLS) {
      // Fizikailag valószínűtlen ugrás. Kitöltjük, de megjelöljük — a Trust
      // Score ezt teleportként fogja értékelni.
      largeGaps++;
    }

    if (steps > 1) {
      // gridPathCells az első elemként a kiindulót adja vissza — azt kihagyjuk
      const bridge = gridPathCells(last, cell);
      for (let i = 1; i < bridge.length; i++) path.push(bridge[i]!);
    } else {
      path.push(cell);
    }
  }

  return { path, droppedPoints, largeGaps };
}

/** Cellaszám → m² a névleges cellaértékkel. */
export function cellsToM2(cellCount: number): number {
  return Math.round(cellCount * GAMEPLAY.CELL_AREA_M2);
}

/** m² → cellaszám (felfelé kerekítve), pl. kihívás-célok átváltásához. */
export function m2ToCells(m2: number): number {
  return Math.ceil(m2 / GAMEPLAY.CELL_AREA_M2);
}
