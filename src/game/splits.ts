/**
 * Részidők (splits) és szintprofil a nyers nyomvonalból.
 *
 * A GRUNDO nem tárol részidőket: kiszámolhatók a nyomvonalból, és ha
 * tárolnánk, minden képletváltoztatás migrációt igényelne. A számítás egy
 * 10 000 pontos nyomvonalon is ezredmásodpercek alatt lefut.
 */

import { distanceM } from './geo';
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

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]!;
    const current = points[i]!;
    const step = distanceM(previous, current);

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
      const boundaryT = previous.t + (current.t - previous.t) * ratio;

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

  for (const point of points) {
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
