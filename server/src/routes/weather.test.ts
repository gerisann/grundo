import { describe, expect, it } from 'vitest';
import { toCondition } from './weather';

/**
 * A szolgáltató több mint ötven kódját hét állapotra képezzük le. A
 * csoporthatárok könnyen elcsúsznak egy szerkesztésnél, és a hiba NÉMA lenne:
 * rossz ikon, semmi hibaüzenet. Ezért a határértékek külön tesztet kapnak.
 */
describe('toCondition — a szolgáltató kódjából ikon-állapot', () => {
  it('a 2xx csoport zivatar', () => {
    expect(toCondition(200)).toBe('storm');
    expect(toCondition(232)).toBe('storm');
  });

  it('a szitálás (3xx) és az eső (5xx) EGYARÁNT eső', () => {
    // A felhasználót az érdekli, esik-e — nem az, hogy mennyire finoman.
    expect(toCondition(300)).toBe('rain');
    expect(toCondition(321)).toBe('rain');
    expect(toCondition(500)).toBe('rain');
    expect(toCondition(531)).toBe('rain');
  });

  it('a 6xx csoport hó', () => {
    expect(toCondition(600)).toBe('snow');
    expect(toCondition(622)).toBe('snow');
  });

  it('a 7xx légköri jelenségek köd alá kerülnek', () => {
    expect(toCondition(701)).toBe('fog');
    expect(toCondition(781)).toBe('fog');
  });

  it('a 800 tiszta, és CSAK a 800', () => {
    expect(toCondition(800)).toBe('clear');
    expect(toCondition(801)).not.toBe('clear');
  });

  it('a felhőzet két fokozatra bomlik a 803-as határnál', () => {
    expect(toCondition(801)).toBe('partly_cloudy');
    expect(toCondition(802)).toBe('partly_cloudy');
    expect(toCondition(803)).toBe('cloudy');
    expect(toCondition(804)).toBe('cloudy');
  });

  it('ismeretlen kódra sem dob, hanem felhőset ad', () => {
    // Egy új szolgáltatói kód ne törje el a Home képernyőt.
    expect(toCondition(999)).toBe('cloudy');
    expect(toCondition(0)).toBe('cloudy');
  });
});
