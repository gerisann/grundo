import { cellToChildren, cellToChildrenSize, cellToParent, compactCells } from 'h3-js';
import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import type {
  CellFate,
  CellId,
  CellOwnership,
  ClaimResult,
  DetectedLoop,
} from '@/types';
import { multiplierFor } from './claim';
import { hasCompactInterior } from './loopInterior';

interface CompactCreditState {
  /** Hányszor jogosult claimre ez a cella ugyanebben az aktivitásban. */
  credits: number;
  /** A legutóbbi hurok toIndexe, amely ezt a cellát jóváírta. */
  creditedAt: number;
}

export interface CompactClaimCredits {
  /** A homogén parentek alapfelbontása (jelenleg res10). */
  parentResolution: number;
  /** Teljes parent → aktivitáson belüli claim-jóváírások száma. */
  parents: Map<CellId, number>;
  /** Finom res12 override → aktivitáson belüli claim-jóváírások száma. */
  cells: Map<CellId, number>;
  /** A teljes, egyedi res12-egyenértékű cellaszám. */
  cellCount: number;
}

export interface CompactClaimPreview {
  /** A számítás alap-parent felbontása. A renderelt cellák ennél durvábbak is lehetnek. */
  parentResolution: number;
  /**
   * A homogén belső rendercellái → defense. H3 `compactCells()` után vegyes,
   * a parentResolutionnél durvább felbontás is előfordulhat, de a lefedett
   * res12 cellahalmaz pontosan ugyanaz.
   */
  parents: Map<CellId, number>;
  /**
   * A finom határsáv rendercellái → defense. Szintén veszteségmentesen H3-
   * kompaktált; a tényleges explicit res12 állapot belül külön marad.
   */
  cells: Map<CellId, number>;
  /** Végső cellaszám defense-szintenként. Index 0 = 1×, … index 4 = 5×. */
  defenseCounts: number[];
  /** A teljes egyedi, saját res12 cellaszám. */
  cellCount: number;
}

export interface CompactEmptyWorldResult {
  claim: ClaimResult | null;
  /** Csak az explicit finom res12 cellák. A tömör parenteket a `preview` tartja. */
  claimedCells: Set<CellId>;
  claimedCellCount: number;
  preview: CompactClaimPreview | null;
}

/**
 * Ownership-független compact claim-jóváírások.
 *
 * A traversal-credit szabály itt dől el: egy későbbi, ugyanabból a traversalból
 * létrejövő nagyobb hurok nem fizeti ki újra a korábban már jóváírt cellát.
 * Valódi új kör viszont új creditet ad. A credit NEM defense: nincs 5-nél
 * levágva, mert például egy rivális 5× cellára 6 találat végül saját 2× állapotot
 * eredményez (4 áttörés + lopás + 1 megerősítés).
 */
export function buildCompactClaimCredits(
  loops: readonly DetectedLoop[],
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): CompactClaimCredits | null {
  const compactLoops = loops.filter(hasCompactInterior);
  if (compactLoops.length === 0) return null;

  const parentResolution = compactLoops[0]!.compactInterior!.parentResolution;
  if (
    compactLoops.some(
      (loop) => loop.compactInterior!.parentResolution !== parentResolution,
    )
  ) {
    throw new Error('A compact hurkok parent felbontása nem egységes.');
  }

  const parentStates = new Map<CellId, CompactCreditState>();
  const fineStates = new Map<CellId, CompactCreditState>();
  const fineParents = new Set<CellId>();

  for (const loop of loops) {
    const compact = loop.compactInterior;
    if (compact) {
      for (const parent of compact.fullParents) {
        applyFullParent(parent, loop.fromIndex, loop.toIndex);
      }
    }

    // Fal + pontos határsáv. A compact full parentektől geometriailag diszjunkt,
    // de több egymást átfedő hurok miatt később lehet parent/fine override.
    for (const cell of loop.wall) applyFineCell(cell, loop.fromIndex, loop.toIndex);
    for (const cell of loop.interior) applyFineCell(cell, loop.fromIndex, loop.toIndex);
  }

  const parents = new Map<CellId, number>();
  const cells = new Map<CellId, number>();
  const overridesPerParent = new Map<CellId, number>();

  for (const cell of fineStates.keys()) {
    const parent = cellToParent(cell, parentResolution);
    if (parentStates.has(parent)) {
      overridesPerParent.set(parent, (overridesPerParent.get(parent) ?? 0) + 1);
    }
  }

  let cellCount = 0;
  for (const [parent, state] of parentStates) {
    const fullCount = Number(cellToChildrenSize(parent, cfg.H3_RESOLUTION));
    const bulkCount = Math.max(0, fullCount - (overridesPerParent.get(parent) ?? 0));
    if (bulkCount <= 0) continue;
    parents.set(parent, state.credits);
    cellCount += bulkCount;
  }
  for (const [cell, state] of fineStates) {
    cells.set(cell, state.credits);
    cellCount += 1;
  }

  return { parentResolution, parents, cells, cellCount };

  function applyFullParent(parent: CellId, fromIndex: number, toIndex: number): void {
    const parentState = parentStates.get(parent);
    const hasFineState = fineParents.has(parent);

    if (!hasFineState) {
      if (parentState === undefined) {
        parentStates.set(parent, { credits: 1, creditedAt: toIndex });
        return;
      }
      if (fromIndex >= parentState.creditedAt) {
        parentStates.set(parent, {
          credits: parentState.credits + 1,
          creditedAt: toIndex,
        });
      }
      return;
    }

    // Részleges korábbi credit: CSAK ezt az egy parentet bontjuk 49 res12-re.
    const children = cellToChildren(parent, cfg.H3_RESOLUTION);
    parentStates.delete(parent);
    fineParents.add(parent);
    for (const child of children) {
      const previous = fineStates.get(child) ?? parentState;
      if (previous === undefined) {
        fineStates.set(child, { credits: 1, creditedAt: toIndex });
      } else if (fromIndex >= previous.creditedAt) {
        fineStates.set(child, {
          credits: previous.credits + 1,
          creditedAt: toIndex,
        });
      } else if (!fineStates.has(child)) {
        fineStates.set(child, previous);
      }
    }
  }

  function applyFineCell(cell: CellId, fromIndex: number, toIndex: number): void {
    const previousFine = fineStates.get(cell);
    const parent = cellToParent(cell, parentResolution);
    const parentState = parentStates.get(parent);
    const previous = previousFine ?? parentState;

    if (previous === undefined) {
      fineStates.set(cell, { credits: 1, creditedAt: toIndex });
      fineParents.add(parent);
      return;
    }
    if (fromIndex < previous.creditedAt) return;

    fineStates.set(cell, {
      credits: previous.credits + 1,
      creditedAt: toIndex,
    });
    fineParents.add(parent);
  }
}

/**
 * Nagy hurok(ka)t üres világban úgy könyvel el, hogy a homogén belső parentek
 * nem bomlanak több millió res12 Map-be.
 *
 * Ez a LAB geometriai probe és a szerver GEOMETRIA-PROBE útja. A többplayeres
 * LAB a fenti credit mapet az aktuális hierarchikus sandbox worldre alkalmazza.
 */
export function resolveCompactEmptyWorldClaims(
  loops: readonly DetectedLoop[],
  actorId: string,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): CompactEmptyWorldResult {
  const credits = buildCompactClaimCredits(loops, cfg);
  if (!credits || credits.cellCount === 0) {
    return { claim: null, claimedCells: new Set(), claimedCellCount: 0, preview: null };
  }

  const defenseCounts = Array.from({ length: cfg.MAX_DEFENSE }, () => 0);
  const parentPreviewFine = new Map<CellId, number>();
  const finePreview = new Map<CellId, number>();
  const finePerParent = new Map<CellId, number>();

  for (const cell of credits.cells.keys()) {
    const parent = cellToParent(cell, credits.parentResolution);
    if (credits.parents.has(parent)) {
      finePerParent.set(parent, (finePerParent.get(parent) ?? 0) + 1);
    }
  }

  let weightedCells = 0;
  for (const [parent, creditCount] of credits.parents) {
    const defense = Math.min(Math.max(creditCount, 1), cfg.MAX_DEFENSE);
    const fullCount = Number(cellToChildrenSize(parent, cfg.H3_RESOLUTION));
    const bulkCount = Math.max(0, fullCount - (finePerParent.get(parent) ?? 0));
    if (bulkCount <= 0) continue;
    defenseCounts[defense - 1] = (defenseCounts[defense - 1] ?? 0) + bulkCount;
    weightedCells += bulkCount * multiplierFor(defense, cfg);
    parentPreviewFine.set(parent, defense);
  }

  for (const [cell, creditCount] of credits.cells) {
    const defense = Math.min(Math.max(creditCount, 1), cfg.MAX_DEFENSE);
    defenseCounts[defense - 1] = (defenseCounts[defense - 1] ?? 0) + 1;
    weightedCells += multiplierFor(defense, cfg);
    finePreview.set(cell, defense);
  }

  const counts: Record<CellFate, number> = {
    free: credits.cellCount,
    reclaimed: 0,
    stolen: 0,
    breakthrough: 0,
  };

  // A ClaimResult kompatibilitás miatt itt csak a finom cellák explicit update-ek.
  // A parent ownershipet a többplayeres LAB külön hierarchikus worldként tartja.
  const updates = new Map<CellId, CellOwnership>();
  const fates = new Map<CellId, CellFate>();
  for (const [cell, defense] of finePreview) {
    updates.set(cell, { owner: actorId, defense });
    fates.set(cell, 'free');
  }

  const claim: ClaimResult = {
    updates,
    fates,
    counts,
    stolenFrom: {},
    breakthroughFrom: {},
    weightedClaimM2: weightedCells * cfg.CELL_AREA_M2,
    gainedM2: credits.cellCount * cfg.CELL_AREA_M2,
  };

  return {
    claim,
    claimedCells: new Set(finePreview.keys()),
    claimedCellCount: credits.cellCount,
    preview: {
      parentResolution: credits.parentResolution,
      parents: compactDefenseMap(parentPreviewFine),
      cells: compactDefenseMap(finePreview),
      defenseCounts,
      cellCount: credits.cellCount,
    },
  };
}

/**
 * Defense-szintenként tömörít, mert különböző védelmi állapotú cellák nem
 * vonhatók össze ugyanabba a render-parentbe. A H3 compactCells az uniót
 * pontosan megőrzi, csak kevesebb, vegyes felbontású indexszel írja le.
 */
function compactDefenseMap(source: ReadonlyMap<CellId, number>): Map<CellId, number> {
  if (source.size === 0) return new Map();
  const byDefense = new Map<number, CellId[]>();
  for (const [cell, defense] of source) {
    const cells = byDefense.get(defense);
    if (cells) cells.push(cell);
    else byDefense.set(defense, [cell]);
  }

  const compacted = new Map<CellId, number>();
  for (const [defense, cells] of byDefense) {
    for (const cell of compactCells(cells)) compacted.set(cell, defense);
  }
  return compacted;
}
