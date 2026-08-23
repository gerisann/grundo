/**
 * GPS-minták szűrése — tiszta függvények, állapot nélkül.
 *
 * A cél NEM a csalás felderítése: azt a Trust Score végzi, szerveroldalon, a
 * teljes nyomvonal ismeretében. Itt csak azt szűrjük ki, ami a mérésből
 * fakadó szemét, és ami elrontaná a megtett távolságot vagy hamis hurkot
 * rajzolna a rácsra.
 *
 * Három hiba jellemző, és mindhárom mást igényel:
 *
 *   1. PONTATLAN FIX — a készülék jelenti, mennyire bízik magában. Városban,
 *      induláskor gyakori a 100 m fölötti érték. Az ilyen pont a hexagonrácson
 *      több cellányit ugrik, tehát nem használható.
 *   2. UGRÁS — a fix hirtelen több száz métert vált (többutas terjedés,
 *      cellatorony-alapú becslés). Fizikailag lehetetlen sebességgel szűrjük.
 *   3. ÁLLÓ HELYZETI ZAJ — álló helyzetben a fix pár méteres körben vándorol.
 *      Ha ezt mind rögzítjük, a felhasználó "megtesz" néhány száz métert
 *      egy piros lámpánál.
 */

import { distanceM } from '@/game/geo';
import { GAMEPLAY } from '@/config/gameplay';
import type { PositionSample } from './types';

export const FILTER = {
  /**
   * E fölött a fixet eldobjuk. 50 m azért, mert a H3 res 12 cella átlója
   * ~18,8 m: 50 m-es bizonytalanság már 2-3 cellányi tévedés, ami hamis
   * falat vagy hamis hurkot rajzolhat.
   */
  // Ugyanaz a küszöb, mint a játékmotorban. Korábban a rögzítő 50 méterig
  // kirajzolta és a távba számolta a pontot, miközben a végleges motor 30
  // méter fölött eldobta — ettől a vonal ugrált, a cellák pedig utólag
  // eltérhettek a mentett eredménytől.
  MAX_ACCURACY_M: GAMEPLAY.MAX_GPS_ACCURACY_M,

  /**
   * Fizikailag lehetetlen sebesség. Nem sportági határ — a bringás réteg
   * simán megy 60 km/h-val lejtőn. 40 m/s = 144 km/h: ezt már csak
   * járműben vagy hibás fixszel lehet elérni. A finomabb megítélés
   * (autóval tekert "futás") a Trust Score dolga.
   */
  MAX_SPEED_MPS: 40,

  /**
   * Ennél közelebbi pontot nem rögzítünk. 5 m nagyjából a jó minőségű
   * városi fix szórása; alatta a mozgás nem megkülönböztethető a zajtól.
   */
  MIN_MOVE_M: 5,

  /**
   * …de ha ennyi idő eltelt, akkor is rögzítünk egy pontot, még ha alig
   * mozdult is. Enélkül egy hosszabb megálló alatt teljesen kilyukadna a
   * nyomvonal, és a szünet nem lenne megkülönböztethető a jelvesztéstől.
   */
  MAX_GAP_MS: 30_000,
} as const;

export type FilterVerdict =
  | { accept: true }
  | { accept: false; reason: 'inaccurate' | 'implausible_speed' | 'too_close' | 'not_newer' };

/**
 * Az előző ponthoz csak ennyi kell.
 *
 * Szándékosan szűkebb, mint a `PositionSample`: a már elfogadott pontok
 * `TracePoint` alakban élnek, ahol az `accuracy` opcionális. Ha itt teljes
 * `PositionSample`-t kérnénk, a hívónak kényszerítenie kellene a típust — és
 * a kényszerítés pont azt a hibát rejtené el, hogy egy hiányzó mezőre
 * hivatkozunk.
 */
export type PreviousPoint = Pick<PositionSample, 'lat' | 'lng' | 't'>;

/**
 * Elfogadható-e a minta?
 *
 * @param sample    az új minta
 * @param previous  az időben KÖZVETLENÜL előtte álló, már elfogadott pont
 *                  (null, ha ez lesz az első)
 */
export function evaluate(sample: PositionSample, previous: PreviousPoint | null): FilterVerdict {
  if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) {
    return { accept: false, reason: 'inaccurate' };
  }

  if (!(sample.accuracy <= FILTER.MAX_ACCURACY_M)) {
    // `!(x <= y)` és nem `x > y`: így a NaN pontosság is elutasításra kerül.
    return { accept: false, reason: 'inaccurate' };
  }

  if (previous === null) return { accept: true };

  const dt = sample.t - previous.t;
  if (dt <= 0) {
    // Azonos vagy korábbi időbélyeg ugyanazon a helyen: nincs mit hozzátenni.
    return { accept: false, reason: 'not_newer' };
  }

  const dist = distanceM(previous, sample);

  if (dist / (dt / 1000) > FILTER.MAX_SPEED_MPS) {
    return { accept: false, reason: 'implausible_speed' };
  }

  if (dist < FILTER.MIN_MOVE_M && dt < FILTER.MAX_GAP_MS) {
    return { accept: false, reason: 'too_close' };
  }

  return { accept: true };
}
