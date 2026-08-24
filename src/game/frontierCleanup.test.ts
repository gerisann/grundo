import { describe, expect, it } from 'vitest';
import { gridDisk, latLngToCell } from 'h3-js';
import type { CellId, CellOwnership, ClaimResult, OwnershipMap } from '@/types';
import {
  cleanupStolenFrontierOrphans,
  findStolenFrontierReassignments,
} from './frontierCleanup';

const CENTER = latLngToCell(47.475, 19.015, 12);

function neighbours(cell: CellId): CellId[] {
  return gridDisk(cell, 1).filter((item) => item !== cell);
}

function ownership(owner: string, defense = 1): CellOwnership {
  return { owner, defense };
}

function stolenClaim(updates: Map<CellId, CellOwnership>): ClaimResult {
  const fates = new Map<CellId, 'stolen'>();
  for (const cell of updates.keys()) fates.set(cell, 'stolen');
  return {
    updates,
    fates,
    counts: { free: 0, reclaimed: 0, stolen: updates.size, breakthrough: 0 },
    stolenFrom: { A: updates.size },
    breakthroughFrom: {},
    weightedClaimM2: updates.size * 307.09,
    gainedM2: updates.size * 307.09,
  };
}

describe('stolen frontier orphan cleanup', () => {
  it('a <2 azonos szomszédú maradványt a legtöbb oldallal érintkező területhez adja', () => {
    const [aSide, b1, b2, b3, b4, cSide] = neighbours(CENTER);
    const before: OwnershipMap = new Map([
      [CENTER, ownership('A')],
      [aSide!, ownership('A')],
      [b1!, ownership('A')],
      [b2!, ownership('A')],
      [b3!, ownership('A')],
      [b4!, ownership('A')],
      [cSide!, ownership('C')],
    ]);
    const claim = stolenClaim(new Map([
      [b1!, ownership('B')],
      [b2!, ownership('B')],
      [b3!, ownership('B')],
      [b4!, ownership('B')],
    ]));
    const scope = new Set<CellId>(gridDisk(CENTER, 2));

    const result = cleanupStolenFrontierOrphans(claim, before, 'B', scope);

    expect(result.reassigned.has(CENTER)).toBe(true);
    expect(result.claim?.updates.get(CENTER)).toEqual(ownership('B'));
    expect(result.claim?.counts.stolen).toBe(5);
    expect(result.claim?.stolenFrom.A).toBe(5);
  });

  it('két azonos oldalszomszédnál megtartja az egycellás szélességű folyosót', () => {
    const [a1, a2, b1, b2, b3, cSide] = neighbours(CENTER);
    const before: OwnershipMap = new Map([
      [CENTER, ownership('A')],
      [a1!, ownership('A')],
      [a2!, ownership('A')],
      [b1!, ownership('A')],
      [b2!, ownership('A')],
      [b3!, ownership('A')],
      [cSide!, ownership('C')],
    ]);
    const claim = stolenClaim(new Map([
      [b1!, ownership('B')],
      [b2!, ownership('B')],
      [b3!, ownership('B')],
    ]));
    const scope = new Set<CellId>(gridDisk(CENTER, 2));

    const result = cleanupStolenFrontierOrphans(claim, before, 'B', scope);

    expect(result.reassigned.has(CENTER)).toBe(false);
    expect(result.claim?.updates.has(CENTER)).toBe(false);
  });

  it('holtversenyben nem választ önkényesen új ownert', () => {
    const [aSide, b1, b2, c1, c2] = neighbours(CENTER);
    const state = new Map<CellId, CellOwnership>([
      [CENTER, ownership('A')],
      [aSide!, ownership('A')],
      [b1!, ownership('B')],
      [b2!, ownership('B')],
      [c1!, ownership('C')],
      [c2!, ownership('C')],
    ]);

    const result = findStolenFrontierReassignments({
      stolenSeeds: [b1!],
      ownershipAt: (cell) => state.get(cell),
    });

    expect(result.has(CENTER)).toBe(false);
  });

  it('egyetlen snapshotból dönt, ezért nem eszi vissza kaszkádban a folyosót', () => {
    const end = CENTER;
    const mid = neighbours(end)[0]!;
    const tail = neighbours(mid).find((cell) => cell !== end && !neighbours(end).includes(cell))
      ?? neighbours(mid).find((cell) => cell !== end)!;

    const state = new Map<CellId, CellOwnership>();
    for (const cell of new Set([...gridDisk(end, 2), ...gridDisk(mid, 2)])) {
      state.set(cell, ownership('B'));
    }
    state.set(end, ownership('A'));
    state.set(mid, ownership('A'));
    state.set(tail, ownership('A'));

    const commonB = neighbours(end).find((cell) =>
      cell !== mid && neighbours(mid).includes(cell),
    )!;

    const result = findStolenFrontierReassignments({
      stolenSeeds: [commonB],
      ownershipAt: (cell) => state.get(cell),
    });

    expect(result.get(end)).toEqual(ownership('B'));
    expect(result.has(mid)).toBe(false);
  });
});
