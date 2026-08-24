import { describe, expect, it } from 'vitest';
import { buildTrace, ORIGIN, squareWaypoints } from './fixtures';
import { processActivity } from './index';

describe('large compact activity pipeline', () => {
  it('több tíz km²-es valódi hurkot elfogad compact belsővel és pontos aggregátumokkal', () => {
    const points = buildTrace(squareWaypoints(ORIGIN, 5_000), {
      // A recorderhez hasonló, de a tesztet gyorsan előállító ritkább trace.
      // A traceToCellPath a köztes H3 cellákat pontosan kitölti.
      stepM: 250,
      intervalS: 1,
      accuracy: 1,
    });

    const result = processActivity({
      points,
      type: 'ride',
      distanceKm: 20,
      actorId: 'u1',
      ownership: new Map(),
      streakDays: 1,
      gpEarnedToday: 0,
    });

    expect(result.diagnostics.loops.rejected.filter((item) => item.reason === 'too_large')).toHaveLength(0);
    expect(result.loops).toHaveLength(1);
    expect(result.loops[0]!.compactInterior).toBeDefined();
    expect(result.compactClaim).not.toBeNull();
    expect(result.claimedCellCount).toBeGreaterThan(40_000);
    expect(result.claim?.counts.free).toBe(result.claimedCellCount);
    expect(result.areaGainedM2).toBeGreaterThan(10_000_000);
    expect(result.gp.total).toBeGreaterThan(0);
  });
});
