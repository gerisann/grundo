/**
 * Birtoklási szabályok — cellánként.
 *
 * Nincs külön "kiharapás" és "bekebelezés" szabály: mindkettő ugyanennek a
 * cellánkénti eljárásnak a következménye.
 *
 * docs/03-jatekszabalyok.md → Birtoklási szabályok
 */

import { GAMEPLAY } from '@/config/gameplay';
import type { CellFate, CellId, CellOwnership, ClaimResult, OwnershipMap } from '@/types';

/**
 * @param claimed   a bezárásokból megszerzett cellák (fal + belső)
 * @param current   a claim által érintett cellák JELENLEGI tulajdonviszonya
 *                  (a hívó tölti fel — a szerveren a `grid` blokkokból)
 * @param actorId   aki a foglalást végzi
 */
export function resolveClaim(
  claimed: ReadonlySet<CellId>,
  current: OwnershipMap,
  actorId: string,
): ClaimResult {
  const updates = new Map<CellId, CellOwnership>();
  const fates = new Map<CellId, CellFate>();
  const counts: Record<CellFate, number> = {
    free: 0, reclaimed: 0, stolen: 0, breakthrough: 0,
  };
  const stolenFrom: Record<string, number> = {};
  let weightedCells = 0;
  let gainedCells = 0;

  for (const cell of claimed) {
    const held = current.get(cell);

    // ── Szabad cella ──────────────────────────────────────────────────────
    if (held === undefined) {
      updates.set(cell, { owner: actorId, defense: 1 });
      fates.set(cell, 'free');
      counts.free++;
      weightedCells += multiplierFor(1);
      gainedCells++;
      continue;
    }

    // ── Saját cella: a védelem nő ─────────────────────────────────────────
    if (held.owner === actorId) {
      const defense = Math.min(held.defense + 1, GAMEPLAY.MAX_DEFENSE);
      updates.set(cell, { owner: actorId, defense });
      fates.set(cell, 'reclaimed');
      counts.reclaimed++;
      // A szorzó az ÚJ védelmi szint szerint jár — ez a körbe-körbe futás jutalma.
      weightedCells += multiplierFor(defense);
      continue;
    }

    // ── Idegen cella, védelem nélkül: elvesszük ───────────────────────────
    if (held.defense <= 1) {
      updates.set(cell, { owner: actorId, defense: 1 });
      fates.set(cell, 'stolen');
      counts.stolen++;
      stolenFrom[held.owner] = (stolenFrom[held.owner] ?? 0) + 1;
      weightedCells += multiplierFor(1);
      gainedCells++;
      continue;
    }

    // ── Idegen cella, védve: nem cserél gazdát, de a védelem csökken ──────
    updates.set(cell, { owner: held.owner, defense: held.defense - 1 });
    fates.set(cell, 'breakthrough');
    counts.breakthrough++;
    stolenFrom[held.owner] = stolenFrom[held.owner] ?? 0; // a károsult értesül
  }

  return {
    updates,
    fates,
    counts,
    stolenFrom,
    weightedClaimM2: weightedCells * GAMEPLAY.CELL_AREA_M2,
    gainedM2: gainedCells * GAMEPLAY.CELL_AREA_M2,
  };
}

/** Védelmi szorzó az adott (új) védelmi szinthez. */
export function multiplierFor(defense: number): number {
  const index = Math.min(Math.max(defense, 1), GAMEPLAY.MAX_DEFENSE) - 1;
  return GAMEPLAY.DEFENSE_MULTIPLIER[index] ?? 1;
}
