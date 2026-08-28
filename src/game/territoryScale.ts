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
 * ESZEN A NÉZETSZÉLESSÉGEN BELÜL SEMMIT NEM SZŰRÜNK — minden folt látszik.
 *
 * Geri döntése (2026-08-28): „zoom 10 értéken is szeretném ha látszódna még
 * minden terület." A mérés szerint a 10-es nagyítás ~66 km széles nézetet ad
 * (lásd a hangoló kijelzőt), ezért a határ 70 km — ennyi alatt a méretszűrés
 * ki van kapcsolva, bármilyen apró folt kirajzolódik.
 *
 * A felső korlátot a szerver `MAX_BLOBS_PER_VIEW` értéke adja: ha nagyon sok
 * folt esne a nézetbe, a legnagyobbak jönnek. A szűrés hiánya tehát nem tud
 * elszabadult méretű választ okozni.
 */
export const TERRITORY_FULL_DETAIL_WIDTH_KM = 70;

/**
 * A küszöb meredeksége a teljes részletesség HATÁRÁN TÚL.
 *
 * ⚠️ NEM a nézetszélességhez mérünk, hanem ahhoz, amennyivel TÚLLÉPTÜK a
 * `TERRITORY_FULL_DETAIL_WIDTH_KM`-t. Enélkül a küszöb ugrana: 66 km-en még
 * minden látszana, 70 km fölött viszont azonnal több km²-es alsó határ
 * lépne életbe, és a foltok zöme egyetlen görgetésnyi mozdulattól eltűnne.
 * Így a küszöb NULLÁRÓL indul a határon, és onnantól nő simán.
 *
 * A 0,012-es érték úgy van megválasztva, hogy ~264 km-es (8-as nagyítású)
 * nézetben ~5 km² legyen az alsó határ — ott már tényleg csak a nagy
 * birodalmak érdekesek. Ez az EGYETLEN szám, amivel az egész kizoomolt kép
 * sűrűsége hangolható.
 */
export const TERRITORY_VISIBILITY_RATIO = 0.012;

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
  const excessKm = Math.max(0, viewWidthInKm) - TERRITORY_FULL_DETAIL_WIDTH_KM;
  if (excessKm <= 0) return 0;
  const diameterKm = TERRITORY_VISIBILITY_RATIO * excessKm;
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
  return (
    TERRITORY_FULL_DETAIL_WIDTH_KM +
    Math.sqrt(Math.max(0, areaM2) / 1_000_000) / TERRITORY_VISIBILITY_RATIO
  );
}
