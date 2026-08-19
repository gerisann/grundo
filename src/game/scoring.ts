/**
 * GRUNDO pont (GP) számítás.
 *
 *   GP = kerekít( (ALAP + IGÉNY + LOPÁS + ÁTTÖRÉS) × STREAK_SZORZÓ × MODIFIER )
 *
 * docs/04-pontrendszer.md — ott számpéldák is vannak, amikre a tesztek épülnek.
 *
 * A konfiguráció PARAMÉTER, nem import. Élesben az `appConfig/gameplay`
 * felülírhatja a hangolható konstansokat, és egy aktivitás feldolgozása a
 * legelején rögzített pillanatképpel számol végig — így egy futás soha nem
 * számol félig a régi, félig az új szabályokkal. Az alapértelmezett paraméter a
 * statikus alapérték, ezért a meglévő hívási helyek változatlanul működnek.
 */

import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
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
  /**
   * Időszakos szorzók, a területi arányokkal MÁR súlyozva (lásd
   * `src/game/modifiers.ts`). 1 = nincs hatás.
   *
   * A `claim` csak az igénypontra hat — és rajta keresztül a lopás- és
   * áttörés-bónuszra, mert azok az igénypont arányos részei —, a `gp` az egész
   * aktivitásra. Mindkettő a lágy plafon ELŐTT érvényesül: a plafon a
   * ténylegesen jóváírandó pontot korlátozza, nem a nyerset.
   */
  modifierFactors?: { gp?: number; claim?: number };
}

export function computeActivityGp(
  input: ScoreInput,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): GpBreakdown {
  const { type, distanceKm, claim, streakDays, gpEarnedToday } = input;
  const claimFactor = positiveFactor(input.modifierFactors?.claim);
  const gpFactor = positiveFactor(input.modifierFactors?.gp);

  // 1. ALAP — minden méter számít, kör nélkül is
  const base = distanceKm * cfg.BASE_GP_PER_KM[type];

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
  const rawM2 = ownCells * cfg.CELL_AREA_M2;
  const defenseMultiplier = rawM2 > 0 ? (claim?.weightedClaimM2 ?? 0) / rawM2 : 1;
  const claimPoints = claim ? areaToGp(rawM2, cfg) * defenseMultiplier * claimFactor : 0;

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
  const steal = claimPoints * stolenShare * cfg.STEAL_BONUS;

  // 4. ÁTTÖRÉS — a védett cella nem cserélt gazdát, de a támadás nem hiábavaló
  const brokenShare = own + broken > 0 ? broken / (own + broken) : 0;
  const breakthrough = claimPoints * brokenShare * cfg.BREAKTHROUGH_BONUS;

  // 5. SOROZAT
  const streakMult = streakMultiplier(streakDays, cfg);

  const raw = (base + claimPoints + steal + breakthrough) * streakMult * gpFactor;
  const { granted, reduction } = applySoftCap(raw, gpEarnedToday, cfg);

  return {
    base: round1(base),
    claim: round1(claimPoints),
    steal: round1(steal),
    breakthrough: round1(breakthrough),
    streakMult,
    modifierMult: round2(gpFactor),
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
export function areaToGp(m2: number, cfg: GameplayConfig = DEFAULT_GAMEPLAY): number {
  if (m2 <= 0) return 0;
  return Math.sqrt(m2 / 1_000_000) * cfg.CLAIM_GP_PER_SQRT_KM2;
}

export function streakMultiplier(
  streakDays: number,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): number {
  if (streakDays <= 1) return 1;
  const mult = 1 + cfg.DAILY_STREAK_STEP * (streakDays - 1);
  return Math.min(round2(mult), cfg.DAILY_STREAK_MAX);
}

/**
 * Lágy plafon: a napi 5 000 GP fölötti rész fele értéken számít.
 * Nem kemény korlát — az extrém teljesítmény továbbra is jutalmazott.
 */
export function applySoftCap(
  raw: number,
  earnedToday: number,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): { granted: number; reduction: number } {
  const cap = cfg.SOFT_CAP_GP_PER_DAY;
  if (earnedToday >= cap) {
    const granted = raw * cfg.SOFT_CAP_RATE;
    return { granted, reduction: raw - granted };
  }
  const headroom = cap - earnedToday;
  if (raw <= headroom) return { granted: raw, reduction: 0 };

  const over = raw - headroom;
  const granted = headroom + over * cfg.SOFT_CAP_RATE;
  return { granted, reduction: raw - granted };
}

/**
 * Napi tartás-bónusz: 100 GP / km² / nap, napi 1 000 GP plafonnal.
 *
 * A `modifierFactor` a területi vagy globális `hold_multiplier` modifierekből
 * jön, és a PLAFON ELŐTT hat: a plafon a ténylegesen jóváírandó pontot
 * korlátozza, nem a nyerset. Ha utána hatna, egy nagybirtokos, aki már a
 * plafonon ül, semmit nem érezne egy hold-bónusz akcióból.
 */
export function computeHoldBonus(
  heldM2: number,
  activeInLastDays: number,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
  modifierFactor = 1,
): number {
  if (activeInLastDays > cfg.HOLD_REQUIRES_ACTIVE_DAYS) return 0;
  const gp = (heldM2 / 1_000_000) * cfg.HOLD_GP_PER_KM2 * positiveFactor(modifierFactor);
  return Math.round(Math.min(gp, cfg.HOLD_GP_DAILY_CAP));
}

/**
 * Egy szorzó akkor érvényes, ha véges és nem negatív. Minden más esetben 1.
 *
 * A modifierek adatbázisból jönnek, tehát lehetnek hiányosak vagy elrontottak.
 * Egy hiányzó vagy `NaN` szorzó itt csendben `NaN`-t vinne a végösszegbe, és az
 * a felhasználónál „nulla pontot kaptam" alakban jelentkezne, minden nyom
 * nélkül.
 */
function positiveFactor(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 1;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
