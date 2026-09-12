import { describe, expect, it } from 'vitest';
import { encodePolyline } from '../../../src/game/polyline';
import type { DirectionsRoute } from './directions';
import { measureBenchmarkRoute, measureDirectedEdgeOverlaps } from './routeBenchmark';

const route = (points: Array<{ lat: number; lng: number }>): DirectionsRoute => ({
  distanceM: 300,
  durationS: 180,
  polyline: encodePolyline(points),
});

describe('route benchmark metrics', () => {
  it('measures maneuver completeness and position against the decoded route', () => {
    const points = [
      { lat: 47.5, lng: 19.04 },
      { lat: 47.501, lng: 19.04 },
      { lat: 47.501, lng: 19.041 },
    ];
    const measured = measureBenchmarkRoute({
      ...route(points),
      maneuvers: [
        { id: '0', routeOffsetM: 0, type: 'depart', position: [19.04, 47.5] },
        {
          id: '1',
          routeOffsetM: 100,
          type: 'turn',
          modifier: 'right',
          streetName: 'Teszt utca',
          position: [19.04, 47.501],
        },
        { id: '2', routeOffsetM: 300, type: 'arrive', position: [19.041, 47.501] },
      ],
    }, 0.3);

    expect(measured).toMatchObject({
      distanceErrorRatio: 0,
      maneuverCount: 3,
      namedManeuverShare: 1,
      maneuverPositionMaxErrorM: 0,
      maneuverOffsetsMonotonic: true,
      startsWithDepart: true,
      endsWithArrive: true,
    });
  });

  it('treats reversed traversal as different directed edges', () => {
    const a = { lat: 47.5, lng: 19.04 };
    const b = { lat: 47.501, lng: 19.04 };
    const c = { lat: 47.501, lng: 19.041 };
    const forward = route([a, b, c]);
    const partlyShared = route([a, b, { lat: 47.502, lng: 19.04 }]);
    const reversed = route([c, b, a]);

    expect(measureDirectedEdgeOverlaps([forward, partlyShared])[0]?.shorterRouteOverlap).toBeGreaterThan(0);
    expect(measureDirectedEdgeOverlaps([forward, reversed])[0]?.shorterRouteOverlap).toBe(0);
  });
});
