import { gridDisk, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '@/config/gameplay';
import type { CellId } from '@/types';
import { cellsToAreaPolygons, groupCellsByKey } from './hexAreas';

const KOZEP = latLngToCell(47.475, 19.015, GAMEPLAY.H3_RESOLUTION) as CellId;

/** Egy összefüggő folt: a középpont körüli `k` gyűrű. */
function folt(k: number): CellId[] {
  return gridDisk(KOZEP, k) as CellId[];
}

describe('cellsToAreaPolygons', () => {
  it('egy egybefüggő foltból EGY poligont csinál', () => {
    const cells = folt(5);
    const polygons = cellsToAreaPolygons(cells);

    expect(cells.length).toBeGreaterThan(90);
    // Egyetlen poligon, egyetlen külső gyűrűvel — nincs lyuk.
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(1);
  });

  it('GeoJSON koordinátasorrendet ad, nem H3-at', () => {
    const polygons = cellsToAreaPolygons(folt(1));
    const first = polygons[0]?.[0]?.[0];
    expect(first).toBeDefined();
    const [lng, lat] = first!;
    /**
     * A H3 [szélesség, hosszúság] párokat ad, a GeoJSON fordítva. Ha ez
     * felcserélődik, az egész rács a Föld túloldalára kerül — Budapesten a
     * hosszúság ~19, a szélesség ~47,5, tehát a kettő nem téveszthető össze.
     */
    expect(lng).toBeGreaterThan(18);
    expect(lng).toBeLessThan(20);
    expect(lat).toBeGreaterThan(47);
    expect(lat).toBeLessThan(48);
  });

  it('⚠️ nagyságrenddel kevesebb pontot ad, mint a cellánkénti rajzolás', () => {
    const cells = folt(12);
    const polygons = cellsToAreaPolygons(cells);

    // Cellánként hat csúcs (zárt gyűrűvel hét) — ennyit rajzolt a régi út.
    const cellankentiPontok = cells.length * 7;
    let osszevontPontok = 0;
    for (const polygon of polygons) {
      for (const ring of polygon) osszevontPontok += ring.length;
    }

    expect(cells.length).toBeGreaterThan(400);
    // A folt kerülete a területnek csak a gyöke, tehát a nyereség nagy.
    expect(osszevontPontok).toBeLessThan(cellankentiPontok / 10);
  });

  it('a lyukat külön gyűrűként adja vissza', () => {
    // Gyűrű alakú birtok: a közepén lyuk marad.
    const kulso = new Set(folt(4));
    for (const cell of folt(1)) kulso.delete(cell);
    const polygons = cellsToAreaPolygons([...kulso]);

    expect(polygons).toHaveLength(1);
    // Külső határ + a belső lyuk határa.
    expect(polygons[0]!.length).toBe(2);
  });

  it('üres bemenetre üres eredmény, hibás cellára nem dob', () => {
    expect(cellsToAreaPolygons([])).toEqual([]);
    expect(cellsToAreaPolygons(['ez-nem-cella' as CellId])).toEqual([]);
  });
});

describe('groupCellsByKey', () => {
  it('kulcs szerint csoportosít, sorrendtartóan', () => {
    const groups = groupCellsByKey([
      { cell: 'a' as CellId, key: 'interior:1' },
      { cell: 'b' as CellId, key: 'rival:3' },
      { cell: 'c' as CellId, key: 'interior:1' },
    ]);

    expect([...groups.keys()]).toEqual(['interior:1', 'rival:3']);
    expect(groups.get('interior:1')).toEqual(['a', 'c']);
  });
});
