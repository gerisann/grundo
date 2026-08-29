/**
 * Részidők (splits) és szintprofil a nyers nyomvonalból.
 *
 * A GRUNDO nem tárol részidőket: kiszámolhatók a nyomvonalból, és ha
 * tárolnánk, minden képletváltoztatás migrációt igényelne. A számítás egy
 * 10 000 pontos nyomvonalon is ezredmásodpercek alatt lefut.
 */

import { distanceM } from './geo';
import { GAMEPLAY } from '@/config/gameplay';
import type { TracePoint } from '@/types';

export interface Split {
  /** Hányadik kilométer — 1-től. */
  index: number;
  /** Ennek a szakasznak a hossza. Az utolsó jellemzően rövidebb 1000 m-nél. */
  distanceM: number;
  seconds: number;
  /** Másodperc kilométerenként. A részszakaszra vetítve, nem a nyers időre. */
  paceSPerKm: number;
  elevationGainM: number;
  /** Teljes kilométer-e. A töredék szakaszt nem szabad rekordként kezelni. */
  partial: boolean;
}

const SPLIT_M = 1000;

/**
 * Zajküszöb a szintemelkedéshez.
 *
 * A telefon barométere és a GPS magassága is ±2-3 métert téved mintánként.
 * Küszöb nélkül egy sík futás is „180 méter emelkedést" mutatna, mert a zaj
 * minden pozitív ingadozása összeadódna.
 */
const ELEVATION_NOISE_M = 3;

export function computeSplits(points: readonly TracePoint[]): Split[] {
  if (points.length < 2) return [];

  const splits: Split[] = [];
  let accumulated = 0;
  let splitStartT = points[0]!.t;
  let splitElevation = 0;
  let lastElevation = points[0]!.elevation;

  // A HORGONY (anchor) — lásd `tracking/filter.ts` `STATIONARY_RADIUS_M`.
  // Pontpáronkénti lánc-összegzésnél egy beltéri/álló helyzeti GPS-zaj is
  // valódi távvá és emelkedéssé adódna össze, hiszen minden egyes lépés
  // önmagában „elfogadhatónak" tűnik. A horgony ezzel szemben csak akkor
  // mozdul (és csak akkor számít bele a távba/emelkedésbe), ha egy pont
  // TARTÓSAN kikerül a köréje rajzolt körből.
  let anchor = points[0]!;
  let anchorT = points[0]!.t;

  for (let i = 1; i < points.length; i += 1) {
    const current = points[i]!;
    const step = distanceM(anchor, current);
    if (step < GAMEPLAY.GPS_STATIONARY_RADIUS_M) continue;

    const elevation = current.elevation;
    if (elevation !== undefined && lastElevation !== undefined) {
      const climb = elevation - lastElevation;
      if (Math.abs(climb) >= ELEVATION_NOISE_M) {
        if (climb > 0) splitElevation += climb;
        lastElevation = elevation;
      }
    } else if (elevation !== undefined) {
      lastElevation = elevation;
    }

    accumulated += step;

    if (accumulated >= SPLIT_M) {
      /**
       * A kilométerhatár jellemzően két minta KÖZÖTT van. A határ idejét
       * lineárisan interpoláljuk a szakaszon belül — enélkül a részidők
       * fokozatosan elcsúsznának, és egy hosszabb futás végére a hiba
       * több tíz másodperc lenne.
       */
      const overshoot = accumulated - SPLIT_M;
      const ratio = step > 0 ? 1 - overshoot / step : 1;
      const boundaryT = anchorT + (current.t - anchorT) * ratio;

      const seconds = (boundaryT - splitStartT) / 1000;
      splits.push({
        index: splits.length + 1,
        distanceM: SPLIT_M,
        seconds,
        paceSPerKm: seconds,
        elevationGainM: Math.round(splitElevation),
        partial: false,
      });

      accumulated = overshoot;
      splitStartT = boundaryT;
      splitElevation = 0;
    }

    anchor = current;
    anchorT = current.t;
  }

  // A maradék szakasz — csak ha értelmes hosszúságú. Egy 12 méteres „utolsó
  // kilométer" nem információ, csak zaj a táblázat alján.
  if (accumulated >= 50) {
    const seconds = (points[points.length - 1]!.t - splitStartT) / 1000;
    splits.push({
      index: splits.length + 1,
      distanceM: Math.round(accumulated),
      seconds,
      paceSPerKm: seconds / (accumulated / SPLIT_M),
      elevationGainM: Math.round(splitElevation),
      partial: true,
    });
  }

  return splits;
}

/** Összes emelkedés és csökkenés, ugyanazzal a zajküszöbbel. */
export function elevationProfile(points: readonly TracePoint[]): {
  gainM: number;
  lossM: number;
  hasData: boolean;
} {
  let gain = 0;
  let loss = 0;
  let last: number | undefined;
  let seen = 0;
  if (points.length === 0) return { gainM: 0, lossM: 0, hasData: false };

  // Ugyanaz a horgony-elv, mint `computeSplits`-ben: egy pont csak akkor
  // számít új mintának, ha VALÓDI elmozdulás van a legutóbbi horgonyhoz
  // képest — különben az álló helyzeti GPS-zaj is emelkedésnek látszana.
  let anchor = points[0]!;
  if (anchor.elevation !== undefined) {
    last = anchor.elevation;
    seen += 1;
  }

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    if (distanceM(anchor, point) < GAMEPLAY.GPS_STATIONARY_RADIUS_M) continue;
    anchor = point;

    if (point.elevation === undefined) continue;
    seen += 1;
    if (last === undefined) {
      last = point.elevation;
      continue;
    }
    const change = point.elevation - last;
    if (Math.abs(change) >= ELEVATION_NOISE_M) {
      if (change > 0) gain += change;
      else loss -= change;
      last = point.elevation;
    }
  }

  return { gainM: Math.round(gain), lossM: Math.round(loss), hasData: seen >= 2 };
}
