import { describe, expect, it } from 'vitest';
import { cellToChildren, gridDisk, latLngToCell } from 'h3-js';
import type { CellId } from '../../../src/types';
import type { CompactBlockWork } from './compactBlockClaim';
import {
  materializeCompactFrontierSeeds,
  planCompactFrontier,
} from './compactFrontier';
import { blockIdFor } from './gridMath';

function fullWork(blockParent: CellId, credits = 1): CompactBlockWork {
  return {
    blockParent,
    claimParentResolution: 10,
    parentCredits: new Map(
      (cellToChildren(blockParent, 10) as CellId[]).map((parent) => [parent, credits]),
    ),
    fineCredits: new Map(),
  };
}

describe('compact frontier planner', () => {
  it('a teljesen körülvett bulk interior blokkot nem bontja res12 seedekre', () => {
    const center = latLngToCell(47.4979, 19.0402, 9) as CellId;
    const works = new Map<string, CompactBlockWork>();
    for (const parent of gridDisk(center, 1) as CellId[]) {
      works.set(`foot_${parent}`, fullWork(parent));
    }

    const plan = planCompactFrontier('foot', works, {
      fineCells: new Set(),
      wholeBlocks: new Set([`foot_${center}`]),
    });

    expect(plan.boundaryWholeBlocks).toEqual([]);
    expect(materializeCompactFrontierSeeds(works, plan).size).toBe(0);
  });

  it('a claim peremén lévő teljesen ellopott blokkot exact seedekre bontja', () => {
    const center = latLngToCell(47.4979, 19.0402, 9) as CellId;
    const works = new Map<string, CompactBlockWork>([
      [`foot_${center}`, fullWork(center)],
    ]);

    const plan = planCompactFrontier('foot', works, {
      fineCells: new Set(),
      wholeBlocks: new Set([`foot_${center}`]),
    });
    const seeds = materializeCompactFrontierSeeds(works, plan);

    expect(plan.boundaryWholeBlocks).toEqual([`foot_${center}`]);
    expect(seeds.size).toBe(cellToChildren(center, 12).length);
    expect(plan.readBlockIds).toContain(blockIdFor('foot', center));
    expect(plan.readBlockIds.length).toBeGreaterThan(1);
  });
});
