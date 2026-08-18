import { describe, expect, it } from 'vitest';
import { processActivity } from '../../../src/game';
import { simpleLoop } from '../../../src/game/fixtures';
import { GAMEPLAY } from '../../../src/config/gameplay';
import { blockIdFor, cellKey, gameDay, type GridBlock } from './gridMath';
import { ownershipFromBlocks } from './grid';

const ACTOR = 'actor';
const RIVAL = 'rival';
const TODAY = gameDay(new Date('2026-08-18T12:00:00Z'));
const POINTS = simpleLoop(200);

function calculate(blocks: ReadonlyMap<string, GridBlock | null>) {
  const probe = processActivity({
    points: POINTS,
    type: 'run',
    distanceKm: 0.8,
    actorId: ACTOR,
    ownership: new Map(),
    streakDays: 1,
    gpEarnedToday: 0,
  });
  const ownership = ownershipFromBlocks('foot', probe.claimedCells, blocks, TODAY);
  return processActivity({
    points: POINTS,
    type: 'run',
    distanceKm: 0.8,
    actorId: ACTOR,
    ownership,
    streakDays: 1,
    gpEarnedToday: 0,
  });
}

function blockWith(cell: string, defense: number): Map<string, GridBlock | null> {
  const blockId = blockIdFor('foot', cell);
  const parent = blockId.slice('foot_'.length);
  return new Map([
    [
      blockId,
      {
        layer: 'foot',
        parent,
        cells: { [cellKey(cell)]: { o: RIVAL, d: defense, u: TODAY } },
        ownerCounts: { [RIVAL]: 1 },
        version: 1,
      },
    ],
  ]);
}

describe('aktivitás commit újraszámítása', () => {
  const probe = calculate(new Map());
  const interiorCell = probe.loops[0]?.interior.values().next().value as string | undefined;

  it('a hurok belső cellájának ownershipjét is figyelembe veszi', () => {
    expect(interiorCell).toBeTruthy();
    const result = calculate(blockWith(interiorCell!, 3));

    expect(result.claim?.fates.get(interiorCell!)).toBe('breakthrough');
    expect(result.claim?.updates.get(interiorCell!)).toEqual({ owner: RIVAL, defense: 2 });
  });

  it('retry után az új blokkállapotból más eredményt ad', () => {
    expect(interiorCell).toBeTruthy();
    const firstAttempt = calculate(new Map());
    const retriedAttempt = calculate(blockWith(interiorCell!, 1));

    expect(firstAttempt.claim?.fates.get(interiorCell!)).toBe('free');
    expect(retriedAttempt.claim?.fates.get(interiorCell!)).toBe('stolen');
    expect(retriedAttempt.claim?.stolenFrom[RIVAL]).toBe(1);
    expect(firstAttempt.areaGainedM2 - retriedAttempt.areaGainedM2)
      .toBeLessThanOrEqual(GAMEPLAY.CELL_AREA_M2);
  });
});
