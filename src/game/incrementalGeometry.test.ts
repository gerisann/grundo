import { describe, expect, it } from 'vitest';
import {
  buildActivityGeometry,
  IncrementalActivityGeometry,
  processActivity,
  processActivityGeometry,
} from './index';
import type { CellId } from '@/types';
import { buildTrace, ORIGIN, offset } from './fixtures';

const p = (eastM: number, northM: number) => offset(ORIGIN, eastM, northM);

describe('IncrementalActivityGeometry', () => {
  it('ugyanazt a végső hurokgeometriát adja, mint a batch feldolgozás', () => {
    const points = buildTrace([
      p(0, 0),
      p(0, 240),
      p(240, 240),
      p(240, 0),
      p(0, 0),
      p(-180, -180),
      p(180, -180),
      p(240, 240),
    ], { stepM: 5, accuracy: 1 });

    const incremental = new IncrementalActivityGeometry();
    for (let end = 2; end <= points.length; end += 7) {
      incremental.update(points.slice(0, end));
    }
    const actual = incremental.update(points);
    const expected = buildActivityGeometry(points);

    expect(actual.cellPath).toEqual(expected.cellPath);
    expect(actual.loops.map((loop) => [loop.fromIndex, loop.toIndex])).toEqual(
      expected.loops.map((loop) => [loop.fromIndex, loop.toIndex]),
    );
    expect(actual.loopDiagnostics.successful).toEqual(expected.loopDiagnostics.successful);
    expect(actual.loopDiagnostics.rejected).toEqual(expected.loopDiagnostics.rejected);
  });

  it('route reset után tisztán újraépíti az állapotot', () => {
    const first = buildTrace([p(0, 0), p(0, 220), p(220, 220), p(220, 0), p(0, 0)], { stepM: 5 });
    const second = buildTrace([p(500, 0), p(500, 220), p(720, 220), p(720, 0), p(500, 0)], { stepM: 5 });
    const incremental = new IncrementalActivityGeometry();

    incremental.update(first);
    const actual = incremental.update(second);
    const expected = buildActivityGeometry(second);

    expect(actual.cellPath).toEqual(expected.cellPath);
    expect(actual.loops.map((loop) => [loop.fromIndex, loop.toIndex])).toEqual(
      expected.loops.map((loop) => [loop.fromIndex, loop.toIndex]),
    );
  });
});

/**
 * A TELJES eredmény egyezése, nem csak a geometriáé.
 *
 * Az éles tracking felület 2026-08-25 óta ezt az inkrementális utat használja
 * (a teljes újraszámolás 20 km-en 337 ms volt, ebből 289 ms a geometria).
 * Ha az élő előnézet és a szerveroldali kötegelt feldolgozás eltérne, a
 * felhasználó azt látná, hogy „a telefonon más területet írt, mint amit
 * végül kaptam" — ezért ez a teszt a claim minden cellájára egyezést követel.
 */
describe('élő előnézet = szerveroldali kötegelt eredmény', () => {
  const ME = 'me';

  function compare(label: string, waypoints: readonly { lat: number; lng: number }[]) {
    const points = buildTrace(waypoints, { stepM: 5, accuracy: 1 });
    const input = {
      points, type: 'ride' as const, distanceKm: 4, actorId: ME,
      ownership: new Map<CellId, { owner: string; defense: number }>(),
      streakDays: 0, gpEarnedToday: 0,
    };

    // Élő út: mintánként haladva, gyorsítótárral.
    const incremental = new IncrementalActivityGeometry();
    for (let end = 2; end < points.length; end += 11) {
      processActivityGeometry({ ...input, points: points.slice(0, end) }, incremental.update(points.slice(0, end)));
    }
    const live = processActivityGeometry(input, incremental.update(points));

    // Szerveroldali út: egyszer, a teljes nyomvonalból.
    const batch = processActivity(input);

    expect(live.claimedCellCount, label).toBe(batch.claimedCellCount);
    expect(live.loops.length, label).toBe(batch.loops.length);
    expect(live.gp.total, label).toBe(batch.gp.total);
    expect([...(live.claim?.updates ?? [])].sort(), label)
      .toEqual([...(batch.claim?.updates ?? [])].sort());
  }

  it('a rajz szerinti három doboz', () => {
    const S = 300;
    const at = (x: number, y: number) => offset(ORIGIN, x * S, y * S);
    compare('3 box', [
      at(0, 0), at(0, 1), at(1, 1), at(1, 0), at(0, 0),
      at(0, -1), at(1, -1), at(1, 0),
      at(0, 0), at(0, 1), at(2, 1), at(2, 0), at(1, 0), at(0, 0),
    ]);
  });

  it('a folyamatábra négy köre', () => {
    const S = 200;
    const at = (x: number, y: number) => offset(ORIGIN, x * S, y * S);
    compare('négy kör', [
      at(0, 1), at(0, 2), at(1, 2), at(1, 1), at(0, 1),
      at(0, 0), at(1, 0), at(1, 1), at(0, 1),
      at(0, 2), at(2, 2), at(2, 1), at(1, 1), at(0, 1),
      at(0, 2), at(2, 2), at(2, 1), at(1, 1), at(0, 1),
      at(0, 0), at(1, 0), at(1, 1), at(0, 1),
    ]);
  });

  it('ugyanaz a kör négyszer', () => {
    const single = [p(0, 0), p(0, 200), p(200, 200), p(200, 0), p(0, 0)];
    const waypoints = [...single];
    for (let lap = 1; lap < 4; lap += 1) waypoints.push(...single.slice(1));
    compare('4 lap', waypoints);
  });
});
