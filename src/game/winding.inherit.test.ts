/**
 * A FALCELLA-ÖRÖKLÉS GYORSÍTÁSA NEM VÁLTOZTATHAT EREDMÉNYT.
 *
 * A `windingCounts` falcellái a legközelebbi, görbén kívüli szomszédjuktól
 * öröklik a körüljárási számot. Ez korábban `gridDisk(cell, 1..3)`-mal ment,
 * most a memoizált `ringOf` ismételt kiterjesztésével — mérve ez volt az élő
 * előnézet legdrágább művelete (GRUNDO #33: 9,1 ms a 14,1-ből).
 *
 * A gyorsítás azon a feltevésen áll, hogy a k-sugarú korong ugyanaz, akárhogy
 * állítjuk elő. Ez a teszt nem elhiszi, hanem összeméri: ugyanazon a valódi
 * hurokgeometrián minden falcellára a `gridDisk`-es referenciát futtatja.
 */

import { describe, expect, it } from 'vitest';
import { gridDisk } from 'h3-js';

import { createInheritedTurns, windingCounts } from './winding';
import { traceToCellPath } from './cells';
import { detectLoopsDetailed } from './loopDetection';
import { loopCells } from './loops';
import { buildTrace, multiLap, offset, ORIGIN } from './fixtures';
import type { CellId } from '@/types';

const MAX_INHERIT_RINGS = 3;

/** A leváltott, `gridDisk`-alapú öröklés — kizárólag referenciaként. */
function referenceInherited(
  cell: CellId,
  onPath: ReadonlySet<CellId>,
  counts: ReadonlyMap<CellId, number>,
): number {
  let inherited = 0;
  for (let ring = 1; ring <= MAX_INHERIT_RINGS; ring += 1) {
    let found = false;
    for (const near of gridDisk(cell, ring)) {
      if (near === cell || onPath.has(near)) continue;
      const known = counts.get(near);
      if (known === undefined) continue;
      found = true;
      if (known > inherited) inherited = known;
    }
    if (found) break;
  }
  return inherited;
}

function spiral(clockwise: boolean) {
  const squarePoint = (t: number, r: number) => {
    const a = ((t % 1) + 1) % 1;
    if (a < 0.25) return { x: -r + 8 * r * a, y: -r };
    if (a < 0.5) return { x: r, y: -r + 8 * r * (a - 0.25) };
    if (a < 0.75) return { x: r - 8 * r * (a - 0.5), y: r };
    return { x: -r, y: r - 8 * r * (a - 0.75) };
  };
  const points: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= 120; i += 1) {
    const t = i / 40;
    const { x, y } = squarePoint(clockwise ? t : -t, 100 + 25 * t);
    points.push(offset(ORIGIN, x, y));
  }
  return buildTrace(points);
}

describe('falcella-öröklés — a gyorsítás nem változtat eredményt', () => {
  const cases: [string, ReturnType<typeof buildTrace>][] = [
    ['kifelé tartó spirál', spiral(true)],
    ['kifelé tartó spirál, ellenirányban', spiral(false)],
    ['négy kör egymáson', multiLap()],
  ];

  for (const [name, points] of cases) {
    it(name, () => {
      const { path } = traceToCellPath(points);
      const claimed = new Set<CellId>();
      for (const loop of detectLoopsDetailed(path).loops) {
        for (const cell of loopCells(loop)) claimed.add(cell);
      }
      expect(claimed.size).toBeGreaterThan(0);

      const onPath = new Set<CellId>(path);
      const final = windingCounts(path, claimed);

      // Az öröklés bemenete: kizárólag a görbén KÍVÜLI cellák értékei.
      const offPathCounts = new Map<CellId, number>();
      for (const [cell, turns] of final) {
        if (!onPath.has(cell)) offPathCounts.set(cell, turns);
      }

      const wallCells = [...claimed].filter((cell) => onPath.has(cell));
      expect(wallCells.length).toBeGreaterThan(0);

      const inherited = createInheritedTurns(onPath, offPathCounts);
      for (const cell of wallCells) {
        expect(inherited(cell)).toBe(referenceInherited(cell, onPath, offPathCounts));
      }

      /**
       * A NYOMVONAL MINDEN cellájára, nem csak a falra: a tágabb korongok
       * memoizált maximumai így olyan cellákra is lefutnak, amiknek a
       * környezetében nincs semmi ismert.
       */
      for (const cell of path) {
        expect(inherited(cell)).toBe(referenceInherited(cell, onPath, offPathCounts));
      }
    });
  }

  it('nulla marad, ha három gyűrűn belül nincs ismert cella', () => {
    const { path } = traceToCellPath(multiLap());
    const onPath = new Set<CellId>(path);
    const cell = path[0]!;
    expect(createInheritedTurns(onPath, new Map())(cell)).toBe(0);
    expect(referenceInherited(cell, onPath, new Map())).toBe(0);
  });
});
