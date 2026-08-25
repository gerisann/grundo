import { describe, expect, it } from 'vitest';
import type { DetectedLoop, OwnershipMap } from '@/types';
import { resolveSequentialLoopClaims } from './index';

const ME = 'user-me';

function loop(
  fromIndex: number,
  toIndex: number,
  cells: readonly string[],
): DetectedLoop {
  return {
    fromIndex,
    toIndex,
    wall: new Set(cells),
    interior: new Set(),
  };
}

describe('overlapping loop reinforcement baseline', () => {
  it('a nagy külső hurok csak a traversal elején már saját cellát erősíti', () => {
    const blue = 'blue-existing';
    const yellow = 'yellow-acquired-during-traversal';

    const before: OwnershipMap = new Map([
      [blue, { owner: ME, defense: 1 }],
    ]);

    // A nagy traversal már a 10-es indexnél elindult. Közben a 20→40 kis
    // hurok megszerzi a sárga cellát. A 60-nál záródó nagy hurok a kék és a
    // sárga cellát is körbezárja.
    const small = loop(20, 40, [yellow]);
    const enclosing = loop(10, 60, [blue, yellow]);

    const result = resolveSequentialLoopClaims([small, enclosing], before, ME);

    expect(result.running.get(blue)).toEqual({ owner: ME, defense: 2 });
    expect(result.running.get(yellow)).toEqual({ owner: ME, defense: 1 });
    expect(result.perLoop).toHaveLength(2);
    expect(result.perLoop[1]!.updates.get(blue)?.defense).toBe(2);
    expect(result.perLoop[1]!.updates.has(yellow)).toBe(false);
  });

  it('a következő valódi traversal már a korábban megszerzett sárga cellát is erősíti', () => {
    const blue = 'blue-existing';
    const yellow = 'yellow-acquired-during-first-traversal';

    const before: OwnershipMap = new Map([
      [blue, { owner: ME, defense: 1 }],
    ]);

    const small = loop(20, 40, [yellow]);
    const firstEnclosing = loop(10, 60, [blue, yellow]);
    // Ez már a nagy hurok BEFEJEZÉSE UTÁN induló új traversal.
    const nextTraversal = loop(60, 100, [blue, yellow]);

    const result = resolveSequentialLoopClaims(
      [small, firstEnclosing, nextTraversal],
      before,
      ME,
    );

    expect(result.running.get(blue)).toEqual({ owner: ME, defense: 3 });
    expect(result.running.get(yellow)).toEqual({ owner: ME, defense: 2 });
  });
});
