/**
 * MIKOR LÁTSZIK EGY TERÜLETFOLT A TÉRKÉPEN?
 *
 * KÖZÖS kliens/szerver modul: a szerver ez alapján szűri a választ, a kliens
 * ez alapján dönti el, mit kér le. Ha a kettő eltérne, a térkép hol többet,
 * hol kevesebbet mutatna, mint amit betöltött — pontosan az a villódzás,
 * ami miatt ez az egész átalakítás készült.
 *
 * A SZABÁLY: a folt akkor látszik, ha az ÁTMÉRŐJE eléri a látott
 * térképszakasz szélességének egy rögzített hányadát. Az átmérőt a
 * területből becsüljük (√terület) — nem a valódi befoglaló méretből —, mert
 * így egyetlen, a foltra jellemző szám dönt, és nem függ attól, hogy a folt
 * épp hosszúkás-e vagy kerek.
 *
 * ⚠️ MIÉRT NÉGYZETES A KÉPLET? Mert a terület négyzetesen skálázódik a
 * hosszal. Ha lineárisan szűrnénk (terület ≥ k × nézetszélesség), akkor
 * kizoomoláskor a foltok jóval hamarabb tűnnének el, mint ahogy a szemnek
 * kicsivé válnának.
 */

/**
 * A küszöb: a folt átmérője a nézetszélesség hány részét érje el.
 *
 * Geri döntése (2026-08-28): 2%. Ez azt jelenti, hogy egy 1 km²-es folt
 * 50 km széles nézetig marad látható. (A korábbi javaslat 5% volt — 1 km²
 * húsz kilométerig —, de az országos nézetet gyakorlatilag üresre szűrte:
 * 500 km-nél ~600 km²-es alsó határt adott volna.)
 *
 * EGYETLEN SZÁM HANGOLJA az egész megjelenítést. Csökkentése mindent
 * távolabbról láthatóvá tesz (zsúfoltabb kizoomolt kép), növelése ritkítja.
 */
export const TERRITORY_VISIBILITY_RATIO = 0.02;

/** Fok → kilométer a hosszúsági körökön, a szélesség összehúzódásával. */
const KM_PER_DEGREE = 111.32;

export interface ViewBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * A látott térképszakasz szélessége kilométerben.
 *
 * A SZÉLESSÉG és nem az átló: a telefon képernyője magas, az átló ezért
 * jóval nagyobb lenne a ténylegesen belátott vízszintes távolságnál, és a
 * szűrés indokolatlanul agresszív lenne álló tájolásban.
 */
export function viewWidthKm(view: ViewBox): number {
  const centerLat = (view.north + view.south) / 2;
  return Math.abs(view.east - view.west) * KM_PER_DEGREE * Math.cos((centerLat * Math.PI) / 180);
}

/**
 * Az a legkisebb terület (m²-ben), ami ilyen széles nézetben még látszik.
 *
 * A szerver ezzel szűr, a kliens ezzel dönti el, melyik tárolási szintet
 * kell egyáltalán lekérdeznie.
 */
export function minVisibleAreaM2(viewWidthInKm: number): number {
  const diameterKm = TERRITORY_VISIBILITY_RATIO * Math.max(0, viewWidthInKm);
  return diameterKm * diameterKm * 1_000_000;
}

/**
 * Fordítva: meddig marad látható egy ekkora folt?
 *
 * A tárolási szintek határainak megválasztásához kell (lásd
 * `territoryBlobs.ts`): egy szintet csak addig a nézetszélességig kell
 * lekérdezni, ameddig a benne tárolt legnagyobb folt még látszik.
 */
export function maxVisibleViewWidthKm(areaM2: number): number {
  return Math.sqrt(Math.max(0, areaM2) / 1_000_000) / TERRITORY_VISIBILITY_RATIO;
}
