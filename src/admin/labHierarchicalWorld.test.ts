import { describe, expect, it } from 'vitest';
import { getResolution } from 'h3-js';
import { buildActivityGeometry } from '@/game';
import { buildTrace, ORIGIN, squareWaypoints } from '@/game/fixtures';
import type { OwnershipMap } from '@/types';
import {
  countLabPlayerCells,
  processLabActivity,
} from './labHierarchicalWorld';

function apply(world: OwnershipMap, result: ReturnType<typeof processLabActivity>): void {
  for (const [cell, ownership] of result.claim?.updates ?? []) world.set(cell, ownership);
}

function process(
  world: OwnershipMap,
  actorId: string,
  sideM: number,
  stepM: number,
) {
  const points = buildTrace(squareWaypoints(ORIGIN, sideM), {
    stepM,
    intervalS: 1,
    accuracy: 1,
  });
  const geometry = buildActivityGeometry(points);
  return processLabActivity({
    points,
    type: 'ride',
    distanceKm: (sideM * 4) / 1000,
    actorId,
    ownership: world,
    streakDays: 1,
    gpEarnedToday: 0,
  }, geometry);
}

describe('hierarchical multiplayer LAB world', () => {
  it('compact nagy területet másik player bulk módon el tud lopni', () => {
    const world: OwnershipMap = new Map();

    const first = process(world, 'A', 5_000, 250);
    expect(first.compactClaim).not.toBeNull();
    expect(first.claimedCellCount).toBeGreaterThan(40_000);
    apply(world, first);

    expect([...world.keys()].some((cell) => getResolution(cell) < 12)).toBe(true);
    const aBefore = countLabPlayerCells(world, 'A');
    expect(aBefore).toBe(first.claimedCellCount);

    const second = process(world, 'B', 5_000, 250);
    expect(second.compactClaim).not.toBeNull();
    expect(second.claim?.counts.stolen ?? 0).toBeGreaterThan(40_000);
    apply(world, second);

    expect(countLabPlayerCells(world, 'B')).toBe(first.claimedCellCount);
    expect(countLabPlayerCells(world, 'A')).toBe(0);
  });

  it('kis normál hurok csak res12 override-okkal harap bele egy compact parent worldbe', () => {
    const world: OwnershipMap = new Map();

    const large = process(world, 'A', 5_000, 250);
    apply(world, large);
    const aBefore = countLabPlayerCells(world, 'A');
    const parentEntriesBefore = [...world.keys()].filter((cell) => getResolution(cell) < 12).length;
    expect(parentEntriesBefore).toBeGreaterThan(0);

    const small = process(world, 'B', 400, 12);
    expect(small.compactClaim).toBeNull();
    expect(small.claim?.counts.stolen ?? 0).toBeGreaterThan(0);
    apply(world, small);

    const bAfter = countLabPlayerCells(world, 'B');
    const aAfter = countLabPlayerCells(world, 'A');
    expect(bAfter).toBeGreaterThan(0);
    expect(aAfter).toBeLessThan(aBefore);
    expect(aAfter + bAfter).toBe(aBefore);
    expect([...world.keys()].filter((cell) => getResolution(cell) < 12).length).toBe(parentEntriesBefore);
  });
});
