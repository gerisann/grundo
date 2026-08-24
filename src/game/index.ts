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
export { detectLoops, detectLoopsDetailed } from './loopDetection';
export * from './claim';
export * from './scoring';
export * from './modifiers';

import { traceToCellPath, layerOf, cellsToM2 } from './cells';
import { detectLoopsDetailed } from './loopDetection';
import { loopCells } from './loops';
import { hasCompactInterior } from './loopInterior';
import {
  resolveCompactEmptyWorldClaims,
  type CompactClaimPreview,
} from './compactClaim';
import { absorbIsolatedRivalCells, mergeClaims, resolveClaim } from './claim';
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
 * FONTOS: egy későbbi, nagyobb hurok geometriailag tartalmazhat olyan területet,
 * amelyet ugyanebben az aktivitásban egy korábbi kisebb hurok már bezárt.
 * Példa: 8-as alakzat. Előbb bezárul az alsó lebeny, majd a felső lezárásakor
 * a detector egy nagy, mindkét lebenyt tartalmazó hurokgeometriát is találhat.
 *
 * Ettől a korábban megszerzett alsó terület NEM kaphat automatikusan +1
 * defense-et. Ugyanaz a cella csak akkor jogosult újabb claimre, ha a jelenlegi
 * hurok traversalja már AZ ELŐZŐ JÓVÁÍRÁS UTÁN kezdődött. Ez bizonyítja, hogy
 * a játékos ténylegesen újra megkerülte a területet (vagy egy azt magába
 * foglaló nagyobb területet), nem csak egy korábban megkezdett útvonal végén
 * zárt le egy újabb geometriát.
 *
 * A `creditedAt` cellánként a legutóbbi jóváíró hurok `toIndex` értékét őrzi.
 * - még nem jóváírt cella → mindig jogosult;
 * - `loop.fromIndex >= creditedAt[cell]` → új traversal, jogosult;
 * - különben → ugyanannak a korábbi traversalnak az átfedése, nem emel defense-et.
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
  const creditedAt = new Map<CellId, number>();

  for (const loop of loops) {
    if (hasCompactInterior(loop)) {
      throw new Error(
        'Compact hurok valódi ownership mellett blokkos claim-feldolgozást igényel.',
      );
    }

    const cells = loopCells(loop);
    const eligible = new Set<CellId>();

    for (const cell of cells) {
      // A teljes geometriai uniót megtartjuk auditáláshoz és szerveroldali
      // ownership-scope olvasáshoz akkor is, ha a cella ezen a hurkon már nem
      // jogosult újabb defense-emelésre.
      claimedCells.add(cell);

      const previousCreditAt = creditedAt.get(cell);
      if (previousCreditAt === undefined || loop.fromIndex >= previousCreditAt) {
        eligible.add(cell);
      }
    }

    const result = resolveClaim(eligible, running, actorId, cfg);
    for (const [cell, nextOwnership] of result.updates) {
      running.set(cell, nextOwnership);
    }
    for (const cell of eligible) {
      creditedAt.set(cell, loop.toIndex);
    }
    perLoop.push(result);
  }

  return { running, claimedCells, perLoop };
}

/**
 * Egy aktivitás teljes feldolgozása.
 *
 * FIGYELEM: a `points` mindig a TELJES nyomvonal legyen, a privát zóna
 * levágásától függetlenül. A levágás kizárólag megjelenítési művelet — ha a
 * foglalás a levágott nyomvonalból számolna, a privát zóna csalási felületté
 * válna (bekapcsolom 200 m-re, és ott nem érvényesülnek a szabályok).
 */
export function processActivity(input: ProcessInput): ProcessResult {
  const cfg = input.cfg ?? DEFAULT_GAMEPLAY;
  const { path, droppedPoints, largeGaps } = traceToCellPath(input.points);
  const loopDetection = detectLoopsDetailed(path);
  const loops = loopDetection.loops;
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
        droppedPoints,
        largeGaps,
        orphanAbsorbedCells: 0,
        loops: loopDetection.diagnostics,
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

  // Az EREDETI birtokviszony kell a károsultak azonosításához.
  const mergedClaim =
    perLoop.length > 0 ? mergeClaims(perLoop, input.ownership, input.actorId, cfg) : null;
  const orphanResult = input.orphanScope
    ? absorbIsolatedRivalCells(mergedClaim, input.ownership, input.actorId, input.orphanScope, cfg)
    : { claim: mergedClaim, absorbed: new Set<CellId>() };
  const claim = orphanResult.claim;
  for (const cell of orphanResult.absorbed) claimedCells.add(cell);

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
      droppedPoints,
      largeGaps,
      orphanAbsorbedCells: orphanResult.absorbed.size,
      loops: loopDetection.diagnostics,
    },
  };
}

/** Kényelmi függvény a nyom élő megjelenítéséhez rögzítés közben. */
export function previewArea(cellCount: number): number {
  return cellsToM2(cellCount);
}
