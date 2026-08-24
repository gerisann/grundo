import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { ORIGIN, buildTrace, squareWaypoints } from './fixtures';
import { traceToCellPath } from './cells';
import {
  buildLoopInterior,
  loopInteriorHas,
  loopInteriorCellCount,
} from './loopInterior';
import type { DetectedLoop } from '@/types';

function squareWall(sideM: number): Set<string> {
  // Ritka GPS-minták is elegendők: traceToCellPath H3 gridPathCells-szel
  // összefüggő, vízhatlan falat épít a töréspontok között.
  const trace = buildTrace(squareWaypoints(ORIGIN, sideM), { stepM: 250, accuracy: 1 });
  return new Set(traceToCellPath(trace).path);
}

describe('compact adaptive loop interior', () => {
  it('egy több tíz km²-es hurok teljesen belső részét parent cellákban tartja', () => {
    const wall = squareWall(5_000);
    const geometry = buildLoopInterior(wall);

    expect(geometry.compactInterior).toBeDefined();
    expect(geometry.compactInterior!.fullParents.size).toBeGreaterThan(0);
    expect(geometry.cellCount).toBeGreaterThan(geometry.interior.size);

    const loop: DetectedLoop = {
      wall,
      interior: geometry.interior,
      compactInterior: geometry.compactInterior,
      fromIndex: 0,
      toIndex: wall.size,
    };
    const center = latLngToCell(ORIGIN.lat, ORIGIN.lng, GAMEPLAY.H3_RESOLUTION);

    expect(loopInteriorHas(loop, center)).toBe(true);
    expect(loopInteriorCellCount(loop)).toBe(geometry.cellCount);
  });

  it('a régi 2,2 millió res12 cellás limit fölötti hurkot sem materializálja ki', () => {
    // 30 × 30 km ≈ 900 km², vagyis névlegesen ~2,9 millió res12 cella.
    // A régi adaptív kód ezt LoopTooLargeErrorral eldobta közvetlenül azelőtt,
    // hogy a teljes belsőt res12 Setbe bontotta volna.
    const wall = squareWall(30_000);
    const geometry = buildLoopInterior(wall);

    expect(geometry.compactInterior).toBeDefined();
    expect(geometry.cellCount).toBeGreaterThan(2_200_000);
    expect(geometry.compactInterior!.fullParents.size).toBeLessThan(100_000);
    expect(geometry.interior.size).toBeLessThan(250_000);
  });

  it('kis huroknál változatlanul a teljes res12 interior Setet adja', () => {
    const wall = squareWall(200);
    const geometry = buildLoopInterior(wall);

    expect(geometry.compactInterior).toBeUndefined();
    expect(geometry.cellCount).toBe(geometry.interior.size);
    expect(geometry.cellCount).toBeGreaterThan(0);
  });
});
