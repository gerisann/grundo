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

  // 2. IGÉNY — a védelmi szorzóval súlyozott terület
  const claimPoints = claim ? m2ToGp(claim.weightedClaimM2) : 0;

  // 3. LOPÁS — csak a ténylegesen elvett cellákra
  const stolenM2 = (claim?.counts.stolen ?? 0) * GAMEPLAY.CELL_AREA_M2;
  const steal = m2ToGp(stolenM2) * GAMEPLAY.STEAL_BONUS;

  // 4. ÁTTÖRÉS — a védett cella nem cserélt gazdát, de a támadás nem hiábavaló
  const brokenM2 = (claim?.counts.breakthrough ?? 0) * GAMEPLAY.CELL_AREA_M2;
  const breakthrough = m2ToGp(brokenM2) * GAMEPLAY.BREAKTHROUGH_BONUS;

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

/** m² → GP: 1 GP minden 1 000 m² után. */
export function m2ToGp(m2: number): number {
  return (m2 / 1_000_000) * GAMEPLAY.CLAIM_GP_PER_KM2;
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

/** Szint a kumulált GP-ből. 1-alapú. A szint soha nem csökken. */
export function levelFromGp(gpTotal: number): { level: number; name: string; nextAt: number | null } {
  let level = 1;
  for (let i = 0; i < GAMEPLAY.LEVELS.length; i++) {
    if (gpTotal >= GAMEPLAY.LEVELS[i]!) level = i + 1;
  }
  const nextAt = GAMEPLAY.LEVELS[level] ?? null;
  return { level, name: GAMEPLAY.LEVEL_NAMES[level - 1] ?? '', nextAt };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
