/**
 * A NAGY KÖRÖK TÉRKÉPE NEM CSONKULHAT.
 *
 * ⚠️ ÉLES HIBÁT RÖGZÍT, MÉRVE (2026-09-03, `ebb3c240…`, 143 km-es bringakör):
 * a dokumentum 42 666 cellát tárolt, a válasz 20 000-nél vágta el — 22 666
 * cella (53 %) sosem jutott el a klienshez. Ugyanez a hiba 2026-08-29-én már
 * megtörtént egyszer, akkor 5 000-es plafonnal. A plafon emelése csak
 * ELTOLJA a határt; a tömör ábrázolás szünteti meg.
 *
 * A DÖNTŐ TESZT az `kibontva a TELJES területet adja vissza` — mert az a
 * VALÓDI kliens-kibontót (`src/lib/activityCells.ts`) futtatja a szerver
 * válaszán. A két oldal szerződését csak együtt van értelme állítani: a
 * szerver akkor jó, ha az a kliens, ami ezt megkapja, mindent kirajzol.
 */
import { gridDisk } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { activityCellPayload } from './activities';
import { expandActivityCells } from '../../../src/lib/activityCells';

/** A válasz plafonja; a `activities.ts` ugyanezt a számot használja. */
const MAX_ACTIVITY_CELLS = 20_000;

/**
 * Egy res12 középpont körüli korong. k=82 → 3·82²+3·82+1 = 20 419 cella,
 * tehát épp a plafon FÖLÖTT — pontosan az az eset, ami élesben csonkult.
 */
const CENTER = '8c1e2d4a1b2c3ff';
const BIG = gridDisk(CENTER, 82);
const SMALL = gridDisk(CENTER, 5);

describe('activityCellPayload', () => {
  it('a plafon alatt semmit nem alakít át', () => {
    const out = activityCellPayload(SMALL, ['8a1e2d4a1b2ffff']);

    expect(out.activityCells).toEqual(SMALL);
    expect(out.activityCellParents).toEqual(['8a1e2d4a1b2ffff']);
  });

  it('a plafon fölött KIBONTVA a TELJES területet adja vissza', () => {
    expect(BIG.length).toBeGreaterThan(MAX_ACTIVITY_CELLS);

    const out = activityCellPayload(BIG, []);
    // A kliens PONTOSAN ezt a két mezőt kapja, és így bontja ki.
    const rendered = new Set(expandActivityCells(out.activityCells, out.activityCellParents));

    for (const cell of BIG) expect(rendered.has(cell)).toBe(true);
    expect(rendered.size).toBe(BIG.length);
  });

  it('a tömör lista ÉRDEMBEN kevesebb indexből áll, mint a nyers', () => {
    const out = activityCellPayload(BIG, []);

    expect(out.activityCellParents.length).toBeLessThan(BIG.length / 4);
  });

  it('a `cells` mező res12 marad — egy RÉGI kliens nem rajzolhat óriás hatszöget', () => {
    const out = activityCellPayload(BIG, []);

    // A régi kliens a `cells`-t változtatás nélkül rajzolja ki, tehát ide
    // tömör (≤ res10) index nem kerülhet. Marad a mai, plafonolt viselkedés.
    expect(out.activityCells).toHaveLength(MAX_ACTIVITY_CELLS);
    expect(new Set(out.activityCells).size).toBe(MAX_ACTIVITY_CELLS);
    // Halmazzal, nem `toContain`-nel: 20 000 × 20 419 összehasonlítás
    // időtúllépésbe futna, és nem a kódról szólna, hanem a tesztről.
    const source = new Set(BIG);
    expect(out.activityCells.every((cell) => source.has(cell))).toBe(true);
  });

  it('a meglévő parenteket megtartja a tömör lista mellett', () => {
    const existing = '8a1e2d4a1b2ffff';
    const out = activityCellPayload(BIG, [existing]);

    expect(out.activityCellParents[0]).toBe(existing);
    expect(out.activityCellParents.length).toBeGreaterThan(1);
  });

  it('vegyes felbontásnál a régi, csonkoló ágra esik vissza — de nem dob', () => {
    const mixed = [...BIG, '8a1e2d4a1b2ffff'];
    const out = activityCellPayload(mixed, []);

    expect(out.activityCells).toHaveLength(MAX_ACTIVITY_CELLS);
    expect(out.activityCellParents).toEqual([]);
  });

  it('érvénytelen indexnél sem dob — egy sérült dokumentum ne vigyen el egy adatlapot', () => {
    const broken = [...BIG.slice(0, MAX_ACTIVITY_CELLS), ...Array(50).fill('nem-h3-index')];

    expect(() => activityCellPayload(broken, [])).not.toThrow();
    expect(activityCellPayload(broken, []).activityCells).toHaveLength(MAX_ACTIVITY_CELLS);
  });

  it('hiányzó mezőkkel üres listákat ad', () => {
    expect(activityCellPayload(undefined, undefined)).toEqual({
      activityCells: [],
      activityCellParents: [],
    });
  });
});
