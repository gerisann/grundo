import { describe, expect, it } from 'vitest';
import { cellToChildrenSize, latLngToCell } from 'h3-js';
import type { CellId, DetectedLoop } from '@/types';
import { GAMEPLAY } from '@/config/gameplay';
import { resolveCompactEmptyWorldClaims } from './compactClaim';

const parent = (lat: number, lng: number): CellId => latLngToCell(lat, lng, 10) as CellId;

function compactLoop(
  fromIndex: number,
  toIndex: number,
  fullParents: readonly CellId[],
): DetectedLoop {
  const childCount = fullParents.reduce(
    (sum, value) => sum + Number(cellToChildrenSize(value, GAMEPLAY.H3_RESOLUTION)),
    0,
  );
  return {
    fromIndex,
    toIndex,
    wall: new Set(),
    interior: new Set(),
    compactInterior: {
      parentResolution: 10,
      fullParents: new Set(fullParents),
      cellCount: childCount,
    },
  };
}

describe('compact large-loop claim credit', () => {
  it('egy teljes parentet a res12 gyerekszámával könyvel el, kibontott update Map nélkül', () => {
    const p = parent(47.475, 19.015);
    const expected = Number(cellToChildrenSize(p, GAMEPLAY.H3_RESOLUTION));

    const result = resolveCompactEmptyWorldClaims([compactLoop(0, 20, [p])], 'u1');

    expect(result.claimedCellCount).toBe(expected);
    expect(result.claim?.counts.free).toBe(expected);
    expect(result.claim?.updates.size).toBe(0);
    expect(result.preview?.parents.get(p)).toBe(1);
    expect(result.preview?.defenseCounts[0]).toBe(expected);
  });

  it('ugyanabból a traversalból származó későbbi átfedés nem emeli a defense-et', () => {
    const p = parent(47.475, 19.015);
    const expected = Number(cellToChildrenSize(p, GAMEPLAY.H3_RESOLUTION));

    const first = compactLoop(10, 20, [p]);
    const enclosingSameTraversal = compactLoop(0, 30, [p]);
    const result = resolveCompactEmptyWorldClaims([first, enclosingSameTraversal], 'u1');

    expect(result.preview?.parents.get(p)).toBe(1);
    expect(result.preview?.defenseCounts[0]).toBe(expected);
    expect(result.preview?.defenseCounts[1]).toBe(0);
  });

  it('valódi új traversal újra bezárhatja a teljes parentet és 2× defense-et ad', () => {
    const p = parent(47.475, 19.015);
    const expected = Number(cellToChildrenSize(p, GAMEPLAY.H3_RESOLUTION));

    const first = compactLoop(0, 20, [p]);
    const secondLap = compactLoop(20, 40, [p]);
    const result = resolveCompactEmptyWorldClaims([first, secondLap], 'u1');

    expect(result.preview?.parents.get(p)).toBe(2);
    expect(result.preview?.defenseCounts[0]).toBe(0);
    expect(result.preview?.defenseCounts[1]).toBe(expected);
  });
});
