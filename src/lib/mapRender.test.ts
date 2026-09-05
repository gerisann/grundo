import { latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import {
  cellInBounds,
  containsBounds,
  filterCellsToBounds,
  pointInBounds,
  renderBounds,
  tiltedZoomForViewingDistance,
  visibleTrackSegments,
} from './mapRender';
import type { CellId } from '@/types';

describe('renderBounds', () => {
  const viewport = { south: 47.49, west: 19.03, north: 47.5, east: 19.04 };

  it('a kamera körül ráhagyást tart az előtöltéshez', () => {
    const result = renderBounds(viewport, 0.1, null, null);
    expect(result.south).toBeCloseTo(47.489);
    expect(result.west).toBeCloseTo(19.029);
    expect(result.north).toBeCloseTo(47.501);
    expect(result.east).toBeCloseTo(19.041);
  });

  it('a pozíció körüli sugár nem engedi korlátlanra nőni a FOV-ot', () => {
    const result = renderBounds(viewport, 0.3, { lat: 47.495, lng: 19.035 }, 250);
    expect(result.north - result.south).toBeLessThan(0.005);
    expect(result.east - result.west).toBeLessThan(0.007);
    expect(pointInBounds({ lat: 47.495, lng: 19.035 }, result)).toBe(true);
  });

  it('felismeri, amikor a látható kivágás még az előtöltött ablakban van', () => {
    const outer = renderBounds(viewport, 0.2, null, null);
    expect(containsBounds(outer, viewport)).toBe(true);
  });
});

describe('visibleTrackSegments', () => {
  it('megtart egy határpontot a látható vonal két oldalán', () => {
    const track = Array.from({ length: 10 }, (_, index) => ({ lat: 0, lng: index }));
    const segments = visibleTrackSegments(
      track,
      { south: -1, west: 3, north: 1, east: 5 },
      1,
    );
    expect(segments).toEqual([[track[2], track[3], track[4], track[5], track[6]]]);
  });

  it('külön vonal marad, ha a nyomvonal többször lép be a FOV-ba', () => {
    const track = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 },
      { lat: 10, lng: 10 }, { lat: 0, lng: 2 }, { lat: 0, lng: 1 }, { lat: 0, lng: 0 },
    ];
    const segments = visibleTrackSegments(track, { south: -1, west: 0, north: 1, east: 1 }, 1);
    expect(segments).toHaveLength(2);
  });

  it('egy hosszú aktivitásból is csak a kamera körüli fix munkakészletet adja vissza', () => {
    const track = Array.from({ length: 20_000 }, (_, index) => ({
      lat: 47.5,
      lng: 18 + index * 0.00001,
    }));
    const segments = visibleTrackSegments(
      track,
      { south: 47.49, west: 18.099, north: 47.51, east: 18.101 },
      4,
    );
    const renderedPointCount = segments.reduce((sum, segment) => sum + segment.length, 0);
    expect(renderedPointCount).toBeLessThan(60);
  });
});

describe('filterCellsToBounds', () => {
  /**
   * Res12 cellák egy ~0,2°×0,2° (≈22 km) területen szétszórva — a `bounds`
   * ennek csak a középső sávja, tehát mindig van BENNE és KÍVÜLE eső cella
   * is. A lépésköz jóval nagyobb, mint egy res12 hatszög (~18,8 m), így nem
   * esnek egybe cellák — a `count` valóban ennyi EGYEDI cellát ad.
   */
  function gridCells(count: number): CellId[] {
    const cells = new Set<CellId>();
    const side = Math.ceil(Math.sqrt(count));
    const step = 0.2 / side;
    for (let row = 0; row < side && cells.size < count; row += 1) {
      for (let col = 0; col < side && cells.size < count; col += 1) {
        cells.add(latLngToCell(47.30 + row * step, 19.00 + col * step, 12));
      }
    }
    return [...cells];
  }

  const bounds = { south: 47.38, west: 19.08, north: 47.42, east: 19.12 };

  it('kis rétegnél (küszöb alatt) a sima szűréssel egyező eredményt ad', () => {
    const cells = gridCells(200);
    const naive = cells.filter((cell) => cellInBounds(cell, bounds));
    const result = filterCellsToBounds(cells, bounds);
    expect(new Set(result)).toEqual(new Set(naive));
  });

  it('nagy rétegnél (küszöb fölött, durva vödrözéssel) is a sima szűréssel egyező eredményt ad', () => {
    const cells = gridCells(9_000);
    expect(cells.length).toBeGreaterThan(5_000);
    const naive = cells.filter((cell) => cellInBounds(cell, bounds));
    const result = filterCellsToBounds(cells, bounds);
    // A durva vödrözés a viewport SZÉLÉN álló cellákat is megtarthatja
    // (szándékos ráhagyás) — de a naiv szűrés eredménye MINDIG benne van.
    const resultSet = new Set(result);
    for (const cell of naive) expect(resultSet.has(cell)).toBe(true);
    // És nem hoz be a viewporttól durván távoli, semmiképpen sem látható cellát.
    for (const entry of result) {
      const cell = typeof entry === 'string' ? entry : entry.cell;
      expect(cellInBounds(cell, {
        south: bounds.south - 0.03,
        west: bounds.west - 0.03,
        north: bounds.north + 0.03,
        east: bounds.east + 0.03,
      })).toBe(true);
    }
  });

  it('a `{cell, ...}` alakú bejegyzéseket is kezeli, nem csak a csupasz indexet', () => {
    const cells = gridCells(200).map((cell) => ({ cell, defense: 2 }));
    const result = filterCellsToBounds(cells, bounds);
    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) expect(cellInBounds((entry as { cell: CellId }).cell, bounds)).toBe(true);
  });
});

describe('tiltedZoomForViewingDistance', () => {
  it('kétszeres látótávolsághoz egy zoomszinttel távolabb lép', () => {
    const near = tiltedZoomForViewingDistance(1_000, 47.4979);
    const far = tiltedZoomForViewingDistance(2_000, 47.4979);
    expect(near - far).toBeCloseTo(1);
  });

  it('szélsőséges értéknél sem hagyja el a biztonságos zoomtartományt', () => {
    expect(tiltedZoomForViewingDistance(1, 0)).toBeLessThanOrEqual(20);
    expect(tiltedZoomForViewingDistance(1_000_000, 0)).toBeGreaterThanOrEqual(13.5);
  });
});
