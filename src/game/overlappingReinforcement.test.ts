import { describe, expect, it } from 'vitest';
import type { DetectedLoop, OwnershipMap } from '@/types';
import { resolveSequentialLoopClaims } from './index';

const ME = 'user-me';

function loop(
  fromIndex: number,
  toIndex: number,
  cells: readonly string[],
  wallSize = Math.max(1, cells.length),
  id = `${fromIndex}-${toIndex}`,
): DetectedLoop {
  const wall = new Set<string>();
  for (let i = 0; i < wallSize; i += 1) wall.add(`wall-${id}-${i}`);
  return {
    fromIndex,
    toIndex,
    wall,
    interior: new Set(cells),
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
    const small = loop(20, 40, [yellow], 12, 'small');
    const enclosing = loop(10, 60, [blue, yellow], 30, 'enclosing');

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

    const small = loop(20, 40, [yellow], 12, 'small');
    const firstEnclosing = loop(10, 60, [blue, yellow], 30, 'first-enclosing');
    // Ez már a nagy hurok BEFEJEZÉSE UTÁN induló új traversal.
    const nextTraversal = loop(60, 100, [blue, yellow], 30, 'next-traversal');

    const result = resolveSequentialLoopClaims(
      [small, firstEnclosing, nextTraversal],
      before,
      ME,
    );

    expect(result.running.get(blue)).toEqual({ owner: ME, defense: 3 });
    expect(result.running.get(yellow)).toEqual({ owner: ME, defense: 2 });
  });

  it('a LAB #5/#6 átfedő closure-a ugyanazon fizikai traversalből csak egyszer erősít cellánként', () => {
    const topLeft = 'top-left';
    const topRight = 'top-right';
    const bottomLeft = 'bottom-left';

    const before: OwnershipMap = new Map([
      [topLeft, { owner: ME, defense: 2 }],
      [topRight, { owner: ME, defense: 1 }],
      [bottomLeft, { owner: ME, defense: 1 }],
    ]);

    // A képernyőképen mért két closure:
    // #5: 150→220, fal 71 — a felső két régiót érinti.
    // #6: 164→258, fal 95 — a teljes nagy L-hurkot zárja.
    // A #6 már a #5 bezárása ELŐTT elindult, és a #5 után csak 38 új path-step
    // készült. Ez ugyanannak a fizikai traversalnek két átfedő closure-a.
    const intermediate = loop(150, 220, [topLeft, topRight], 71, 'lab-5');
    const finalOuter = loop(164, 258, [topLeft, topRight, bottomLeft], 95, 'lab-6');

    const result = resolveSequentialLoopClaims([intermediate, finalOuter], before, ME);

    expect(result.running.get(topLeft)).toEqual({ owner: ME, defense: 3 });
    expect(result.running.get(topRight)).toEqual({ owner: ME, defense: 2 });
    expect(result.running.get(bottomLeft)).toEqual({ owner: ME, defense: 2 });
  });

  it('egy majdnem teljesen új kör creditet kap akkor is, ha a detektált intervalluma kissé visszanyúlik', () => {
    const blue = 'blue-existing';
    const before: OwnershipMap = new Map([[blue, { owner: ME, defense: 1 }]]);

    const first = loop(0, 100, [blue], 100, 'lap-1');
    // A detektor 20 indexet visszanyúl az előző körbe, de az első closure óta
    // 80 új step készült. Ez a 100 cellás fal 75%-ánál több, tehát valódi új lap.
    const shiftedSecond = loop(20, 180, [blue], 100, 'lap-2');

    const result = resolveSequentialLoopClaims([first, shiftedSecond], before, ME);
    expect(result.running.get(blue)).toEqual({ owner: ME, defense: 3 });
  });
});
