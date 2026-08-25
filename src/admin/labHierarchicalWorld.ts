import {
  cellToChildren,
  cellToChildrenSize,
  cellToParent,
  compactCells,
  getResolution,
  gridDisk,
} from 'h3-js';
import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import {
  buildCompactClaimCredits,
  computeActivityGp,
  findStolenFrontierReassignments,
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
    // a claim teljes kétgyűrűs környezetét materializáljuk, mert a rablás utáni
    // frontier-cleanupnak mind a 6 oldalszomszédot ismernie kell.
    const scoped = materializeFineOwnership(input.ownership, geometry, cfg);
    return processActivityGeometry({
      ...input,
      ownership: scoped.ownership,
      orphanScope: scoped.scope,
    }, geometry);
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

/** Egy player res12-egyenértékű összesítése a vegyes felbontású worldben. */
export interface LabWorldPlayerTotals {
  /** Összes birtokolt res12-egyenértékű cella. */
  cells: number;
  /** Védelmi szintenkénti bontás; a 0. elem az 1× védelem. */
  byDefense: number[];
}

/**
 * A teljes sandbox world összesítése EGYETLEN bejárásból.
 *
 * Playerenként és védelmi szintenként külön számolva ez tíz playernél
 * rendernként tizenöt teljes world-bejárás volt, res12 cellánként akár tizenkét
 * `cellToParent` hívással. Ugyanaz az információ egy passzal is kijön, és a
 * hívó egyszer memoizálhatja.
 */
export function summarizeLabWorld(
  world: OwnershipMap,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): Map<string, LabWorldPlayerTotals> {
  const totals = new Map<string, LabWorldPlayerTotals>();

  function add(owner: string, defense: number, amount: number): void {
    if (amount === 0) return;
    let entry = totals.get(owner);
    if (!entry) {
      entry = { cells: 0, byDefense: Array.from({ length: cfg.MAX_DEFENSE }, () => 0) };
      totals.set(owner, entry);
    }
    entry.cells += amount;
    const index = defense - 1;
    if (index >= 0 && index < entry.byDefense.length) {
      entry.byDefense[index] = (entry.byDefense[index] ?? 0) + amount;
    }
  }

  const fine: CellId[] = [];
  for (const [cell, ownership] of world) {
    const resolution = getResolution(cell);
    if (resolution < cfg.H3_RESOLUTION) {
      add(
        ownership.owner,
        ownership.defense,
        Number(cellToChildrenSize(cell, cfg.H3_RESOLUTION)),
      );
    } else if (resolution === cfg.H3_RESOLUTION) {
      fine.push(cell);
    }
  }

  // Az exact res12 override elveszi az örökölt parent egy celláját, és a saját
  // állapotát teszi a helyére.
  for (const cell of fine) {
    const inherited = inheritedParentOwnership(world, cell);
    if (inherited !== undefined) add(inherited.owner, inherited.defense, -1);
    const exact = world.get(cell)!;
    add(exact.owner, exact.defense, 1);
  }

  return totals;
}

/** Egy mixed-resolution world res12-egyenértékű cellaszáma player szerint. */
export function countLabPlayerCells(world: OwnershipMap, playerId: string): number {
  return summarizeLabWorld(world).get(playerId)?.cells ?? 0;
}

/** Egy mixed-resolution world res12-egyenértékű cellaszáma player + defense szerint. */
export function countLabPlayerDefense(
  world: OwnershipMap,
  playerId: string,
  defense: number,
): number {
  return summarizeLabWorld(world).get(playerId)?.byDefense[defense - 1] ?? 0;
}

function processCompactLabActivity(
  input: ProcessInput,
  geometry: ActivityGeometry,
  cfg: GameplayConfig,
): ProcessResult {
  const credits = buildCompactClaimCredits(geometry.loops, cfg);
  if (!credits || credits.cellCount === 0) {
    /*
      Ide csak akkor jutunk, ha a geometria compact hurkot jelez, a compact
      kredit-építő mégsem talált egyetlen cellát sem — vagyis a két oldal
      ellentmond egymásnak.

      A korábbi visszaesés ÜRES ownershippel hívta tovább a core-t. Az néma
      adatromlás: üres világban minden cella `free`, tehát a LAB azt írta volna
      ki, hogy a játékos egy már birtokolt területet szabadon foglalt el. Egy
      diagnosztikai eszközben a hangos hiba a helyes válasz.
    */
    throw new Error(
      'Compact hurok érkezett, de nem keletkezett hozzá compact claim kredit. '
      + 'Ez motorhiba — ne a LAB worldön javítsd.',
    );
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
    // Nulla jóváírás gazdátlan parenten: nincs mit írni. A benne lévő finom
    // cellákat a lenti, `credits.cells` fölötti kör így is feldolgozza.
    if (afterParent === undefined) continue;
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
      if (afterCell === undefined) continue;
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
    if (after === undefined) continue;
    updates.set(cell, after);
    accountFinal(cell, before, after, 1);
    if (after.owner === input.actorId) {
      previewFine.set(cell, after.defense);
      defenseCounts[after.defense - 1] =
        (defenseCounts[after.defense - 1] ?? 0) + 1;
    }
  }

  /**
   * Rablás utáni frontier cleanup.
   *
   * A teljes compact belsőt NEM bontjuk ki. Csak azokat a lopott parenteket
   * materializáljuk 49 res12 gyerekre, amelyek a post-claim worldben más ownerű
   * parenttel érintkeznek. Így a szabály a határon pontos, de a többmilliós
   * homogén belső továbbra is tömör marad.
   */
  const cleanupReassigned = new Set<CellId>();
  if (counts.stolen > 0) {
    const snapshotUpdates = new Map(updates);
    const stolenSeeds = new Set<CellId>();

    const snapshotOwnershipAt = (cell: CellId): CellOwnership | undefined => {
      const exact = snapshotUpdates.get(cell);
      if (exact !== undefined) return exact;
      const resolution = getResolution(cell);
      for (let parentRes = resolution - 1; parentRes >= 0; parentRes -= 1) {
        const parent = cellToParent(cell, parentRes);
        const updatedParent = snapshotUpdates.get(parent);
        if (updatedParent !== undefined) return updatedParent;
      }
      return labWorldOwnershipAt(world, cell);
    };

    for (const [key, fate] of fates) {
      if (fate !== 'stolen') continue;
      const resolution = getResolution(key);
      if (resolution === cfg.H3_RESOLUTION) {
        stolenSeeds.add(key);
        continue;
      }
      if (resolution > cfg.H3_RESOLUTION) continue;

      const owner = snapshotOwnershipAt(key)?.owner;
      if (!owner) continue;
      const touchesDifferentOwner = gridDisk(key, 1).some((near) =>
        near !== key && snapshotOwnershipAt(near)?.owner !== owner,
      );
      if (!touchesDifferentOwner) continue;

      for (const child of cellToChildren(key, cfg.H3_RESOLUTION)) stolenSeeds.add(child);
    }

    const planned = findStolenFrontierReassignments({
      stolenSeeds,
      ownershipAt: snapshotOwnershipAt,
      isDirectlyClaimed: (cell) =>
        credits.cells.has(cell)
        || credits.parents.has(cellToParent(cell, credits.parentResolution)),
      gameplayResolution: cfg.H3_RESOLUTION,
    });

    // A `planned` teljes egészében ugyanabból a snapshotból készült; csak most
    // alkalmazzuk, ezért az endpoint levágása nem indít folyosó-visszaevő kaszkádot.
    for (const [cell, next] of planned) {
      const previous = snapshotOwnershipAt(cell);
      if (!previous || previous.owner === next.owner) continue;

      updates.set(cell, next);
      cleanupReassigned.add(cell);

      if (next.owner === input.actorId) {
        fates.set(cell, 'stolen');
        counts.stolen += 1;
        stolenFrom[previous.owner] = (stolenFrom[previous.owner] ?? 0) + 1;
        weightedCells += multiplierFor(1, cfg);
        gainedCells += 1;
        previewFine.set(cell, 1);
        defenseCounts[0] = (defenseCounts[0] ?? 0) + 1;
      }
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

  const claimedCells = new Set(credits.cells.keys());
  for (const cell of cleanupReassigned) claimedCells.add(cell);

  return {
    layer: layerOf(input.type),
    cellPath: geometry.cellPath,
    loops: geometry.loops,
    claimedCells,
    claimedCellCount: credits.cellCount + cleanupReassigned.size,
    claim,
    compactClaim: preview,
    loopClaims: [],
    gp,
    areaGainedM2: Math.round(claim.gainedM2),
    diagnostics: {
      droppedPoints: geometry.droppedPoints,
      largeGaps: geometry.largeGaps,
      orphanAbsorbedCells: cleanupReassigned.size,
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

/**
 * A claim kétgyűrűs környezetének kiolvasása a vegyes felbontású worldből.
 *
 * ⚠️ CSAK A FAL KÖRÉ HÚZUNK GYŰRŰT, nem minden hurokcella köré. A hurok
 * régiója = fal ∪ belső, és a belső cellákat definíció szerint (flood fill) a
 * fal választja el a külvilágtól. Egy belső cella két lépésen belül csak
 * olyan külső cellát érhet el, amit a hozzá tartozó falcella egy lépésen belül
 * amúgy is elér — tehát a belső cellák felfújása egyetlen új cellát sem ad
 * hozzá az eredményhez.
 *
 * Mérve (3 player, 1400 m négyzet): 19 502 hurokcella helyett néhány száz
 * falcellára kell `gridDisk`, miközben a `scope` halmaz bitre ugyanaz. A
 * `labHierarchicalWorld.test.ts` egyenértékűségi tesztje ezt rögzíti.
 */
export function materializeFineOwnership(
  world: OwnershipMap,
  geometry: ActivityGeometry,
  cfg: GameplayConfig,
): { ownership: OwnershipMap; scope: Set<CellId> } {
  const scope = new Set<CellId>();

  for (const loop of geometry.loops) {
    for (const cell of loopCells(loop)) {
      if (getResolution(cell) !== cfg.H3_RESOLUTION) continue;
      scope.add(cell);
    }
    for (const cell of loop.wall) {
      if (getResolution(cell) !== cfg.H3_RESOLUTION) continue;
      for (const near of gridDisk(cell, 2)) scope.add(near);
    }
  }

  /*
    A parent-keresést egyszer indexeljük. A `labWorldOwnershipAt` enélkül
    cellánként a res-1 szinttől nulláig próbálkozik — több tízezer cellánál ez
    százezres nagyságrendű `cellToParent` hívás, miközben a world tipikusan
    EGYETLEN parent felbontást használ, gyakran egyet sem.
  */
  const parentResolutions = worldParentResolutions(world, cfg);

  const ownership: OwnershipMap = new Map();
  for (const cell of scope) {
    const held = ownershipAtWithin(world, cell, parentResolutions);
    if (held !== undefined) ownership.set(cell, held);
  }

  return { ownership, scope };
}

/** A worldben ténylegesen előforduló parent felbontások, finomtól durváig. */
function worldParentResolutions(world: OwnershipMap, cfg: GameplayConfig): number[] {
  const found = new Set<number>();
  for (const cell of world.keys()) {
    const resolution = getResolution(cell);
    if (resolution < cfg.H3_RESOLUTION) found.add(resolution);
  }
  return [...found].sort((a, b) => b - a);
}

/** Mint a `labWorldOwnershipAt`, de csak a ténylegesen létező szinteket próbálja. */
function ownershipAtWithin(
  world: OwnershipMap,
  cell: CellId,
  parentResolutions: readonly number[],
): CellOwnership | undefined {
  const exact = world.get(cell);
  if (exact !== undefined) return exact;
  if (parentResolutions.length === 0) return undefined;

  const resolution = getResolution(cell);
  for (const parentRes of parentResolutions) {
    if (parentRes >= resolution) continue;
    const held = world.get(cellToParent(cell, parentRes));
    if (held !== undefined) return held;
  }
  return undefined;
}

/**
 * N azonos claim-jóváírás hatása egy cellára, iteráció nélkül.
 *
 * ⚠️ Nulla jóváírásnál `undefined`-ot ad vissza, ha a cella eddig gazdátlan
 * volt. Korábban ilyenkor `{owner: actorId, defense: 1}` jött ki: nulla
 * jóváírásból tulajdon lett. A hívónak ilyenkor nincs mit írnia — hagyja ki a
 * cellát.
 */
function applyCredits(
  before: CellOwnership | undefined,
  actorId: string,
  credits: number,
  cfg: GameplayConfig,
): CellOwnership | undefined {
  const hits = Math.max(0, Math.trunc(credits));
  if (hits === 0) return before;

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
