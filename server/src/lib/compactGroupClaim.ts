import type { CellFate, CellId, Layer } from '../../../src/types';
import type { GridBlock } from './gridMath';
import {
  resolveCompactBlockClaim,
  type CompactBlockPart,
  type CompactBlockWork,
} from './compactBlockClaim';

export interface CompactGroupResult {
  nextBlocks: Map<string, GridBlock>;
  part: CompactBlockPart;
  /** Részleges/mixed blokkok exact stolen frontier seedjei. */
  stolenFineCells: CellId[];
  /** Teljes blokk bulk lopás — a cleanup csak a határon bontja majd finomra. */
  wholeStolenBlocks: string[];
}

/**
 * Egy chunked transaction csoport tiszta compact claim-feldolgozása.
 *
 * A csoport blokkjai függetlenül dönthetők el az aktuális blokk snapshotból;
 * az összesített GP/profil stat csak a `part` számait használja. Frontier
 * cleanup külön, a teljes claim UTÁNI snapshotból fut, ezért itt csak seedeket
 * gyűjtünk hozzá — nem indítunk lokális, csoportonként eltérő kaszkádot.
 */
export function resolveCompactGroup(
  layer: Layer,
  groupBlockIds: readonly string[],
  blocks: ReadonlyMap<string, GridBlock | null>,
  works: ReadonlyMap<string, CompactBlockWork>,
  actorId: string,
  today: number,
): CompactGroupResult {
  const nextBlocks = new Map<string, GridBlock>();
  let part = emptyPart();
  const stolenFineCells: CellId[] = [];
  const wholeStolenBlocks: string[] = [];

  for (const blockId of groupBlockIds) {
    const work = works.get(blockId);
    if (!work) continue;
    const result = resolveCompactBlockClaim(
      layer,
      blocks.get(blockId) ?? null,
      work,
      actorId,
      today,
    );
    part = mergePart(part, result.part);
    if (result.changed && result.nextBlock) nextBlocks.set(blockId, result.nextBlock);
    stolenFineCells.push(...result.stolenFineCells);
    if (result.wholeBlockStolen) wholeStolenBlocks.push(blockId);
  }

  return { nextBlocks, part, stolenFineCells, wholeStolenBlocks };
}

function emptyPart(): CompactBlockPart {
  return {
    counts: { free: 0, reclaimed: 0, stolen: 0, breakthrough: 0 },
    stolenFrom: {},
    breakthroughFrom: {},
    weightedClaimM2: 0,
    gainedM2: 0,
    cells: 0,
  };
}

function mergePart(a: CompactBlockPart, b: CompactBlockPart): CompactBlockPart {
  const counts = { ...a.counts };
  for (const fate of ['free', 'reclaimed', 'stolen', 'breakthrough'] as CellFate[]) {
    counts[fate] += b.counts[fate];
  }
  const stolenFrom = { ...a.stolenFrom };
  for (const [owner, amount] of Object.entries(b.stolenFrom)) {
    stolenFrom[owner] = (stolenFrom[owner] ?? 0) + amount;
  }
  const breakthroughFrom = { ...a.breakthroughFrom };
  for (const [owner, amount] of Object.entries(b.breakthroughFrom)) {
    breakthroughFrom[owner] = (breakthroughFrom[owner] ?? 0) + amount;
  }
  return {
    counts,
    stolenFrom,
    breakthroughFrom,
    weightedClaimM2: a.weightedClaimM2 + b.weightedClaimM2,
    gainedM2: a.gainedM2 + b.gainedM2,
    cells: a.cells + b.cells,
  };
}
