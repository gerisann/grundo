/**
 * A terület megjelenítése — a döntés RÖGZÍTÉSE.
 *
 * MIÉRT VAN EZ A FÁJL? Mert ez a szabály már egyszer elcsúszott: a spec
 * 2026-08-15-én m²-t írt elő 1 000 000 m² alatt, a kód 2026-08-17-én
 * áttért a mindig-km²-re, és a dokumentáció hónapokig mást mondott, mint
 * amit a felhasználó látott. A `formatArea()` addig teljesen fedezetlen
 * volt — semmi nem szólt, amikor a kettő szétment.
 *
 * Az érvényes döntés: MINDIG km², három tizedesjeggyel, váltás nélkül.
 * docs/03-jatekszabalyok.md → A terület megjelenítése
 */

import { describe, expect, it } from 'vitest';
import { formatArea, formatAreaDelta } from './format';

/**
 * A magyar ezres elválasztó NEM sima szóköz, hanem NBSP (U+00A0) — az Intl
 * ezt adja. Szándékosan escape-elve írjuk: ha valaki átgépeli sima
 * szóközre, a teszt elbukik, és a hibaüzenetből nem látszana, miért.
 */
const NBSP = '\u00A0';

/** A negatív előjel a formázóban valódi mínuszjel (U+2212), nem kötőjel. */
const MINUS = '\u2212';

describe('formatArea', () => {
  it('mindig km², a legkisebb értéknél is', () => {
    // EZ A LÉNYEG: nincs m²-es tartomány. Ha valaki visszahozza a
    // kétszintű váltást, ez a három sor bukik el elsőként.
    expect(formatArea(0)).toBe('0,000 km²');
    expect(formatArea(9421)).toBe('0,009 km²');
    expect(formatArea(184_500)).toBe('0,185 km²');
  });

  it('az 1 000 000 m² NEM határ — ott sem vált mértékegységet', () => {
    // A régi spec itt váltott volna m²-ről km²-re. Ma a küszöb két oldala
    // ugyanúgy néz ki; csak a szám nő.
    expect(formatArea(999_999)).toBe('1,000 km²');
    expect(formatArea(1_000_000)).toBe('1,000 km²');
    expect(formatArea(1_000_001)).toBe('1,000 km²');
  });

  it('mindig pontosan három tizedes — a szélesség nem ugrál', () => {
    // Fix tizedesszám kell, mert a ranglistán egymás alatt állnak a számok.
    expect(formatArea(1_845_000)).toBe('1,845 km²');
    expect(formatArea(55_830_000)).toBe('55,830 km²');
    expect(formatArea(2_000_000)).toBe('2,000 km²');
  });

  it('magyar tizedesvessző, és NBSP-s ezres tagolás a nagy értékeknél', () => {
    // Négy egész számjegyig a magyar helyesírás nem tagol, öttől igen.
    expect(formatArea(1_234_567_890)).toBe('1234,568 km²');
    expect(formatArea(12_345_000_000)).toBe(`12${NBSP}345,000 km²`);
  });

  it('a felbontás alatti terület 0,000 km² — ez a vállalt áldozat', () => {
    // Egy cella 307 m², a három tizedesjegy viszont csak ezer m²-t bont.
    // Néhány mező ezért nullaként jelenik meg: tudatos csere, nem hiba.
    expect(formatArea(307)).toBe('0,000 km²');
    expect(formatArea(1228)).toBe('0,001 km²'); // 4 cella, a legkisebb szerzemény
  });
});

describe('formatAreaDelta', () => {
  it('a nyereség plusz jelet kap', () => {
    expect(formatAreaDelta(840_000)).toBe('+0,840 km²');
  });

  it('a veszteség valódi mínuszjelet kap, nem kötőjelet', () => {
    expect(formatAreaDelta(-21_000)).toBe(`${MINUS}0,021 km²`);
  });

  it('a nulla előjel nélkül áll', () => {
    expect(formatAreaDelta(0)).toBe('0,000 km²');
  });

  it('a felbontás alatti veszteség előjeles nullát ad', () => {
    // RÖGZÍTETT MAI VISELKEDÉS, nem kívánság: egyetlen elvesztett cella
    // „−0,000 km²"-ként jelenik meg. Ha ez valaha zavaró lesz a
    // felhasználónak, itt kell eldönteni, mi legyen helyette.
    expect(formatAreaDelta(-307)).toBe(`${MINUS}0,000 km²`);
  });
});
