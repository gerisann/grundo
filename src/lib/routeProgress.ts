import { distanceM, type LatLng } from '@/game/geo';
import type { RouteManeuver } from '@/types';

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export interface PreparedRoute {
  points: readonly LatLng[];
  maneuvers: readonly RouteManeuver[];
  segmentLengthsM: readonly number[];
  segmentStartOffsetsM: readonly number[];
  totalDistanceM: number;
}

export interface RouteProgressOptions {
  /** Measured distance from the geometry above which guidance reports an off-route state. */
  offRouteThresholdM?: number;
  /** Equally close segments inside this band are resolved by continuity with prior progress. */
  projectionTieToleranceM?: number;
}

export interface RouteProgressState {
  matchedOffsetM: number;
  matchedSegmentIndex: number;
  distanceFromRouteM: number;
  remainingDistanceM: number;
  nextManeuver?: RouteManeuver;
  distanceToNextManeuverM?: number;
  estimatedArrivalAt?: number;
  /** Null until a device-tested threshold is configured. */
  offRoute: boolean | null;
  /** Null until a device-tested threshold is configured. */
  matchConfidence: number | null;
}

interface Projection {
  segmentIndex: number;
  routeOffsetM: number;
  distanceM: number;
}

export function prepareRoute(
  points: readonly LatLng[],
  maneuvers: readonly RouteManeuver[] = [],
): PreparedRoute {
  if (points.length < 2) throw new Error('A route needs at least two points.');

  const segmentLengthsM: number[] = [];
  const segmentStartOffsetsM: number[] = [];
  let totalDistanceM = 0;
  for (let index = 1; index < points.length; index += 1) {
    segmentStartOffsetsM.push(totalDistanceM);
    const lengthM = distanceM(points[index - 1]!, points[index]!);
    segmentLengthsM.push(lengthM);
    totalDistanceM += lengthM;
  }

  return {
    points: [...points],
    maneuvers: [...maneuvers]
      .filter((maneuver) => Number.isFinite(maneuver.routeOffsetM) && maneuver.routeOffsetM >= 0)
      .sort((a, b) => a.routeOffsetM - b.routeOffsetM),
    segmentLengthsM,
    segmentStartOffsetsM,
    totalDistanceM,
  };
}

export function updateRouteProgress(args: {
  route: PreparedRoute;
  position: LatLng;
  previous?: RouteProgressState;
  options: RouteProgressOptions;
  averageSpeedMps?: number;
  sampledAt?: number;
}): RouteProgressState {
  const { route, position, previous, options } = args;
  validateOptions(options);

  const projections = projectToSegments(route, position);
  const nearestDistanceM = Math.min(...projections.map((projection) => projection.distanceM));
  const tied = projections.filter(
    (projection) => projection.distanceM <= nearestDistanceM + (options.projectionTieToleranceM ?? 0),
  );
  const continuityOffsetM = previous?.matchedOffsetM ?? 0;
  const selected = tied.sort((a, b) => {
    const continuityDifference =
      Math.abs(a.routeOffsetM - continuityOffsetM) - Math.abs(b.routeOffsetM - continuityOffsetM);
    return continuityDifference || a.distanceM - b.distanceM || a.segmentIndex - b.segmentIndex;
  })[0]!;

  // Route progress is monotonic. Backtracking still changes the actual recorded distance,
  // but it cannot make the next navigation instruction jump backwards.
  const matchedOffsetM = Math.min(
    route.totalDistanceM,
    Math.max(previous?.matchedOffsetM ?? 0, selected.routeOffsetM),
  );
  const matchedSegmentIndex = selected.routeOffsetM < (previous?.matchedOffsetM ?? 0)
    ? previous?.matchedSegmentIndex ?? selected.segmentIndex
    : selected.segmentIndex;
  const remainingDistanceM = Math.max(0, route.totalDistanceM - matchedOffsetM);
  const nextManeuver = route.maneuvers.find(
    (maneuver) => maneuver.routeOffsetM >= matchedOffsetM,
  );
  const distanceToNextManeuverM = nextManeuver
    ? Math.max(0, nextManeuver.routeOffsetM - matchedOffsetM)
    : undefined;
  const averageSpeedMps = Number(args.averageSpeedMps);
  const sampledAt = args.sampledAt ?? Date.now();
  const estimatedArrivalAt =
    Number.isFinite(averageSpeedMps) && averageSpeedMps > 0
      ? sampledAt + Math.round((remainingDistanceM / averageSpeedMps) * 1000)
      : undefined;

  const offRouteThresholdM = options.offRouteThresholdM;
  const matchingConfigured = offRouteThresholdM !== undefined;
  return {
    matchedOffsetM,
    matchedSegmentIndex,
    distanceFromRouteM: selected.distanceM,
    remainingDistanceM,
    ...(nextManeuver ? { nextManeuver } : {}),
    ...(distanceToNextManeuverM === undefined ? {} : { distanceToNextManeuverM }),
    ...(estimatedArrivalAt === undefined ? {} : { estimatedArrivalAt }),
    offRoute: matchingConfigured ? selected.distanceM > offRouteThresholdM : null,
    matchConfidence: matchingConfigured
      ? Math.max(0, 1 - selected.distanceM / offRouteThresholdM)
      : null,
  };
}

function validateOptions(options: RouteProgressOptions): void {
  if (
    options.offRouteThresholdM !== undefined &&
    (!Number.isFinite(options.offRouteThresholdM) || options.offRouteThresholdM <= 0)
  ) {
    throw new Error('offRouteThresholdM must be greater than zero.');
  }
  if (
    options.projectionTieToleranceM !== undefined &&
    (!Number.isFinite(options.projectionTieToleranceM) || options.projectionTieToleranceM < 0)
  ) {
    throw new Error('projectionTieToleranceM must not be negative.');
  }
}

function projectToSegments(route: PreparedRoute, position: LatLng): Projection[] {
  const projections: Projection[] = [];
  for (let index = 0; index < route.points.length - 1; index += 1) {
    const start = route.points[index]!;
    const end = route.points[index + 1]!;
    const projected = projectToSegment(position, start, end);
    projections.push({
      segmentIndex: index,
      routeOffsetM:
        route.segmentStartOffsetsM[index]! + route.segmentLengthsM[index]! * projected.fraction,
      distanceM: projected.distanceM,
    });
  }
  return projections;
}

function projectToSegment(
  position: LatLng,
  start: LatLng,
  end: LatLng,
): { fraction: number; distanceM: number } {
  const referenceLat = position.lat * RAD;
  const startX = (start.lng - position.lng) * RAD * EARTH_RADIUS_M * Math.cos(referenceLat);
  const startY = (start.lat - position.lat) * RAD * EARTH_RADIUS_M;
  const endX = (end.lng - position.lng) * RAD * EARTH_RADIUS_M * Math.cos(referenceLat);
  const endY = (end.lat - position.lat) * RAD * EARTH_RADIUS_M;
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared > 0
    ? Math.max(0, Math.min(1, -(startX * dx + startY * dy) / lengthSquared))
    : 0;
  const projectedX = startX + fraction * dx;
  const projectedY = startY + fraction * dy;
  return { fraction, distanceM: Math.hypot(projectedX, projectedY) };
}
