/**
 * Az elfoglalt cellák kibontása a megjelenítéshez.
 *
 * A hiba, amit ez rögzít (2026-08-29): a nagy (compact) hurkok belseje nem
 * jutott el a klienshez, ezért a térképen a hurok KÖZEPE üresen maradt — egy
 * „nyolcas" alakú aktivitásnál csak a kisebbik hurok volt kitöltve.
 */
import { describe, expect, it } from 'vitest';
import { cellToChildren, cellToParent, latLngToCell } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { expandActivityCells } from './activityCells';

const CENTER = latLngToCell(47.4979, 19.0402, GAMEPLAY.H3_RESOLUTION);

describe('elfoglalt cellák kibontása', () => {
  it('a durvább felbontású parentet res12 gyerekekre bontja', () => {
    const parent = cellToParent(CENTER, 10);
    const expanded = expandActivityCells([], [parent]);

    expect(expanded).toEqual(expect.arrayContaining(cellToChildren(parent, GAMEPLAY.H3_RESOLUTION)));
    // Egy res10 parent 49 res12 cellát képvisel.
    expect(expanded).toHaveLength(49);
  });

  it('a falat és a belsőt EGY halmazba vonja, duplikátum nélkül', () => {
    const parent = cellToParent(CENTER, 10);
    // A `CENTER` a parent gyereke is — nem szabad kétszer szerepelnie.
    const expanded = expandActivityCells([CENTER], [parent]);
    expect(new Set(expanded).size).toBe(expanded.length);
    expect(expanded).toHaveLength(49);
  });

  it('a már res12 indexet változatlanul átengedi', () => {
    expect(expandActivityCells([], [CENTER])).toEqual([CENTER]);
  });

  it('hiányzó mezőkkel sem hasal el (régi aktivitás)', () => {
    expect(expandActivityCells(undefined, undefined)).toEqual([]);
    expect(expandActivityCells([CENTER], undefined)).toEqual([CENTER]);
  });
});
