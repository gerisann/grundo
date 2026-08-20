import { describe, expect, it } from 'vitest';
import { describe as describeCode, pickPrecipitationChance, toCondition } from './weather';

/**
 * A szolgáltató harmincnál több WMO kódját hét állapotra képezzük le. A
 * csoporthatárok könnyen elcsúsznak egy szerkesztésnél, és a hiba NÉMA lenne:
 * rossz ikon, semmi hibaüzenet. Ezért a határértékek külön tesztet kapnak.
 *
 * ⚠️ 2026-08-20-tól ezek WMO kódok (Open-Meteo), NEM a korábbi OpenWeather
 * 2xx/5xx/8xx csoportok. A két számozás átfed — a 71 az egyikben hó, a
 * másikban „köd" lenne —, ezért a régi tesztek nem maradhattak.
 */
describe('toCondition — WMO kódból ikon-állapot', () => {
  it('a 0 tiszta, és CSAK a 0', () => {
    expect(toCondition(0)).toBe('clear');
    expect(toCondition(1)).not.toBe('clear');
  });

  it('a felhőzet két fokozatra bomlik a 3-as határnál', () => {
    expect(toCondition(1)).toBe('partly_cloudy');
    expect(toCondition(2)).toBe('partly_cloudy');
    expect(toCondition(3)).toBe('cloudy');
  });

  it('a köd a 45 és a 48', () => {
    expect(toCondition(45)).toBe('fog');
    expect(toCondition(48)).toBe('fog');
  });

  it('a szitálás, az eső és a zápor EGYARÁNT eső', () => {
    // A felhasználót az érdekli, esik-e — nem az, hogy mennyire finoman.
    expect(toCondition(51)).toBe('rain');
    expect(toCondition(57)).toBe('rain');
    expect(toCondition(61)).toBe('rain');
    expect(toCondition(67)).toBe('rain');
    expect(toCondition(80)).toBe('rain');
    expect(toCondition(82)).toBe('rain');
  });

  it('a havazás és a hózápor egyaránt hó', () => {
    expect(toCondition(71)).toBe('snow');
    expect(toCondition(77)).toBe('snow');
    expect(toCondition(85)).toBe('snow');
    expect(toCondition(86)).toBe('snow');
  });

  it('a 95-től zivatar', () => {
    expect(toCondition(95)).toBe('storm');
    expect(toCondition(96)).toBe('storm');
    expect(toCondition(99)).toBe('storm');
  });

  it('ismeretlen kódra sem dob, hanem felhőset ad', () => {
    // Egy új szolgáltatói kód ne törje el a Home képernyőt.
    expect(toCondition(4)).toBe('cloudy');
    expect(toCondition(999)).toBe('cloudy');
  });
});

describe('describe — magyar megnevezés', () => {
  it('a gyakori kódokra saját szöveget ad', () => {
    // A szolgáltató nem ad leírást, ez a szöveg innentől a miénk.
    expect(describeCode(0)).toBe('tiszta égbolt');
    expect(describeCode(3)).toBe('borult');
    expect(describeCode(95)).toBe('zivatar');
  });

  it('ismeretlen kódra is mondatot ad, nem üres sztringet', () => {
    // A widget felolvassa a képernyőolvasónak — üres szöveg ott néma marad.
    expect(describeCode(123)).toBe('változó idő');
  });
});

/**
 * A csapadék-esély kiválasztása az óránkénti tömbből.
 *
 * Ez az egyetlen valódi logika a válasz feldolgozásában, és pont ez az, ami
 * NÉMÁN tud rosszat mutatni: ha a nulladik elemet vennénk, egy nap eleji
 * tömbnél az éjféli esélyt írnánk ki délutánként.
 */
describe('pickPrecipitationChance', () => {
  const times = ['2026-08-20T16:00', '2026-08-20T17:00', '2026-08-20T18:00'];
  const values = [10, 40, 70];

  it('a FOLYÓ órához tartozó értéket adja, nem az elsőt', () => {
    expect(pickPrecipitationChance('2026-08-20T17:30', times, values)).toBe(40);
    expect(pickPrecipitationChance('2026-08-20T18:00', times, values)).toBe(70);
  });

  it('ha nincs illeszkedő óra, az első elemre esik vissza', () => {
    expect(pickPrecipitationChance('2026-08-21T05:00', times, values)).toBe(10);
  });

  it('hiányzó vagy üres adatnál null, nem nulla', () => {
    // A 0% azt jelenti, hogy biztosan nem esik — a „nem tudjuk" nem ugyanaz.
    expect(pickPrecipitationChance('2026-08-20T17:00', undefined, undefined)).toBeNull();
    expect(pickPrecipitationChance('2026-08-20T17:00', times, [])).toBeNull();
    expect(pickPrecipitationChance('2026-08-20T17:00', times, ['-'])).toBeNull();
  });

  it('kerekít, és a 0–100 tartományba szorít', () => {
    expect(pickPrecipitationChance(undefined, times, [39.6])).toBe(40);
    expect(pickPrecipitationChance(undefined, times, [140])).toBe(100);
    expect(pickPrecipitationChance(undefined, times, [-5])).toBe(0);
  });
});
