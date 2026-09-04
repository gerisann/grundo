/**
 * AZ INKREMENTÁLIS ELŐNÉZET NEM TÉRHET EL A BATCH ELSZÁMOLÁSTÓL.
 *
 * Az `IncrementalActivityClaims` két bezárás között újrahasználja a korábbi
 * eredményt. Ez akkor és csak akkor helyes, ha a körüljárási térkép tényleg
 * változatlan — az osztály ezt három feltétellel dönti el (új hurok, saját
 * cellába visszalépés, új kör).
 *
 * Ez a teszt nem a feltételeket ellenőrzi, hanem a KÖVETKEZMÉNYT: egy valódi
 * nyomvonalat mintáról mintára végigjátszva a gyorsított és a batch eredmény
 * cellánként, sorsonként és GP-ben is egyezik. Ha bármelyik feltétel hiányos,
 * itt bukik el — nem élesben, a felhasználó területén.
 */

import { describe, expect, it } from 'vitest';

import { IncrementalActivityGeometry, processActivityGeometry } from './index';
import { IncrementalActivityClaims } from './incrementalClaims';
import { generateGpsActivity, type SimulationWaypoint } from '@/tracking/simulationSource';
import type { PositionSample } from '@/tracking/types';
import type { ProcessResult } from './index';
import type { CellId, OwnershipMap, TracePoint } from '@/types';

const ORIGIN = { lat: 47.4979, lng: 19.0402 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

function offset(eastM: number, northM: number): SimulationWaypoint {
  return {
    lat: ORIGIN.lat + northM / M_PER_DEG_LAT,
    lng: ORIGIN.lng + eastM / M_PER_DEG_LNG,
  };
}

/** Városi rács: több egymást keresztező hurok, mint egy valódi futásnál. */
function cityRoute(legs: number): SimulationWaypoint[] {
  const route: SimulationWaypoint[] = [offset(0, 0)];
  for (let row = 0; row < legs; row += 1) {
    const eastEnd = row % 2 === 0 ? 600 : 0;
    route.push(offset(eastEnd, row * 200));
    route.push(offset(eastEnd, (row + 1) * 200));
  }
  route.push(offset(0, legs * 200));
  route.push(offset(0, 0));
  return route;
}

/** Ugyanaz a kör négyszer — itt NŐ a körüljárási szám menet közben. */
function repeatedLaps(laps: number): SimulationWaypoint[] {
  const route: SimulationWaypoint[] = [];
  for (let lap = 0; lap < laps; lap += 1) {
    route.push(offset(0, 0), offset(200, 0), offset(200, 200), offset(0, 200), offset(0, 0));
  }
  return route;
}

function toTracePoint(sample: PositionSample): TracePoint {
  return { lat: sample.lat, lng: sample.lng, t: sample.t, accuracy: sample.accuracy };
}

function samplesOf(route: SimulationWaypoint[], speedKmh: number): TracePoint[] {
  return generateGpsActivity(route, {
    activityType: 'ride',
    speedKmh,
    sampleIntervalS: 1,
    seed: 4242,
  }).samples.map(toTracePoint);
}

function expectSameResult(actual: ProcessResult, expected: ProcessResult, at: number): void {
  const where = `${at} mintánál`;
  expect(actual.claimedCellCount, where).toBe(expected.claimedCellCount);
  expect(actual.areaGainedM2, where).toBe(expected.areaGainedM2);
  expect(actual.gp, where).toEqual(expected.gp);
  expect([...actual.claimedCells].sort(), where).toEqual([...expected.claimedCells].sort());

  expect(actual.claim === null, where).toBe(expected.claim === null);
  if (actual.claim === null || expected.claim === null) return;

  expect(actual.claim.counts, where).toEqual(expected.claim.counts);
  expect(actual.claim.stolenFrom, where).toEqual(expected.claim.stolenFrom);
  expect(actual.claim.breakthroughFrom, where).toEqual(expected.claim.breakthroughFrom);
  expect(actual.claim.weightedClaimM2, where).toBe(expected.claim.weightedClaimM2);
  expect(actual.claim.gainedM2, where).toBe(expected.claim.gainedM2);

  expect([...actual.claim.fates].sort(), where).toEqual([...expected.claim.fates].sort());
  const asPairs = (map: ProcessResult['claim'] extends null ? never : Map<CellId, { owner: string; defense: number }>) =>
    [...map].map(([cell, held]) => `${cell}:${held.owner}:${held.defense}`).sort();
  expect(asPairs(actual.claim.updates), where).toEqual(asPairs(expected.claim.updates));
}

describe('IncrementalActivityClaims — a batch eredménnyel egyezik', () => {
  const cases: Array<{
    name: string;
    points: TracePoint[];
    ownership: OwnershipMap;
    step: number;
    /**
     * Elvárható-e egyáltalán újrahasználás? A körbe-körbe futásnál NEM: a
     * nyomvonal minden körben visszalép a saját, már megszerzett celláiba,
     * ami épp az egyik érvénytelenítő feltétel. Ez nem hiba, hanem a
     * gyorsítótár hatókörének mért határa — a helyességet ott is ellenőrizzük.
     */
    expectHits: boolean;
  }> = [
    {
      name: 'városi rács, több egymást metsző hurok',
      points: samplesOf(cityRoute(8), 18),
      ownership: new Map(),
      step: 25,
      expectHits: true,
    },
    {
      name: 'négyszer megtett ugyanaz a kör',
      points: samplesOf(repeatedLaps(4), 12),
      ownership: new Map(),
      step: 10,
      expectHits: false,
    },
  ];

  for (const { name, points, ownership, step, expectHits } of cases) {
    it(name, () => {
      const geometryCache = new IncrementalActivityGeometry();
      const claims = new IncrementalActivityClaims();
      let sawLoops = false;

      for (let n = 2; n <= points.length; n += step) {
        const prefix = points.slice(0, n);
        const geometry = geometryCache.update(prefix);
        if (geometry.loops.length > 0) sawLoops = true;

        const input = {
          points: prefix,
          type: 'ride' as const,
          distanceKm: n / 100,
          actorId: 'runner',
          ownership,
          streakDays: 0,
          gpEarnedToday: 0,
        };

        const incremental = claims.update(input, geometry);
        const batch = processActivityGeometry(input, new IncrementalActivityGeometry().update(prefix));
        expectSameResult(incremental, batch, n);
      }

      expect(sawLoops, 'a fixture nem zárt hurkot — a teszt nem mérne semmit').toBe(true);
      if (expectHits) {
        expect(claims.stats.hits, 'egyetlen újrahasználás sem történt').toBeGreaterThan(0);
      }
    });
  }

  it('rivális birtok mellett is egyezik', () => {
    const points = samplesOf(cityRoute(6), 18);
    const geometryCache = new IncrementalActivityGeometry();
    const full = geometryCache.update(points);
    expect(full.loops.length).toBeGreaterThan(0);

    // Minden második megszerzett cella egy riválisé, vegyes védelemmel.
    const ownership: OwnershipMap = new Map();
    let index = 0;
    for (const loop of full.loops) {
      for (const cell of loop.interior) {
        index += 1;
        if (index % 2 === 0) continue;
        ownership.set(cell, { owner: 'rival', defense: (index % 5) + 1 });
      }
    }

    const claims = new IncrementalActivityClaims();
    const stepped = new IncrementalActivityGeometry();
    for (let n = 2; n <= points.length; n += 25) {
      const prefix = points.slice(0, n);
      const geometry = stepped.update(prefix);
      const input = {
        points: prefix,
        type: 'run' as const,
        distanceKm: n / 100,
        actorId: 'runner',
        ownership,
        streakDays: 3,
        gpEarnedToday: 0,
      };
      expectSameResult(
        claims.update(input, geometry),
        processActivityGeometry(input, new IncrementalActivityGeometry().update(prefix)),
        n,
      );
    }
    expect(claims.stats.hits).toBeGreaterThan(0);
  });

  it('a birtoktérkép cseréje újraszámolást kényszerít', () => {
    const points = samplesOf(cityRoute(6), 18);
    const geometry = new IncrementalActivityGeometry().update(points);
    const claims = new IncrementalActivityClaims();
    const base = {
      points,
      type: 'ride' as const,
      distanceKm: 6,
      actorId: 'runner',
      streakDays: 0,
      gpEarnedToday: 0,
    };

    const first = claims.update({ ...base, ownership: new Map() }, geometry);
    expect(first.claim?.counts.stolen ?? 0).toBe(0);

    const rival: OwnershipMap = new Map();
    for (const cell of first.claimedCells) rival.set(cell, { owner: 'rival', defense: 1 });
    const second = claims.update({ ...base, ownership: rival }, geometry);

    expect(claims.stats.hits).toBe(0);
    expect(second.claim?.counts.stolen ?? 0).toBeGreaterThan(0);
  });
});
