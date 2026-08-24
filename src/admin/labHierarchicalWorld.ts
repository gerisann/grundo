import {
  cellToChildrenSize,
  cellToParent,
  compactCells,
  getResolution,
} from 'h3-js';
import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import {
  buildCompactClaimCredits,
  computeActivityGp,
  hasCompactInterior,
  layerOf,
  loopCells,
  multiplierFor,
  processActivityGeometry,
  type ActivityGeometry,
  type CompactClaimPreview,
  type ProcessInput,
  type ProcessResult,
} from '@/game';
import type {
  CellFate,
  CellId,
  CellOwnership,
  ClaimResult,
  OwnershipMap,
} from '@/types';

/**
 * A LAB sandbox world vegyes H3 felbontást használhat:
 * - res10 parent = 49 homogén res12 cella alapállapota;
 * - res12 kulcs = egyedi override a parenten belül.
 *
 * Az exact res12 override mindig erősebb az örökölt parent állapotnál. Így egy
 * többmilliós nagy terület tömör marad, de egy későbbi kis hurok csak az érintett
 * finom cellákat írja felül.
 */
export function processLabActivity(
  input: ProcessInput,
  geometry: ActivityGeometry,
): ProcessResult {
  const cfg = input.cfg ?? DEFAULT_GAMEPLAY;
  const hasCompact = geometry.loops.some(hasCompactInterior);

  if (!hasCompact) {
    // A normál core claim res12 exact Mapet vár. A mixed-resolution LAB worldből
    // csak a ténylegesen érintett kis hurok celláit materializáljuk.
    const scopedOwnership = materializeFineOwnership(input.ownership, geometry, cfg);
    return processActivityGeometry({ ...input, ownership: scopedOwnership }, geometry);
  }

  return processCompactLabActivity(input, geometry, cfg);
}

/** Exact cell → legközelebbi tárolt parent fallback. */
export function labWorldOwnershipAt(
  world: OwnershipMap,
  cell: CellId,
): CellOwnership | undefined {
  const exact = world.get(cell);
  if (exact !== undefined) return exact;

  const resolution = getResolution(cell);
  for (let parentRes = resolution - 1; parentRes >= 0; parentRes -= 1) {
    const parent = cellToParent(cell, parentRes);
    const inherited = world.get(parent);
    if (inherited !== undefined) return inherited;
  }
  return undefined;
}

/** Egy mixed-resolution world res12-egyenértékű cellaszáma player szerint. */
export function countLabPlayerCells(world: OwnershipMap, playerId: string): number {
  return countWorldState(world, (ownership) => ownership.owner === playerId);
}

/** Egy mixed-resolution world res12-egyenértékű cellaszáma player + defense szerint. */
export function countLabPlayerDefense(
  world: OwnershipMap,
  playerId: string,
  defense: number,
): number {
  return countWorldState(
    world,
    (ownership) => ownership.owner === playerId && ownership.defense === defense,
  );
}

function processCompactLabActivity(
  input: ProcessInput,
  geometry: ActivityGeometry,
  cfg: GameplayConfig,
): ProcessResult {
  const credits = buildCompactClaimCredits(geometry.loops, cfg);
  if (!credits || credits.cellCount === 0) {
    return processActivityGeometry({ ...input, ownership: new Map() }, geometry);
  }

  const world = input.ownership;
  const updates = new Map<CellId, CellOwnership>();
  const fates = new Map<CellId, CellFate>();
  const counts: Record<CellFate, number> = {
    free: 0,
    reclaimed: 0,
    stolen: 0,
    breakthrough: 0,
  };
  const stolenFrom: Record<string, number> = {};
  const breakthroughFrom: Record<string, number> = {};
  let weightedCells = 0;
  let gainedCells = 0;

  // A worldben már létező res12 override-ok parent-indexe. Ettől egy több tízezer
  // parentből álló compact claimnél nem kell 49 gyereket legenerálni minden
  // parenthez csak azért, hogy kiderüljön, van-e benne eltérő ownership.
  const existingFineByParent = new Map<CellId, CellId[]>();
  for (const cell of world.keys()) {
    if (getResolution(cell) !== cfg.H3_RESOLUTION) continue;
    const parent = cellToParent(cell, credits.parentResolution);
    const bucket = existingFineByParent.get(parent);
    if (bucket) bucket.push(cell);
    else existingFineByParent.set(parent, [cell]);
  }

  const creditFineByParent = new Map<CellId, CellId[]>();
  for (const cell of credits.cells.keys()) {
    const parent = cellToParent(cell, credits.parentResolution);
    const bucket = creditFineByParent.get(parent);
    if (bucket) bucket.push(cell);
    else creditFineByParent.set(parent, [cell]);
  }

  const handledFine = new Set<CellId>();
  const previewParents = new Map<CellId, number>();
  const previewFine = new Map<CellId, number>();
  const defenseCounts = Array.from({ length: cfg.MAX_DEFENSE }, () => 0);

  for (const [parent, parentCredits] of credits.parents) {
    const beforeParent = labWorldOwnershipAt(world, parent);
    const afterParent = applyCredits(beforeParent, input.actorId, parentCredits, cfg);
    updates.set(parent, afterParent);

    const overrides = new Set<CellId>();
    for (const cell of existingFineByParent.get(parent) ?? []) overrides.add(cell);
    for (const cell of creditFineByParent.get(parent) ?? []) overrides.add(cell);

    const fullCount = Number(cellToChildrenSize(parent, cfg.H3_RESOLUTION));
    const bulkCount = Math.max(0, fullCount - overrides.size);
    if (bulkCount > 0) {
      accountFinal(parent, beforeParent, afterParent, bulkCount);
      if (afterParent.owner === input.actorId) {
        previewParents.set(parent, afterParent.defense);
        defenseCounts[afterParent.defense - 1] =
          (defenseCounts[afterParent.defense - 1] ?? 0) + bulkCount;
      }
    }

    for (const cell of overrides) {
      const cellCredits = credits.cells.get(cell) ?? parentCredits;
      const beforeCell = labWorldOwnershipAt(world, cell);
      const afterCell = applyCredits(beforeCell, input.actorId, cellCredits, cfg);
      updates.set(cell, afterCell);
      handledFine.add(cell);
      accountFinal(cell, beforeCell, afterCell, 1);
      if (afterCell.owner === input.actorId) {
        previewFine.set(cell, afterCell.defense);
        defenseCounts[afterCell.defense - 1] =
          (defenseCounts[afterCell.defense - 1] ?? 0) + 1;
      }
    }
  }

  // Finom claim olyan parentben, amely maga nem teljes compact claim ebben az
  // aktivitásban. Itt az örökölt world parent állapotot exact cell szinten írjuk felül.
  for (const [cell, cellCredits] of credits.cells) {
    if (handledFine.has(cell)) continue;
    const before = labWorldOwnershipAt(world, cell);
    const after = applyCredits(before, input.actorId, cellCredits, cfg);
    updates.set(cell, after);
    accountFinal(cell, before, after, 1);
    if (after.owner === input.actorId) {
      previewFine.set(cell, after.defense);
      defenseCounts[after.defense - 1] =
        (defenseCounts[after.defense - 1] ?? 0) + 1;
    }
  }

  const claim: ClaimResult = {
    updates,
    fates,
    counts,
    stolenFrom,
    breakthroughFrom,
    weightedClaimM2: weightedCells * cfg.CELL_AREA_M2,
    gainedM2: gainedCells * cfg.CELL_AREA_M2,
  };

  const preview: CompactClaimPreview = {
    parentResolution: credits.parentResolution,
    parents: compactDefenseMap(previewParents),
    cells: compactDefenseMap(previewFine),
    defenseCounts,
    cellCount: defenseCounts.reduce((sum, value) => sum + value, 0),
  };

  const gp = computeActivityGp(
    {
      type: input.type,
      distanceKm: input.distanceKm,
      claim,
      streakDays: input.streakDays,
      gpEarnedToday: input.gpEarnedToday,
      modifierFactors: input.modifierFactors,
    },
    cfg,
  );

  return {
    layer: layerOf(input.type),
    cellPath: geometry.cellPath,
    loops: geometry.loops,
    claimedCells: new Set(credits.cells.keys()),
    claimedCellCount: credits.cellCount,
    claim,
    compactClaim: preview,
    loopClaims: [],
    gp,
    areaGainedM2: Math.round(claim.gainedM2),
    diagnostics: {
      droppedPoints: geometry.droppedPoints,
      largeGaps: geometry.largeGaps,
      orphanAbsorbedCells: 0,
      loops: geometry.loopDiagnostics,
    },
  };

  function accountFinal(
    key: CellId,
    before: CellOwnership | undefined,
    after: CellOwnership,
    amount: number,
  ): void {
    if (amount <= 0) return;
    const fate = finalFate(before, after, input.actorId);
    fates.set(key, fate);
    counts[fate] += amount;

    if (fate === 'breakthrough') {
      if (before !== undefined) {
        breakthroughFrom[before.owner] = (breakthroughFrom[before.owner] ?? 0) + amount;
      }
      return;
    }

    weightedCells += amount * multiplierFor(after.defense, cfg);
    if (fate === 'free' || fate === 'stolen') gainedCells += amount;
    if (fate === 'stolen' && before !== undefined) {
      stolenFrom[before.owner] = (stolenFrom[before.owner] ?? 0) + amount;
    }
  }
}

function materializeFineOwnership(
  world: OwnershipMap,
  geometry: ActivityGeometry,
  cfg: GameplayConfig,
): OwnershipMap {
  if (world.size === 0 || geometry.loops.length === 0) return new Map();
  const scoped: OwnershipMap = new Map();
  for (const loop of geometry.loops) {
    for (const cell of loopCells(loop)) {
      if (getResolution(cell) !== cfg.H3_RESOLUTION) continue;
      const ownership = labWorldOwnershipAt(world, cell);
      if (ownership !== undefined) scoped.set(cell, ownership);
    }
  }
  return scoped;
}

/** N azonos claim-jóváírás hatása egy cellára, iteráció nélkül. */
function applyCredits(
  before: CellOwnership | undefined,
  actorId: string,
  credits: number,
  cfg: GameplayConfig,
): CellOwnership {
  const hits = Math.max(0, Math.trunc(credits));
  if (hits === 0) return before ?? { owner: actorId, defense: 1 };

  if (before === undefined) {
    return { owner: actorId, defense: Math.min(hits, cfg.MAX_DEFENSE) };
  }

  if (before.owner === actorId) {
    return {
      owner: actorId,
      defense: Math.min(before.defense + hits, cfg.MAX_DEFENSE),
    };
  }

  if (hits < before.defense) {
    return { owner: before.owner, defense: before.defense - hits };
  }

  // `before.defense` darab hit kell a lopásig: d-1 áttörés, majd lopás 1×-re.
  // Az ezen felüli hitek már a saját defense-et építik.
  return {
    owner: actorId,
    defense: Math.min(1 + (hits - before.defense), cfg.MAX_DEFENSE),
  };
}

function finalFate(
  before: CellOwnership | undefined,
  after: CellOwnership,
  actorId: string,
): CellFate {
  if (after.owner !== actorId) return 'breakthrough';
  if (before === undefined) return 'free';
  if (before.owner === actorId) return 'reclaimed';
  return 'stolen';
}

function compactDefenseMap(source: ReadonlyMap<CellId, number>): Map<CellId, number> {
  if (source.size === 0) return new Map();
  const byDefense = new Map<number, CellId[]>();
  for (const [cell, defense] of source) {
    const bucket = byDefense.get(defense);
    if (bucket) bucket.push(cell);
    else byDefense.set(defense, [cell]);
  }

  const result = new Map<CellId, number>();
  for (const [defense, cells] of byDefense) {
    for (const cell of compactCells(cells)) result.set(cell, defense);
  }
  return result;
}

function countWorldState(
  world: OwnershipMap,
  predicate: (ownership: CellOwnership) => boolean,
): number {
  let count = 0;

  // Parentek teljes tömege.
  for (const [cell, ownership] of world) {
    const resolution = getResolution(cell);
    if (resolution >= DEFAULT_GAMEPLAY.H3_RESOLUTION) continue;
    if (predicate(ownership)) {
      count += Number(cellToChildrenSize(cell, DEFAULT_GAMEPLAY.H3_RESOLUTION));
    }
  }

  // Exact res12 override-ok: ha parentet írnak felül, előbb levonjuk az örökölt
  // cellát, majd hozzáadjuk az exact állapotot.
  for (const [cell, ownership] of world) {
    if (getResolution(cell) !== DEFAULT_GAMEPLAY.H3_RESOLUTION) continue;
    const inherited = inheritedParentOwnership(world, cell);
    if (inherited !== undefined && predicate(inherited)) count -= 1;
    if (predicate(ownership)) count += 1;
  }

  return count;
}

function inheritedParentOwnership(
  world: OwnershipMap,
  cell: CellId,
): CellOwnership | undefined {
  const resolution = getResolution(cell);
  for (let parentRes = resolution - 1; parentRes >= 0; parentRes -= 1) {
    const held = world.get(cellToParent(cell, parentRes));
    if (held !== undefined) return held;
  }
  return undefined;
}
