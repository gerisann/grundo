/**
 * Trust Score — aktivitás-hitelesség.
 *
 * 0–100 közötti súlyozott pontszám hét jelforrásból. NEM bináris döntés,
 * mert a valóság sem bináris: egy alagútban kihagyó GPS gyanúsnak tűnik,
 * de ártatlan.
 *
 * ⚠️ A PONTSZÁM SOHA NEM KERÜLHET KLIENSRE — sem a szám, sem a részjelek.
 * A felhasználó csak a verdiktet látja. Ha a szám látszana, visszafejthető
 * és kijátszható lenne.
 *
 * docs/03-jatekszabalyok.md → Trust Score
 */

import type { TracePoint } from '@/types';

export type TrustVerdict = 'trusted' | 'pending_review' | 'rejected';

/** A hét jelforrás és a súlyuk. Élesben az appConfig-ból felülírható. */
export const TRUST_WEIGHTS = {
  speed: 20,
  acceleration: 15,
  gpsPrecision: 15,
  teleport: 20,
  sensorConsistency: 15,
  history: 10,
  reports: 5,
} as const;

export type TrustSignal = keyof typeof TRUST_WEIGHTS;

export interface TrustInput {
  points: readonly TracePoint[];
  type: 'run' | 'walk' | 'ride';
  distanceKm: number;
  durationS: number;
  /** eszközből érkező adatok — ha vannak, erős bizonyíték a valódiságra */
  sensors?: { avgHr?: number; avgCadence?: number; avgPowerW?: number };
  /** a felhasználó előzménye */
  history: { cleanActivities: number; avgPaceSPerKm?: number; upheldReports: number };
  /** független, hiteles bejelentők száma erre az aktivitásra */
  credibleReports: number;
  /** hézagkitöltési figyelmeztetések a cellaláncból (src/game/cells.ts) */
  largeGaps: number;
}

export interface TrustResult {
  score: number;
  /** részjelenként 0–1 közötti érték (1 = teljesen rendben) */
  signals: Record<TrustSignal, number>;
  verdict: TrustVerdict;
  /** a felhasználónak MUTATHATÓ indoklás — a pontszám nélkül */
  reasons: string[];
}

/**
 * TODO(F2): implementáció.
 *
 * Vázlat:
 *   speed              a típushoz tartozó plafon (25 / 12 / 80 km/h);
 *                      a tartósan plafonközeli sebesség önmagában is gyanús
 *   acceleration       emberi gyorsulási profil — a TÚL SIMA ugyanolyan
 *                      gyanús, mint a túl ugrálós
 *   gpsPrecision       jelentett pontosság, pontsűrűség; a hamisított jel
 *                      tipikusan irreálisan JÓ és ÁLLANDÓ pontosságot jelent
 *   teleport           fizikailag lehetetlen ugrások + largeGaps
 *   sensorConsistency  tempó ↔ lépésfrekvencia ↔ pulzus ↔ magasság;
 *                      autóval "futni" itt bukik le
 *   history            saját előzményhez képest hirtelen 2× jobb tempó,
 *                      új eszköz, szokatlan helyszín, fiók kora
 *   reports            csak TÖBB, egymástól független és maga is jó hírű
 *                      bejelentő húzza le — egyetlen bosszú-bejelentés nem
 */
export function computeTrustScore(_input: TrustInput): TrustResult {
  throw new Error('Még nincs implementálva — lásd docs/03-jatekszabalyok.md');
}

/** Küszöbök: ≥80 érvényes · 50–79 ellenőrzés alatt · <50 elutasítva. */
export function verdictFor(score: number, accept = 80, reject = 50): TrustVerdict {
  if (score >= accept) return 'trusted';
  if (score >= reject) return 'pending_review';
  return 'rejected';
}
