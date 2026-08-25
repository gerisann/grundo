import { describe, expect, it } from 'vitest';
import { cellToChildren, cellToParent, latLngToCell } from 'h3-js';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { CompactClaimCredits } from '../../../src/game/compactClaim';
import type { CellId } from '../../../src/types';
import { BLOCK_RESOLUTION, blockIdFor } from './gridMath';
import { buildCompactBlockPlan } from './compactBlockPlan';

const fine = latLngToCell(47.475, 19.015, GAMEPLAY.H3_RESOLUTION) as CellId;
const block = cellToParent(fine, BLOCK_RESOLUTION) as CellId;
const parentResolution = GAMEPLAY.H3_RESOLUTION - 2;
const parents = cellToChildren(block, parentResolution) as CellId[];

describe('compact production block planner', () => {
  it('res10 parenteket res12 materializálás nélkül a res9 blokkba csoportosít', () => {
    const credits: CompactClaimCredits = {
      parentResolution,
      parents: new Map(parents.map((parent, index) => [parent, index + 1])),
      cells: new Map(),
      cellCount: 343,
    };
    const plan = buildCompactBlockPlan('foot', credits);

    expect(plan.size).toBe(1);
    const work = plan.get(blockIdFor('foot', fine));
    expect(work?.blockParent).toBe(block);
    expect(work?.parentCredits.size).toBe(parents.length);
    expect(work?.fineCredits.size).toBe(0);
  });

  it('exact res12 override ugyanabba a blokk-workba kerül, a parent credit mellé', () => {
    const targetParent = parents[0]!;
    const targetFine = (cellToChildren(targetParent, GAMEPLAY.H3_RESOLUTION) as CellId[])[0]!;
    const credits: CompactClaimCredits = {
      parentResolution,
      parents: new Map([[targetParent, 1]]),
      cells: new Map([[targetFine, 3]]),
      cellCount: 49,
    };
    const plan = buildCompactBlockPlan('bike', credits);

    expect(plan.size).toBe(1);
    const work = plan.get(blockIdFor('bike', targetFine));
    expect(work?.parentCredits.get(targetParent)).toBe(1);
    expect(work?.fineCredits.get(targetFine)).toBe(3);
  });
});
