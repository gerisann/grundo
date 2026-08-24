import { gridDisk } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import type {
  CellId,
  DetectedLoop,
  LoopDiagnostics,
  RejectedLoopDiagnostic,
} from '@/types';
import { LoopTooLargeError, pruneDeadEnds } from './loops';
import {
  buildLoopInterior,
  loopInteriorCellCount,
  loopInteriorHas,
  loopInteriorOverlapCount,
} from './loopInterior';

interface AcceptedLoopRecord {
  loop: DetectedLoop;
  /** Az a traversal-index, ahol ezt a geometriai hurkot jóváírtuk. */
  toIndex: number;
}

interface ClosureBlock {
  /** Az éppen lezárt régió. Amíg benne/peremén haladunk, nincs új kompozit closure. */
  loop: DetectedLoop;
  /** A tényleges kapu környezete — teljes új kör után itt engedjük újra a repeat closure-t. */
  gate: Set<CellId>;
  acceptedAt: number;
}

/**
 * Egyetlen H3 kontaktfolt több egymás melletti korábbi cellát is érinthet.
 * Ezek a pathon jellemzően néhány indexen belül vannak, de geometriában ugyanazt
 * a kereszteződést jelentik. Ha mindegyiket külön jelöltként futtatjuk, ugyanarra
 * a fizikai találkozásra 2–6× Tarjan + flood fill indul.
 *
 * A 6 index elég tág egy res12 kontaktfolthoz, de több külön kör / külön korábbi
 * áthaladás tipikusan nagyságrendekkel távolabb van a pathon, tehát azok nem
 * olvadnak össze.
 */
const CONTACT_INDEX_CLUSTER_GAP = 6;

export interface IncrementalLoopSnapshot {
  loops: DetectedLoop[];
  diagnostics: LoopDiagnostics;
}

/**
 * Állapottartó, inkrementális hurokdetektor.
 *
 * A korábbi batch algoritmus minden preview-frissítésnél az egész addigi
 * aktivitást újraszámolta. Ez kis útvonalon is egyre drágább lett, főleg egy
 * már bejárt fal mellett, ahol minden új cella több korábbi kontaktból képezhet
 * hurokjelöltet.
 *
 * Ez az osztály pontosan ugyanazt a döntési logikát használja, de egy új H3
 * cella érkezésekor CSAK az új cella által létrehozott jelölteket vizsgálja.
 * A `detectLoopsDetailed()` lent kompatibilis batch wrapper marad.
 */
export class IncrementalLoopDetector {
  private readonly path: CellId[] = [];
  private readonly loops: DetectedLoop[] = [];
  private readonly successful: LoopDiagnostics['successful'] = [];
  private readonly rejected: RejectedLoopDiagnostic[] = [];
  private shortRevisits = 0;

  private readonly seenAt = new Map<CellId, number[]>();
  private readonly accepted: AcceptedLoopRecord[] = [];
  private closureBlock: ClosureBlock | null = null;

  /** Hány H3 cellát dolgoztunk már fel. */
  get length(): number {
    return this.path.length;
  }

  /**
   * Egy új, már összefüggő cellalánc-elemet dolgoz fel.
   * Visszatérési érték: keletkezett-e ezen a lépésen új elfogadott hurok.
   */
  append(cell: CellId): boolean {
    const i = this.path.length;
    this.path.push(cell);

    const sameHistory = this.seenAt.get(cell) ?? [];
    const latestSame = sameHistory[sameHistory.length - 1];

    if (latestSame !== undefined && i - latestSame < GAMEPLAY.MIN_LOOP_STEPS) {
      this.shortRevisits += 1;
    }

    if (this.closureBlock !== null) {
      const minimumRepeatSteps = Math.max(
        GAMEPLAY.MIN_LOOP_STEPS,
        Math.floor(this.closureBlock.loop.wall.size * 0.75),
      );
      const repeatReady = i - this.closureBlock.acceptedAt >= minimumRepeatSteps;

      // Ha egy teljes új lap után visszaértünk az eredeti kapuhoz, nem kell
      // kilépni a closure zone-ból: ez a szándékos multi-lap defense-eset.
      if (repeatReady && this.closureBlock.gate.has(cell)) {
        this.closureBlock = null;
      } else if (insideClosureZone(cell, this.closureBlock.loop)) {
        noteVisit(this.seenAt, cell, i);
        return false;
      } else {
        // Az első valóban külső cella szeparátor. Ezen még nem keresünk új
        // hurkot; a következő cellától indulhat új closure-epizód.
        this.closureBlock = null;
        noteVisit(this.seenAt, cell, i);
        return false;
      }
    }

    /**
     * A mostani cella saját korábbi előfordulásai és a hat élszomszéd korábbi
     * előfordulásai lehetnek kapuk. Cellánként legfeljebb a három legfrissebb
     * strukturálisan érvényes előzményt tartjuk meg.
     */
    const candidates = new Set<number>();
    addRecentEligible(sameHistory, i, candidates);
    for (const near of gridDisk(cell, 1)) {
      if (near === cell) continue;
      addRecentEligible(this.seenAt.get(near) ?? [], i, candidates);
    }

    /**
     * Egy H3 kereszteződés több egymás melletti korábbi cellát érinthet. Ezeket
     * egyetlen kontaktfolttá vonjuk össze, és a korábbi viselkedéssel egyezően
     * a legfrissebb indexet próbáljuk. Külön korábbi áthaladások a nagyobb
     * indexkülönbség miatt külön jelöltek maradnak.
     */
    const candidateIndices = clusterCandidateIndices(candidates);

    for (const previous of candidateIndices) {
      const rawWall = new Set(this.path.slice(previous, i + 1));
      const wall = pruneDeadEnds(rawWall);
      const prunedCells = Math.max(0, rawWall.size - wall.size);

      let interiorGeometry: ReturnType<typeof buildLoopInterior>;
      try {
        interiorGeometry = buildLoopInterior(wall);
      } catch (err) {
        if (err instanceof LoopTooLargeError) {
          this.rejected.push({
            reason: 'too_large',
            fromIndex: previous,
            toIndex: i,
            wallCells: wall.size,
            interiorCells: 0,
            prunedCells,
            candidateCells: err.candidateCells,
          });
          continue;
        }
        throw err;
      }

      if (interiorGeometry.cellCount < GAMEPLAY.MIN_INTERIOR_CELLS) {
        this.rejected.push({
          reason: 'interior_too_small',
          fromIndex: previous,
          toIndex: i,
          wallCells: wall.size,
          interiorCells: interiorGeometry.cellCount,
          prunedCells,
        });
        continue;
      }

      const candidate: DetectedLoop = {
        wall,
        interior: interiorGeometry.interior,
        ...(interiorGeometry.compactInterior
          ? { compactInterior: interiorGeometry.compactInterior }
          : {}),
        fromIndex: previous,
        toIndex: i,
      };

      // Ugyanannak a geometriai huroknak a közvetlen folytatása nem kap új
      // bezárást. Egy teljesen új traversal viszont továbbra is számíthat.
      if (isTraversalDuplicate(candidate, previous, this.accepted)) {
        continue;
      }

      this.loops.push(candidate);
      this.successful.push({
        fromIndex: previous,
        toIndex: i,
        wallCells: wall.size,
        interiorCells: interiorGeometry.cellCount,
        prunedCells,
      });
      this.accepted.push({ loop: candidate, toIndex: i });
      this.closureBlock = {
        loop: candidate,
        gate: gateZone(this.path[previous]!, cell),
        acceptedAt: i,
      };
      noteVisit(this.seenAt, cell, i);
      return true;
    }

    noteVisit(this.seenAt, cell, i);
    return false;
  }

  appendMany(cells: readonly CellId[]): number {
    let addedLoops = 0;
    for (const cell of cells) {
      if (this.append(cell)) addedLoops += 1;
    }
    return addedLoops;
  }

  snapshot(): IncrementalLoopSnapshot {
    return {
      loops: [...this.loops],
      diagnostics: {
        successful: [...this.successful],
        rejected: [...this.rejected],
        shortRevisits: this.shortRevisits,
      },
    };
  }
}

/**
 * Hurokdetektor átfedő és egymásba kapcsolódó bezárásokhoz.
 *
 * A H3-on egy fizikai útvonal-találkozás nem egy matematikai pont, hanem több
 * cellából álló kontaktfolt. Ráadásul egy már bezárt régió peremén/belsejében
 * továbbhaladva ugyanabból az útvonalból több, egyre nagyobb kompozit ciklus is
 * levezethető. Ezek gráfelméletileg létező ciklusok, de a játék szempontjából
 * NEM külön bezárási események.
 *
 * A batch API kompatibilitásból megmarad, de belül ugyanazt az inkrementális
 * állapotgépet eteti végig pontosan egyszer.
 */
export function detectLoopsDetailed(path: readonly CellId[]): {
  loops: DetectedLoop[];
  diagnostics: LoopDiagnostics;
} {
  const detector = new IncrementalLoopDetector();
  detector.appendMany(path);
  return detector.snapshot();
}

export function detectLoops(path: readonly CellId[]): DetectedLoop[] {
  return detectLoopsDetailed(path).loops;
}

function noteVisit(history: Map<CellId, number[]>, cell: CellId, index: number): void {
  const visits = history.get(cell);
  if (visits) visits.push(index);
  else history.set(cell, [index]);
}

function addRecentEligible(
  history: readonly number[],
  currentIndex: number,
  target: Set<number>,
): void {
  let added = 0;
  for (let i = history.length - 1; i >= 0 && added < 3; i -= 1) {
    const index = history[i]!;
    if (currentIndex - index < GAMEPLAY.MIN_LOOP_STEPS) continue;
    target.add(index);
    added += 1;
  }
}

/**
 * Ugyanahhoz a fizikai H3 kontaktfolthoz tartozó path-indexeket összevonja.
 * A lista csökkenő sorrendű, minden klaszterből a legfrissebb index marad.
 */
function clusterCandidateIndices(candidates: ReadonlySet<number>): number[] {
  const sorted = [...candidates].sort((a, b) => b - a);
  if (sorted.length < 2) return sorted;

  const result: number[] = [];
  let clusterNewest = sorted[0]!;
  let previous = sorted[0]!;

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    if (previous - current <= CONTACT_INDEX_CLUSTER_GAP) {
      previous = current;
      continue;
    }
    result.push(clusterNewest);
    clusterNewest = current;
    previous = current;
  }
  result.push(clusterNewest);
  return result;
}

function gateZone(a: CellId, b: CellId): Set<CellId> {
  const zone = new Set<CellId>();
  for (const cell of gridDisk(a, 1)) zone.add(cell);
  for (const cell of gridDisk(b, 1)) zone.add(cell);
  return zone;
}

/**
 * A lezárt régió maga + a fal közvetlen külső kontaktzónája.
 *
 * Compact nagy huroknál a homogén belsőt parent-membership alapján kérdezzük,
 * tehát itt sem kell több millió res12 cellát materializálni.
 */
function insideClosureZone(cell: CellId, loop: DetectedLoop): boolean {
  if (loop.wall.has(cell) || loopInteriorHas(loop, cell)) return true;
  for (const near of gridDisk(cell, 1)) {
    if (loop.wall.has(near)) return true;
  }
  return false;
}

function isTraversalDuplicate(
  candidate: DetectedLoop,
  previous: number,
  accepted: readonly AcceptedLoopRecord[],
): boolean {
  for (let i = accepted.length - 1; i >= 0; i -= 1) {
    const record = accepted[i]!;
    if (previous >= record.toIndex) break;
    if (sameLoopGeometry(candidate, record.loop)) return true;
  }
  return false;
}

/**
 * Ugyanazt a területet elsődlegesen a BELSEJE alapján azonosítjuk. Compact
 * geometriánál a metszetszám parent-szinten számolható, ezért egy Balaton-méretű
 * hurok deduplikációja sem bont vissza több millió res12 cellára.
 */
function sameLoopGeometry(a: DetectedLoop, b: DetectedLoop): boolean {
  const aInterior = loopInteriorCellCount(a);
  const bInterior = loopInteriorCellCount(b);
  const minInterior = Math.min(aInterior, bInterior);
  const maxInterior = Math.max(aInterior, bInterior);

  if (minInterior > 0) {
    if (minInterior / maxInterior < 0.85) return false;
    const shared = loopInteriorOverlapCount(a, b);
    if (shared / minInterior >= 0.95) return true;
  }

  const minWall = Math.min(a.wall.size, b.wall.size);
  const maxWall = Math.max(a.wall.size, b.wall.size);
  if (minWall === 0 || minWall / maxWall < 0.9) return false;

  const smallerWall = a.wall.size <= b.wall.size ? a.wall : b.wall;
  const largerWall = smallerWall === a.wall ? b.wall : a.wall;
  let sharedWall = 0;
  for (const cell of smallerWall) {
    if (largerWall.has(cell)) sharedWall += 1;
  }
  return sharedWall / minWall >= 0.95;
}
