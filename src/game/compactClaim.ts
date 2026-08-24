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

interface CompactState {
  defense: number;
  /** A legutóbbi hurok toIndexe, amely ezt a cellát jóváírta. */
  creditedAt: number;
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
   *
   * `fineParents` külön index: ettől egy 40 000 parentből álló Balaton-belsőn
   * nem kell 40 000 × 49 gyereket legenerálni csak azért, hogy megkérdezzük,
   * van-e részleges override. Gyereklista kizárólag VALÓDI részleges metszésnél
   * készül.
   */
  const parentStates = new Map<CellId, CompactState>();
  const fineStates = new Map<CellId, CompactState>();
  const fineParents = new Set<CellId>();

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
  const parentPreviewFine = new Map<CellId, number>();
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
      parentPreviewFine.set(parent, state.defense);
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

  // A finom explicit map a claim kompatibilitásához marad meg. A teljes
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

  // A Mapboxnak nem küldünk ki tízezrével olyan H3 cellákat, amelyeket maga
  // a H3 hierarchia veszteségmentesen egyetlen parentté tud összevonni.
  const renderParents = compactDefenseMap(parentPreviewFine);
  const renderFine = compactDefenseMap(finePreview);

  return {
    claim,
    claimedCells: new Set(finePreview.keys()),
    claimedCellCount: cellCount,
    preview: {
      parentResolution,
      parents: renderParents,
      cells: renderFine,
      defenseCounts,
      cellCount,
    },
  };

  function applyFullParent(parent: CellId, fromIndex: number, toIndex: number): void {
    const parentState = parentStates.get(parent);
    const hasFineState = fineParents.has(parent);

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

    // Részleges korábbi állapot: CSAK ezt az egy parentet bontjuk ki.
    const children = cellToChildren(parent, cfg.H3_RESOLUTION);
    parentStates.delete(parent);
    fineParents.add(parent);
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
      fineParents.add(parent);
      return;
    }
    if (fromIndex < previous.creditedAt) return;

    fineStates.set(cell, {
      defense: Math.min(previous.defense + 1, cfg.MAX_DEFENSE),
      creditedAt: toIndex,
    });
    fineParents.add(parent);
  }
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
