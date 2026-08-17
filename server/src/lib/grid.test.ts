/**
 * A védelem elévülése és a blokkszámítás.
 *
 * Az elévülés a játék egyensúlyának a gerince: ha nem működik, a terület
 * bebetonozódik, és a támadás értelmetlenné válik. Viszont csak napok
 * múlásával figyelhető meg — élesben tehát gyakorlatilag tesztelhetetlen.
 * Tiszta függvényként pontosan előállítható.
 */

import { describe, expect, it } from 'vitest';
import { blockIdFor, blocksFor, cellKey, effectiveDefense, gameDay } from './gridMath';

/** Budapest, Deák tér — res 12. */
const CELL = '8c1e2d84c9327ff';

function day(iso: string): number {
  return gameDay(new Date(iso));
}

function stored(defense: number, at: number) {
  return { o: 'u1', d: defense, u: at };
}

describe('gameDay', () => {
  it('egymást követő napok napszáma egyesével nő', () => {
    expect(day('2026-08-17T10:00:00Z') - day('2026-08-16T10:00:00Z')).toBe(1);
  });

  it('hónapfordulón is egy a különbség', () => {
    // Ezért napszám, és nem 20260901 alakú szám: abból a különbség 70 lenne.
    expect(day('2026-09-01T10:00:00Z') - day('2026-08-31T10:00:00Z')).toBe(1);
  });

  it('évfordulón is egy a különbség', () => {
    expect(day('2027-01-01T10:00:00Z') - day('2026-12-31T10:00:00Z')).toBe(1);
  });

  it('a nap a játék időzónája szerint fordul, nem UTC szerint', () => {
    // Budapesten nyáron UTC+2: 2026-08-16 22:30 UTC már 17-e helyben.
    expect(day('2026-08-16T22:30:00Z')).toBe(day('2026-08-17T06:00:00Z'));
  });

  it('ugyanaz a naptári nap ugyanazt a számot adja reggel és este', () => {
    expect(day('2026-08-16T05:00:00Z')).toBe(day('2026-08-16T19:00:00Z'));
  });
});

describe('a védelem elévülése', () => {
  const today = day('2026-08-16T12:00:00Z');

  it('a ma szerzett védelem teljes értékű', () => {
    expect(effectiveDefense(stored(5, today), today)).toBe(5);
  });

  it('naponta EGY szintet veszít', () => {
    expect(effectiveDefense(stored(5, today - 1), today)).toBe(4);
    expect(effectiveDefense(stored(5, today - 2), today)).toBe(3);
    expect(effectiveDefense(stored(5, today - 3), today)).toBe(2);
  });

  it('sosem esik 1 alá', () => {
    expect(effectiveDefense(stored(5, today - 4), today)).toBe(1);
    expect(effectiveDefense(stored(5, today - 40), today)).toBe(1);
    expect(effectiveDefense(stored(1, today - 999), today)).toBe(1);
  });

  it('egy kihagyott nap NEM nyitja ki a teljes területet', () => {
    // Ez a napi nullázás és a fokozatos elévülés közti lényegi különbség:
    // ott ez 1 lenne, itt 4 — a támadónak még mindig négy bezárás kell.
    expect(effectiveDefense(stored(5, today - 1), today)).toBe(4);
  });

  it('TERÜLETET ELVESZTENI NEM LEHET — az elévülés sosem vesz el cellát', () => {
    // A szabály: a terület csak úgy tűnhet el, ha MÁSVALAKI elveszi. Magától,
    // az idő múlásától soha. Ezért van az alsó határ 1-en és nem 0-n: a
    // nullás védelem azt jelentené, hogy a cella gazdátlanná vált.
    for (const level of [1, 2, 3, 4, 5]) {
      for (const elapsed of [0, 1, 5, 100, 10_000]) {
        expect(effectiveDefense(stored(level, today - elapsed), today)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('a jövőbeli bélyeget nem bünteti', () => {
    // Óraeltérésből előfordulhat. Nem növelünk tőle védelmet, de nem is
    // rontunk el semmit.
    expect(effectiveDefense(stored(3, today + 1), today)).toBe(3);
  });
});

describe('blokkok', () => {
  it('a cellakulcs az index utolsó hat karaktere', () => {
    expect(cellKey(CELL)).toBe(CELL.slice(-6));
    expect(cellKey(CELL)).toHaveLength(6);
  });

  it('a blokkazonosító tartalmazza a réteget', () => {
    expect(blockIdFor('foot', CELL)).toMatch(/^foot_/);
    expect(blockIdFor('bike', CELL)).toMatch(/^bike_/);
  });

  it('a két réteg KÜLÖN blokkot kap ugyanarra a cellára', () => {
    // Ugyanazt a cellát két különböző ember birtokolhatja a két rétegben.
    expect(blockIdFor('foot', CELL)).not.toBe(blockIdFor('bike', CELL));
  });

  it('a szomszédos cellák jellemzően egy blokkba esnek', () => {
    const grouped = blocksFor('foot', [CELL, CELL]);
    expect(grouped.size).toBe(1);
    expect(grouped.get(blockIdFor('foot', CELL))).toHaveLength(2);
  });
});
