import { describe, expect, it } from 'vitest';
import { offset, ORIGIN, buildTrace } from './fixtures';
import { traceToCellPath } from './cells';
import { detectLoopsDetailed } from './loopDetection';
import { processActivity } from './index';

function diagnose(waypoints: { lat: number; lng: number }[]) {
  const points = buildTrace(waypoints, { stepM: 6 });
  const { path } = traceToCellPath(points);
  const detection = detectLoopsDetailed(path);
  const result = processActivity({
    points,
    type: 'run',
    distanceKm: 1,
    actorId: 'u1',
    ownership: new Map(),
    streakDays: 0,
    gpEarnedToday: 0,
  });
  return { path, detection, result };
}

describe('post-closure spur diagnostic', () => {
  it('prints the exact extra closure/cells', () => {
    const A = ORIGIN;
    const B = offset(ORIGIN, 0, 200);
    const C = offset(ORIGIN, 200, 200);
    const D = offset(ORIGIN, 200, 0);
    const clean = diagnose([A, B, C, D, A]);
    const spur = diagnose([A, B, C, D, A, offset(ORIGIN, 240, -40), A]);
    const extra = [...spur.result.claimedCells].filter((cell) => !clean.result.claimedCells.has(cell));

    console.log('SPUR_DIAG', JSON.stringify({
      cleanPath: clean.path.length,
      spurPath: spur.path.length,
      cleanClaimed: clean.result.claimedCells.size,
      spurClaimed: spur.result.claimedCells.size,
      cleanLoops: clean.detection.loops.map((loop) => ({ from: loop.fromIndex, to: loop.toIndex, wall: loop.wall.size, interior: loop.interior.size })),
      spurLoops: spur.detection.loops.map((loop) => ({ from: loop.fromIndex, to: loop.toIndex, wall: loop.wall.size, interior: loop.interior.size })),
      successful: spur.detection.diagnostics.successful,
      rejected: spur.detection.diagnostics.rejected,
      extra,
    }));

    expect(spur.detection.loops.length).toBeGreaterThan(0);
  });
});
