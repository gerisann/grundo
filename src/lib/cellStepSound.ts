/**
 * VALÓS IDEJŰ CELLAHANG — ahogy futás közben új mezőre lépünk.
 *
 * ⚠️ EZ NEM A HUROKBEZÁRÁS VISSZAJELZÉSE. A kettő szándékosan külön:
 *
 *   - `lib/captureEvents.ts` → a BEZÁRÁS eredménye: mennyi terület lett a
 *     tiéd. Egyszer szól (`loop-closed`), és felugró üzenet jár hozzá.
 *   - ez a modul → a LÉPÉS: minden új H3 cellánál egy koppanás, a cella
 *     ÉPP AKTUÁLIS állapota szerint. Geri kérése (2026-09-01): „mikor real
 *     time rámegyünk egy új cellára, akkor. és attól függően hogy milyen
 *     cella, olyan hangot kell lejátszani."
 *
 * Futótempóban egy H3 res 12 cella (~18,8 m átló) 5–7 másodpercenként vált,
 * bringán 2–3 másodpercenként — a koppanások tehát ritmust adnak, nem zajt.
 *
 * A HANG A CELLA MOSTANI ÁLLAPOTÁT tükrözi, nem a végső elszámolást. A
 * terület ténylegesen csak hurokbezáráskor cserél gazdát (`game/index.ts`),
 * de a felhasználó abban a pillanatban akar visszajelzést, amikor rálép a
 * mezőre — és akkor az az érdekes, hogy MIRE lépett rá.
 */

import { GAMEPLAY } from '@/config/gameplay';
import type { CellId } from '@/types';
import type { SoundName } from './sound';

export interface CellOwner {
  owner: string;
  defense: number;
}

/**
 * Melyik hang jár ennek a mezőnek?
 *
 * @param owned  a mező jelenlegi tulajdonosa, vagy `undefined`, ha szabad
 *               (illetve ha a térképcsempe még nem tud róla — akkor a
 *               „szabad" a helyes feltételezés, mert a rács alapállapota az)
 * @param myUid  a saját azonosító
 */
export function cellStepSound(owned: CellOwner | undefined, myUid: string): SoundName {
  if (owned === undefined) return 'cell-captured';
  if (owned.owner !== myUid) return 'cell-stolen';
  /**
   * A SAJÁT MEZŐ KÉT ESETE.
   *
   * A maximum alatt a bezárás EMELNÉ a védelmet (2-3-4-5) — ez a
   * „megerősítés" hangja. A maximumon már nincs hova nőnie; ott a külön
   * `cell-max` szól, hogy hallható különbség legyen a kettő között.
   */
  return owned.defense >= GAMEPLAY.MAX_DEFENSE ? 'cell-max' : 'cell-defend';
}

/**
 * Egyszerre ennyi új mező szólalhat meg.
 *
 * ⚠️ NEM SZÉPÍTÉS. A cellalánc nem csak egyesével nő: natív ébredés után a
 * háttérsor egyszerre több tucat pontot szállít, egy félbehagyott rögzítés
 * visszaállítása pedig több százat. Korlát nélkül egy alagútból kibukkanó
 * telefon percnyi géppuskatüzet játszana le. A LEGUTOLSÓ mezők maradnak: az
 * a friss információ, ott van a felhasználó most.
 */
export const CELL_STEP_BURST_CAP = 5;

/** Két koppanás között legalább ennyi idő — így kötegnél is ritmus marad. */
export const CELL_STEP_GAP_MS = 190;

/**
 * Az új mezők hangjai, sorrendben.
 *
 * Tiszta függvény: a cellalánc két állapota közti KÜLÖNBSÉGET fordítja
 * hangokká. A hívó dolga eldönteni, mikor hívja (lásd `useCellStepSound`).
 *
 * @param previousLength hány mezőt dolgoztunk fel eddig
 * @param path           a teljes cellalánc most
 */
export function cellStepSounds(
  previousLength: number,
  path: readonly CellId[],
  ownership: ReadonlyMap<CellId, CellOwner>,
  myUid: string,
): SoundName[] {
  if (path.length <= previousLength) return [];
  const fresh = path.slice(Math.max(previousLength, path.length - CELL_STEP_BURST_CAP));
  return fresh.map((cell) => cellStepSound(ownership.get(cell), myUid));
}
