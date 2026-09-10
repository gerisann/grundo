import { describe, expect, it } from 'vitest';
import { destinationPoint } from '@/game/missions';
import type { RouteManeuver } from '@/types';
import { prepareRoute, updateRouteProgress, type RouteProgressOptions } from './routeProgress';

const ORIGIN = { lat: 47.5, lng: 19.04 };
const EAST = destinationPoint(ORIGIN, 90, 1_000);
const NORTH_EAST = destinationPoint(EAST, 0, 1_000);
const OPTIONS: RouteProgressOptions = {
  offRouteThresholdM: 30,
  projectionTieToleranceM: 5,
};

const maneuvers: RouteManeuver[] = [
  { id: 'depart', routeOffsetM: 0, type: 'depart', position: [ORIGIN.lng, ORIGIN.lat] },
  { id: 'turn', routeOffsetM: 1_000, type: 'turn', modifier: 'left', position: [EAST.lng, EAST.lat] },
  { id: 'arrive', routeOffsetM: 2_000, type: 'arrive', position: [NORTH_EAST.lng, NORTH_EAST.lat] },
];

describe('route progress engine', () => {
  it('projects a GPS sample onto the route and selects the next maneuver', () => {
    const route = prepareRoute([ORIGIN, EAST, NORTH_EAST], maneuvers);
    const position = destinationPoint(ORIGIN, 90, 400);

    const progress = updateRouteProgress({
      route,
      position,
      options: OPTIONS,
      averageSpeedMps: 2,
      sampledAt: 1_000_000,
    });

    expect(progress.matchedOffsetM).toBeCloseTo(400, 0);
    expect(progress.remainingDistanceM).toBeCloseTo(1_600, 0);
    expect(progress.nextManeuver?.id).toBe('turn');
    expect(progress.distanceToNextManeuverM).toBeCloseTo(600, 0);
    expect(progress.estimatedArrivalAt).toBeCloseTo(1_800_000, -2);
    expect(progress.offRoute).toBe(false);
  });

  it('keeps navigation progress monotonic when the user walks backwards', () => {
    const route = prepareRoute([ORIGIN, EAST, NORTH_EAST], maneuvers);
    const forward = updateRouteProgress({
      route,
      position: destinationPoint(ORIGIN, 90, 650),
      options: OPTIONS,
    });
    const backward = updateRouteProgress({
      route,
      position: destinationPoint(ORIGIN, 90, 350),
      previous: forward,
      options: OPTIONS,
    });

    expect(backward.matchedOffsetM).toBe(forward.matchedOffsetM);
    expect(backward.nextManeuver?.id).toBe('turn');
  });

  it('reports distance and confidence when the sample is off route', () => {
    const route = prepareRoute([ORIGIN, EAST, NORTH_EAST], maneuvers);
    const onRoute = destinationPoint(ORIGIN, 90, 400);
    const offRoute = destinationPoint(onRoute, 180, 75);

    const progress = updateRouteProgress({ route, position: offRoute, options: OPTIONS });

    expect(progress.distanceFromRouteM).toBeCloseTo(75, 0);
    expect(progress.offRoute).toBe(true);
    expect(progress.matchConfidence).toBe(0);
  });

  it('uses prior progress to disambiguate the shared start and finish of a loop', () => {
    const route = prepareRoute([ORIGIN, EAST, NORTH_EAST, ORIGIN]);
    const atStart = updateRouteProgress({ route, position: ORIGIN, options: OPTIONS });
    const nearFinish = updateRouteProgress({
      route,
      position: destinationPoint(ORIGIN, 45, 5),
      previous: {
        ...atStart,
        matchedOffsetM: route.totalDistanceM - 20,
        matchedSegmentIndex: 2,
      },
      options: OPTIONS,
    });

    expect(atStart.matchedSegmentIndex).toBe(0);
    expect(nearFinish.matchedSegmentIndex).toBe(2);
    expect(nearFinish.remainingDistanceM).toBeLessThan(30);
  });

  it('leaves off-route classification disabled until measured thresholds are supplied', () => {
    const route = prepareRoute([ORIGIN, EAST]);

    const progress = updateRouteProgress({ route, position: ORIGIN, options: {} });

    expect(progress.offRoute).toBeNull();
    expect(progress.matchConfidence).toBeNull();
  });

  it('rejects invalid configured matching thresholds', () => {
    const route = prepareRoute([ORIGIN, EAST]);

    expect(() => updateRouteProgress({
      route,
      position: ORIGIN,
      options: { offRouteThresholdM: 0, projectionTieToleranceM: 0 },
    })).toThrow('offRouteThresholdM');
  });
});
