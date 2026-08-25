import { hasCompactInterior } from '../../../src/game/loopInterior';
import type { DetectedLoop } from '../../../src/types';

/**
 * Compact hurok nem kerülhet a flat, egytranzakciós res12 commitba.
 *
 * A compact geometria szándékosan NEM materializálja a több tízezer/millió
 * belső res12 cellát, ezért a `candidateCells`/`blockIds` mérete ilyenkor nem
 * a valódi claim méretét jelenti. Ha pusztán a blokkszám alapján választanánk,
 * egy nagy compact hurok tévesen fast-pathra kerülhetne, ahol a shared core
 * ownership guard helyesen hibát dob.
 *
 * Ez a predicate Firestore-független, ezért külön tesztelhető és a route-/
 * commit-választás egyetlen forrása lehet.
 */
export function requiresChunkedClaim(
  loops: readonly DetectedLoop[],
  fitsByWriteCount: boolean,
): boolean {
  return loops.some(hasCompactInterior) || !fitsByWriteCount;
}
