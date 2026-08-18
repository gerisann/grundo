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
 * A szabály: az elejéről addig dobjuk a pontokat, amíg TARTÓSAN el nem
 * hagyják az első pont körüli R sugarú kört. A „tartósan" nem díszítés — egy
 * bemelegítő kör a ház körül többször is kilép és visszatér a körbe, és ha az
 * első kilépésnél megállnánk, a visszatérő szakasz újra megmutatná a kezdetet.
 * Ezért az UTOLSÓ olyan pontig vágunk, ami még a körön belül van.
 *
 * Körfutásnál a két levágás ugyanoda esik, tehát a hurok „nyitva marad" a
 * megjelenítésen. Ez így helyes: pont ezért nem azonosítható, hogy a kör
 * melyik pontján van a lakás.
 */
export function trimPrivateEnds<T extends { lat: number; lng: number }>(
  points: readonly T[],
  settings: PrivacySettings = DEFAULT_PRIVACY,
): { points: T[]; trimmedStart: boolean; trimmedEnd: boolean } {
  if (points.length < 2) return { points: [...points], trimmedStart: false, trimmedEnd: false };

  let start = 0;
  if (settings.hideStart && settings.startRadiusM > 0) {
    const origin = points[0]!;
    for (let i = 0; i < points.length; i += 1) {
      if (distanceM(origin, points[i]!) <= settings.startRadiusM) start = i + 1;
    }
  }

  let end = points.length - 1;
  if (settings.hideEnd && settings.endRadiusM > 0) {
    const origin = points[points.length - 1]!;
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (distanceM(origin, points[i]!) <= settings.endRadiusM) end = i - 1;
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
