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
import {
  buildActivityGeometry,
  hasCompactInterior,
  loopCells,
  processActivityGeometry,
  type ActivityGeometry,
} from '../../../src/game';
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
  /** Fölösleges visszafordulások az útvonalon — a válogatás döntetlenjéhez. */
  uTurns: number;
  /** Rövid visszatérő hurok vagy háromoldalas dobozkerülő. */
  shortDetours: number;
  /** 30 m-es léptékű kanyarszám — lásd `routeShape.ts` → `measureStraightness`. */
  turnCount?: number;
  /**
   * Compact (nagy) belsejű-e a hurok?
   *
   * Ilyenkor az `evaluateCandidate` ÜRES ownershippel értékel (a motor őre
   * miatt), tehát ehhez a jelölthez NEM olvasunk Firestore-blokkot — ezért a
   * `limitByBlocks` plafonja sem vonatkozik rá.
   */
  compact?: boolean;
  /**
   * A már felépített geometria — hogy az `evaluateCandidate` NE építse fel újra.
   *
   * ⚠️ MÉRT OK, nem elegancia. A geometriaépítés drága fele a hurokdetektálás
   * (`detectLoopsDetailed`), ami jelöltkapunként flood fillt futtat: egy 16 km-es
   * bringakörnél ~4,8 s. Enélkül a mező nélkül az `evaluateCandidate` a
   * `processActivity`-n át MÉGEGYSZER lefuttatta ugyanezt ugyanarra a
   * nyomvonalra. Mérve 2026-08-29 (élő GraphHopper, 2 jelölt/táv): a
   * megtakarítás 43–50 %, és a kapott cella/GP/terület bitre azonos maradt.
   */
  geometry?: ActivityGeometry;
}

/**
 * A jelölt bezárásainak cellái — PONTOSAN azzal a geometriával, amit a mentés
 * is futtat.
 *
 * ⚠️ NE hívj itt `detectLoopsDetailed`-et a `src/game/loops`-ból. Abban a
 * modulban a hurokdetektor LEVÁLTOTT változata él tovább; a `src/game`
 * belépőpont a `loopDetection`-belire cseréli (5cf6362, 2026-08-24). Aki
 * közvetlenül a `loops`-ból importált, csendben a régi detektorral számolt: a
 * küldetés más cellahalmazt ígért, mint amit a `processActivity` jóváír.
 * Mérve: egy 220 m-es fixture-körnél 187 cella a régivel, 186 az élessel — a
 * két detektor más kaput választ ugyanannál a H3 kontaktfoltnál.
 *
 * Ezért van EGY közös hely: a route és a teszt is innen kapja a cellákat.
 */
export function shapeCandidateCells(points: readonly TracePoint[]): {
  loopCount: number;
  cells: Set<CellId>;
  /** Lásd `ShapedCandidate.compact`. */
  compact: boolean;
  /** Add tovább az `evaluateCandidate`-nek — lásd `ShapedCandidate.geometry`. */
  geometry: ActivityGeometry;
} {
  const geometry = buildActivityGeometry(points);
  const cells = new Set<CellId>();
  for (const loop of geometry.loops) {
    for (const cell of loopCells(loop)) cells.add(cell);
  }
  return {
    loopCount: geometry.loops.length,
    cells,
    compact: geometry.loops.some(hasCompactInterior),
    geometry,
  };
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
    /*
      Ha a hívó már felépítette a geometriát (a `shapeCandidateCells`-ben
      úgyis kellett), azt használjuk — különben a drága hurokdetektálás
      kétszer futna le ugyanarra a nyomvonalra.
    */
    const geometry = shaped.geometry ?? buildActivityGeometry(shaped.points);

    /**
     * Nagy (compact belsejű) huroknál a motor SZÁNDÉKOSAN dob, ha valódi
     * ownershipet kap (`src/game/index.ts` `processActivityGeometry` őre) —
     * az ilyen hurkot csak a szerver blokkos útja könyvelheti el ténylegesen
     * (`routes/activities.ts` `requiresChunkedClaim`). Küldetés-AJÁNLÁSKOR
     * viszont ez csak előnézet, nincs írás — enélkül MINDEN nagy hurkos
     * jelölt itt elhasalt (kivétel → `null`), és 50-150 km-es kéréseknél
     * "Most nincs ajánlható küldetés" jött ki, holott a geometria és a
     * távolság rendben volt (ugyanaz a gyökérok, mint a `TrackingScreen`
     * élő preview-jának korábbi hibája, HANDOFF #20). Üres ownershippel
     * hívva a compact ág "üres világ" becslést ad: a GP és a cellaszám
     * pontos, csak a lopott/visszafoglalt cella MEGKÜLÖNBÖZTETÉSE vész el —
     * egy ekkora kör ajánlatnál ez elfogadható közelítés.
     */
    const ownership = geometry.loops.some(hasCompactInterior) ? new Map() : context.ownership;
    const input = {
      points: shaped.points,
      type: context.type,
      distanceKm: shaped.distanceKm,
      actorId: context.uid,
      ownership,
      streakDays: context.streakDays,
      gpEarnedToday: context.gpEarnedToday,
      cfg: context.cfg,
    };
    const result = processActivityGeometry(input, geometry);
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
      uTurns: shaped.uTurns,
      shortDetours: shaped.shortDetours,
      turnCount: shaped.turnCount,
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
 *
 * ⚠️ A COMPACT (nagy) JELÖLTEK KIVÉTELEK, és ez nem kivételezés, hanem a
 * plafon értelme: hozzájuk EGYETLEN blokkot sem olvasunk be, mert az
 * `evaluateCandidate` üres ownershippel értékeli őket (a motor őre miatt).
 * Amíg mégis beleszámítottak, pont ők bukták el a keretet, amit nem is
 * használtak: MÉRVE (2026-08-29) egyetlen 113 km-es kör 431 res9 blokkot
 * érint — már önmagában a 400-as plafon FÖLÖTT —, két ilyen kör együtt 844-et,
 * ezért a második jelölt mindig kiesett. Ez adta a „100 km fölött előbb két
 * ajánlat jön, aztán már csak egy marad" hibát (HANDOFF #20).
 */
export function limitByBlocks(
  candidates: readonly ShapedCandidate[],
  layer: Layer,
  maxBlocks: number,
): ShapedCandidate[] {
  const free = candidates.filter((candidate) => candidate.compact);
  const paying = candidates.filter((candidate) => !candidate.compact);

  const all = new Set<string>();
  for (const candidate of paying) {
    for (const id of blocksOf(candidate.cells, layer)) all.add(id);
  }
  if (all.size <= maxBlocks) return [...candidates];

  const sorted = [...paying].sort((a, b) => a.cells.size - b.cells.size);
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

  return [...free, ...kept];
}

/** A birtokviszony beolvasásának plafonja EGY generálásra. */
export const MAX_OWNERSHIP_BLOCKS = 400;

/** A cellák névleges területe m²-ben — a válaszban a célpont mérete. */
export function cellsToArea(cells: number, cfg?: GameplayConfig): number {
  return Math.round(cells * (cfg?.CELL_AREA_M2 ?? GAMEPLAY.CELL_AREA_M2));
}
