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
export * from './winding';
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
import { windingCounts } from './winding';
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

export interface LoopClaimResolution {
  /** A geometriai bezárások teljes uniója — audit/scope célra. */
  claimedCells: Set<CellId>;
  /** A ténylegesen jóváírt hurkonkénti claim eredmények. Indexben a `loops`-hoz igazítva. */
  perLoop: ClaimResult[];
  /** A hurkok után kialakult átmeneti ownership. */
  running: OwnershipMap;
}

/**
 * A detektált hurkok celláit írja jóvá — cellánként annyiszor, ahányszor a
 * játékos ténylegesen körbejárta őket.
 *
 * ── MIÉRT NEM A BEZÁRÁSOK SZÁMA DÖNT ─────────────────────────────────────
 *
 * Kézenfekvő lenne minden bezárásnál +1 védelmet adni a bezárt saját cellákra.
 * Ez azonban azt méri, hányszor talált a detektor hurkot, nem azt, hányszor
 * futotta körbe a játékos a területet. A kettő a H3-rácson látványosan eltér:
 * egy kifelé táguló spirál minden sarokérintésénél levezethető egy újabb,
 * nagyobb kompozit ciklus. Ugyanarra a HÁROM fizikai körre mérve hat bezárás
 * jött ki az egyik irányban és kettő a másikban — és a védelem eszerint lett
 * `{1:191, 2:79, 3:224}`, illetve `{1:496}`. Ugyanaz a futás, más eredmény.
 *
 * Ezért a jóváírások számát a `windingCounts()` adja: az irány megfordítása a
 * körüljárási számnak csak az előjelét fordítja meg, a nagyságát nem.
 *
 * ── A KÉT IDŐBELI SZABÁLY, AMI EBBŐL KÖVETKEZIK ──────────────────────────
 *
 * 1. Ha egy nagy külső traversal KÖZBEN egy kisebb hurok új cellát szerez, azt
 *    a külső hurok később nem erősíti meg. Nem kell külön szabály: a frissen
 *    megszerzett cellát a nyomvonal pontosan EGYSZER kerülte meg, tehát egy
 *    jóváírást kap — a megszerzést.
 *
 * 2. Ugyanazon fizikai traversal átfedő, egymásba kapcsolódó bezárásai sem
 *    adhatnak többszörös védelmet ugyanarra a cellára. Ez is következmény: hiába
 *    négy kompozit ciklus, a körüljárás egy.
 *
 * A jóváírásokat a KÉSŐBBI bezárásokhoz rendeljük, mert a +1 ott jár, ahol a
 * játékos ténylegesen befejezte az újabb körbejárást — nem egy korábbi
 * részbezárásnál. Az első megszerzés viszont az ELSŐ olyan bezáráshoz tartozik,
 * amelyik a cellát körbezárta: azt a területet ott foglaltuk el.
 */
export function resolveLoopClaims(
  loops: readonly DetectedLoop[],
  path: readonly CellId[],
  ownership: OwnershipMap,
  actorId: string,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): LoopClaimResolution {
  const running: OwnershipMap = new Map(ownership);
  const claimedCells = new Set<CellId>();

  /** Cella → mely hurkok zárták körbe, időrendben. */
  const membership = new Map<CellId, number[]>();

  for (let index = 0; index < loops.length; index += 1) {
    const loop = loops[index]!;
    if (hasCompactInterior(loop)) {
      throw new Error(
        'Compact hurok valódi ownership mellett blokkos claim-feldolgozást igényel.',
      );
    }
    for (const cell of loopCells(loop)) {
      claimedCells.add(cell);
      const visits = membership.get(cell);
      if (visits) visits.push(index);
      else membership.set(cell, [index]);
    }
  }

  const winding = windingCounts(path, claimedCells);
  // Egy 5-ös védelmű rivális cellához négy áttörés, egy elvétel és négy saját
  // megerősítés kell — ennél többre semmilyen futás nem tud hivatkozni.
  const maxPasses = cfg.MAX_DEFENSE * 2;
  const schedule: Map<CellId, number>[] = loops.map(() => new Map<CellId, number>());

  for (const [cell, visits] of membership) {
    const ownedAtStart = ownership.get(cell)?.owner === actorId;
    const turns = winding.get(cell) ?? 0;

    /**
     * Ami nem a miénk, azon a bezárás önmagában jár egy művelettel: a
     * megszerzés és az áttörés a bekerítés következménye. A VÉDELEM növelése
     * viszont kizárólag a tényleges körüljárásból jön — ezért a már saját
     * cellának nincs ilyen alapjuttatása.
     */
    let remaining = Math.min(ownedAtStart ? turns : Math.max(1, turns), maxPasses);
    if (remaining <= 0) continue;

    const first = visits[0]!;
    const last = visits[visits.length - 1]!;

    if (!ownedAtStart) {
      addPass(schedule[first]!, cell);
      remaining -= 1;
    }

    const floor = ownedAtStart ? 0 : 1;
    for (let k = visits.length - 1; remaining > 0 && k >= floor; k -= 1) {
      addPass(schedule[visits[k]!]!, cell);
      remaining -= 1;
    }

    // Kevesebb bezárás, mint körüljárás: a spirált a detektor néha egyetlen
    // nagy ciklusba vonja össze. A maradékot a lezáró bezárás viszi el.
    if (remaining > 0) addPass(schedule[last]!, cell, remaining);
  }

  const perLoop = schedule.map((planned) => applyPasses(planned, running, actorId, cfg));

  return { running, claimedCells, perLoop };
}

function addPass(target: Map<CellId, number>, cell: CellId, by = 1): void {
  target.set(cell, (target.get(cell) ?? 0) + by);
}

/**
 * Egy hurokhoz beütemezett jóváírások végrehajtása.
 *
 * A legtöbb cella egyszer szerepel, ilyenkor ez egyetlen `resolveClaim` hívás.
 * A többszörös eset a ritka: ott körönként fogy a hátralék, és a hurok
 * auditsora az összevont eredmény lesz.
 */
function applyPasses(
  planned: ReadonlyMap<CellId, number>,
  running: OwnershipMap,
  actorId: string,
  cfg: GameplayConfig,
): ClaimResult {
  const before: OwnershipMap = new Map();
  for (const cell of planned.keys()) {
    const held = running.get(cell);
    if (held) before.set(cell, held);
  }

  const parts: ClaimResult[] = [];
  const pending = new Map(planned);

  while (pending.size > 0) {
    const batch = new Set<CellId>(pending.keys());
    const result = resolveClaim(batch, running, actorId, cfg);
    for (const [cell, nextOwnership] of result.updates) running.set(cell, nextOwnership);
    parts.push(result);

    for (const [cell, count] of [...pending]) {
      if (count <= 1) pending.delete(cell);
      else pending.set(cell, count - 1);
    }
  }

  if (parts.length === 1) return parts[0]!;
  return mergeClaims(parts, before, actorId, cfg);
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

  const resolution = resolveLoopClaims(
    loops,
    path,
    input.ownership,
    input.actorId,
    cfg,
  );
  const { claimedCells, perLoop } = resolution;

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
