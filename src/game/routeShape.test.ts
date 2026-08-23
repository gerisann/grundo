import { describe, expect, it } from 'vitest';
import {
  countRouteDefects,
  countShortDetours,
  countUTurns,
  findShortDetours,
  preferCleanRoutes,
  selectMissionRoutes,
  withoutOutAndBackSpurs,
} from './routeShape';
import { destinationPoint } from './missions';
import type { LatLng } from './geo';

/**
 * A mérőszám hitelesítése ISMERT alakú nyomvonalakon.
 *
 * Ugyanazok az esetek, amikkel a 2026-08-22-i mérés előtt is ellenőriztem a
 * detektort — ha valaki elállítja a bázishosszt vagy a szögküszöböt, itt
 * bukik el, nem élesben.
 */

const CENTRE: LatLng = { lat: 47.4738, lng: 19.0088 };
const DEG = 180 / Math.PI;

/** Sokszögesített kör adott kerülettel — a „tiszta" eset. */
function circle(perimeterM: number, vertices = 360): LatLng[] {
  const radius = perimeterM / (2 * Math.PI);
  const points: LatLng[] = [];
  for (let index = 0; index <= vertices; index += 1) {
    points.push(destinationPoint(CENTRE, (index * 360) / vertices, radius));
  }
  return points;
}

/**
 * Oda-vissza kitérők beszúrása: a megadott arányoknál a nyomvonal merőlegesen
 * kilép `spurM` métert, majd ugyanazon az úton visszatér. Pontosan ezt csinálja
 * a Directions, ha egy köztes pont mellékutcára esik.
 */
function withSpurs(track: readonly LatLng[], atRatios: readonly number[], spurM: number): LatLng[] {
  const insertAt = new Set(atRatios.map((ratio) => Math.floor(ratio * (track.length - 1))));
  const out: LatLng[] = [];
  for (let index = 0; index < track.length; index += 1) {
    const point = track[index]!;
    out.push(point);
    if (!insertAt.has(index) || index + 1 >= track.length) continue;

    const next = track[index + 1]!;
    const along = Math.atan2(next.lng - point.lng, next.lat - point.lat) * DEG;
    const tip: LatLng[] = [];
    for (let step = 1; step <= 5; step += 1) {
      tip.push(destinationPoint(point, along + 90, (spurM * step) / 5));
    }
    out.push(...tip);
    for (let step = tip.length - 2; step >= 0; step -= 1) out.push(tip[step]!);
    out.push(point);
  }
  return out;
}

describe('countUTurns', () => {
  it('tiszta körön nem talál visszafordulást', () => {
    expect(countUTurns(circle(7500))).toBe(0);
    expect(countUTurns(circle(2000))).toBe(0);
  });

  it('minden beszúrt kitérőre pontosan egy fordulatot ad', () => {
    // Egy lábon CSAK a csúcs 180 fokos: a be- és a kilépés derékszög.
    expect(countUTurns(withSpurs(circle(7500), [0.2, 0.5, 0.8], 40))).toBe(3);
    expect(countUTurns(withSpurs(circle(7500), [0.2, 0.5, 0.8], 80))).toBe(3);
    expect(countUTurns(withSpurs(circle(7500), [0.1, 0.25, 0.4, 0.55, 0.7, 0.85], 60))).toBe(6);
  });

  it('szűk körön is a kitérőket számolja, nem a kanyarokat', () => {
    expect(countUTurns(withSpurs(circle(2000), [0.2, 0.5, 0.8], 60))).toBe(3);
  });

  it('elhanyagolható bemenetre nem hasal el', () => {
    expect(countUTurns([])).toBe(0);
    expect(countUTurns([CENTRE])).toBe(0);
    expect(countUTurns([CENTRE, CENTRE])).toBe(0);
  });
});

describe('countShortDetours', () => {
  it('észreveszi a visszatérő rövid lábat akkor is, ha a csúcsa lekerekített', () => {
    const clean = circle(7500);
    const spurred = withSpurs(clean, [0.4], 35);
    expect(countShortDetours(clean)).toBe(0);
    expect(countShortDetours(spurred)).toBeGreaterThan(0);
    expect(countRouteDefects(spurred)).toBeGreaterThan(0);
    const [defect] = findShortDetours(spurred);
    expect(defect).toBeDefined();
    expect(defect!.path.length).toBeGreaterThan(2);
    expect(defect!.directM / defect!.alongM).toBeLessThanOrEqual(0.5);
  });

  it('nem minősít hibának egy rendes derékszögű utcafordulót', () => {
    const origin = CENTRE;
    const east = destinationPoint(origin, 90, 100);
    const north = destinationPoint(east, 0, 100);
    expect(countShortDetours([origin, east, north])).toBe(0);
  });

  it('kiszűri a háromoldalas, doboz alakú helyi kerülőt', () => {
    const a = CENTRE;
    const b = destinationPoint(a, 0, 80);
    const c = destinationPoint(b, 90, 80);
    const d = destinationPoint(c, 180, 80);
    expect(countUTurns([a, b, c, d])).toBe(0);
    expect(countShortDetours([a, b, c, d])).toBeGreaterThan(0);
  });
});

describe('preferCleanRoutes', () => {
  it('kiszűri a helyi legjobbnál több mint egy fordulással rosszabb lábakat', () => {
    const routes = [0, 1, 1, 3, 6].map((uTurns, id) => ({ id, uTurns }));
    expect(preferCleanRoutes(routes).map((route) => route.uTurns)).toEqual([0, 1, 1]);
  });

  it('legalább három jelöltet megtart, ha minden útvonal kényszerűen rosszabb', () => {
    const routes = [1, 4, 5, 8].map((uTurns, id) => ({ id, uTurns }));
    expect(preferCleanRoutes(routes).map((route) => route.uTurns)).toEqual([1, 4, 5]);
  });
});

describe('withoutOutAndBackSpurs', () => {
  it('csak a fölösleges visszafordulás nélküli jelölteket engedi ajánlani', () => {
    const routes = [0, 1, 0, 3].map((uTurns, id) => ({ id, uTurns }));
    expect(withoutOutAndBackSpurs(routes).map((route) => route.id)).toEqual([0, 2]);
  });
});

describe('selectMissionRoutes', () => {
  it('a tiszta útvonalakat választja, ha van belőlük', () => {
    const routes = [0, 1, 0, 3].map((uTurns, id) => ({ id, uTurns }));
    expect(selectMissionRoutes(routes).map((route) => route.id)).toEqual([0, 2]);
  });

  it('a legkevésbé hibás köröket megtartja, ha tiszta egyáltalán nincs', () => {
    const routes = [3, 1, 2, 4].map((uTurns, id) => ({ id, uTurns }));
    expect(selectMissionRoutes(routes).map((route) => route.uTurns)).toEqual([1, 2, 3]);
  });

  it('a visszafordulásmentes jelöltet nem nyomja el több enyhébb helyi kerülő', () => {
    const routes = [
      { id: 'spur', uTurns: 1, shortDetours: 0 },
      { id: 'cleaner', uTurns: 0, shortDetours: 4 },
      { id: 'cleanest', uTurns: 0, shortDetours: 2 },
    ];
    expect(selectMissionRoutes(routes).map((route) => route.id)).toEqual(['cleaner', 'cleanest']);
  });
});
