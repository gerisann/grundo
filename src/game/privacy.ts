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
 * Először a VÉGÉRŐL vágjuk le a célpont védőkörében lévő összefüggő
 * szakaszt. Ezután az elejéről az utolsó olyan pontig vágunk, amely még a
 * rajt védőkörében van — de már csak a megmaradt tartományban.
 *
 * A sorrend lényeges. Zárt körnél az utolsó pont újra a rajt közelében van.
 * Ha az eleji vágás előbb a TELJES nyomot vizsgálná, ezt a célba érkezést is
 * „rajt közeli" pontnak hinné, és az egész aktivitást elrejtené. A végi
 * szakasz előzetes levágásával a hurok közepe megmarad, a két érzékeny vég
 * viszont nem látszik.
 */
export function trimPrivateEnds<T extends { lat: number; lng: number }>(
  points: readonly T[],
  settings: PrivacySettings = DEFAULT_PRIVACY,
): { points: T[]; trimmedStart: boolean; trimmedEnd: boolean } {
  if (points.length < 2) return { points: [...points], trimmedStart: false, trimmedEnd: false };

  let end = points.length - 1;
  if (settings.hideEnd && settings.endRadiusM > 0) {
    const origin = points[points.length - 1]!;
    while (end >= 0 && distanceM(origin, points[end]!) <= settings.endRadiusM) {
      end -= 1;
    }
  }

  let start = 0;
  if (settings.hideStart && settings.startRadiusM > 0 && end >= 0) {
    const origin = points[0]!;
    for (let i = 0; i <= end; i += 1) {
      if (distanceM(origin, points[i]!) <= settings.startRadiusM) start = i + 1;
    }
  }

  /**
   * Peremeset: az egész aktivitás a védőkörön belül zajlott (pl. 300 méter
   * séta a ház körül). Ilyenkor nincs mit mutatni — üres nyomvonalat adunk
   * vissza, a felület pedig „Az útvonal rejtve" feliratot ír ki. A metrikák
   * ettől függetlenül teljesek maradnak.
   */
  if (end - start < 1) {
    return { points: [], trimmedStart: settings.hideStart, trimmedEnd: settings.hideEnd };
  }

  return {
    points: points.slice(start, end + 1),
    trimmedStart: start > 0,
    trimmedEnd: end < points.length - 1,
  };
}
