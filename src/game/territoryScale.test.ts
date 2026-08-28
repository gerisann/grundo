import { describe, expect, it } from 'vitest';
import {
  TERRITORY_FULL_DETAIL_WIDTH_KM,
  maxVisibleViewWidthKm,
  minVisibleAreaM2,
  viewWidthKm,
} from './territoryScale';

/** A mért összefüggés a hangoló kijelzőről: zoom 10 ≈ 66 km széles nézet. */
const ZOOM_10_WIDTH_KM = 66.1;
const ZOOM_9_WIDTH_KM = 132.2;
const ZOOM_8_WIDTH_KM = 264.4;

describe('viewWidthKm', () => {
  it('a SZÉLESSÉGET adja vissza, nem az átlót', () => {
    // Budapest szélességén egy fok hosszúság ~75 km.
    const width = viewWidthKm({ south: 47.4, west: 19.0, north: 47.6, east: 20.0 });
    expect(width).toBeGreaterThan(70);
    expect(width).toBeLessThan(80);
  });

  it('a magasság NEM számít bele', () => {
    const keskeny = viewWidthKm({ south: 47.49, west: 19.0, north: 47.51, east: 19.1 });
    const magas = viewWidthKm({ south: 47.0, west: 19.0, north: 48.0, east: 19.1 });
    expect(magas).toBeCloseTo(keskeny, 5);
  });
});

describe('minVisibleAreaM2', () => {
  /**
   * EZ A LÉNYEG — Geri kérése (2026-08-28): „zoom 10 értéken is szeretném ha
   * látszódna még minden terület." A 10-es nagyítás ~66 km széles nézet,
   * tehát ott a küszöbnek nullának kell lennie: EGYETLEN foltot sem szűrünk.
   */
  it('zoom 10-ig (~66 km) NEM szűr semmit', () => {
    expect(minVisibleAreaM2(ZOOM_10_WIDTH_KM)).toBe(0);
  });

  it('közeli nézetben sem szűr', () => {
    for (const width of [0, 1, 4, 8, 16, 33]) {
      expect(minVisibleAreaM2(width)).toBe(0);
    }
  });

  it('a teljes részletesség HATÁRÁN pontosan nulla — nincs ugrás', () => {
    expect(minVisibleAreaM2(TERRITORY_FULL_DETAIL_WIDTH_KM)).toBe(0);
    // Közvetlenül fölötte még mindig elhanyagolható, nem ugrik több km²-re.
    expect(minVisibleAreaM2(TERRITORY_FULL_DETAIL_WIDTH_KM + 1)).toBeLessThan(200);
  });

  it('a határon túl NŐ a küszöb, de csak fokozatosan', () => {
    const zoom9 = minVisibleAreaM2(ZOOM_9_WIDTH_KM) / 1e6;
    const zoom8 = minVisibleAreaM2(ZOOM_8_WIDTH_KM) / 1e6;

    expect(zoom9).toBeGreaterThan(0.4);
    expect(zoom9).toBeLessThan(0.8);
    expect(zoom8).toBeGreaterThan(4);
    expect(zoom8).toBeLessThan(7);
    expect(zoom8).toBeGreaterThan(zoom9);
  });

  it('monoton — távolabbról sosem szűrünk kevesebbet', () => {
    let previous = -1;
    for (let width = 0; width <= 600; width += 10) {
      const current = minVisibleAreaM2(width);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('maxVisibleViewWidthKm', () => {
  it('a `minVisibleAreaM2` MEGFORDÍTÁSA — a két képlet nem sodródhat el', () => {
    for (const areaKm2 of [0.5, 1, 5, 10, 50]) {
      const width = maxVisibleViewWidthKm(areaKm2 * 1e6);
      // Ezen a szélességen a folt még épp látszik…
      expect(minVisibleAreaM2(width)).toBeCloseTo(areaKm2 * 1e6, 0);
      // …valamivel távolabbról viszont már nem.
      expect(minVisibleAreaM2(width + 5)).toBeGreaterThan(areaKm2 * 1e6);
    }
  });

  it('a teljes részletesség határán belüli folt addig mindig látszik', () => {
    expect(maxVisibleViewWidthKm(0)).toBe(TERRITORY_FULL_DETAIL_WIDTH_KM);
  });
});
