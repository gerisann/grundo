/**
 * Privát zóna — az aktivitás elejének és végének levágása a MEGJELENÍTÉSHEZ.
 *
 * ⚠️ EZ KIZÁRÓLAG MEGJELENÍTÉSI MŰVELET. A területfoglalás, a táv, az idő és
 * a pont MINDIG a teljes nyomvonalból számolódik. Ha a foglalás a levágott
 * nyomvonalat kapná, a privát zóna azonnal csalási felületté válna: bekapcsolom
 * 200 méterre, és azon a szakaszon nem érvényesülnek a szabályok.
 *
 * MIÉRT ITT, A SZERVEREN VÁGUNK? Mert a levágásnak azelőtt kell megtörténnie,
 * hogy az adat elhagyja a szervert. Ha a teljes nyomvonalat küldenénk ki és a
 * kliens vágná, a levágott szakasz ott lenne a hálózati válaszban — bárki
 * elolvashatná. A `firestore.rules` ugyanezért tartja külön dokumentumban a
 * teljes nyomvonalat: a szabályok nem tudnak mezőszinten szűrni.
 *
 * docs/02-funkcionalis-spec.md → Privát zóna
 */

import { distanceM } from './geo';

export interface PrivacySettings {
  hideStart: boolean;
  startRadiusM: number;
  hideEnd: boolean;
  endRadiusM: number;
}

/** A specifikáció szerinti alapértelmezés: mindkét vég rejtve, 200 méteren. */
export const DEFAULT_PRIVACY: PrivacySettings = {
  hideStart: true,
  startRadiusM: 200,
  hideEnd: true,
  endRadiusM: 200,
};

/**
 * A nyomvonal két végének levágása.
 *
 * HÁROM LÉPÉS, és mindegyik másért felel:
 *
 *   1. A VÉGÉRŐL levágjuk a célpont védőkörében lévő ÖSSZEFÜGGŐ szakaszt.
 *   2. Az ELEJÉRŐL ugyanígy: az első pontig, amely kilép a rajt védőköréből.
 *   3. Ami megmaradt, abból KIHAGYJUK a védőkörbe eső pontokat — bárhol is
 *      legyenek. A vonal ilyenkor egyenes húrral vág át a körön, mintha a GPS
 *      ott kihagyott volna.
 *
 * ⚠️ A 2. LÉPÉS KORÁBBAN NEM ÖSSZEFÜGGŐ VOLT, és ez éles hibát okozott
 * (2026-08-29). Az elejéről az UTOLSÓ rajt-közeli pontig vágtunk, a teljes
 * nyomvonalat végignézve — így egy útvonal, amely menet KÖZBEN visszatér a
 * rajt közelébe (több hurok, oda-vissza szakasz, háztömb körüli körözés),
 * a visszatérés pillanatáig elveszett. MÉRVE, szintetikus nyomvonalakon:
 *
 *   alak                                      elveszett
 *   ------------------------------------------|----------
 *   egyszerű kör, közbenső visszatérés nélkül |   14 %  (ennyi a helyes)
 *   hurok + 3,5 km-es második kör             |   44 %
 *   hurok + 1,5 km-es második kör             |   66 %
 *   hurok + 600 m-es második kör              |   84 %
 *   hurok + 350 m-es második kör              |   90 %
 *
 * Éles esetben (17 km, három bezárt kör) ez a TELJES útvonalat elrejtette,
 * pedig a felhasználó 200 méteres levágást kért. A 3. lépés ezért van: a
 * védelem szándéka — hogy a védőkörből ne szivárogjon ki pont — így is
 * érvényesül, de már nem visz magával fél útvonalat.
 */
export function trimPrivateEnds<T extends { lat: number; lng: number }>(
  points: readonly T[],
  settings: PrivacySettings = DEFAULT_PRIVACY,
): { points: T[]; trimmedStart: boolean; trimmedEnd: boolean } {
  if (points.length < 2) return { points: [...points], trimmedStart: false, trimmedEnd: false };

  const hideStart = settings.hideStart && settings.startRadiusM > 0;
  const hideEnd = settings.hideEnd && settings.endRadiusM > 0;
  const startOrigin = points[0]!;
  const endOrigin = points[points.length - 1]!;

  let end = points.length - 1;
  if (hideEnd) {
    while (end >= 0 && distanceM(endOrigin, points[end]!) <= settings.endRadiusM) {
      end -= 1;
    }
  }

  let start = 0;
  if (hideStart) {
    while (start < points.length && distanceM(startOrigin, points[start]!) <= settings.startRadiusM) {
      start += 1;
    }
  }

  const visible: T[] = [];
  for (let i = start; i <= end; i += 1) {
    const point = points[i]!;
    // A védőkörbe eső pont sehol nem kerül ki — a menet közbeni áthaladásnál
    // sem, különben a védőkör pont attól veszítené el az értelmét, amitől
    // védeni akar.
    if (hideStart && distanceM(startOrigin, point) <= settings.startRadiusM) continue;
    if (hideEnd && distanceM(endOrigin, point) <= settings.endRadiusM) continue;
    visible.push(point);
  }

  /**
   * Peremeset: az egész aktivitás a védőkörön belül zajlott (pl. 300 méter
   * séta a ház körül). Ilyenkor nincs mit mutatni — üres nyomvonalat adunk
   * vissza, a felület pedig „Az útvonal rejtve" feliratot ír ki. A metrikák
   * ettől függetlenül teljesek maradnak.
   */
  if (visible.length < 2) {
    return { points: [], trimmedStart: settings.hideStart, trimmedEnd: settings.hideEnd };
  }

  return {
    points: visible,
    trimmedStart: start > 0,
    trimmedEnd: end < points.length - 1,
  };
}
