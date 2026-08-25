import { describe, expect, it } from 'vitest';
import { gridDisk, gridRingUnsafe, latLngToCell } from 'h3-js';
import { DEFAULT_GAMEPLAY } from '@/config/gameplay';
import type { ActivityGeometry } from '@/game';
import type { CellId, DetectedLoop, OwnershipMap } from '@/types';
import { ORIGIN } from '@/game/fixtures';
import { processLabActivity } from './labHierarchicalWorld';

const ME = 'player-a';

function acceptedLoop(
  fromIndex: number,
  toIndex: number,
  cells: readonly CellId[],
): DetectedLoop {
  return {
    fromIndex,
    toIndex,
    wall: new Set(cells),
    interior: new Set(),
  };
}

function geometry(loops: DetectedLoop[]): ActivityGeometry {
  return {
    cellPath: [],
    loops,
    loopDiagnostics: {
      successful: loops.map((loop) => ({
        fromIndex: loop.fromIndex,
        toIndex: loop.toIndex,
        wallCells: loop.wall.size,
        interiorCells: loop.interior.size,
        prunedCells: 0,
      })),
      rejected: [],
      shortRevisits: 0,
    },
    droppedPoints: 0,
    largeGaps: 0,
  };
}

describe('LAB — nested / overlapping reinforcement', () => {
  it('a nagy külső hurok a régi kék területet erősíti, a közben szerzett sárgát nem', () => {
    const center = latLngToCell(
      ORIGIN.lat,
      ORIGIN.lng,
      DEFAULT_GAMEPLAY.H3_RESOLUTION,
    ) as CellId;

    // Kék: már a nagy traversal előtt a játékosé.
    const blue = new Set<CellId>(gridDisk(center, 1) as CellId[]);
    // Sárga: a kék körüli következő gyűrű, amelyet a traversal közben
    // keletkező kisebb hurkok szereznek meg.
    const yellow = new Set<CellId>(gridRingUnsafe(center, 2) as CellId[]);

    const world: OwnershipMap = new Map(
      [...blue].map((cell) => [cell, { owner: ME, defense: 1 }] as const),
    );

    const yellowCells = [...yellow];
    const smallA = acceptedLoop(20, 35, yellowCells.slice(0, 4));
    const smallB = acceptedLoop(38, 50, yellowCells.slice(4, 8));
    const smallC = acceptedLoop(52, 65, yellowCells.slice(8));

    // A nagy külső traversal már a kis hurkok előtt, a 10-es indexnél indult,
    // és csak a 90-es indexnél zárul. Geometriailag mind a korábbi kék, mind
    // a közben megszerzett sárga cellákat körbezárja.
    const enclosing = acceptedLoop(10, 90, [...blue, ...yellow]);
    const loops = [smallA, smallB, smallC, enclosing];

    const result = processLabActivity(
      {
        points: [],
        type: 'ride',
        distanceKm: 1,
        actorId: ME,
        ownership: world,
        streakDays: 1,
        gpEarnedToday: 0,
      },
      geometry(loops),
    );

    expect(result.loops).toHaveLength(4);

    for (const cell of blue) {
      expect(result.claim?.updates.get(cell)).toEqual({ owner: ME, defense: 2 });
    }
    for (const cell of yellow) {
      expect(result.claim?.updates.get(cell)).toEqual({ owner: ME, defense: 1 });
    }

    expect(result.claim?.counts.reclaimed).toBe(blue.size);
    expect(result.claim?.counts.free).toBe(yellow.size);
  });
});
