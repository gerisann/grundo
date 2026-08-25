import { cellToChildren, cellToParent } from 'h3-js';
import { DEFAULT_GAMEPLAY, type GameplayConfig } from '../../../src/config/gameplay';
import { resolveClaimCredits } from '../../../src/game/claimCredits';
import type { CellFate, CellId, CellOwnership, Layer } from '../../../src/types';
import {
  blockCellCount,
  cellKey,
  effectiveDefense,
  uniformStateOf,
  type GridBlock,
  type StoredCell,
} from './gridMath';

export interface CompactBlockWork {
  /** A Firestore blokk H3 parentje, jelenleg res9. */
  blockParent: CellId;
  /** A compact claim parentfelbontása, jelenleg res10. */
  claimParentResolution: number;
  /** Teljes claim-parent → traversal credit. */
  parentCredits: ReadonlyMap<CellId, number>;
  /** Exact res12 override → traversal credit. */
  fineCredits: ReadonlyMap<CellId, number>;
}

export interface CompactBlockPart {
  counts: Record<CellFate, number>;
  stolenFrom: Record<string, number>;
  breakthroughFrom: Record<string, number>;
  weightedClaimM2: number;
  gainedM2: number;
  /** Ennyi egyedi res12-egyenértékű cellát érintett claim ebben a blokkban. */
  cells: number;
}

export interface CompactBlockResult {
  /** Csak valódi állapotváltozásnál kell Firestore-ba írni. */
  changed: boolean;
  /** A blokk teljes következő tárolt alakja. `changed=false` esetén null. */
  nextBlock: GridBlock | null;
  part: CompactBlockPart;
  /**
   * Exact ellopott res12 cellák részleges/mixed blokkból. A teljesen bulk módon
   * ellopott blokkot a `wholeBlockStolen` jelzi, hogy ne kelljen 343 id-t eltárolni.
   */
  stolenFineCells: CellId[];
  wholeBlockStolen: boolean;
}

/**
 * Egyetlen production res9 blokk compact claimjének tiszta feldolgozása.
 *
 * Két út van:
 * - ha a teljes blokk azonos creditet kap ÉS a tárolt állapot homogén, a
 *   transition O(1), és a blokk `uniform` marad;
 * - minden más esetben CSAK EZT AZ EGY blokkot bontjuk ki res12-re (max 343
 *   cella), alkalmazzuk a crediteket, majd rögtön visszatömörítjük, ha lehet.
 *
 * Ez a production megfelelője a LAB parent/override logikájának, de a tárolási
 * granularitáshoz igazítva: Firestore-ban res9 blokk a dokumentumhatár.
 */
export function resolveCompactBlockClaim(
  layer: Layer,
  current: GridBlock | null,
  work: CompactBlockWork,
  actorId: string,
  today: number,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): CompactBlockResult {
  const empty = emptyPart();
  const fullBlockCredits = uniformCreditsForWholeBlock(work, cfg);

  if (fullBlockCredits !== null && (current === null || current.uniform !== undefined)) {
    const stored = current?.uniform;
    const before: CellOwnership | undefined = stored
      ? { owner: stored.o, defense: effectiveDefense(stored, today) }
      : undefined;
    const transition = resolveClaimCredits(before, actorId, fullBlockCredits, cfg);
    const amount = blockCellCount(work.blockParent, cfg.H3_RESOLUTION);
    const part = accountTransition(empty, transition, amount, cfg);

    if (!transition.after) {
      return { changed: false, nextBlock: null, part, stolenFineCells: [], wholeBlockStolen: false };
    }

    const changed = before?.owner !== transition.after.owner
      || before?.defense !== transition.after.defense;
    if (!changed) {
      return { changed: false, nextBlock: null, part, stolenFineCells: [], wholeBlockStolen: false };
    }

    const nextStored: StoredCell = {
      o: transition.after.owner,
      d: transition.after.defense,
      u: today,
    };
    return {
      changed: true,
      nextBlock: {
        layer,
        parent: work.blockParent,
        cells: {},
        ownerCounts: { [nextStored.o]: amount },
        version: (current?.version ?? 0) + 1,
        uniform: nextStored,
      },
      part,
      stolenFineCells: [],
      wholeBlockStolen: transition.fate === 'stolen',
    };
  }

  return resolveExpandedBlock(layer, current, work, actorId, today, cfg);
}

function resolveExpandedBlock(
  layer: Layer,
  current: GridBlock | null,
  work: CompactBlockWork,
  actorId: string,
  today: number,
  cfg: GameplayConfig,
): CompactBlockResult {
  const children = cellToChildren(work.blockParent, cfg.H3_RESOLUTION) as CellId[];
  const storedCells: Record<string, StoredCell> = current?.uniform
    ? Object.fromEntries(children.map((cell) => [cellKey(cell), { ...current.uniform! }]))
    : { ...(current?.cells ?? {}) };

  let part = emptyPart();
  let changed = false;
  const stolenFineCells: CellId[] = [];

  for (const cell of children) {
    const parent = cellToParent(cell, work.claimParentResolution) as CellId;
    const credits = work.fineCredits.get(cell) ?? work.parentCredits.get(parent) ?? 0;
    if (credits <= 0) continue;

    const key = cellKey(cell);
    const stored = storedCells[key];
    const before: CellOwnership | undefined = stored
      ? { owner: stored.o, defense: effectiveDefense(stored, today) }
      : undefined;
    const transition = resolveClaimCredits(before, actorId, credits, cfg);
    part = accountTransition(part, transition, 1, cfg);
    if (transition.fate === 'stolen') stolenFineCells.push(cell);

    if (!transition.after) continue;
    if (before?.owner === transition.after.owner && before?.defense === transition.after.defense) continue;

    storedCells[key] = {
      o: transition.after.owner,
      d: transition.after.defense,
      u: today,
    };
    changed = true;
  }

  if (!changed) {
    return { changed: false, nextBlock: null, part, stolenFineCells, wholeBlockStolen: false };
  }

  const ownerCounts: Record<string, number> = {};
  for (const stored of Object.values(storedCells)) {
    ownerCounts[stored.o] = (ownerCounts[stored.o] ?? 0) + 1;
  }
  const uniform = uniformStateOf(
    storedCells,
    blockCellCount(work.blockParent, cfg.H3_RESOLUTION),
  );

  return {
    changed: true,
    nextBlock: {
      layer,
      parent: work.blockParent,
      cells: uniform ? {} : storedCells,
      ownerCounts,
      version: (current?.version ?? 0) + 1,
      ...(uniform ? { uniform } : {}),
    },
    part,
    stolenFineCells,
    wholeBlockStolen: false,
  };
}

/**
 * Igaz, ha a work a blokk MINDEN res12 gyerekét közvetlen claimként érinti.
 *
 * A gyakori út teljes res10 parentekből áll, ezért csak hét bejegyzést néz.
 * A ritka, finom határsávval teljesen kitöltött parentnél legfeljebb a blokk
 * 343 res12 gyerekét ellenőrzi. Ezt a frontier cleanup használja arra, hogy a
 * homogén compact belső blokkokat SOHA ne bontsa ki feleslegesen.
 */
export function compactWorkCoversWholeBlock(
  work: CompactBlockWork,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): boolean {
  const parents = cellToChildren(work.blockParent, work.claimParentResolution) as CellId[];
  if (parents.length === 0) return false;

  for (const parent of parents) {
    if ((work.parentCredits.get(parent) ?? 0) > 0) continue;
    const fineChildren = cellToChildren(parent, cfg.H3_RESOLUTION) as CellId[];
    if (fineChildren.length === 0) return false;
    if (!fineChildren.every((cell) => (work.fineCredits.get(cell) ?? 0) > 0)) return false;
  }
  return true;
}

/**
 * Akkor ad creditet, ha a claim a blokk MINDEN res10 gyermekét teljesen és
 * AZONOS credit-számmal lefedi, exact finom kivétel nélkül.
 */
function uniformCreditsForWholeBlock(
  work: CompactBlockWork,
  cfg: GameplayConfig,
): number | null {
  if (work.fineCredits.size > 0) return null;
  const parents = cellToChildren(work.blockParent, work.claimParentResolution) as CellId[];
  if (parents.length === 0) return null;

  let credits: number | null = null;
  for (const parent of parents) {
    const value = work.parentCredits.get(parent);
    if (value === undefined || value <= 0) return null;
    if (credits === null) credits = value;
    else if (credits !== value) return null;
  }
  return credits;
}

function emptyPart(): CompactBlockPart {
  return {
    counts: { free: 0, reclaimed: 0, stolen: 0, breakthrough: 0 },
    stolenFrom: {},
    breakthroughFrom: {},
    weightedClaimM2: 0,
    gainedM2: 0,
    cells: 0,
  };
}

function accountTransition(
  source: CompactBlockPart,
  transition: ReturnType<typeof resolveClaimCredits>,
  amount: number,
  cfg: GameplayConfig,
): CompactBlockPart {
  if (!transition.fate || amount <= 0) return source;
  const next: CompactBlockPart = {
    counts: { ...source.counts },
    stolenFrom: { ...source.stolenFrom },
    breakthroughFrom: { ...source.breakthroughFrom },
    weightedClaimM2: source.weightedClaimM2 + transition.weightedCells * amount * cfg.CELL_AREA_M2,
    gainedM2: source.gainedM2 + transition.gainedCells * amount * cfg.CELL_AREA_M2,
    cells: source.cells + amount,
  };
  next.counts[transition.fate] += amount;
  if (transition.stolenFrom) {
    next.stolenFrom[transition.stolenFrom] = (next.stolenFrom[transition.stolenFrom] ?? 0) + amount;
  }
  if (transition.breakthroughFrom) {
    next.breakthroughFrom[transition.breakthroughFrom] =
      (next.breakthroughFrom[transition.breakthroughFrom] ?? 0) + amount;
  }
  return next;
}
