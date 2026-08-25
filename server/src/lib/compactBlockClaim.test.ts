import { describe, expect, it } from 'vitest';
import { cellToChildren, cellToParent, latLngToCell } from 'h3-js';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { CellId } from '../../../src/types';
import { BLOCK_RESOLUTION, blockCellCount, cellKey, type GridBlock } from './gridMath';
import { resolveCompactBlockClaim, type CompactBlockWork } from './compactBlockClaim';

const fine = latLngToCell(47.475, 19.015, GAMEPLAY.H3_RESOLUTION) as CellId;
const blockParent = cellToParent(fine, BLOCK_RESOLUTION) as CellId;
const claimParentResolution = GAMEPLAY.H3_RESOLUTION - 2;
const claimParents = cellToChildren(blockParent, claimParentResolution) as CellId[];
const today = 20_000;

function wholeBlock(credits: number): CompactBlockWork {
  return {
    blockParent,
    claimParentResolution,
    parentCredits: new Map(claimParents.map((parent) => [parent, credits])),
    fineCredits: new Map(),
  };
}

function uniform(owner: string, defense: number): GridBlock {
  const count = blockCellCount(blockParent, GAMEPLAY.H3_RESOLUTION);
  return {
    layer: 'foot',
    parent: blockParent,
    cells: {},
    ownerCounts: { [owner]: count },
    version: 4,
    uniform: { o: owner, d: defense, u: today },
  };
}

describe('production compact block claim', () => {
  it('teljes szabad blokkot O(1)-ben uniform ownershippé alakít', () => {
    const result = resolveCompactBlockClaim('foot', null, wholeBlock(1), 'A', today);
    const count = blockCellCount(blockParent, GAMEPLAY.H3_RESOLUTION);

    expect(result.changed).toBe(true);
    expect(result.nextBlock?.uniform).toEqual({ o: 'A', d: 1, u: today });
    expect(result.nextBlock?.cells).toEqual({});
    expect(result.part.counts.free).toBe(count);
    expect(result.part.cells).toBe(count);
    expect(result.part.gainedM2).toBe(count * GAMEPLAY.CELL_AREA_M2);
  });

  it('teljes saját uniform blokkot több traversallal defense 5-ig erősít', () => {
    const result = resolveCompactBlockClaim('foot', uniform('A', 2), wholeBlock(3), 'A', today);
    const count = blockCellCount(blockParent, GAMEPLAY.H3_RESOLUTION);

    expect(result.nextBlock?.uniform?.o).toBe('A');
    expect(result.nextBlock?.uniform?.d).toBe(5);
    expect(result.part.counts.reclaimed).toBe(count);
    expect(result.part.cells).toBe(count);
  });

  it('rivális 5× uniform blokkot hat credittel ellop és saját 2×-re épít', () => {
    const result = resolveCompactBlockClaim('foot', uniform('B', 5), wholeBlock(6), 'A', today);
    const count = blockCellCount(blockParent, GAMEPLAY.H3_RESOLUTION);

    expect(result.nextBlock?.uniform).toEqual({ o: 'A', d: 2, u: today });
    expect(result.part.counts.stolen).toBe(count);
    expect(result.part.stolenFrom.B).toBe(count);
    expect(result.wholeBlockStolen).toBe(true);
  });

  it('ha nincs elég credit, a rivális marad és csak breakthrough történik', () => {
    const result = resolveCompactBlockClaim('foot', uniform('B', 5), wholeBlock(2), 'A', today);
    const count = blockCellCount(blockParent, GAMEPLAY.H3_RESOLUTION);

    expect(result.nextBlock?.uniform).toEqual({ o: 'B', d: 3, u: today });
    expect(result.part.counts.breakthrough).toBe(count);
    expect(result.part.breakthroughFrom.B).toBe(count);
    expect(result.part.gainedM2).toBe(0);
  });

  it('részleges res10 claim csak az adott 49 res12 cellát írja, nem az egész világot', () => {
    const targetParent = claimParents[0]!;
    const work: CompactBlockWork = {
      blockParent,
      claimParentResolution,
      parentCredits: new Map([[targetParent, 1]]),
      fineCredits: new Map(),
    };
    const result = resolveCompactBlockClaim('foot', null, work, 'A', today);
    const targetCells = cellToChildren(targetParent, GAMEPLAY.H3_RESOLUTION) as CellId[];

    expect(result.changed).toBe(true);
    expect(result.nextBlock?.uniform).toBeUndefined();
    expect(Object.keys(result.nextBlock?.cells ?? {})).toHaveLength(targetCells.length);
    expect(result.part.counts.free).toBe(targetCells.length);
    expect(result.part.cells).toBe(targetCells.length);
    for (const cell of targetCells) {
      expect(result.nextBlock?.cells[cellKey(cell)]?.o).toBe('A');
    }
  });

  it('exact finom credit felülírja ugyanabban a parentben a bulk creditet', () => {
    const targetParent = claimParents[0]!;
    const targetCell = (cellToChildren(targetParent, GAMEPLAY.H3_RESOLUTION) as CellId[])[0]!;
    const work: CompactBlockWork = {
      blockParent,
      claimParentResolution,
      parentCredits: new Map([[targetParent, 1]]),
      fineCredits: new Map([[targetCell, 3]]),
    };
    const result = resolveCompactBlockClaim('foot', null, work, 'A', today);

    expect(result.nextBlock?.cells[cellKey(targetCell)]?.d).toBe(3);
    expect(result.part.cells).toBe(
      (cellToChildren(targetParent, GAMEPLAY.H3_RESOLUTION) as CellId[]).length,
    );
  });

  it('napokkal ezelőtti stored defense az effective defense-ből indul', () => {
    const old = uniform('B', 5);
    old.uniform = { o: 'B', d: 5, u: today - 3 }; // ma effektíven 2×
    const result = resolveCompactBlockClaim('foot', old, wholeBlock(2), 'A', today);

    expect(result.nextBlock?.uniform).toEqual({ o: 'A', d: 1, u: today });
    expect(result.part.counts.stolen).toBe(blockCellCount(blockParent, GAMEPLAY.H3_RESOLUTION));
  });
});
