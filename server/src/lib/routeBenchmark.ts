import { createHash } from 'node:crypto';
import { distanceM, type LatLng } from '../../../src/game/geo';
import { decodePolyline } from '../../../src/game/polyline';
import { countShortDetours, countUTurns, measureStraightness } from '../../../src/game/routeShape';
import type { RouteManeuver } from '../../../src/types';
import type { DirectionsRoute } from './directions';

const EDGE_COORDINATE_DECIMALS = 5;

export interface RouteBenchmarkMeasurement {
  geometryHash: string;
  distanceM: number;
  durationS: number;
  distanceErrorRatio: number;
  pointCount: number;
  maneuverCount: number;
  namedManeuverShare: number;
  maneuverPositionMaxErrorM: number | null;
  maneuverOffsetsMonotonic: boolean;
  startsWithDepart: boolean;
  endsWithArrive: boolean;
  uTurns: number;
  shortDetours: number;
  turnCount: number;
  averageStraightM: number;
}

export interface RouteOverlapMeasurement {
  firstGeometryHash: string;
  secondGeometryHash: string;
  shorterRouteOverlap: number;
}

export function measureBenchmarkRoute(
  route: DirectionsRoute,
  targetKm: number,
): RouteBenchmarkMeasurement {
  const points = decodePolyline(route.polyline);
  const maneuvers = route.maneuvers ?? [];
  const namedManeuvers = maneuvers.filter(
    (maneuver) => maneuver.type !== 'depart' && maneuver.type !== 'arrive' && maneuver.streetName,
  );
  const nameEligible = maneuvers.filter(
    (maneuver) => maneuver.type !== 'depart' && maneuver.type !== 'arrive',
  );
  const straightness = measureStraightness(points);

  return {
    geometryHash: createHash('sha256').update(route.polyline).digest('hex').slice(0, 16),
    distanceM: round(route.distanceM, 1),
    durationS: round(route.durationS, 1),
    distanceErrorRatio: round(Math.abs(route.distanceM - targetKm * 1000) / (targetKm * 1000), 4),
    pointCount: points.length,
    maneuverCount: maneuvers.length,
    namedManeuverShare: nameEligible.length === 0 ? 0 : round(namedManeuvers.length / nameEligible.length, 4),
    maneuverPositionMaxErrorM: measureManeuverPositionMaxError(points, maneuvers),
    maneuverOffsetsMonotonic: maneuvers.every(
      (maneuver, index) => index === 0 || maneuver.routeOffsetM >= maneuvers[index - 1]!.routeOffsetM,
    ),
    startsWithDepart: maneuvers[0]?.type === 'depart',
    endsWithArrive: maneuvers.at(-1)?.type === 'arrive',
    uTurns: countUTurns(points),
    shortDetours: countShortDetours(points),
    turnCount: straightness.turnCount,
    averageStraightM: round(straightness.averageStraightM, 1),
  };
}

export function measureDirectedEdgeOverlaps(
  routes: readonly DirectionsRoute[],
): RouteOverlapMeasurement[] {
  const measured = routes.map((route) => ({
    hash: createHash('sha256').update(route.polyline).digest('hex').slice(0, 16),
    edges: directedEdges(decodePolyline(route.polyline)),
  }));
  const overlaps: RouteOverlapMeasurement[] = [];

  for (let firstIndex = 0; firstIndex < measured.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < measured.length; secondIndex += 1) {
      const first = measured[firstIndex]!;
      const second = measured[secondIndex]!;
      let sharedM = 0;
      for (const [edge, firstLength] of first.edges.weights) {
        const secondLength = second.edges.weights.get(edge);
        if (secondLength !== undefined) sharedM += Math.min(firstLength, secondLength);
      }
      const shorterM = Math.min(first.edges.totalM, second.edges.totalM);
      overlaps.push({
        firstGeometryHash: first.hash,
        secondGeometryHash: second.hash,
        shorterRouteOverlap: shorterM === 0 ? 0 : round(sharedM / shorterM, 4),
      });
    }
  }

  return overlaps;
}

function measureManeuverPositionMaxError(
  points: readonly LatLng[],
  maneuvers: readonly RouteManeuver[],
): number | null {
  if (points.length === 0 || maneuvers.length === 0) return null;
  let maximum = 0;
  for (const maneuver of maneuvers) {
    const position = { lat: maneuver.position[1], lng: maneuver.position[0] };
    let nearest = Number.POSITIVE_INFINITY;
    for (const point of points) nearest = Math.min(nearest, distanceM(position, point));
    maximum = Math.max(maximum, nearest);
  }
  return round(maximum, 1);
}

function directedEdges(points: readonly LatLng[]): { weights: Map<string, number>; totalM: number } {
  const weights = new Map<string, number>();
  let totalM = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const length = distanceM(from, to);
    if (!(length > 0)) continue;
    const key = `${coordinateKey(from)}>${coordinateKey(to)}`;
    weights.set(key, (weights.get(key) ?? 0) + length);
    totalM += length;
  }
  return { weights, totalM };
}

function coordinateKey(point: LatLng): string {
  return `${point.lat.toFixed(EDGE_COORDINATE_DECIMALS)},${point.lng.toFixed(EDGE_COORDINATE_DECIMALS)}`;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
