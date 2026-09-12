/**
 * Read-only Route Intelligence benchmark.
 *
 * It calls the same planner used by the mission API, records aggregate metrics,
 * and never writes application data. The optional output is a local JSON
 * artifact suitable for committing as a comparison baseline.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DEFAULT_GAMEPLAY } from '../../../src/config/gameplay';
import {
  BUDAPEST_ROUTE_BENCHMARK_CASES,
  ROUTE_BENCHMARK_CORPUS_VERSION,
} from '../fixtures/routeBenchmarkBudapest';
import { graphhopperConfigured, mapboxToken, planMissionLoop } from '../lib/directions';
import {
  measureBenchmarkRoute,
  measureDirectedEdgeOverlaps,
  type RouteBenchmarkMeasurement,
  type RouteOverlapMeasurement,
} from '../lib/routeBenchmark';

interface RequestCounts {
  graphhopper: number;
  mapbox: number;
  other: number;
}

interface BenchmarkCaseResult {
  id: string;
  name: string;
  activity: string;
  profile: string;
  terrain: string;
  junctions: string;
  character: string;
  targetKm: number;
  bearingDeg: number;
  latencyMs: number;
  requests: RequestCounts;
  fallbackAttempted: boolean;
  fallbackUsed: boolean;
  candidateCount: number;
  candidateShortfall: number;
  elevationAvailable: false;
  routes: RouteBenchmarkMeasurement[];
  directedEdgeOverlaps: RouteOverlapMeasurement[];
}

const outputArg = valueAfter('--output=');
const graphVersion = valueAfter('--graph-version=') ?? 'unspecified';
const warmupRequested = process.argv.includes('--warmup');

if (!graphhopperConfigured() && !mapboxToken()) {
  throw new Error('Set GRAPHHOPPER_URL or MAPBOX_TOKEN before running the route benchmark.');
}

const originalFetch = globalThis.fetch;
let activeCounts: RequestCounts | null = null;
globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  if (activeCounts) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (url.includes('api.mapbox.com/directions/')) activeCounts.mapbox += 1;
    else if (url.includes('/route')) activeCounts.graphhopper += 1;
    else activeCounts.other += 1;
  }
  return originalFetch(input, init);
};

const cases: BenchmarkCaseResult[] = [];
try {
  if (warmupRequested) {
    const warmup = BUDAPEST_ROUTE_BENCHMARK_CASES[0]!;
    console.log(`Warmup: ${warmup.id}`);
    await planMissionLoop(
      warmup.origin,
      warmup.bearingDeg,
      warmup.targetKm,
      warmup.profile,
      DEFAULT_GAMEPLAY,
      warmup.character,
    );
  }

  for (const benchmarkCase of BUDAPEST_ROUTE_BENCHMARK_CASES) {
    const requests: RequestCounts = { graphhopper: 0, mapbox: 0, other: 0 };
    activeCounts = requests;
    const startedAt = performance.now();
    const routes = await planMissionLoop(
      benchmarkCase.origin,
      benchmarkCase.bearingDeg,
      benchmarkCase.targetKm,
      benchmarkCase.profile,
      DEFAULT_GAMEPLAY,
      benchmarkCase.character,
    );
    const latencyMs = performance.now() - startedAt;
    activeCounts = null;

    const fallbackAttempted = requests.mapbox > 0 && requests.graphhopper > 0;
    cases.push({
      id: benchmarkCase.id,
      name: benchmarkCase.name,
      activity: benchmarkCase.activity,
      profile: benchmarkCase.profile,
      terrain: benchmarkCase.terrain,
      junctions: benchmarkCase.junctions,
      character: benchmarkCase.character,
      targetKm: benchmarkCase.targetKm,
      bearingDeg: benchmarkCase.bearingDeg,
      latencyMs: round(latencyMs, 1),
      requests,
      fallbackAttempted,
      fallbackUsed: fallbackAttempted && routes.length > 0,
      candidateCount: routes.length,
      candidateShortfall: Math.max(0, 3 - routes.length),
      elevationAvailable: false,
      routes: routes.map((route) => measureBenchmarkRoute(route, benchmarkCase.targetKm)),
      directedEdgeOverlaps: measureDirectedEdgeOverlaps(routes),
    });
    console.log(
      `${benchmarkCase.id}: ${routes.length} candidate(s), ${latencyMs.toFixed(0)} ms, ` +
        `GH=${requests.graphhopper}, Mapbox=${requests.mapbox}`,
    );
  }
} finally {
  activeCounts = null;
  globalThis.fetch = originalFetch;
}

const successfulCases = cases.filter((entry) => entry.candidateCount > 0);
const latencies = cases.map((entry) => entry.latencyMs).sort((a, b) => a - b);
const routeMeasurements = cases.flatMap((entry) => entry.routes);
const overlaps = cases.flatMap((entry) => entry.directedEdgeOverlaps);
const report = {
  schemaVersion: 1,
  corpusVersion: ROUTE_BENCHMARK_CORPUS_VERSION,
  generatedAt: new Date().toISOString(),
  gitCommit: gitCommit(),
  graphVersion,
  configuration: {
    graphhopper: graphhopperConfigured(),
    mapboxFallback: mapboxToken().length > 0,
    requestedCandidatesPerCase: 3,
    elevationRequested: false,
    warmup: warmupRequested,
  },
  summary: {
    caseCount: cases.length,
    successfulCaseCount: successfulCases.length,
    fallbackAttemptCount: cases.filter((entry) => entry.fallbackAttempted).length,
    fallbackSuccessCount: cases.filter((entry) => entry.fallbackUsed).length,
    candidateCount: cases.reduce((sum, entry) => sum + entry.candidateCount, 0),
    candidateShortfall: cases.reduce((sum, entry) => sum + entry.candidateShortfall, 0),
    medianLatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    meanDistanceErrorRatio: mean(routeMeasurements.map((route) => route.distanceErrorRatio)),
    meanManeuverCount: mean(routeMeasurements.map((route) => route.maneuverCount)),
    meanNamedManeuverShare: mean(routeMeasurements.map((route) => route.namedManeuverShare)),
    maxManeuverPositionErrorM: maximum(
      routeMeasurements.flatMap((route) => route.maneuverPositionMaxErrorM ?? []),
    ),
    meanDirectedEdgeOverlap: mean(overlaps.map((overlap) => overlap.shorterRouteOverlap)),
    maxDirectedEdgeOverlap: maximum(overlaps.map((overlap) => overlap.shorterRouteOverlap)),
  },
  cases,
};

if (outputArg) {
  const outputPath = resolve(process.cwd(), outputArg);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Baseline written: ${outputPath}`);
} else {
  console.log(JSON.stringify(report.summary, null, 2));
}

function valueAfter(prefix: string): string | undefined {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  const value = argument?.slice(prefix.length).trim();
  return value || undefined;
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: resolve(process.cwd(), '..'),
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  return values[Math.ceil(values.length * fraction) - 1] ?? values.at(-1) ?? null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 4);
}

function maximum(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
