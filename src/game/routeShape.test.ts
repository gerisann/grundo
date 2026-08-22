import { describe, expect, it } from 'vitest';
import { countUTurns } from './routeShape';
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
