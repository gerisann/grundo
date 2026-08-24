import { describe, expect, it } from 'vitest';
import { multiLap, simpleLoop } from './fixtures';
import { processActivity } from './index';

function run(points: ReturnType<typeof simpleLoop>, distanceKm: number) {
  return processActivity({
    points,
    type: 'run',
    distanceKm,
    actorId: 'u1',
    ownership: new Map(),
    streakDays: 1,
    gpEarnedToday: 0,
  });
}

describe('multi-lap diagnostic', () => {
  it('prints exact extra cell and loop geometries', () => {
    const single = run(simpleLoop(200), 0.8);
    const four = run(multiLap(4, 200), 3.2);
    const extra = [...four.claimedCells].filter((cell) => !single.claimedCells.has(cell));
    const missing = [...single.claimedCells].filter((cell) => !four.claimedCells.has(cell));
    console.log('MULTILAP_DIAG', JSON.stringify({
      singleClaimed: single.claimedCells.size,
      fourClaimed: four.claimedCells.size,
      singleLoops: single.loops.map((loop) => ({ from: loop.fromIndex, to: loop.toIndex, wall: loop.wall.size, interior: loop.interior.size })),
      fourLoops: four.loops.map((loop) => ({ from: loop.fromIndex, to: loop.toIndex, wall: loop.wall.size, interior: loop.interior.size })),
      extra,
      missing,
    }));
    expect(four.loops.length).toBeGreaterThanOrEqual(single.loops.length);
  });
});
