import { describe, expect, it } from 'vitest';
import { buildTrace, offset, ORIGIN, squareWaypoints } from '@/game/fixtures';
import { buildActivityGeometry, type ProcessInput } from '@/game';
import type { CellId, OwnershipMap, TracePoint } from '@/types';
import { processLabActivity } from './labHierarchicalWorld';

const ME = 'player-a';

/**
 * A LAB burkolatán át futtat egy valódi nyomvonalat.
 *
 * KORÁBBAN ez a teszt kézzel gyártott `DetectedLoop` objektumokkal és ÜRES
 * `cellPath`-szal dolgozott. Az akkori motorban a megerősítés a bezárások
 * darabszámából jött, ezért ez működött. Mostantól a körüljárási számból jön —
 * az pedig a nyomvonalból, tehát nyomvonal nélkül nincs mit mérni. A szabály
 * ugyanaz maradt, csak valódi geometriával fejezzük ki.
 */
function runLab(points: readonly TracePoint[], ownership: OwnershipMap) {
  const input: ProcessInput = {
    points, type: 'run', distanceKm: 3, actorId: ME,
    ownership, streakDays: 1, gpEarnedToday: 0,
  };
  return processLabActivity(input, buildActivityGeometry(points));
}

describe('LAB — nested / overlapping reinforcement', () => {
  it('a nagy külső hurok a régi kék területet erősíti, a közben szerzett sárgát nem', () => {
    // 1. aktivitás: 200 m-es négyzet → ez a KÉK terület, 1×.
    const blueRun = runLab(buildTrace(squareWaypoints(ORIGIN, 200)), new Map());
    const blue: OwnershipMap = new Map(blueRun.claim?.updates ?? []);
    expect(blue.size).toBeGreaterThan(100);
    for (const [, ownership] of blue) expect(ownership.defense).toBe(1);

    // 2. aktivitás: nagyobb kör a kék körül, közben egy önmetsző kitérővel,
    // ami menet közben egy külön kis lebenyt (SÁRGA) is bezár.
    const result = runLab(buildTrace([
      offset(ORIGIN, -150, -150),
      offset(ORIGIN, 150, -150),
      offset(ORIGIN, 150, 60),
      offset(ORIGIN, 240, 60),
      offset(ORIGIN, 240, -30),
      offset(ORIGIN, 130, -30),
      offset(ORIGIN, 150, 150),
      offset(ORIGIN, -150, 150),
      offset(ORIGIN, -150, -150),
    ]), blue);

    expect(result.loops.length).toBeGreaterThan(1);

    // A traversal ELEJÉN már saját kék terület pontosan egy megerősítést kap.
    for (const cell of blue.keys()) {
      expect(result.claim?.updates.get(cell)).toEqual({ owner: ME, defense: 2 });
    }

    // A menet közben megszerzett sárga 1× marad: a záró nagy hurok nem adhat rá
    // azonnal még egy védelmet.
    const updated = [...(result.claim?.updates.keys() ?? [])] as CellId[];
    const acquired = updated.filter((cell) => !blue.has(cell));
    expect(acquired.length).toBeGreaterThan(0);
    for (const cell of acquired) {
      expect(result.claim?.updates.get(cell)).toEqual({ owner: ME, defense: 1 });
    }

    expect(result.claim?.counts.reclaimed).toBe(blue.size);
    expect(result.claim?.counts.free).toBe(acquired.length);
  });
});
