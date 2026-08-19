/**
 * Helyi idő — napszám, óra, éjfél, hét- és hónapforduló.
 *
 * Ez a réteg dönti el, MIKOR fordul a nap egy felhasználónál. Ha elcsúszik, a
 * hold-bónusz és a sorozat is elcsúszik vele, méghozzá csendben: a felhasználó
 * csak annyit lát, hogy „nem kaptam meg a napi pontom".
 */

import { describe, expect, it } from 'vitest';
import { gameDay, localDay, localHour, monthOf, nextLocalMidnight, weekOf } from './gridMath';

const BUDAPEST = 'Europe/Budapest';
const AUCKLAND = 'Pacific/Auckland';
const HONOLULU = 'Pacific/Honolulu';

/** 2026-08-17 hétfő, 08-16 vasárnap, 08-24 a következő hétfő. */
const MONDAY = Math.floor(Date.UTC(2026, 7, 17) / 86_400_000);
const SUNDAY_BEFORE = MONDAY - 1;
const NEXT_MONDAY = MONDAY + 7;

describe('localDay', () => {
  it('a helyi dátumot adja, nem az UTC-t', () => {
    // 21:30 UTC = 23:30 Budapesten (nyári időszámítás) — még 19-e.
    const beforeMidnight = new Date('2026-08-19T21:30:00Z');
    // 22:30 UTC = 00:30 Budapesten — már 20-a.
    const afterMidnight = new Date('2026-08-19T22:30:00Z');

    expect(localDay(afterMidnight, BUDAPEST)).toBe(localDay(beforeMidnight, BUDAPEST) + 1);
  });

  it('a féltekék között egy nap eltérés is lehet', () => {
    const instant = new Date('2026-08-19T12:00:00Z');
    // Aucklandben már másnap van, Honoluluban még aznap.
    expect(localDay(instant, AUCKLAND)).toBe(localDay(instant, BUDAPEST) + 1);
    expect(localDay(instant, HONOLULU)).toBe(localDay(instant, BUDAPEST));
  });

  it('a gameDay a rögzített játékidőzónás esete', () => {
    const instant = new Date('2026-08-19T21:30:00Z');
    expect(gameDay(instant)).toBe(localDay(instant, BUDAPEST));
  });

  it('érvénytelen időzónánál a játékidőzónára esik vissza, nem dob', () => {
    const instant = new Date('2026-08-19T12:00:00Z');
    expect(localDay(instant, 'Nincs/Ilyen_Zóna')).toBe(gameDay(instant));
    expect(localDay(instant, '')).toBe(gameDay(instant));
  });
});

describe('localHour', () => {
  it('a helyi órát adja', () => {
    expect(localHour(new Date('2026-08-19T22:30:00Z'), BUDAPEST)).toBe(0);
    expect(localHour(new Date('2026-08-19T10:00:00Z'), BUDAPEST)).toBe(12);
  });
});

describe('nextLocalMidnight', () => {
  it('a következő helyi éjfélre mutat', () => {
    const now = new Date('2026-08-19T10:00:00Z'); // 12:00 Budapesten
    const next = nextLocalMidnight(now, BUDAPEST);

    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(localDay(next, BUDAPEST)).toBe(localDay(now, BUDAPEST) + 1);
    // Egy perccel korábban még az előző nap van — tehát pontosan az éjfél.
    expect(localDay(new Date(next.getTime() - 60_000), BUDAPEST)).toBe(localDay(now, BUDAPEST));
  });

  it('közvetlenül éjfél előtt is a KÖVETKEZŐ éjfélt adja, nem a mostanit', () => {
    const now = new Date('2026-08-19T21:59:00Z'); // 23:59 Budapesten
    const next = nextLocalMidnight(now, BUDAPEST);
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(61_000);
    expect(localDay(next, BUDAPEST)).toBe(localDay(now, BUDAPEST) + 1);
  });

  /**
   * A nyári időszámítás vége Európában: 2026. október 25-én a helyi nap 25
   * órás. A „most plusz 24 óra" itt tévedne — a felezés a `localDay`
   * definíciójából dolgozik, ezért nem.
   */
  it('átvészeli az óraátállítást (25 órás nap)', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    const next = nextLocalMidnight(now, BUDAPEST);
    expect(localDay(next, BUDAPEST)).toBe(localDay(now, BUDAPEST) + 1);
    expect(localDay(new Date(next.getTime() - 60_000), BUDAPEST)).toBe(localDay(now, BUDAPEST));
  });
});

describe('weekOf', () => {
  it('a hét hétfőn fordul', () => {
    expect(weekOf(SUNDAY_BEFORE)).toBe(weekOf(MONDAY) - 1);
    expect(weekOf(MONDAY + 6)).toBe(weekOf(MONDAY)); // vasárnapig ugyanaz a hét
    expect(weekOf(NEXT_MONDAY)).toBe(weekOf(MONDAY) + 1);
  });

  it('a hét minden napja ugyanabba a hétbe esik', () => {
    const weeks = new Set([0, 1, 2, 3, 4, 5, 6].map((offset) => weekOf(MONDAY + offset)));
    expect(weeks.size).toBe(1);
  });
});

describe('monthOf', () => {
  it('hónapfordulón lép', () => {
    const aug31 = Math.floor(Date.UTC(2026, 7, 31) / 86_400_000);
    expect(monthOf(aug31 + 1)).toBe(monthOf(aug31) + 1);
    expect(monthOf(aug31)).toBe(monthOf(aug31 - 1));
  });

  it('évfordulón is folytonos', () => {
    const dec31 = Math.floor(Date.UTC(2026, 11, 31) / 86_400_000);
    expect(monthOf(dec31 + 1)).toBe(monthOf(dec31) + 1);
  });
});
