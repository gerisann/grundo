import { gridDisk } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import type {
  CellId,
  DetectedLoop,
  LoopDiagnostics,
  RejectedLoopDiagnostic,
} from '@/types';
import { floodFillInterior, LoopTooLargeError, pruneDeadEnds } from './loops';

/**
 * Hurokdetektor átfedő bezárásokhoz.
 *
 * A korábbi algoritmus minden sikeres bezárás után teljesen elfelejtette az
 * addigi nyomvonalat. Ez megfogta a rávezető szakasz oda-vissza járásából
 * születő hamis újrabezárásokat, viszont valódi, egymást részben átfedő
 * hurkokat is lenullázott: egy későbbi hurok nem használhatta falnak a már
 * korábban bejárt szakaszt.
 *
 * Itt a teljes látogatási előzményt megtartjuk. A régi rávezető-hibát nem
 * history-reset védi, hanem egy topológiai feltétel: ha egy új hurok egy már
 * korábbi bezárás ELŐTT kezdődő útvonalrészt használ, akkor a bezárás óta
 * legalább egy ÚJONNAN BEJÁRT ÉLNEK ténylegesen a megmetszett hurok falán kell
 * maradnia. Egy egyszerű visszaút rávezető ágai a bridge-pruning során
 * kiesnek, ezért nem tudják ugyanazt a régi kört új bezárásként elsütni.
 */
export function detectLoopsDetailed(path: readonly CellId[]): {
  loops: DetectedLoop[];
  diagnostics: LoopDiagnostics;
} {
  const loops: DetectedLoop[] = [];
  const successful: LoopDiagnostics['successful'] = [];
  const rejected: RejectedLoopDiagnostic[] = [];
  let shortRevisits = 0;

  // Egy cellát egy aktivitás alatt többször is érinthetünk. Nem csak a
  // legutolsó előfordulás kell: egy közeli rövid visszaérintés mögött lehet
  // egy régebbi, valódi bezárási kapu.
  const seenAt = new Map<CellId, number[]>();
  let lastAcceptedAt = -1;

  for (let i = 0; i < path.length; i += 1) {
    const cell = path[i]!;
    const sameHistory = seenAt.get(cell) ?? [];
    const latestSame = sameHistory[sameHistory.length - 1];

    if (latestSame !== undefined && i - latestSame < GAMEPLAY.MIN_LOOP_STEPS) {
      shortRevisits += 1;
    }

    /**
     * A kapu cellaszinten záródik. A mostani cella saját korábbi
     * előfordulásai ÉS a hat élszomszéd minden korábbi előfordulása jelölt.
     *
     * A legfrissebb jelöltet próbáljuk először: egy új keresztezésnél ez adja
     * a lokális, frissen bezárt hurkot. Ha az túl kicsi vagy érvénytelen,
     * haladunk visszafelé a régebbi kapuk felé.
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

      /**
       * Ha ez a jelölt visszanyúl egy már korábban elfogadott hurok elé,
       * csak akkor lehet ÚJ bezárás, ha a legutóbbi bezárás óta bejárt
       * szakaszból marad legalább egy valódi falél a ciklusban.
       *
       * - valódi átfedő hurok: van új falél → marad;
       * - ugyanazon a rávezető ágon visszamenés: az új ág bridge, pruningkor
       *   kiesik → nincs új falél → nem számít új huroknak;
       * - újabb teljes kör ugyanazon a nyomon: minden él friss traversal →
       *   marad, tehát a defense továbbra is épül.
       */
      if (
        previous <= lastAcceptedAt &&
        !hasFreshWallEdge(path, wall, previous, i, lastAcceptedAt)
      ) {
        continue;
      }

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

      if (interior.size >= GAMEPLAY.MIN_INTERIOR_CELLS) {
        loops.push({ wall, interior, fromIndex: previous, toIndex: i });
        successful.push({
          fromIndex: previous,
          toIndex: i,
          wallCells: wall.size,
          interiorCells: interior.size,
          prunedCells,
        });
        lastAcceptedAt = i;
        break;
      }

      rejected.push({
        reason: 'interior_too_small',
        fromIndex: previous,
        toIndex: i,
        wallCells: wall.size,
        interiorCells: interior.size,
        prunedCells,
      });
    }

    const history = seenAt.get(cell);
    if (history) history.push(i);
    else seenAt.set(cell, [i]);
  }

  return { loops, diagnostics: { successful, rejected, shortRevisits } };
}

export function detectLoops(path: readonly CellId[]): DetectedLoop[] {
  return detectLoopsDetailed(path).loops;
}

function hasFreshWallEdge(
  path: readonly CellId[],
  wall: ReadonlySet<CellId>,
  previous: number,
  current: number,
  lastAcceptedAt: number,
): boolean {
  const firstFreshEdgeEnd = Math.max(previous + 1, lastAcceptedAt + 1);
  for (let i = firstFreshEdgeEnd; i <= current; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if (a === undefined || b === undefined || a === b) continue;
    if (wall.has(a) && wall.has(b)) return true;
  }
  return false;
}
