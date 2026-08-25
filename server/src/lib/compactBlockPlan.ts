import { cellToParent } from 'h3-js';
import type { CompactClaimCredits } from '../../../src/game/compactClaim';
import type { CellId, Layer } from '../../../src/types';
import { BLOCK_RESOLUTION, blockIdFor } from './gridMath';
import type { CompactBlockWork } from './compactBlockClaim';

/**
 * A shared compact claim-crediteket a production tárolási határára (res9
 * Firestore blokk) csoportosítja.
 *
 * Nem bont res12 gyerekeket: egy res10 parent egyetlen res9 blokkhoz tartozik,
 * az exact res12 határsáv pedig szintén közvetlenül blokkba sorolható. A teljes
 * nagy interior reprezentációja így O(compact parent + boundary cell), nem
 * O(res12 terület).
 */
export function buildCompactBlockPlan(
  layer: Layer,
  credits: CompactClaimCredits,
): Map<string, CompactBlockWork> {
  const result = new Map<string, CompactBlockWork>();

  function ensure(blockId: string, blockParent: CellId): CompactBlockWork {
    const existing = result.get(blockId);
    if (existing) return existing;
    const created: CompactBlockWork = {
      blockParent,
      claimParentResolution: credits.parentResolution,
      parentCredits: new Map(),
      fineCredits: new Map(),
    };
    result.set(blockId, created);
    return created;
  }

  for (const [parent, count] of credits.parents) {
    const blockParent = cellToParent(parent, BLOCK_RESOLUTION) as CellId;
    const blockId = blockIdFor(layer, parent);
    (ensure(blockId, blockParent).parentCredits as Map<CellId, number>).set(parent, count);
  }

  for (const [cell, count] of credits.cells) {
    const blockParent = cellToParent(cell, BLOCK_RESOLUTION) as CellId;
    const blockId = blockIdFor(layer, cell);
    (ensure(blockId, blockParent).fineCredits as Map<CellId, number>).set(cell, count);
  }

  return result;
}
