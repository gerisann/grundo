import { GAMEPLAY } from '../../../src/config/gameplay';
import type { ProcessResult } from '../../../src/game';
import type { CellOwnership, OwnershipMap } from '../../../src/types';

export type AuditTransitionKind =
  | 'captured_free'
  | 'reinforced'
  | 'stolen'
  | 'weakened'
  | 'unchanged_max';

export interface AuditTransition {
  kind: AuditTransitionKind;
  fromLevel: number;
  toLevel: number;
  count: number;
}

export interface AuditVictim {
  userId: string;
  stolenCells: number;
  weakenedCells: number;
}

export interface AuditClaimSummary {
  affectedCells: number;
  capturedFree: number;
  stolen: number;
  reinforced: number;
  weakened: number;
  unchangedAtMax: number;
  ownershipChanges: number;
  areaGainedM2: number;
  transitions: AuditTransition[];
  victims: AuditVictim[];
}

export interface ActivityAuditData {
  version: 1;
  appliedToGameplay: boolean;
  claim: AuditClaimSummary;
  loops: {
    successful: Array<{
      index: number;
      fromIndex: number;
      toIndex: number;
      wallCells: number;
      interiorCells: number;
      totalCells: number;
      areaM2: number;
      prunedCells: number;
      claim: AuditClaimSummary;
    }>;
    rejected: ProcessResult['diagnostics']['loops']['rejected'];
    shortRevisits: number;
    prunedCells: number;
    orphanAbsorbedCells: number;
  };
  gps: {
    sourcePoints: number;
    cellPath: number;
    droppedPoints: number;
    largeGaps: number;
  };
}

/**
 * Az aktivitás tranzakcióban látott birtokállapotából készít tömör auditot.
 * Nem tárol cellaazonosítókat: az audit elemzésre való, a hiteles állapot a
 * gridben marad, így a dokumentum mérete hosszú útvonalnál is korlátos.
 */
export function buildActivityAudit(
  result: ProcessResult,
  before: OwnershipMap,
  actorId: string,
  sourcePoints: number,
  appliedToGameplay: boolean,
): ActivityAuditData {
  const finalClaim = summarize(result.claim?.updates ?? new Map(), before, actorId);
  const running: OwnershipMap = new Map(before);

  const successful = result.loops.map((loop, index) => {
    const loopClaim = result.loopClaims[index];
    const claim = summarize(loopClaim?.updates ?? new Map(), running, actorId);
    for (const [cell, ownership] of loopClaim?.updates ?? []) running.set(cell, ownership);
    const diagnostic = result.diagnostics.loops.successful[index];
    const totalCells = new Set([...loop.wall, ...loop.interior]).size;
    return {
      index: index + 1,
      fromIndex: loop.fromIndex,
      toIndex: loop.toIndex,
      wallCells: loop.wall.size,
      interiorCells: loop.interior.size,
      totalCells,
      areaM2: Math.round(totalCells * GAMEPLAY.CELL_AREA_M2),
      prunedCells: diagnostic?.prunedCells ?? 0,
      claim,
    };
  });

  return {
    version: 1,
    appliedToGameplay,
    claim: finalClaim,
    loops: {
      successful,
      rejected: result.diagnostics.loops.rejected,
      shortRevisits: result.diagnostics.loops.shortRevisits,
      prunedCells: result.diagnostics.loops.successful.reduce(
        (sum, loop) => sum + loop.prunedCells,
        result.diagnostics.loops.rejected.reduce((sum, loop) => sum + loop.prunedCells, 0),
      ),
      orphanAbsorbedCells: result.diagnostics.orphanAbsorbedCells,
    },
    gps: {
      sourcePoints,
      cellPath: result.cellPath.length,
      droppedPoints: result.diagnostics.droppedPoints,
      largeGaps: result.diagnostics.largeGaps,
    },
  };
}

function summarize(
  updates: ReadonlyMap<string, CellOwnership>,
  before: OwnershipMap,
  actorId: string,
): AuditClaimSummary {
  const counters = new Map<string, AuditTransition>();
  const victims = new Map<string, AuditVictim>();
  let capturedFree = 0;
  let stolen = 0;
  let reinforced = 0;
  let weakened = 0;
  let unchangedAtMax = 0;

  for (const [cell, after] of updates) {
    const previous = before.get(cell);
    let kind: AuditTransitionKind;
    let fromLevel = previous?.defense ?? 0;

    if (!previous) {
      kind = 'captured_free';
      capturedFree += 1;
    } else if (previous.owner !== after.owner) {
      kind = 'stolen';
      stolen += 1;
      addVictim(victims, previous.owner, true);
    } else if (previous.owner === actorId && after.defense > previous.defense) {
      kind = 'reinforced';
      reinforced += 1;
    } else if (previous.owner !== actorId && after.defense < previous.defense) {
      kind = 'weakened';
      weakened += 1;
      addVictim(victims, previous.owner, false);
    } else {
      kind = 'unchanged_max';
      unchangedAtMax += 1;
      fromLevel = after.defense;
    }

    const key = `${kind}:${fromLevel}:${after.defense}`;
    const existing = counters.get(key);
    if (existing) existing.count += 1;
    else counters.set(key, { kind, fromLevel, toLevel: after.defense, count: 1 });
  }

  return {
    affectedCells: updates.size,
    capturedFree,
    stolen,
    reinforced,
    weakened,
    unchangedAtMax,
    ownershipChanges: stolen,
    areaGainedM2: Math.round((capturedFree + stolen) * GAMEPLAY.CELL_AREA_M2),
    transitions: [...counters.values()].sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.fromLevel - b.fromLevel || a.toLevel - b.toLevel,
    ),
    victims: [...victims.values()].sort(
      (a, b) => b.stolenCells + b.weakenedCells - a.stolenCells - a.weakenedCells,
    ),
  };
}

function addVictim(victims: Map<string, AuditVictim>, userId: string, stolen: boolean) {
  const victim = victims.get(userId) ?? { userId, stolenCells: 0, weakenedCells: 0 };
  if (stolen) victim.stolenCells += 1;
  else victim.weakenedCells += 1;
  victims.set(userId, victim);
}
