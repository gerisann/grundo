/**
 * Az elfoglalt cellák kibontása a megjelenítéshez.
 *
 * A hiba, amit ez rögzít (2026-08-29): a nagy (compact) hurkok belseje nem
 * jutott el a klienshez, ezért a térképen a hurok KÖZEPE üresen maradt — egy
 * „nyolcas" alakú aktivitásnál csak a kisebbik hurok volt kitöltve.
 */
import { describe, expect, it } from 'vitest';
import { cellToChildren, cellToParent, getResolution, latLngToCell } from 'h3-js';
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

  /**
   * ⚠️ EZ A JAMAL-FÉLE ÉLES HIBÁT RÖGZÍTI (2026-09-05).
   *
   * Egy 159 km-es körnél a valódi 148 717 cellából 120 000 jutott a térképre,
   * a maradék 19 % NÉMÁN eltűnt, önkényes helyeken hagyva lyukakat. A javítás
   * után a plafon fölött sem csonkolunk: a halmaz DURVÁBB lesz, de teljes.
   */
  describe('a plafon fölött durvít, nem csonkol', () => {
    /**
     * A VALÓSÁGHOZ IGAZÍTOTT BEMENET: 90 darab res8 parent.
     *
     * ⚠️ Nem egyetlen nagyon durva ős, pedig az rövidebb lenne. A szerver a
     * `parents`-et legfeljebb res8-ig tömöríti (mérve Jamal körén: res8–12),
     * és egy res5 ős res12-re bontása 823 543 cella — a teszt öt másodperc
     * alatt sem futott le tőle. Ez egyben a megvalósítás korlátja is: a
     * durvítás előbb res12-re bont, tehát nagyon durva parenttel drága lenne.
     * A szerver szerződése ezt kizárja; a teszt ezt a szerződést tükrözi.
     *
     * 90 × 7^4 = 216 090 res12 cella, azaz épp a 200 000-es plafon fölött.
     */
    const RES8_PARENTS = cellToChildren(cellToParent(CENTER, 5), 8).slice(0, 90);

    it('a teljes területet megtartja, egységes, durvább felbontáson', () => {
      const expanded = expandActivityCells([], RES8_PARENTS);

      // EGYSÉGES felbontás — enélkül a `cellsToMultiPolygon` hibás alakot ad.
      const resolutions = new Set(expanded.map((cell) => getResolution(cell)));
      expect(resolutions.size).toBe(1);

      const resolution = [...resolutions][0]!;
      expect(resolution).toBeLessThan(GAMEPLAY.H3_RESOLUTION);
      expect(resolution).toBeGreaterThanOrEqual(9);

      // ÉS HIÁNYTALAN: minden bemeneti parent teljes lefedése megvan, és
      // semmi nem került bele, ami nem tartozik hozzájuk.
      const wanted = new Set(
        RES8_PARENTS.flatMap((parent) => cellToChildren(parent, resolution)),
      );
      expect(new Set(expanded)).toEqual(wanted);
    });

    it('a plafon alatti halmazt NEM durvítja meg', () => {
      const parent = cellToParent(CENTER, 10);
      const expanded = expandActivityCells([], [parent]);
      expect(new Set(expanded.map((cell) => getResolution(cell)))).toEqual(
        new Set([GAMEPLAY.H3_RESOLUTION]),
      );
    });
  });
});
