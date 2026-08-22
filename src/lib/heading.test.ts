/**
 * A menetirány-számítás rögzítése.
 *
 * A szintetikus nyomvonalakat a `destinationPoint` gyártja: ismert irányba,
 * ismert távolságra teszünk pontokat, és visszamérjük, hogy ugyanazt az
 * irányt kapjuk-e. Így a teszt nem a saját képletünket ismétli meg (az
 * körkörös bizonyítás lenne), hanem a motor meglévő, máshol is használt
 * geometriájához méri.
 */

import { describe, expect, it } from 'vitest';
import { destinationPoint } from '@/game/missions';
import type { LatLng } from '@/game/geo';
import { bearingBetween, normalizeBearing, smoothBearing, trackBearing } from './heading';

/** Budapest — mindegy, hol vagyunk, de legyen valós szélességi kör. */
const ORIGIN: LatLng = { lat: 47.4979, lng: 19.0402 };

/**
 * Egyenes nyomvonal adott irányba.
 *
 * @param stepM egy minta elmozdulása méterben — 5 m nagyjából egy másodperc futás
 */
function straightTrack(bearing: number, steps: number, stepM = 5): LatLng[] {
  const points: LatLng[] = [ORIGIN];
  for (let index = 1; index <= steps; index += 1) {
    points.push(destinationPoint(ORIGIN, bearing, index * stepM));
  }
  return points;
}

describe('bearingBetween', () => {
  it('a négy fő égtájat adja vissza', () => {
    expect(bearingBetween(ORIGIN, destinationPoint(ORIGIN, 0, 100))).toBeCloseTo(0, 1);
    expect(bearingBetween(ORIGIN, destinationPoint(ORIGIN, 90, 100))).toBeCloseTo(90, 1);
    expect(bearingBetween(ORIGIN, destinationPoint(ORIGIN, 180, 100))).toBeCloseTo(180, 1);
    expect(bearingBetween(ORIGIN, destinationPoint(ORIGIN, 270, 100))).toBeCloseTo(270, 1);
  });

  it('mindig [0, 360) tartományban ad eredményt', () => {
    // Északnyugat: a nyers atan2 itt negatív szöget adna (-45).
    const northWest = bearingBetween(ORIGIN, destinationPoint(ORIGIN, 315, 100));
    expect(northWest).toBeGreaterThanOrEqual(0);
    expect(northWest).toBeLessThan(360);
    expect(northWest).toBeCloseTo(315, 1);
  });
});

describe('trackBearing', () => {
  it('egyenes nyomvonalon a haladás irányát adja', () => {
    // 10 lépés × 5 m = 50 m, tehát bőven megvan a 25 méteres bázis.
    expect(trackBearing(straightTrack(90, 10))).toBeCloseTo(90, 0);
    expect(trackBearing(straightTrack(0, 10))).toBeCloseTo(0, 0);
    expect(trackBearing(straightTrack(225, 10))).toBeCloseTo(225, 0);
  });

  it('null, amíg nincs meg a minimális bázishossz', () => {
    // 3 lépés × 5 m = 15 m — kevesebb, mint a 25 méteres bázis.
    expect(trackBearing(straightTrack(90, 3))).toBeNull();
  });

  it('null üres és egyelemű nyomvonalra', () => {
    expect(trackBearing([])).toBeNull();
    expect(trackBearing([ORIGIN])).toBeNull();
  });

  it('null, ha a felhasználó egy helyben áll', () => {
    // Ugyanaz a pont sokszor: a rögzítő álló helyzetben is kap mintákat.
    // EZ A LÉNYEG: ilyenkor nem szabad irányt hazudni, mert a térkép
    // elfordulna a felhasználó alatt, miközben meg sem mozdult.
    expect(trackBearing(Array.from({ length: 50 }, () => ORIGIN))).toBeNull();
  });

  it('a FRISS irányt adja, nem a nyomvonal egészének irányát', () => {
    // L alak: előbb 200 m északra, aztán 60 m keletre. A teljes nyomvonal
    // "átlaga" északkelet lenne — a menetirány viszont KELET, mert a
    // felhasználó éppen arra tart.
    const corner = destinationPoint(ORIGIN, 0, 200);
    const points: LatLng[] = [ORIGIN];
    for (let index = 1; index <= 40; index += 1) {
      points.push(destinationPoint(ORIGIN, 0, index * 5));
    }
    for (let index = 1; index <= 12; index += 1) {
      points.push(destinationPoint(corner, 90, index * 5));
    }
    expect(trackBearing(points)).toBeCloseTo(90, 0);
  });

  it('zajos mintákból is a valódi irányt hozza ki', () => {
    /*
      Ez az a helyzet, amiért a hosszabb bázisvonal létezik. A séta kelet felé
      tart 4 méteres lépésekkel, de minden mintát ±6 m-es hiba terhel — ez
      valósághű városi GPS-zaj. Két szomszédos pontból számolva az irány itt
      teljesen véletlenszerű lenne; a 25 méteres bázisból viszont kijön.

      A zaj determinisztikus (nem Math.random), hogy a teszt ne tudjon
      alkalmanként bukni.
    */
    const wobble = [6, -4, 5, -6, 3, -3, 6, -5, 4, -6, 2, -2, 5, -4, 6, -6, 3, -5, 4, -3];
    const points: LatLng[] = [];
    for (let index = 0; index < wobble.length; index += 1) {
      const clean = destinationPoint(ORIGIN, 90, index * 4);
      // A hibát merőlegesen (északra/délre) tesszük rá — ez rontja a legjobban
      // a kelet-nyugati irány becslését.
      points.push(destinationPoint(clean, 0, wobble[index]!));
    }

    const bearing = trackBearing(points);
    expect(bearing).not.toBeNull();
    /*
      30 fokos tűrés, és ez MÉRT szám, nem óvatosságból tág.

      Ilyen zajszinten (±6 m, 4 méteres lépések) a szöghiba p95-e 29 fok — a
      részletes táblázat a `heading.ts`-ben áll. A teszt tehát azt rögzíti,
      ami elvárható: a térkép KELETRE néz, nem északra vagy délre (az 45 fok
      lenne). A maradék ingadozást a hívó `smoothBearing`-je fogja le.
    */
    expect(Math.abs(bearing! - 90)).toBeLessThan(30);
  });
});

describe('smoothBearing', () => {
  it('a rövidebb ív mentén megy át a 0 fokon', () => {
    // 350 -> 10 az tíz fok JOBBRA, nem 340 fok balra. Ha ez elromlik, a
    // térkép minden észak felé forduláskor egy teljes kört pörögne.
    expect(smoothBearing(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(smoothBearing(10, 350, 0.5)).toBeCloseTo(0, 5);
  });

  it('a szorzó a két végpont között arányosan oszt', () => {
    expect(smoothBearing(0, 100, 0)).toBeCloseTo(0, 5);
    expect(smoothBearing(0, 100, 1)).toBeCloseTo(100, 5);
    expect(smoothBearing(0, 100, 0.25)).toBeCloseTo(25, 5);
  });

  it('mindig [0, 360) tartományban marad', () => {
    const result = smoothBearing(5, 355, 0.5);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(360);
    expect(result).toBeCloseTo(0, 5);
  });
});

describe('normalizeBearing', () => {
  it('a negatív és a 360 fölötti szöget is bevonja', () => {
    expect(normalizeBearing(-90)).toBe(270);
    expect(normalizeBearing(450)).toBe(90);
    expect(normalizeBearing(360)).toBe(0);
    expect(normalizeBearing(0)).toBe(0);
  });
});
