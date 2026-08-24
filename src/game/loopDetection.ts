import { gridDisk } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import type {
  CellId,
  DetectedLoop,
  LoopDiagnostics,
  RejectedLoopDiagnostic,
} from '@/types';
import { floodFillInterior, LoopTooLargeError, pruneDeadEnds } from './loops';

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
 * Hurokdetektor átfedő és egymásba kapcsolódó bezárásokhoz.
 *
 * A H3-on egy fizikai útvonal-találkozás nem egy matematikai pont, hanem több
 * cellából álló kontaktfolt. Ráadásul egy már bezárt régió peremén/belsejében
 * továbbhaladva ugyanabból az útvonalból több, egyre nagyobb kompozit ciklus is
 * levezethető. Ezek gráfelméletileg létező ciklusok, de a játék szempontjából
 * NEM külön bezárási események.
 *
 * Ezért sikeres bezárás után a teljes lezárt régió (belső + fal + a fal egy
 * cellás kontaktzónája) ideiglenes closure zone. Amíg az útvonal ebből
 * ténylegesen ki nem lép, ugyanebből a closure-epizódból nem képezünk új
 * hurkot. Az első külső cella kötelező szeparátor, csak utána élesedik újra a
 * detector.
 *
 * Kivétel az ismételt teljes kör: ha a játékos a falat ténylegesen újra
 * végigjárja és visszaér az eredeti kapuhoz, az új traversal, ezért új
 * bezárásként számíthat és defense-et építhet.
 */
export function detectLoopsDetailed(path: readonly CellId[]): {
  loops: DetectedLoop[];
  diagnostics: LoopDiagnostics;
} {
  const loops: DetectedLoop[] = [];
  const successful: LoopDiagnostics['successful'] = [];
  const rejected: RejectedLoopDiagnostic[] = [];
  let shortRevisits = 0;

  const seenAt = new Map<CellId, number[]>();
  const accepted: AcceptedLoopRecord[] = [];
  let closureBlock: ClosureBlock | null = null;

  for (let i = 0; i < path.length; i += 1) {
    const cell = path[i]!;
    const sameHistory = seenAt.get(cell) ?? [];
    const latestSame = sameHistory[sameHistory.length - 1];

    if (latestSame !== undefined && i - latestSame < GAMEPLAY.MIN_LOOP_STEPS) {
      shortRevisits += 1;
    }

    if (closureBlock !== null) {
      const minimumRepeatSteps = Math.max(
        GAMEPLAY.MIN_LOOP_STEPS,
        Math.floor(closureBlock.loop.wall.size * 0.75),
      );
      const repeatReady = i - closureBlock.acceptedAt >= minimumRepeatSteps;

      // Ha egy teljes új lap után visszaértünk az eredeti kapuhoz, nem kell
      // kilépni a closure zone-ból: ez a szándékos multi-lap defense-eset.
      if (repeatReady && closureBlock.gate.has(cell)) {
        closureBlock = null;
      } else if (insideClosureZone(cell, closureBlock.loop)) {
        noteVisit(seenAt, cell, i);
        continue;
      } else {
        // Az első valóban külső cella szeparátor. Ezen még nem keresünk új
        // hurkot; a következő cellától indulhat új closure-epizód.
        closureBlock = null;
        noteVisit(seenAt, cell, i);
        continue;
      }
    }

    /**
     * A mostani cella saját korábbi előfordulásai és a hat élszomszéd korábbi
     * előfordulásai lehetnek kapuk. Cellánként legfeljebb a három legfrissebb
     * strukturálisan érvényes előzményt tartjuk meg: ez megőrzi az overlap
     * eseteket, de hosszú / ismételt útvonalnál nem engedi felrobbanni a
     * jelöltek számát.
     */
    const candidates = new Set<number>();
    addRecentEligible(sameHistory, i, candidates);
    for (const near of gridDisk(cell, 1)) {
      if (near === cell) continue;
      addRecentEligible(seenAt.get(near) ?? [], i, candidates);
    }
    const candidateIndices = [...candidates].sort((a, b) => b - a);

    for (const previous of candidateIndices) {
      const rawWall = new Set(path.slice(previous, i + 1));
      const wall = pruneDeadEnds(rawWall);
      const prunedCells = Math.max(0, rawWall.size - wall.size);

      let interior: Set<CellId>;
      try {
        interior = floodFillInterior(wall);
      } catch (err) {
        if (err instanceof LoopTooLargeError) {
          rejected.push({
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

      if (interior.size < GAMEPLAY.MIN_INTERIOR_CELLS) {
        rejected.push({
          reason: 'interior_too_small',
          fromIndex: previous,
          toIndex: i,
          wallCells: wall.size,
          interiorCells: interior.size,
          prunedCells,
        });
        continue;
      }

      const candidate: DetectedLoop = { wall, interior, fromIndex: previous, toIndex: i };

      // Ugyanannak a geometriai huroknak a közvetlen folytatása nem kap új
      // bezárást. Egy teljesen új traversal viszont továbbra is számíthat.
      if (isTraversalDuplicate(candidate, previous, accepted)) {
        continue;
      }

      loops.push(candidate);
      successful.push({
        fromIndex: previous,
        toIndex: i,
        wallCells: wall.size,
        interiorCells: interior.size,
        prunedCells,
      });
      accepted.push({ loop: candidate, toIndex: i });
      closureBlock = {
        loop: candidate,
        gate: gateZone(path[previous]!, cell),
        acceptedAt: i,
      };
      break;
    }

    noteVisit(seenAt, cell, i);
  }

  return { loops, diagnostics: { successful, rejected, shortRevisits } };
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

function gateZone(a: CellId, b: CellId): Set<CellId> {
  const zone = new Set<CellId>();
  for (const cell of gridDisk(a, 1)) zone.add(cell);
  for (const cell of gridDisk(b, 1)) zone.add(cell);
  return zone;
}

/**
 * A lezárt régió maga + a fal közvetlen külső kontaktzónája.
 *
 * Nem materializáljuk előre a teljes 1-ringet (nagy huroknál felesleges
 * memória lenne); egy aktuális cellához legfeljebb hét membership-check elég.
 */
function insideClosureZone(cell: CellId, loop: DetectedLoop): boolean {
  if (loop.wall.has(cell) || loop.interior.has(cell)) return true;
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
 * Ugyanazt a területet elsődlegesen a BELSEJE alapján azonosítjuk. A H3-kapu
 * 1–2 cellás eltolódása a falat látványosan megváltoztathatja úgy, hogy a
 * bezárt terület valójában azonos marad. Egy valóban nagyobb, új területet is
 * hozzáadó hurok viszont a belső méretarány miatt nem esik ebbe a dedupe-ba.
 */
function sameLoopGeometry(a: DetectedLoop, b: DetectedLoop): boolean {
  const minInterior = Math.min(a.interior.size, b.interior.size);
  const maxInterior = Math.max(a.interior.size, b.interior.size);

  if (minInterior > 0) {
    if (minInterior / maxInterior < 0.85) return false;
    const smaller = a.interior.size <= b.interior.size ? a.interior : b.interior;
    const larger = smaller === a.interior ? b.interior : a.interior;
    let shared = 0;
    for (const cell of smaller) {
      if (larger.has(cell)) shared += 1;
    }
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
