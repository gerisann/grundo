/**
 * Menetirány a nyomvonalból — a 3D (bedöntött, menetirányba forgatott)
 * térképnézethez.
 *
 * MIÉRT NEM A `coords.heading`? A böngésző Geolocation API-ja ad iránymezőt,
 * de az a valóságban használhatatlan: asztali gépen és a legtöbb Androidon
 * `null`, álló helyzetben pedig `NaN` vagy az utolsó véletlenszerű érték. A
 * saját nyomvonalunkból viszont MINDIG kiszámolható, bármilyen eszközön —
 * és pontosan azt adja, amerre a felhasználó tényleg halad.
 *
 * MIÉRT NEM AZ UTOLSÓ KÉT PONT? Mert a GPS vízszintes hibája 5–10 m, két
 * egymást követő minta között viszont csak néhány méter a valódi elmozdulás.
 * A kettő aránya miatt az utolsó két pontból számolt irány álló helyzetben a
 * teljes körön pörögne — a térkép forogna a felhasználó alatt. Ezért egy
 * HOSSZABB BÁZISVONALAT keresünk visszafelé: minél hosszabb a bázis, annál
 * kisebb súlyú benne ugyanaz a zaj.
 *
 * Ez tisztán MEGJELENÍTÉSI számítás, ezért a `src/lib/`-ben van és nem a
 * `src/game/`-ben: a játékmotor eredményét semmilyen módon nem befolyásolja
 * (AGENTS.md 4. szabály).
 */

import { distanceM, type LatLng } from '@/game/geo';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * A bázisvonal minimális hossza méterben.
 *
 * Hosszabb bázis pontosabb irányt ad, de későn követi a kanyart: futótempóban
 * 25 m nagyjából 8 másodperc. Ez az egyensúlyi pont.
 *
 * ⚠️ MÉRT ÉRTÉKEK (400 szintetikus futás irányonként, merőleges zajjal):
 *
 * | GPS-zaj | szöghiba átlag | medián | p95 |
 * |---------|----------------|--------|-----|
 * | ±4 m    | 6,7°           | 5,5°   | 16° |
 * | ±6 m    | 12,4°          | 10,8°  | 29° |
 * | ±10 m   | 26,3°          | 25,3°  | 54° |
 *
 * EBBŐL KÖVETKEZIK, hogy a hívónak SIMÍTANIA KELL (`smoothBearing`): a nyers
 * érték városi zajban 10–25 fokot ingadozik mintáról mintára, és simítás
 * nélkül a térkép láthatóan remegne a felhasználó alatt. A simítás nem
 * kozmetika, hanem ennek a szórásnak a kezelése.
 *
 * MEGMÉRTÜK ÉS ELVETETTÜK: a bázis két végén súlypontot (több minta átlagát)
 * használni. Három mintánál a javulás elhanyagolható (12,4° → 11,8°), ötnél
 * viszont a két súlypont összecsúszhat, és az irány 180 fokot fordul — a mért
 * legrosszabb hiba 179° volt. A két nyers végpont a helyes választás.
 */
const MIN_BASE_M = 25;

/**
 * Ennyi mintánál tovább nem megyünk vissza.
 *
 * Ha valaki hosszan egy helyben áll, a minták ott gyűlnek, és a 25 méteres
 * bázis több száz pontra nyúlna vissza. A korlát garantálja, hogy a művelet
 * minden pozíciófrissítésnél olcsó marad; ha ennyi mintán belül nincs meg a
 * bázis, akkor a felhasználó tényleg áll — ilyenkor `null` a helyes válasz.
 */
const MAX_LOOKBACK = 300;

/**
 * Két pont közti irányszög fokban: 0 = észak, 90 = kelet, óramutató szerint.
 *
 * A kezdeti irányszög („initial bearing") gömbi képlete. Néhány tíz méteren a
 * sík közelítés is majdnem ugyanezt adná, de ez sem drágább, és a pólusok
 * közelében sem romlik el.
 */
export function bearingBetween(from: LatLng, to: LatLng): number {
  const lat1 = from.lat * RAD;
  const lat2 = to.lat * RAD;
  const dLng = (to.lng - from.lng) * RAD;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return normalizeBearing(Math.atan2(y, x) * DEG);
}

/** Egy szög a [0, 360) tartományba hozva. */
export function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * A haladási irány a nyomvonal végéből, vagy `null`, ha nem megbízható.
 *
 * A `null` NEM hiba: ez a normális válasz a rögzítés első métereiben és álló
 * helyzetben is. A hívó ilyenkor tartsa meg az utolsó ismert irányt — az
 * sokkal jobb, mint északra ugrani.
 *
 * @param points időrendben növekvő nyomvonal; az utolsó elem a legfrissebb
 * @param minimumBaseM rövidebb értékkel gyorsabb, de zajérzékenyebb az irány
 */
export function trackBearing(
  points: readonly LatLng[],
  minimumBaseM = MIN_BASE_M,
): number | null {
  if (points.length < 2) return null;

  const last = points[points.length - 1]!;
  const lowest = Math.max(0, points.length - 1 - MAX_LOOKBACK);

  /*
    Visszafelé haladva ÖSSZEADJUK a szakaszhosszokat, nem a végponttól mért
    légvonalat nézzük. Egy kanyargós szakasznál a kettő eltér — és az összeg a
    helyes: az mondja meg, mennyi nyomvonalat használtunk fel a becsléshez.
    A légvonal egy hajtűkanyarban nulla közelébe menne, és a ciklus a teljes
    nyomvonalat végigrágná, mielőtt feladja.
  */
  let walked = 0;
  for (let index = points.length - 2; index >= lowest; index -= 1) {
    walked += distanceM(points[index]!, points[index + 1]!);
    if (walked >= minimumBaseM) {
      const base = points[index]!;
      // Két egybeeső pont (álló GPS) irányszöge értelmezhetetlen — az atan2
      // ilyenkor 0-t adna, ami hamis „északnak" látszana.
      if (distanceM(base, last) < 1) return null;
      return bearingBetween(base, last);
    }
  }

  return null;
}

/**
 * Két irányszög közti átmenet — a RÖVIDEBB ív mentén.
 *
 * ⚠️ Enélkül a 350° → 10° váltás (tíz fok jobbra) 340 fokos visszafelé
 * pörgésként jelenne meg a térképen. A különbséget ezért a [-180, 180]
 * tartományba hozzuk, és azon belül interpolálunk.
 *
 * @param factor 0 = maradjon a régi, 1 = ugorjon az újra
 */
export function smoothBearing(previous: number, next: number, factor: number): number {
  const delta = ((next - previous + 540) % 360) - 180;
  return normalizeBearing(previous + delta * factor);
}
