/**
 * Trust Score.
 *
 * A tesztek két dolgot védenek, és a második a fontosabb:
 *
 *   1. hogy a csalás lebukjon,
 *   2. hogy az ÁRTATLAN ne bukjon le.
 *
 * A második azért súlyosabb, mert egy tévesen elutasított aktivitás valódi
 * felhasználót veszít el, míg egy átcsúszó csalás legfeljebb egy ranglista-
 * helyezést torzít, és utólag javítható.
 */

import { describe, expect, it } from 'vitest';
import { computeTrustScore, verdictFor, type TrustInput } from './score';
import { buildTrace, ORIGIN, offset } from '@/game/fixtures';
import type { TracePoint } from '@/types';

/**
 * Valósághű nyomvonal: a szintetikus fixture-höz zajt adunk.
 *
 * Enélkül a teszt hazudna: a `buildTrace` tökéletesen egyenletes tempót ad,
 * amit a rendszer — helyesen — gyanúsnak lát. Egy valódi GPS-nyomon a
 * pozíció pár méteren belül ingadozik, és a pontosság is változik.
 */
function realistic(waypoints: { lat: number; lng: number }[], stepM = 3): TracePoint[] {
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return buildTrace(waypoints, { stepM }).map((p) => ({
    ...p,
    // ±2 méter — ennyit téved egy jó városi fix.
    lat: p.lat + (random() - 0.5) * 0.000036,
    lng: p.lng + (random() - 0.5) * 0.000036,
    accuracy: 4 + random() * 8,
  }));
}

const square = (side: number) => [
  ORIGIN,
  offset(ORIGIN, 0, side),
  offset(ORIGIN, side, side),
  offset(ORIGIN, side, 0),
  ORIGIN,
];

function input(over: Partial<TrustInput> = {}): TrustInput {
  const points = over.points ?? realistic(square(300));
  const durationS = (points[points.length - 1]!.t - points[0]!.t) / 1000;
  return {
    points,
    type: 'run',
    distanceKm: 1.2,
    durationS,
    history: { cleanActivities: 20, upheldReports: 0 },
    credibleReports: 0,
    largeGaps: 0,
    ...over,
  };
}

describe('az ártatlan nem bukhat le', () => {
  it('valósághű futás átmegy', () => {
    const result = computeTrustScore(input());
    expect(result.verdict).toBe('trusted');
    expect(result.reasons).toHaveLength(0);
  });

  it('a szenzorok HIÁNYA nem büntetés', () => {
    const withSensors = computeTrustScore(
      input({ sensors: { avgHr: 150, avgCadence: 170 } }),
    ).score;
    const without = computeTrustScore(input()).score;
    expect(without).toBe(withSensors);
  });

  it('az új fiók nem gyanús, csak ismeretlen — átmegy', () => {
    const result = computeTrustScore(
      input({ history: { cleanActivities: 0, upheldReports: 0 } }),
    );
    expect(result.verdict).toBe('trusted');
  });

  it('EGYETLEN bejelentés nem húzza le', () => {
    // Különben a jelentés fegyverré válna: bárki lehúzhatná mások aktivitását.
    expect(computeTrustScore(input({ credibleReports: 1 })).verdict).toBe('trusted');
  });

  it('a hiányzó pontosság-adat nem büntetés', () => {
    const noAccuracy = realistic(square(300)).map(({ accuracy: _drop, ...p }) => p);
    expect(computeTrustScore(input({ points: noAccuracy })).verdict).toBe('trusted');
  });
});

describe('a csalás lebukik', () => {
  it('autósebességű „futás" elbukik', () => {
    // Ugyanaz a kör, de tizedannyi idő alatt: ~60 km/h.
    const fast = realistic(square(300)).map((p, i) => ({ ...p, t: p.t - i * 900 }));
    const result = computeTrustScore(input({ points: fast, durationS: 60 }));
    expect(result.verdict).not.toBe('trusted');
    expect(result.reasons.join(' ')).toContain('reális');
  });

  it('a tökéletesen egyenletes nyom gyanús', () => {
    // A nyers fixture zaj nélkül: rajzolt vagy generált nyomvonal jellemzője.
    const perfect = buildTrace(square(300), { stepM: 6 });
    const result = computeTrustScore(input({ points: perfect }));
    expect(result.reasons.join(' ')).toContain('egyenletes');
    expect(result.score).toBeLessThan(computeTrustScore(input()).score);
  });

  it('az állandó, irreálisan jó pontosság gyanús', () => {
    const spoofed = realistic(square(300)).map((p) => ({ ...p, accuracy: 1 }));
    const result = computeTrustScore(input({ points: spoofed }));
    expect(result.reasons.join(' ')).toContain('pontosság');
  });

  it('a teleport erősen lehúz', () => {
    const jump = realistic(square(300));
    // Egyetlen pont hirtelen tíz kilométerrel odébb.
    jump[20] = { ...jump[20]!, lat: jump[20]!.lat + 0.09 };
    const result = computeTrustScore(input({ points: jump }));
    expect(result.verdict).not.toBe('trusted');
    expect(result.reasons.join(' ')).toContain('lehetetlen');
  });

  it('autóval „futni" a szenzorokon bukik le', () => {
    const result = computeTrustScore(
      input({
        distanceKm: 5,
        durationS: 600, // 30 km/h
        sensors: { avgHr: 70, avgCadence: 40 },
      }),
    );
    expect(result.signals.sensorConsistency).toBeLessThan(0.5);
    expect(result.reasons.join(' ')).toMatch(/lépésfrekvencia|pulzus/);
  });

  it('három független bejelentés nullázza a jelet', () => {
    expect(computeTrustScore(input({ credibleReports: 3 })).signals.reports).toBe(0);
  });
});

describe('küszöbök', () => {
  it('a három sáv határai', () => {
    expect(verdictFor(80)).toBe('trusted');
    expect(verdictFor(79)).toBe('pending_review');
    expect(verdictFor(50)).toBe('pending_review');
    expect(verdictFor(49)).toBe('rejected');
  });

  it('a pontszám 0 és 100 közé esik', () => {
    const worst = computeTrustScore(
      input({
        points: buildTrace(square(300), { stepM: 6 }).map((p, i) => ({ ...p, t: p.t - i * 900 })),
        credibleReports: 5,
        largeGaps: 20,
        history: { cleanActivities: 0, upheldReports: 10 },
      }),
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });
});
