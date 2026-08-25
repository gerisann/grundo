/**
 * GRUNDO játékmotor — a teljes folyamat egy helyen.
 *
 * KÖZÖS MODUL: ugyanez a kód fut a kliensen (élő előnézet) és a szerveren
 * (hiteles számítás). Ne kerüljön ide DOM, Firebase, Node API vagy bármi,
 * ami platformfüggő — ha a két oldal eltérne, a felhasználó azt látná, hogy
 * "a telefonon más területet írt, mint amit végül kaptam".
 */

export * from './cells';
export * from './loops';
export * from './loopInterior';
export * from './compactClaim';
export * from './frontierCleanup';
export {
  detectLoops,
  detectLoopsDetailed,
  IncrementalLoopDetector,
  type IncrementalLoopSnapshot,
} from './loopDetection';
export * from './claim';
export * from './scoring';
export * from './modifiers';

import { traceToCellPath, layerOf, cellsToM2 } from './cells';
import { detectLoopsDetailed, IncrementalLoopDetector } from './loopDetection';
import { loopCells } from './loops';
import { hasCompactInterior } from './loopInterior';
import {
  resolveCompactEmptyWorldClaims,
  type CompactClaimPreview,
} from './compactClaim';
import { cleanupStolenFrontierOrphans } from './frontierCleanup';
import { mergeClaims, resolveClaim } from './claim';
import { computeActivityGp } from './scoring';
import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import type {
  ActivityType, CellId, ClaimResult, DetectedLoop, GpBreakdown, LoopDiagnostics,
  OwnershipMap, TracePoint,
} from '@/types';

export interface ProcessInput {
  points: readonly TracePoint[];
  type: ActivityType;
  distanceKm: number;
  actorId: string;
  /** a claim által érintett cellák jelenlegi tulajdonosa; üres Map = minden szabad */
  ownership: OwnershipMap;
  streakDays: number;
  gpEarnedToday: number;
  /** A claim kétgyűrűs, teljesen beolvasott környezete az árva mezőkhöz. */
  orphanScope?: ReadonlySet<CellId>;
  /**
   * A játékkonfiguráció pillanatképe. Ha hiányzik, a statikus alapértékkel
   * számolunk — a kliensoldali élő előnézet így változatlanul működik.
   */
  cfg?: GameplayConfig;
  /**
   * Időszakos szorzók, a területi arányokkal már súlyozva. Kizárólag a szerver
   * tölti ki: a kliens nem tudhatja, mely cellák esnek egy bónuszterületre,
   * mert ahhoz a teljes nyomvonalat kellene kiértékelnie.
   */
  modifierFactors?: { gp?: number; claim?: number };
}

/**
 * A nyomvonalból kizárólag geometriailag következő, ownership-független rész.
 *
 * Ezt külön tartjuk, mert élő previewban a GPS path minden új cellával csak
 * FOLYTATÓDIK. A hurkok újraszámítása a teljes prefixre felesleges és hosszú
 * aktivitásnál négyzetes jellegű munkát okoz.
 */
export interface ActivityGeometry {
  cellPath: CellId[];
  loops: DetectedLoop[];
  loopDiagnostics: LoopDiagnostics;
  droppedPoints: number;
  largeGaps: number;
}

export interface ProcessResult {
  layer: 'foot' | 'bike';
  cellPath: CellId[];
  loops: DetectedLoop[];
  /**
   * Explicit res12 claim cellák. Nagy compact huroknál a teljes parenteket
   * nem bontjuk ide; azokat a `compactClaim` tartja.
   */
  claimedCells: Set<CellId>;
  /** A teljes, res12-egyenértékű egyedi claim cellaszám. */
  claimedCellCount: number;
  claim: ClaimResult | null;
  /** Nagy, tömör hurok LAB/geometriai előnézete. Normál claimnél null. */
  compactClaim: CompactClaimPreview | null;
  /** Hurkonkénti eredmény, kizárólag auditáláshoz és visszajátszáshoz. */
  loopClaims: ClaimResult[];
  gp: GpBreakdown;
  areaGainedM2: number;
  diagnostics: {
    droppedPoints: number;
    largeGaps: number;
    orphanAbsorbedCells: number;
    loops: LoopDiagnostics;
  };
}

export interface SequentialLoopClaimResult {
  /** A geometriai bezárások teljes uniója — audit/scope célra. */
  claimedCells: Set<CellId>;
  /** A ténylegesen jóváírt hurkonkénti claim eredmények. */
  perLoop: ClaimResult[];
  /** A hurkok után kialakult átmeneti ownership. */
  running: OwnershipMap;
}

/**
 * A detektált hurkok celláit időrendben írja jóvá.
 *
 * A HURKOK ÉRVÉNYESSÉGÉRŐL KIZÁRÓLAG a hurokdetektor dönt. Mire ide ér egy
 * `DetectedLoop`, az már átment a minimumhossz-, belsőterület-, sliver- és
 * traversal-duplikációs szűrőkön. Itt ezért nem szabad még egyszer teljes
 * hurkokat/cellákat eldobni pusztán attól, hogy a path-indexük átfed egy
 * korábbi bezárással: egy nagyobb, valóban új bekerítés épp természetesen
 * visszanyúlhat egy korábbi falhoz.
 *
 * Van viszont egy fontos időbeli szabály. Ha egy nagy külső traversal KÖZBEN
 * egy kisebb hurok új cellát szerez, a külső hurok későbbi bezárása ezt az
 * új cellát nem erősítheti meg azonnal. +1 defense csak arra a saját cellára
 * jár, amely már az adott hurok traversalének KEZDETEKOR is a játékosé volt.
 *
 * Ezért cellánként azt jegyezzük meg, MIKOR került az aktuális aktivitásban
 * az actorhoz. Az aktivitás előtt már saját celláknak nincs ilyen timestampje:
 * azok minden érvényes új bekerítésből reinforcementet kaphatnak.
 */
export function resolveSequentialLoopClaims(
  loops: readonly DetectedLoop[],
  ownership: OwnershipMap,
  actorId: string,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): SequentialLoopClaimResult {
  const running: OwnershipMap = new Map(ownership);
  const claimedCells = new Set<CellId>();
  const perLoop: ClaimResult[] = [];

  /**
   * Cella → annak a bezárásnak a `toIndex`-e, amelyben a cella ebben az
   * aktivitásban az actor tulajdonába került (`free` vagy `stolen`).
   *
   * A már az aktivitás előtt saját cellák szándékosan hiányoznak a Mapből.
   */
  const actorAcquiredAt = new Map<CellId, number>();

  for (const loop of loops) {
    if (hasCompactInterior(loop)) {
      throw new Error(
        'Compact hurok valódi ownership mellett blokkos claim-feldolgozást igényel.',
      );
    }

    const cells = loopCells(loop);
    const eligible = new Set<CellId>();

    for (const cell of cells) {
      claimedCells.add(cell);

      const held = running.get(cell);
      const acquiredAt = actorAcquiredAt.get(cell);

      /**
       * Csak az actor SAJÁT, az adott traversal KÖZBEN megszerzett celláját
       * hagyjuk ki ebből a később záródó befoglaló hurokból.
       *
       * - kezdetkor már saját → reinforcement jár;
       * - rivális → az új érvényes hurok új támadás, tehát jár a hit;
       * - szabad → megszerzés jár;
       * - korábbi traversalban megszerzett saját → reinforcement jár;
       * - ugyanezen traversal közben kis hurokkal megszerzett saját → nem jár
       *   még egy azonnali reinforcement.
       */
      if (
        held?.owner === actorId
        && acquiredAt !== undefined
        && acquiredAt > loop.fromIndex
      ) {
        continue;
      }

      eligible.add(cell);
    }

    const result = resolveClaim(eligible, running, actorId, cfg);
    for (const [cell, nextOwnership] of result.updates) {
      running.set(cell, nextOwnership);
    }

    for (const [cell, fate] of result.fates) {
      if (fate === 'free' || fate === 'stolen') {
        actorAcquiredAt.set(cell, loop.toIndex);
      }
    }

    perLoop.push(result);
  }

  return { running, claimedCells, perLoop };
}

/** Egyszeri/batch geometriaépítés — szerver végleges feldolgozásához is ezt használjuk. */
export function buildActivityGeometry(points: readonly TracePoint[]): ActivityGeometry {
  const { path, droppedPoints, largeGaps } = traceToCellPath(points);
  const loopDetection = detectLoopsDetailed(path);
  return {
    cellPath: path,
    loops: loopDetection.loops,
    loopDiagnostics: loopDetection.diagnostics,
    droppedPoints,
    largeGaps,
  };
}

/**
 * Élő previewhoz használható geometriai cache.
 *
 * Ha a következő GPS snapshot cellalánca a korábbi path prefix-folytatása,
 * kizárólag az új H3 cellákat dolgozza fel. Route reset, GPS-history csere vagy
 * bármilyen visszamenőleges eltérés esetén egyszer újraépít, majd onnantól megint
 * inkrementálisan halad.
 */
export class IncrementalActivityGeometry {
  private detector = new IncrementalLoopDetector();
  private path: CellId[] = [];

  reset(): void {
    this.detector = new IncrementalLoopDetector();
    this.path = [];
  }

  update(points: readonly TracePoint[]): ActivityGeometry {
    const traced = traceToCellPath(points);
    const nextPath = traced.path;

    if (!isPrefix(this.path, nextPath)) {
      this.detector = new IncrementalLoopDetector();
      this.detector.appendMany(nextPath);
    } else if (nextPath.length > this.path.length) {
      this.detector.appendMany(nextPath.slice(this.path.length));
    }

    this.path = nextPath;
    const loopDetection = this.detector.snapshot();
    return {
      cellPath: nextPath,
      loops: loopDetection.loops,
      loopDiagnostics: loopDetection.diagnostics,
      droppedPoints: traced.droppedPoints,
      largeGaps: traced.largeGaps,
    };
  }
}

/**
 * Már elkészített geometriából végzi el az ownership + scoring részt.
 *
 * Ez teszi lehetővé, hogy az élő preview ne számolja újra a teljes hurokgeometriát
 * csak azért, mert érkezett egy új GPS fix vagy frissült a nearby ownership.
 */
export function processActivityGeometry(
  input: ProcessInput,
  geometry: ActivityGeometry,
): ProcessResult {
  const cfg = input.cfg ?? DEFAULT_GAMEPLAY;
  const path = geometry.cellPath;
  const loops = geometry.loops;
  const hasCompactLoop = loops.some(hasCompactInterior);

  /**
   * Nagy huroknál az üres világ (LAB + szerver geometriai probe) tömören
   * elszámolható. Valódi ownership esetén NEM bontjuk vissza itt több millió
   * res12 Map-be; azt a backend blokkos commit útja végzi majd parentenként.
   */
  if (hasCompactLoop) {
    if (input.ownership.size > 0 || input.orphanScope !== undefined) {
      throw new Error(
        'Compact hurok ownership-feldolgozása csak a blokkos backend útvonalon engedett.',
      );
    }

    const compact = resolveCompactEmptyWorldClaims(loops, input.actorId, cfg);
    const claim = compact.claim;
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
      cellPath: path,
      loops,
      claimedCells: compact.claimedCells,
      claimedCellCount: compact.claimedCellCount,
      claim,
      compactClaim: compact.preview,
      loopClaims: [],
      gp,
      areaGainedM2: claim ? Math.round(claim.gainedM2) : 0,
      diagnostics: {
        droppedPoints: geometry.droppedPoints,
        largeGaps: geometry.largeGaps,
        orphanAbsorbedCells: 0,
        loops: geometry.loopDiagnostics,
      },
    };
  }

  const sequential = resolveSequentialLoopClaims(
    loops,
    input.ownership,
    input.actorId,
    cfg,
  );
  const { claimedCells, perLoop } = sequential;

  const mergedClaim =
    perLoop.length > 0 ? mergeClaims(perLoop, input.ownership, input.actorId, cfg) : null;
  const orphanResult = input.orphanScope
    ? cleanupStolenFrontierOrphans(mergedClaim, input.ownership, input.actorId, input.orphanScope, cfg)
    : { claim: mergedClaim, reassigned: new Set<CellId>() };
  const claim = orphanResult.claim;
  for (const cell of orphanResult.reassigned) claimedCells.add(cell);

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
    cellPath: path,
    loops,
    claimedCells,
    claimedCellCount: claimedCells.size,
    claim,
    compactClaim: null,
    loopClaims: perLoop,
    gp,
    areaGainedM2: claim ? Math.round(claim.gainedM2) : 0,
    diagnostics: {
      droppedPoints: geometry.droppedPoints,
      largeGaps: geometry.largeGaps,
      orphanAbsorbedCells: orphanResult.reassigned.size,
      loops: geometry.loopDiagnostics,
    },
  };
}

/**
 * Egy aktivitás teljes feldolgozása.
 *
 * FIGYELEM: a `points` mindig a TELJES nyomvonal legyen, a privát zóna
 * levágásától függetlenül. A végleges szerveroldali feldolgozás szándékosan
 * batch: egyszer építi fel a geometriát, majd egyszer könyveli az ownershipet.
 */
export function processActivity(input: ProcessInput): ProcessResult {
  return processActivityGeometry(input, buildActivityGeometry(input.points));
}

/** Kényelmi függvény a nyom élő megjelenítéséhez rögzítés közben. */
export function previewArea(cellCount: number): number {
  return cellsToM2(cellCount);
}

function isPrefix(previous: readonly CellId[], next: readonly CellId[]): boolean {
  if (previous.length > next.length) return false;
  for (let i = 0; i < previous.length; i += 1) {
    if (previous[i] !== next[i]) return false;
  }
  return true;
}
