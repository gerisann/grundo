/**
 * A küldetés-jelöltek kiértékelése — a VALÓDI motorral.
 *
 * MIÉRT KÜLÖN MODUL? Mert ez a rész a legkockázatosabb, és külön kell tudni
 * tesztelni. A `routes/missions.ts` a Mapbox Directions API-tól kapja a
 * jelölteket, tehát ott a teljes menetet csak élő hálózattal lehetne
 * ellenőrizni. Így viszont a lánc drága fele — vonallánc → cellák → hurkok →
 * birtokviszony → GP → válogatás — szintetikus nyomvonallal, emulátoron
 * végigmérhető, külső szolgáltató nélkül.
 *
 * ⚠️ NINCS BENNE BECSLŐ ALGORITMUS. A `processActivity` fut le, ugyanaz a
 * függvény, ami a tényleges mentésnél a területet adja — csak nem írunk vele
 * semmit. Amit a küldetés ígér, azt a felhasználó pontosan meg is kapja, ha
 * végigmegy rajta (a GPS-pontosság határain belül). Ha valaha külön „gyors
 * becslés" kerülne ide, a kettő elcsúszna, és a felhasználó azt látná, hogy
 * az app mást ígért, mint amit adott.
 */

import { GAMEPLAY, type GameplayConfig } from '../../../src/config/gameplay';
import { processActivity } from '../../../src/game';
import { blockIdFor } from './gridMath';
import type { ActivityType, CellId, Layer, OwnershipMap, TracePoint } from '../../../src/types';
import type { MissionCandidate } from '../../../src/game/missions';

/** Egy jelölt, amit már geometriává alakítottunk. */
export interface ShapedCandidate {
  bearing: number;
  distanceKm: number;
  polyline: string;
  points: TracePoint[];
  /** A bezárások összes cellája — a birtokviszony-betöltés ebből dolgozik. */
  cells: Set<CellId>;
}

export interface EvaluateContext {
  uid: string;
  layer: Layer;
  type: ActivityType;
  ownership: OwnershipMap;
  streakDays: number;
  gpEarnedToday: number;
  cfg?: GameplayConfig;
}

/**
 * A felhasználó saját blokkjai a már beolvasott birtokviszonyból.
 *
 * A „felfedezés" karakter mértéke: hány olyan körzetet érint a kör, ahol a
 * felhasználónak MOST egyetlen mezője sincs.
 */
export function ownedBlockIds(ownership: OwnershipMap, uid: string, layer: Layer): Set<string> {
  const blocks = new Set<string>();
  for (const [cell, held] of ownership) {
    if (held.owner === uid) blocks.add(blockIdFor(layer, cell));
  }
  return blocks;
}

/**
 * Egy jelölt kiértékelése. `null`, ha nem zár be semmit.
 *
 * A HIBA NEM DOBÁS: egy túl nagy hurok (`LoopTooLargeError`) vagy hibás
 * geometria csak azt jelenti, hogy EZ a jelölt kiesik — a többi még bőven
 * elég egy ajánlathoz.
 */
export function evaluateCandidate(
  shaped: ShapedCandidate,
  context: EvaluateContext,
  ownedBlocks: ReadonlySet<string>,
): MissionCandidate | null {
  try {
    const result = processActivity({
      points: shaped.points,
      type: context.type,
      distanceKm: shaped.distanceKm,
      actorId: context.uid,
      ownership: context.ownership,
      streakDays: context.streakDays,
      gpEarnedToday: context.gpEarnedToday,
      cfg: context.cfg,
    });
    if (!result.claim) return null;

    const touched = new Set<string>();
    for (const cell of result.claimedCells) touched.add(blockIdFor(context.layer, cell));
    let newBlocks = 0;
    for (const id of touched) if (!ownedBlocks.has(id)) newBlocks += 1;

    return {
      bearing: shaped.bearing,
      distanceKm: shaped.distanceKm,
      polyline: shaped.polyline,
      claim: result.claim,
      gainedM2: result.areaGainedM2,
      estimatedGp: result.gp.total,
      newBlocks,
      cells: result.claimedCells,
    };
  } catch {
    return null;
  }
}

/** Egy cellahalmaz res 9 blokkjai — a beolvasási plafon méréséhez. */
export function blocksOf(cells: Iterable<CellId>, layer: Layer): Set<string> {
  const blocks = new Set<string>();
  for (const cell of cells) blocks.add(blockIdFor(layer, cell));
  return blocks;
}

/**
 * A jelöltek megnyirbálása a blokk-plafonig.
 *
 * Nyolc jelölt együtt sok blokkot érinthet, és mindegyik egy Firestore
 * olvasás. A korlát nem a felhasználó ellen véd, hanem a szolgáltatás ellen:
 * egy elgépelt (túl hosszú) időkeret különben több ezer dokumentumot olvasna
 * egyetlen koppintásra.
 *
 * A RÖVIDEBB JELÖLTEK MARADNAK. Nem véletlenszerűen vágunk: a kisebb körök
 * olcsóbbak, és belőlük több fér bele — így több karakterre marad ajánlat,
 * mint ha egyetlen óriási kör vinné el az egész keretet.
 */
export function limitByBlocks(
  candidates: readonly ShapedCandidate[],
  layer: Layer,
  maxBlocks: number,
): ShapedCandidate[] {
  const all = new Set<string>();
  for (const candidate of candidates) {
    for (const id of blocksOf(candidate.cells, layer)) all.add(id);
  }
  if (all.size <= maxBlocks) return [...candidates];

  const sorted = [...candidates].sort((a, b) => a.cells.size - b.cells.size);
  const kept: ShapedCandidate[] = [];
  const keptBlocks = new Set<string>();

  for (const candidate of sorted) {
    const merged = new Set(keptBlocks);
    for (const id of blocksOf(candidate.cells, layer)) merged.add(id);
    // Az elsőt akkor is megtartjuk, ha egyedül átlépné a plafont — különben
    // egy nagy kör mellett egyetlen ajánlat sem születne.
    if (merged.size > maxBlocks && kept.length > 0) break;
    kept.push(candidate);
    for (const id of merged) keptBlocks.add(id);
  }

  return kept;
}

/** A birtokviszony beolvasásának plafonja EGY generálásra. */
export const MAX_OWNERSHIP_BLOCKS = 400;

/** A cellák névleges területe m²-ben — a válaszban a célpont mérete. */
export function cellsToArea(cells: number, cfg?: GameplayConfig): number {
  return Math.round(cells * (cfg?.CELL_AREA_M2 ?? GAMEPLAY.CELL_AREA_M2));
}
