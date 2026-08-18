/**
 * GRUNDO pont (GP) számítás.
 *
 *   GP = kerekít( (ALAP + IGÉNY + LOPÁS + ÁTTÖRÉS) × STREAK_SZORZÓ )
 *
 * docs/04-pontrendszer.md — ott számpéldák is vannak, amikre a tesztek épülnek.
 */

import { GAMEPLAY } from '@/config/gameplay';
import type { ActivityType, ClaimResult, GpBreakdown } from '@/types';

export interface ScoreInput {
  type: ActivityType;
  distanceKm: number;
  /** null, ha az aktivitás nem zárt be semmit */
  claim: ClaimResult | null;
  /** hányadik napja tart a sorozat (0 = nincs) */
  streakDays: number;
  /** amennyi GP-t a felhasználó ma már megszerzett (a lágy plafonhoz) */
  gpEarnedToday: number;
}

export function computeActivityGp(input: ScoreInput): GpBreakdown {
  const { type, distanceKm, claim, streakDays, gpEarnedToday } = input;

  // 1. ALAP — minden méter számít, kör nélkül is
  const base = distanceKm * GAMEPLAY.BASE_GP_PER_KM[type];

  /**
   * 2. IGÉNY — a terület GYÖKE, a védelmi szorzóval megszorozva.
   *
   * A két hatást szándékosan szétválasztjuk. Ha a súlyozott területnek vennénk
   * a gyökét, a gyök a védelmi szorzót is elnyelné: négy kör az egyhez képest
   * csak 1,4× pontot adna a 3× helyett — pedig a körbe-körbe futás jutalma a
   * játék egyik alappillére.
   *
   * Így viszont mindkettő azt teszi, amire való: a TERÜLET gyökösen nő (tehát
   * a megtett úttal arányosan, nem a négyzetével), a VÉDELEM pedig teljes
   * súllyal szoroz, egészen 5×-ig.
   */
  const ownCells =
    (claim?.counts.free ?? 0) + (claim?.counts.reclaimed ?? 0) + (claim?.counts.stolen ?? 0);
  const rawM2 = ownCells * GAMEPLAY.CELL_AREA_M2;
  const defenseMultiplier = rawM2 > 0 ? (claim?.weightedClaimM2 ?? 0) / rawM2 : 1;
  const claimPoints = claim ? areaToGp(rawM2) * defenseMultiplier : 0;

  /**
   * A lopás és az áttörés az igénypont ARÁNYOS része.
   *
   * A gyök nem összegezhető cellánként (√(a+b) ≠ √a + √b), tehát az elvett
   * mezőkre nem lehet külön kiszámolni a pontot. Ehelyett az igénypontot
   * osztjuk el a mezők aránya szerint: ha a foglalás negyede idegentől jött,
   * a lopásbónusz az igénypont negyedére jár.
   */
  const own =
    (claim?.counts.free ?? 0) + (claim?.counts.reclaimed ?? 0) + (claim?.counts.stolen ?? 0);
  const broken = claim?.counts.breakthrough ?? 0;

  const stolenShare = own > 0 ? (claim?.counts.stolen ?? 0) / own : 0;
  const steal = claimPoints * stolenShare * GAMEPLAY.STEAL_BONUS;

  // 4. ÁTTÖRÉS — a védett cella nem cserélt gazdát, de a támadás nem hiábavaló
  const brokenShare = own + broken > 0 ? broken / (own + broken) : 0;
  const breakthrough = claimPoints * brokenShare * GAMEPLAY.BREAKTHROUGH_BONUS;

  // 5. SOROZAT
  const streakMult = streakMultiplier(streakDays);

  const raw = (base + claimPoints + steal + breakthrough) * streakMult;
  const { granted, reduction } = applySoftCap(raw, gpEarnedToday);

  return {
    base: round1(base),
    claim: round1(claimPoints),
    steal: round1(steal),
    breakthrough: round1(breakthrough),
    streakMult,
    softCapReduction: round1(reduction),
    total: Math.round(granted),
  };
}

/**
 * Terület → GP, a terület GYÖKÉVEL arányosan.
 *
 * A gyök a hurok lineáris méretével arányos, tehát a pont a megtett úttal nő,
 * nem a négyzetével. Lásd a `CLAIM_GP_PER_SQRT_KM2` melletti indoklást.
 */
export function areaToGp(m2: number): number {
  if (m2 <= 0) return 0;
  return Math.sqrt(m2 / 1_000_000) * GAMEPLAY.CLAIM_GP_PER_SQRT_KM2;
}

export function streakMultiplier(streakDays: number): number {
  if (streakDays <= 1) return 1;
  const mult = 1 + GAMEPLAY.DAILY_STREAK_STEP * (streakDays - 1);
  return Math.min(round2(mult), GAMEPLAY.DAILY_STREAK_MAX);
}

/**
 * Lágy plafon: a napi 5 000 GP fölötti rész fele értéken számít.
 * Nem kemény korlát — az extrém teljesítmény továbbra is jutalmazott.
 */
export function applySoftCap(
  raw: number,
  earnedToday: number,
): { granted: number; reduction: number } {
  const cap = GAMEPLAY.SOFT_CAP_GP_PER_DAY;
  if (earnedToday >= cap) {
    const granted = raw * GAMEPLAY.SOFT_CAP_RATE;
    return { granted, reduction: raw - granted };
  }
  const headroom = cap - earnedToday;
  if (raw <= headroom) return { granted: raw, reduction: 0 };

  const over = raw - headroom;
  const granted = headroom + over * GAMEPLAY.SOFT_CAP_RATE;
  return { granted, reduction: raw - granted };
}

/** Napi tartás-bónusz: 100 GP / km² / nap, napi 1 000 GP plafonnal. */
export function computeHoldBonus(heldM2: number, activeInLastDays: number): number {
  if (activeInLastDays > GAMEPLAY.HOLD_REQUIRES_ACTIVE_DAYS) return 0;
  const gp = (heldM2 / 1_000_000) * GAMEPLAY.HOLD_GP_PER_KM2;
  return Math.round(Math.min(gp, GAMEPLAY.HOLD_GP_DAILY_CAP));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
