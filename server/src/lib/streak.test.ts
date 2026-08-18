/**
 * A napi sorozat léptetése.
 *
 * MIÉRT KELLETT TESZT? Mert élesben elromlott, és senki nem vette észre: a
 * sorozat makacsul 1-en állt, pedig három egymást követő napon volt aktivitás.
 * Az ok az volt, hogy a MENTÉS napjából számoltunk, nem az aktivitáséból — így
 * két nap edzése egyetlen napnak látszott, ha ugyanakkor töltötte fel a
 * telefon.
 */
import { describe, expect, it } from 'vitest';
import { advanceStreak } from './activityCommit';

/** Tetszőleges, de rögzített játéknap-szám — a valódi értéke lényegtelen. */
const HETFO = 20_680;
const KEDD = HETFO + 1;
const SZERDA = HETFO + 2;
const PENTEK = HETFO + 4;

describe('advanceStreak', () => {
  it('az első aktivitás 1-es sorozatot indít', () => {
    expect(advanceStreak(undefined, HETFO)).toEqual({
      current: 1,
      longest: 1,
      lastActiveDay: HETFO,
    });
  });

  it('a regisztrációkor létrehozott, üres sorozatból is 1 lesz', () => {
    // A profil `streak: { current: 0, longest: 0 }`-val jön létre.
    expect(advanceStreak({ current: 0, longest: 0 }, HETFO).current).toBe(1);
  });

  it('három egymást követő nap sorozata 3', () => {
    const h = advanceStreak(undefined, HETFO);
    const k = advanceStreak(h, KEDD);
    const sz = advanceStreak(k, SZERDA);

    expect(h.current).toBe(1);
    expect(k.current).toBe(2);
    expect(sz.current).toBe(3);
    expect(sz.lastActiveDay).toBe(SZERDA);
  });

  it('ugyanazon a napon a második aktivitás nem növeli', () => {
    const elso = advanceStreak(undefined, HETFO);
    const masodik = advanceStreak(elso, HETFO);

    // Aki naponta ötször fut, az nem ötnapos sorozatot épít.
    expect(masodik.current).toBe(1);
    expect(masodik.longest).toBe(1);
  });

  it('kihagyott nap után újrakezdés', () => {
    const kedd = advanceStreak(advanceStreak(undefined, HETFO), KEDD);
    const pentek = advanceStreak(kedd, PENTEK);

    expect(kedd.current).toBe(2);
    expect(pentek.current).toBe(1);
    // A csúcs viszont megmarad — az a felhasználó teljesítménye.
    expect(pentek.longest).toBe(2);
  });

  it('a longest sosem csökken', () => {
    let streak = advanceStreak(undefined, HETFO);
    for (let day = KEDD; day <= HETFO + 5; day += 1) streak = advanceStreak(streak, day);
    expect(streak.current).toBe(6);

    const megszakad = advanceStreak(streak, HETFO + 20);
    expect(megszakad.current).toBe(1);
    expect(megszakad.longest).toBe(6);
  });

  /**
   * EZ AZ ÉLES HIBA REGRESSZIÓS TESZTJE.
   *
   * Egy offline sorból későn felszivárgó, RÉGI aktivitás nem írhatja át a
   * sorozatot — és főleg nem törheti meg. A javítás előtt a „régebben volt"
   * ág lefutott volna rá, és 1-re nullázta volna a hatnapos sorozatot.
   */
  it('utólag feltöltött régi aktivitás nem töri meg a sorozatot', () => {
    let streak = advanceStreak(undefined, HETFO);
    streak = advanceStreak(streak, KEDD);
    streak = advanceStreak(streak, SZERDA);
    expect(streak.current).toBe(3);

    // Most érkezik meg a hétfői futás, három nap késéssel.
    const utolag = advanceStreak(streak, HETFO);

    expect(utolag.current).toBe(3);
    expect(utolag.longest).toBe(3);
    expect(utolag.lastActiveDay).toBe(SZERDA);
  });

  it('a sorozat az AKTIVITÁS napjából épül, nem a mentésébŐl', () => {
    /**
     * A valódi eset: hétfőn és kedden is volt edzés, de mindkettő szerdán
     * került fel. A mentés napjából számolva ez egyetlen nap lenne (sorozat 1);
     * az aktivitás napjából számolva kettő.
     */
    const hetfoiEdzes = advanceStreak(undefined, HETFO);
    const keddiEdzes = advanceStreak(hetfoiEdzes, KEDD);

    expect(keddiEdzes.current).toBe(2);
  });
});
