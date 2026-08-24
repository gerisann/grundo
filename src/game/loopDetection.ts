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

/**
 * Hurokdetektor átfedő bezárásokhoz.
 *
 * A teljes látogatási előzményt megtartjuk, hogy későbbi valódi hurkok
 * használhassanak korábbi útvonalrészt is. Emiatt viszont külön kell kezelni
 * azt, hogy egy fizikai útvonal-találkozás H3-on több egymás melletti cella.
 *
 * Egy elfogadott bezárás után a kapu 1-cellás kontaktzónájában nem keresünk
 * új hurkot. Amikor először kilépünk ebből a zónából, AZ A KILÉPŐ CELLA még
 * kötelező elválasztó cella: ott sem fut hurokvizsgálat. Csak a következő
 * cellától élesedhet újra a detector.
 *
 * Ez fontos különbség. A korábbi verzió a zónából kilépés pillanatában rögtön
 * újraélesedett, ezért ugyanannak a huroknak a kilépési oldalán még egyszer
 * bezárást tudott generálni.
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
  let blockedGateZone: Set<CellId> | null = null;

  for (let i = 0; i < path.length; i += 1) {
    const cell = path[i]!;
    const sameHistory = seenAt.get(cell) ?? [];
    const latestSame = sameHistory[sameHistory.length - 1];

    if (latestSame !== undefined && i - latestSame < GAMEPLAY.MIN_LOOP_STEPS) {
      shortRevisits += 1;
    }

    /**
     * Bezárás utáni kapu-debounce.
     *
     * - amíg a kapu kontaktzónájában vagyunk: nincs új hurok;
     * - az ELSŐ cella a zónán kívül: elválasztó cella, még mindig nincs hurok;
     * - csak a következő cellától vizsgálunk újra.
     *
     * Így a metszéspont H3-klasztere és annak kilépő cellája egyetlen
     * találkozási esemény marad, de egy teljes új kör továbbra is számíthat.
     */
    if (blockedGateZone !== null) {
      if (!blockedGateZone.has(cell)) {
        blockedGateZone = null;
      }
      noteVisit(seenAt, cell, i);
      continue;
    }

    /**
     * A mostani cella saját korábbi előfordulásai és a hat élszomszéd minden
     * korábbi előfordulása hurokkapu-jelölt. A frissebb jelöltet próbáljuk
     * először, mert az adja a lokális, frissen bezárt hurkot.
     */
    const candidates = new Set<number>();
    for (const index of sameHistory) {
      if (i - index >= GAMEPLAY.MIN_LOOP_STEPS) candidates.add(index);
    }
    for (const near of gridDisk(cell, 1)) {
      if (near === cell) continue;
      for (const index of seenAt.get(near) ?? []) {
        if (i - index >= GAMEPLAY.MIN_LOOP_STEPS) candidates.add(index);
      }
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
      // jóváírást. Egy teljesen új traversal viszont továbbra is építhet defense-t.
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
      blockedGateZone = gateZone(path[previous]!, cell);
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

function gateZone(a: CellId, b: CellId): Set<CellId> {
  const zone = new Set<CellId>();
  for (const cell of gridDisk(a, 1)) zone.add(cell);
  for (const cell of gridDisk(b, 1)) zone.add(cell);
  return zone;
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
 * A H3-kapu következő cellája 1–2 falcellát hozzáadhat vagy elvehet, ezért
 * nem bitpontos azonosságot kérünk. A küszöb szigorú marad, hogy valódi,
 * átfedő, de eltérő hurkokat ne nyeljünk el.
 */
function sameLoopGeometry(a: DetectedLoop, b: DetectedLoop): boolean {
  const aWall = a.wall;
  const bWall = b.wall;
  const minWall = Math.min(aWall.size, bWall.size);
  const maxWall = Math.max(aWall.size, bWall.size);
  if (minWall === 0) return false;
  if (minWall / maxWall < 0.88) return false;

  const minInterior = Math.min(a.interior.size, b.interior.size);
  const maxInterior = Math.max(a.interior.size, b.interior.size);
  if (maxInterior > 0 && minInterior / maxInterior < 0.88) return false;

  const smaller = aWall.size <= bWall.size ? aWall : bWall;
  const larger = smaller === aWall ? bWall : aWall;
  let shared = 0;
  for (const cell of smaller) {
    if (larger.has(cell)) shared += 1;
  }

  return shared / minWall >= 0.9;
}
