import { gridDisk } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { buildTrace, ORIGIN, simpleLoop, squareWaypoints } from '../../../src/game/fixtures';
import type { CellId } from '../../../src/types';
import { fitsOneTransaction, planActivity } from './activityCommit';
import { requiresChunkedClaim } from './activityRouting';
import { blocksFor } from './gridMath';

/**
 * A COMPACT AKTIVITÁS TERVE — a gyors és a darabolt út elágazása.
 *
 * Ezek a tesztek azt a csapdát rögzítik, ami miatt a compact útnak egyáltalán
 * külön blokkterv kell: a compact hurok belseje parentekben él, ezért a
 * jelöltcellákból számolt blokklista a foglalás nagyobbik részét NEM tartalmazza,
 * az írásszám pedig tévesen kicsinek látszik.
 */

/** Egy 5 km oldalú kör — több tíz km², compact belsővel. */
function compactPlan() {
  const points = buildTrace(squareWaypoints(ORIGIN, 5_000), {
    stepM: 250,
    intervalS: 1,
    accuracy: 1,
  });
  return planActivity({
    activityId: 'compact-activity',
    uid: 'u1',
    type: 'ride',
    points,
    startedAt: points[0]!.t,
    endedAt: points[points.length - 1]!.t,
    movingMs: points[points.length - 1]!.t - points[0]!.t,
  });
}

/** Az a blokklista, amit a jelöltcellák kétgyűrűs környezete adna. */
function blocksFromCandidates(plan: ReturnType<typeof planActivity>): string[] {
  const scope = new Set<CellId>();
  for (const cell of plan.candidateCells) {
    for (const near of gridDisk(cell, 2)) scope.add(near as CellId);
  }
  return [...blocksFor(plan.layer, scope).keys()];
}

describe('compact aktivitás terve', () => {
  it('a hurok BELSEJÉT is beleveszi a blokklistába, nem csak a jelöltcellákat', () => {
    const plan = compactPlan();

    expect(plan.compactWorks).not.toBeNull();
    const works = plan.compactWorks!;

    // A blokklista pontosan az, amit írni fogunk — se több, se kevesebb.
    expect(plan.blockIds).toHaveLength(works.size);
    expect(new Set(plan.blockIds)).toEqual(new Set(works.keys()));

    /**
     * A LÉNYEG: a jelöltcellákból számolt lista jóval kevesebb blokkot adna.
     * A különbség maga a hurok belseje — ha a darabolt út abból dolgozna, a
     * terület nagyobbik része némán elveszne.
     */
    const fromCandidates = new Set(blocksFromCandidates(plan));
    const missing = plan.blockIds.filter((id) => !fromCandidates.has(id));
    expect(missing.length).toBeGreaterThan(fromCandidates.size);
  });

  it('a jelöltcellák a teljes területnek csak a töredékét materializálják', () => {
    const plan = compactPlan();
    const works = plan.compactWorks!;

    let compactCells = 0;
    for (const work of works.values()) {
      compactCells += work.parentCredits.size + work.fineCredits.size;
    }

    // A fal és a pontos határsáv explicit; a belső parentekben van.
    expect(plan.candidateCells.length).toBeGreaterThan(0);
    expect(compactCells).toBeGreaterThan(0);
    // Egy több tíz km²-es kör res12-ben több tízezer cella lenne.
    expect(plan.candidateCells.length).toBeLessThan(20_000);
  });

  it('⚠️ az írásszám ÖNMAGÁBAN a gyors útra küldené — ezért kell a geometriai őr', () => {
    const plan = compactPlan();

    // Ez a csapda: a blokkszám bőven a Firestore-korlát alatt van…
    expect(fitsOneTransaction(plan)).toBe(true);
    // …a compact hurok viszont a gyors úton a motor őrébe futna.
    expect(requiresChunkedClaim(plan.loops, fitsOneTransaction(plan))).toBe(true);
  });

  it('normál hurkot változatlanul hagy: nincs compact terv, marad a gyors út', () => {
    const points = simpleLoop(200);
    const plan = planActivity({
      activityId: 'normal-activity',
      uid: 'u1',
      type: 'run',
      points,
      startedAt: points[0]!.t,
      endedAt: points[points.length - 1]!.t,
      movingMs: points[points.length - 1]!.t - points[0]!.t,
    });

    expect(plan.compactWorks).toBeNull();
    // Normál úton a blokklista továbbra is a jelöltcellák környezetéből jön.
    expect(new Set(plan.blockIds)).toEqual(new Set(blocksFromCandidates(plan)));
    expect(fitsOneTransaction(plan)).toBe(true);
    expect(requiresChunkedClaim(plan.loops, fitsOneTransaction(plan))).toBe(false);
  });
});
