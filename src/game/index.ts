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
import { detectLoops, loopCells } from './loops';
import { resolveClaim } from './claim';
import { computeActivityGp } from './scoring';
import type {
  ActivityType, CellId, ClaimResult, DetectedLoop, GpBreakdown, OwnershipMap, TracePoint,
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
  gp: GpBreakdown;
  areaGainedM2: number;
  diagnostics: { droppedPoints: number; largeGaps: number };
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
  const loops = detectLoops(path);

  const claimedCells = new Set<CellId>();
  for (const loop of loops) {
    for (const cell of loopCells(loop)) claimedCells.add(cell);
  }

  const claim = claimedCells.size > 0
    ? resolveClaim(claimedCells, input.ownership, input.actorId)
    : null;

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
    gp,
    areaGainedM2: claim ? Math.round(claim.gainedM2) : 0,
    diagnostics: { droppedPoints, largeGaps },
  };
}

/** Kényelmi függvény a nyom élő megjelenítéséhez rögzítés közben. */
export function previewArea(cellCount: number): number {
  return cellsToM2(cellCount);
}
