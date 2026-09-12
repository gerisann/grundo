import { describe, expect, it } from 'vitest';

import { distanceM, type LatLng } from './geo';
import {
  detourViaPoint,
  routeAvoidRings,
  sideCorridorRing,
  signedSideOffsetM,
} from './routeCorridor';

/** Deák tér → Hősök tere: valódi budapesti pár, nagyjából észak-keleti tengely. */
const A: LatLng = { lat: 47.4979, lng: 19.0544 };
const B: LatLng = { lat: 47.5148, lng: 19.0777 };

describe('detourViaPoint', () => {
  it('a köztes pont a megadott távolságra van a felezőponttól', () => {
    const via = detourViaPoint(A, B, 'left', 1_000);
    const offset = signedSideOffsetM(A, B, via);
    expect(offset).toBeGreaterThan(950);
    expect(offset).toBeLessThan(1_050);
  });

  it('a két oldal ellentétes előjelű és tükrös', () => {
    const left = signedSideOffsetM(A, B, detourViaPoint(A, B, 'left', 500));
    const right = signedSideOffsetM(A, B, detourViaPoint(A, B, 'right', 500));
    expect(left).toBeGreaterThan(0);
    expect(right).toBeLessThan(0);
    expect(Math.abs(left + right)).toBeLessThan(5);
  });

  it('a köztes pont a szakasz felénél van, nem a végénél', () => {
    const via = detourViaPoint(A, B, 'left', 0);
    const half = distanceM(A, B) / 2;
    expect(Math.abs(distanceM(A, via) - half)).toBeLessThan(5);
    expect(Math.abs(distanceM(via, B) - half)).toBeLessThan(5);
  });

  it('nulla eltérésnél nem lép ki a vonalról', () => {
    expect(Math.abs(signedSideOffsetM(A, B, detourViaPoint(A, B, 'left', 0)))).toBeLessThan(1);
  });

  it('a tengely menti hányad tolja a pontot, az oldaltávolságot nem', () => {
    // ⚠️ MÉRÉSBŐL: a köztes pont rákapcsolása a visszafordulások fő oka, ezért
    // a tervező több hányadot próbál ki. Mindegyiknek UGYANAKKORA kerülőt kell
    // adnia, különben a „kis/közepes/nagy" választás jelentése elcsúszna.
    for (const fraction of [0.35, 0.5, 0.65]) {
      const offset = signedSideOffsetM(A, B, detourViaPoint(A, B, 'left', 800, fraction));
      expect(offset).toBeGreaterThan(760);
      expect(offset).toBeLessThan(840);
    }

    const early = detourViaPoint(A, B, 'left', 800, 0.35);
    const late = detourViaPoint(A, B, 'left', 800, 0.65);
    expect(distanceM(A, early)).toBeLessThan(distanceM(A, late));
  });

  it('a tengely menti hányadot a 0–1 tartományra vágja', () => {
    const under = detourViaPoint(A, B, 'left', 500, -2);
    const over = detourViaPoint(A, B, 'left', 500, 5);
    expect(distanceM(A, under)).toBeLessThan(600);
    expect(distanceM(B, over)).toBeLessThan(600);
  });

  it('a kerülő mérete arányosan nő — ez adja a bezárt terület méretét', () => {
    const small = signedSideOffsetM(A, B, detourViaPoint(A, B, 'left', 500));
    const large = signedSideOffsetM(A, B, detourViaPoint(A, B, 'left', 2_000));
    expect(large / small).toBeGreaterThan(3.8);
    expect(large / small).toBeLessThan(4.2);
  });
});

describe('signedSideOffsetM', () => {
  it('a tengely pontjaira nulla', () => {
    expect(Math.abs(signedSideOffsetM(A, B, A))).toBeLessThan(1);
    expect(Math.abs(signedSideOffsetM(A, B, B))).toBeLessThan(1);
  });

  it('elfajult tengelyen nem oszt nullával', () => {
    expect(signedSideOffsetM(A, A, B)).toBe(0);
  });
});

describe('sideCorridorRing', () => {
  it('zárt gyűrűt ad, GeoJSON sorrendben', () => {
    const ring = sideCorridorRing(A, B, 'left', 30, 1_500);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    // GeoJSON: [lng, lat] — Budapesten a hosszúság 19 körül, a szélesség 47 körül.
    for (const [lng, lat] of ring) {
      expect(lng).toBeGreaterThan(18);
      expect(lng).toBeLessThan(20);
      expect(lat).toBeGreaterThan(47);
      expect(lat).toBeLessThan(48);
    }
  });

  it('a gyűrű minden sarka a kért oldalon van', () => {
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      for (const [lng, lat] of sideCorridorRing(A, B, side, 30, 1_500)) {
        expect(signedSideOffsetM(A, B, { lat, lng }) * sign).toBeGreaterThan(0);
      }
    }
  });

  it('a sáv a megadott belső és külső határ között fekszik', () => {
    const offsets = sideCorridorRing(A, B, 'left', 200, 1_500).map(([lng, lat]) =>
      signedSideOffsetM(A, B, { lat, lng }),
    );
    expect(Math.min(...offsets)).toBeGreaterThan(190);
    expect(Math.max(...offsets)).toBeLessThan(1_510);
  });

  it('elfajult tengelyen üres', () => {
    expect(sideCorridorRing(A, A, 'left', 30, 500)).toEqual([]);
  });
});

describe('routeAvoidRings', () => {
  /** Egyenletes, 20 méterenként mintavett nyomvonal A-ból B felé. */
  function synthetic(count: number): LatLng[] {
    return Array.from({ length: count }, (_unused, index) => ({
      lat: A.lat + ((B.lat - A.lat) * index) / (count - 1),
      lng: A.lng + ((B.lng - A.lng) * index) / (count - 1),
    }));
  }

  it('tartja a poligonplafont — ez mérésből jött, nem ízlésből', () => {
    const rings = routeAvoidRings(synthetic(400), { maxRings: 24 });
    expect(rings.length).toBeGreaterThan(0);
    expect(rings.length).toBeLessThanOrEqual(24);
  });

  it('hosszabb útvonal sem lépi túl a plafont', () => {
    const rings = routeAvoidRings(synthetic(4_000), { maxRings: 10 });
    expect(rings.length).toBeLessThanOrEqual(10);
  });

  it('minden folt zárt négyzet a nyomvonal körül', () => {
    for (const ring of routeAvoidRings(synthetic(200), { bufferM: 40, maxRings: 8 })) {
      expect(ring).toHaveLength(5);
      expect(ring[0]).toEqual(ring[4]);
    }
  });

  it('a folt mérete a kért puffer szerint nő', () => {
    const [narrow] = routeAvoidRings(synthetic(50), { bufferM: 20, maxRings: 4 });
    const [wide] = routeAvoidRings(synthetic(50), { bufferM: 80, maxRings: 4 });
    const width = (ring: [number, number][]) => ring[1]![0] - ring[0]![0];
    expect(width(wide!) / width(narrow!)).toBeGreaterThan(3.5);
  });

  it('a végek kihagyása kiveszi a rajt és a cél környékét', () => {
    // ⚠️ Mindkét leg ugyanonnan indul és ugyanoda érkezik: ha a foltok a
    // végpontokig érnek, a tervező a saját indulását bünteti.
    const points = synthetic(200);
    const trimmed = routeAvoidRings(points, { maxRings: 8, trimFraction: 0.15 });
    const first = trimmed[0]!;
    const centre: [number, number] = [
      (first[0]![0] + first[2]![0]) / 2,
      (first[0]![1] + first[2]![1]) / 2,
    ];
    expect(distanceM(A, { lat: centre[1], lng: centre[0] })).toBeGreaterThan(
      distanceM(A, B) * 0.1,
    );
  });

  it('a folytonos korridor foltjai összeérnek', () => {
    // ⚠️ Mérésből: a szaggatott foltsor mellett a tervező minden foltnál kitér
    // és visszatér — épp ez adja a felesleges ficakokat.
    const points = synthetic(400);
    const dotted = routeAvoidRings(points, { bufferM: 40, maxRings: 12 });
    const solid = routeAvoidRings(points, { bufferM: 40, maxRings: 12, continuous: true });

    const width = (ring: [number, number][]) => Math.abs(ring[1]![0] - ring[0]![0]);
    expect(width(solid[0]!)).toBeGreaterThan(width(dotted[0]!) * 2);
    // A plafon a hosszú útvonalon sem enged korlátlanul nőni.
    const capped = routeAvoidRings(points, { bufferM: 40, maxRings: 4, continuous: true, maxBufferM: 100 });
    const metresPerDegLng = 111_194.93 * Math.cos((A.lat * Math.PI) / 180);
    expect((width(capped[0]!) * metresPerDegLng) / 2).toBeLessThanOrEqual(101);
  });

  it('üres nyomvonalra üres', () => {
    expect(routeAvoidRings([])).toEqual([]);
  });

  it('egyetlen pontra is ad foltot', () => {
    expect(routeAvoidRings([A])).toHaveLength(1);
  });
});
