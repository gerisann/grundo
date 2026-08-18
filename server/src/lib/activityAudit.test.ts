import { describe, expect, it } from 'vitest';
import type { ProcessResult } from '../../../src/game';
import type { CellOwnership, ClaimResult, OwnershipMap } from '../../../src/types';
import { buildActivityAudit } from './activityAudit';

describe('buildActivityAudit', () => {
  it('összesíti a foglalást, gazdaváltást és védelmi szinteket', () => {
    const before: OwnershipMap = new Map([
      ['own', { owner: 'actor', defense: 2 }],
      ['max', { owner: 'actor', defense: 5 }],
      ['stolen', { owner: 'victim', defense: 1 }],
      ['weakened', { owner: 'victim', defense: 3 }],
    ]);
    const updates = new Map<string, CellOwnership>([
      ['free', { owner: 'actor', defense: 1 }],
      ['own', { owner: 'actor', defense: 3 }],
      ['max', { owner: 'actor', defense: 5 }],
      ['stolen', { owner: 'actor', defense: 1 }],
      ['weakened', { owner: 'victim', defense: 2 }],
    ]);
    const claim: ClaimResult = {
      updates,
      fates: new Map(),
      counts: { free: 1, reclaimed: 2, stolen: 1, breakthrough: 1 },
      stolenFrom: { victim: 1 },
      weightedClaimM2: 0,
      gainedM2: 0,
    };
    const result: ProcessResult = {
      layer: 'foot',
      cellPath: ['free'],
      loops: [{ wall: new Set(['free']), interior: new Set(), fromIndex: 0, toIndex: 5 }],
      claimedCells: new Set(updates.keys()),
      claim,
      loopClaims: [claim],
      gp: { base: 0, claim: 0, steal: 0, breakthrough: 0, streakMult: 1, softCapReduction: 0, total: 0 },
      areaGainedM2: 0,
      diagnostics: {
        droppedPoints: 2,
        largeGaps: 1,
        loops: {
          successful: [{ fromIndex: 0, toIndex: 5, wallCells: 1, interiorCells: 0, prunedCells: 3 }],
          rejected: [],
          shortRevisits: 4,
        },
      },
    };

    const audit = buildActivityAudit(result, before, 'actor', 12, true);

    expect(audit.claim).toMatchObject({
      affectedCells: 5,
      capturedFree: 1,
      stolen: 1,
      reinforced: 1,
      weakened: 1,
      unchangedAtMax: 1,
      ownershipChanges: 1,
    });
    expect(audit.claim.victims).toEqual([{ userId: 'victim', stolenCells: 1, weakenedCells: 1 }]);
    expect(audit.loops.prunedCells).toBe(3);
    expect(audit.gps).toEqual({ sourcePoints: 12, cellPath: 1, droppedPoints: 2, largeGaps: 1 });
  });
});
