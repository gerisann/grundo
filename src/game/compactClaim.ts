import { cellToChildren, cellToChildrenSize, cellToParent } from 'h3-js';
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

interface CompactState {
  defense: number;
  /** A legutóbbi hurok toIndexe, amely ezt a cellát jóváírta. */
  creditedAt: number;
}

export interface CompactClaimPreview {
  /** A tömör teljes-parent állapot felbontása. */
  parentResolution: number;
  /** Teljes parent → egységes végső defense. */
  parents: Map<CellId, number>;
  /** Explicit res12 cella → végső defense (határsáv / részlegesen felbontott parent). */
  cells: Map<CellId, number>;
  /** Végső cellaszám defense-szintenként. Index 0 = 1×, … index 4 = 5×. */
  defenseCounts: number[];
  /** A teljes egyedi, saját res12 cellaszám. */
  cellCount: number;
}

export interface CompactEmptyWorldResult {
  claim: ClaimResult | null;
  /** Csak az explicit finom cellák. A tömör parenteket a `preview` tartja. */
  claimedCells: Set<CellId>;
  claimedCellCount: number;
  preview: CompactClaimPreview | null;
}

/**
 * Nagy hurok(ka)t üres világban úgy könyvel el, hogy a homogén belső parentek
 * nem bomlanak több millió res12 Map-be.
 *
 * Ez a LAB és a szerver GEOMETRIA-PROBE útja. Valódi ownership mellett a
 * backend blokkos claimje végzi ugyanezt az aktuális Firestore állapotból.
 */
export function resolveCompactEmptyWorldClaims(
  loops: readonly DetectedLoop[],
  actorId: string,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): CompactEmptyWorldResult {
  const compactLoops = loops.filter(hasCompactInterior);
  if (compactLoops.length === 0) {
    return { claim: null, claimedCells: new Set(), claimedCellCount: 0, preview: null };
  }

  const parentResolution = compactLoops[0]!.compactInterior!.parentResolution;
  if (
    compactLoops.some(
      (loop) => loop.compactInterior!.parentResolution !== parentResolution,
    )
  ) {
    throw new Error('A compact hurkok parent felbontása nem egységes.');
  }

  /**
   * `parentStates` csak akkor él, ha a parent minden res12 gyereke azonos
   * defense/credit állapotban van. Részleges metszésnél az adott parentet
   * legfeljebb 49 gyerekre bontjuk a `fineStates` mapben.
   */
  const parentStates = new Map<CellId, CompactState>();
  const fineStates = new Map<CellId, CompactState>();

  for (const loop of loops) {
    const compact = loop.compactInterior;
    if (compact) {
      for (const parent of compact.fullParents) {
        applyFullParent(parent, loop.fromIndex, loop.toIndex);
      }
    }

    // Fal + pontos határsáv. A két halmaz a compact full parentektől diszjunkt.
    for (const cell of loop.wall) applyFineCell(cell, loop.fromIndex, loop.toIndex);
    for (const cell of loop.interior) applyFineCell(cell, loop.fromIndex, loop.toIndex);
  }

  const defenseCounts = Array.from({ length: cfg.MAX_DEFENSE }, () => 0);
  const parentPreview = new Map<CellId, number>();
  const finePreview = new Map<CellId, number>();

  // Parenteknél a fine override-ok felülírhatják az alapállapotot. Az ilyen
  // override-ok számát levonjuk a parent bulk darabszámából.
  const overridesPerParent = new Map<CellId, number>();
  for (const cell of fineStates.keys()) {
    const parent = cellToParent(cell, parentResolution);
    if (parentStates.has(parent)) {
      overridesPerParent.set(parent, (overridesPerParent.get(parent) ?? 0) + 1);
    }
  }

  let cellCount = 0;
  let weightedCells = 0;

  for (const [parent, state] of parentStates) {
    const fullCount = Number(cellToChildrenSize(parent, cfg.H3_RESOLUTION));
    const overrideCount = overridesPerParent.get(parent) ?? 0;
    const bulkCount = Math.max(0, fullCount - overrideCount);
    if (bulkCount > 0) {
      defenseCounts[state.defense - 1] = (defenseCounts[state.defense - 1] ?? 0) + bulkCount;
      cellCount += bulkCount;
      weightedCells += bulkCount * multiplierFor(state.defense, cfg);
      parentPreview.set(parent, state.defense);
    }
  }

  for (const [cell, state] of fineStates) {
    defenseCounts[state.defense - 1] = (defenseCounts[state.defense - 1] ?? 0) + 1;
    cellCount += 1;
    weightedCells += multiplierFor(state.defense, cfg);
    finePreview.set(cell, state.defense);
  }

  if (cellCount === 0) {
    return { claim: null, claimedCells: new Set(), claimedCellCount: 0, preview: null };
  }

  /**
   * Üres világban a VÉGSŐ fate minden egyedi cellára `free`: az aktivitás előtt
   * egyik sem volt a játékosé. A köztes ismételt hurkok a defense-et emelik,
   * de a mergeClaims normál útja is `free`-ként könyvelné a végső sorsot.
   */
  const counts: Record<CellFate, number> = {
    free: cellCount,
    reclaimed: 0,
    stolen: 0,
    breakthrough: 0,
  };

  // A finom explicit map a LAB részletes kirajzolásához marad meg. A teljes
  // parentek szándékosan NINCSENEK itt kibontva.
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
    gainedM2: cellCount * cfg.CELL_AREA_M2,
  };

  return {
    claim,
    claimedCells: new Set(finePreview.keys()),
    claimedCellCount: cellCount,
    preview: {
      parentResolution,
      parents: parentPreview,
      cells: finePreview,
      defenseCounts,
      cellCount,
    },
  };

  function applyFullParent(parent: CellId, fromIndex: number, toIndex: number): void {
    const parentState = parentStates.get(parent);
    const children = cellToChildren(parent, cfg.H3_RESOLUTION);
    const hasFineState = children.some((child) => fineStates.has(child));

    if (!hasFineState) {
      if (parentState === undefined) {
        parentStates.set(parent, { defense: 1, creditedAt: toIndex });
        return;
      }
      if (fromIndex >= parentState.creditedAt) {
        parentStates.set(parent, {
          defense: Math.min(parentState.defense + 1, cfg.MAX_DEFENSE),
          creditedAt: toIndex,
        });
      }
      return;
    }

    // Részleges korábbi állapot: csak ezt az egy parentet bontjuk ki.
    parentStates.delete(parent);
    for (const child of children) {
      const previous = fineStates.get(child) ?? parentState;
      if (previous === undefined) {
        fineStates.set(child, { defense: 1, creditedAt: toIndex });
      } else if (fromIndex >= previous.creditedAt) {
        fineStates.set(child, {
          defense: Math.min(previous.defense + 1, cfg.MAX_DEFENSE),
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
      fineStates.set(cell, { defense: 1, creditedAt: toIndex });
      return;
    }
    if (fromIndex < previous.creditedAt) return;

    fineStates.set(cell, {
      defense: Math.min(previous.defense + 1, cfg.MAX_DEFENSE),
      creditedAt: toIndex,
    });
  }
}
