import { cellToChildren, cellToParent, gridDisk } from 'h3-js';
import { DEFAULT_GAMEPLAY, type GameplayConfig } from '../../../src/config/gameplay';
import { findStolenFrontierReassignments } from '../../../src/game/frontierCleanup';
import type { CellId, CellOwnership, Layer, OwnershipMap } from '../../../src/types';
import { compactWorkCoversWholeBlock, type CompactBlockWork } from './compactBlockClaim';
import { blockIdFor } from './gridMath';

export interface CompactFrontierSeeds {
  /** Exact stolen res12 cellák mixed/részleges blokkokból. */
  fineCells: ReadonlySet<CellId>;
  /** Teljesen bulk módon ellopott res9 blokkok. */
  wholeBlocks: ReadonlySet<string>;
}

export interface CompactFrontierPlan {
  /** Csak ezekből a blokkokból kell res12 seedet materializálni. */
  boundaryWholeBlocks: string[];
  /** Már eleve exact stolen seedek. */
  fineSeeds: CellId[];
  /** A cleanuphoz szükséges összes res9 blokk (seed blokkok + 1 gyűrű). */
  readBlockIds: string[];
}

/**
 * Megtervezi a compact frontier cleanup I/O scope-ját res12 materializálás
 * nélkül.
 *
 * Teljesen ellopott res9 blokk CSAK akkor kerül a finom seedek közé, ha a
 * közvetlen claim peremén van. Ha a blokk minden res9 szomszédja szintén teljes
 * közvetlen claim, akkor a blokk belseje topológiailag nem lehet frontier:
 * nincs mellette claimen kívül maradt cella, tehát 343 gyermek legenerálása
 * puszta pazarlás lenne.
 */
export function planCompactFrontier(
  layer: Layer,
  works: ReadonlyMap<string, CompactBlockWork>,
  seeds: CompactFrontierSeeds,
): CompactFrontierPlan {
  const fullClaimBlocks = new Set<string>();
  for (const [blockId, work] of works) {
    if (compactWorkCoversWholeBlock(work)) fullClaimBlocks.add(blockId);
  }

  const boundaryWholeBlocks: string[] = [];
  for (const blockId of seeds.wholeBlocks) {
    const work = works.get(blockId);
    if (!work) continue;
    const parent = work.blockParent;
    const touchesOutsideClaim = gridDisk(parent, 1).some((near) => {
      if (near === parent) return false;
      return !fullClaimBlocks.has(`${layer}_${near}`);
    });
    if (touchesOutsideClaim) boundaryWholeBlocks.push(blockId);
  }

  const readBlocks = new Set<string>();
  const addCellNeighbourBlocks = (cell: CellId): void => {
    for (const near of gridDisk(cell, 1)) readBlocks.add(blockIdFor(layer, near));
  };

  for (const cell of seeds.fineCells) addCellNeighbourBlocks(cell);
  for (const blockId of boundaryWholeBlocks) {
    const work = works.get(blockId)!;
    for (const neighbourParent of gridDisk(work.blockParent, 1)) {
      readBlocks.add(`${layer}_${neighbourParent}`);
    }
  }

  return {
    boundaryWholeBlocks,
    fineSeeds: [...seeds.fineCells],
    readBlockIds: [...readBlocks],
  };
}

/**
 * A planner által kiválasztott bulk frontier blokkokból exact res12 seedeket
 * készít. Ezt csak a valódi cleanup tranzakció előtt hívjuk, tehát a nagy
 * homogén interior soha nem kerül ide.
 */
export function materializeCompactFrontierSeeds(
  works: ReadonlyMap<string, CompactBlockWork>,
  plan: CompactFrontierPlan,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): Set<CellId> {
  const seeds = new Set<CellId>(plan.fineSeeds);
  for (const blockId of plan.boundaryWholeBlocks) {
    const work = works.get(blockId);
    if (!work) continue;
    for (const child of cellToChildren(work.blockParent, cfg.H3_RESOLUTION)) {
      seeds.add(child as CellId);
    }
  }
  return seeds;
}

/**
 * A post-claim exact ownership scope-ból kiszámolja a NO-CASCADE frontier
 * korrekciót. A közvetlen compact claim cellákat nem írhatja felül.
 */
export function resolveCompactFrontier(
  layer: Layer,
  ownership: OwnershipMap,
  stolenSeeds: Iterable<CellId>,
  works: ReadonlyMap<string, CompactBlockWork>,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): Map<CellId, CellOwnership> {
  return findStolenFrontierReassignments({
    stolenSeeds,
    ownershipAt: (cell) => ownership.get(cell),
    isDirectlyClaimed: (cell) => {
      const work = works.get(blockIdFor(layer, cell));
      if (!work) return false;
      const parent = cellToParent(cell, work.claimParentResolution) as CellId;
      return (work.fineCredits.get(cell) ?? 0) > 0 || (work.parentCredits.get(parent) ?? 0) > 0;
    },
    scope: new Set(ownership.keys()),
    gameplayResolution: cfg.H3_RESOLUTION,
  });
}
