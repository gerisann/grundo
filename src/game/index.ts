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
export * from './claim';
export * from './scoring';

import { traceToCellPath, layerOf, cellsToM2 } from './cells';
import { detectLoopsDetailed, loopCells } from './loops';
import { mergeClaims, resolveClaim } from './claim';
import { computeActivityGp } from './scoring';
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
}

export interface ProcessResult {
  layer: 'foot' | 'bike';
  cellPath: CellId[];
  loops: DetectedLoop[];
  claimedCells: Set<CellId>;
  claim: ClaimResult | null;
  /** Hurkonkénti eredmény, kizárólag auditáláshoz és visszajátszáshoz. */
  loopClaims: ClaimResult[];
  gp: GpBreakdown;
  areaGainedM2: number;
  diagnostics: { droppedPoints: number; largeGaps: number; loops: LoopDiagnostics };
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
  const { path, droppedPoints, largeGaps } = traceToCellPath(input.points);
  const loopDetection = detectLoopsDetailed(path);
  const loops = loopDetection.loops;

  // A bezárásokat SORBAN dolgozzuk fel, mindegyiket az előző által frissített
  // állapot ellen. Ha egyetlen egyesített halmazként kezelnénk, ugyanaz a kör
  // négyszer megfutva csak egyszer számítana, és a védelem 1× maradna 4×
  // helyett — a 04. fejezet C) példája éppen ezt írja le.
  const running: OwnershipMap = new Map(input.ownership);
  const claimedCells = new Set<CellId>();
  const perLoop: ClaimResult[] = [];

  for (const loop of loops) {
    const cells = loopCells(loop);
    for (const cell of cells) claimedCells.add(cell);

    const result = resolveClaim(cells, running, input.actorId);
    for (const [cell, ownership] of result.updates) running.set(cell, ownership);
    perLoop.push(result);
  }

  // Az EREDETI birtokviszony kell a károsultak azonosításához.
  const claim =
    perLoop.length > 0 ? mergeClaims(perLoop, input.ownership, input.actorId) : null;

  const gp = computeActivityGp({
    type: input.type,
    distanceKm: input.distanceKm,
    claim,
    streakDays: input.streakDays,
    gpEarnedToday: input.gpEarnedToday,
  });

  return {
    layer: layerOf(input.type),
    cellPath: path,
    loops,
    claimedCells,
    claim,
    loopClaims: perLoop,
    gp,
    areaGainedM2: claim ? Math.round(claim.gainedM2) : 0,
    diagnostics: { droppedPoints, largeGaps, loops: loopDetection.diagnostics },
  };
}

/** Kényelmi függvény a nyom élő megjelenítéséhez rögzítés közben. */
export function previewArea(cellCount: number): number {
  return cellsToM2(cellCount);
}
