import { getResolution, gridDisk } from 'h3-js';
import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import type {
  CellId,
  CellOwnership,
  ClaimResult,
  OwnershipMap,
} from '@/types';
import { multiplierFor } from './claim';

export interface FrontierOrphanSearchInput {
  /** Res12 cellák, amelyek környezetében a friss rablás frontierét vizsgáljuk. */
  stolenSeeds: Iterable<CellId>;
  /** A RABLÁS UTÁNI, de cleanup ELŐTTI snapshot ownership lekérdezése. */
  ownershipAt(cell: CellId): CellOwnership | undefined;
  /** Közvetlenül a claim által érintett cellát nem írjuk át cleanupként. */
  isDirectlyClaimed?(cell: CellId): boolean;
  /** Flat/backend worldnél csak teljesen beolvasott scope-ban döntünk. */
  scope?: ReadonlySet<CellId>;
  gameplayResolution?: number;
}

/**
 * Egyetlen snapshot-passban megkeresi a rablás után árván maradt frontier cellákat.
 *
 * Szabály:
 * - csak a friss stolen frontier 1-gyűrűjét vizsgáljuk;
 * - a közvetlen claim cellákat nem módosítjuk;
 * - ha a cellának >=2 azonos ownerű oldalszomszédja van, marad;
 * - ha <2, átkerül ahhoz az ownerhez, amelyik a legtöbb oldalával érintkezik;
 * - holtversenyben nincs változás;
 * - minden döntés ugyanabból a post-claim snapshotból készül, tehát NINCS
 *   láncreakciós újraértékelés (egy keskeny folyosót nem eszik vissza a pass).
 */
export function findStolenFrontierReassignments(
  input: FrontierOrphanSearchInput,
): Map<CellId, CellOwnership> {
  const resolution = input.gameplayResolution ?? DEFAULT_GAMEPLAY.H3_RESOLUTION;
  const candidates = new Set<CellId>();

  for (const seed of input.stolenSeeds) {
    if (getResolution(seed) !== resolution) continue;
    for (const cell of gridDisk(seed, 1)) candidates.add(cell);
  }

  const reassignments = new Map<CellId, CellOwnership>();

  for (const candidate of candidates) {
    if (getResolution(candidate) !== resolution) continue;
    if (input.isDirectlyClaimed?.(candidate)) continue;
    if (input.scope && !input.scope.has(candidate)) continue;

    const held = input.ownershipAt(candidate);
    if (!held) continue;

    const neighbours = gridDisk(candidate, 1).filter((cell) => cell !== candidate);
    if (input.scope && !neighbours.every((cell) => input.scope!.has(cell))) continue;

    const sideCounts = new Map<string, number>();
    let sameOwnerNeighbours = 0;

    for (const neighbour of neighbours) {
      const neighbourOwnership = input.ownershipAt(neighbour);
      if (!neighbourOwnership) continue;
      sideCounts.set(
        neighbourOwnership.owner,
        (sideCounts.get(neighbourOwnership.owner) ?? 0) + 1,
      );
      if (neighbourOwnership.owner === held.owner) sameOwnerNeighbours += 1;
    }

    if (sameOwnerNeighbours >= 2) continue;

    let winner: string | null = null;
    let maxSides = 0;
    let tied = false;
    for (const [owner, sides] of sideCounts) {
      if (sides > maxSides) {
        winner = owner;
        maxSides = sides;
        tied = false;
      } else if (sides === maxSides && sides > 0) {
        tied = true;
      }
    }

    if (!winner || tied || winner === held.owner) continue;

    // A topológiai cleanup tulajdonosváltás: az új területhez 1× defense-szel
    // csatlakozik, ugyanúgy, mint egy normál lopásnál.
    reassignments.set(candidate, { owner: winner, defense: 1 });
  }

  return reassignments;
}

export interface FrontierCleanupResult {
  claim: ClaimResult | null;
  reassigned: Set<CellId>;
}

/**
 * Flat res12 ownershiphoz alkalmazza a frontier cleanupot a kész claimen.
 * Kizárólag tényleges lopás (`stolen`) után fut.
 */
export function cleanupStolenFrontierOrphans(
  claim: ClaimResult | null,
  before: OwnershipMap,
  actorId: string,
  scope: ReadonlySet<CellId>,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): FrontierCleanupResult {
  const reassigned = new Set<CellId>();
  if (!claim || claim.counts.stolen <= 0) return { claim, reassigned };

  const postClaim: OwnershipMap = new Map(before);
  for (const [cell, ownership] of claim.updates) postClaim.set(cell, ownership);

  const stolenSeeds = [...claim.fates]
    .filter(([, fate]) => fate === 'stolen')
    .map(([cell]) => cell)
    .filter((cell) => getResolution(cell) === cfg.H3_RESOLUTION);

  if (stolenSeeds.length === 0) return { claim, reassigned };

  const planned = findStolenFrontierReassignments({
    stolenSeeds,
    ownershipAt: (cell) => postClaim.get(cell),
    isDirectlyClaimed: (cell) => claim.updates.has(cell),
    scope,
    gameplayResolution: cfg.H3_RESOLUTION,
  });

  if (planned.size === 0) return { claim, reassigned };

  const updates = new Map(claim.updates);
  const fates = new Map(claim.fates);
  const counts = { ...claim.counts };
  const stolenFrom = { ...claim.stolenFrom };
  let weightedClaimM2 = claim.weightedClaimM2;
  let gainedM2 = claim.gainedM2;

  // FONTOS: `planned` már teljes egészében az eredeti post-claim snapshotból
  // készült. Csak most alkalmazzuk egyszerre, ezért nincs kaszkád.
  for (const [cell, next] of planned) {
    const previous = postClaim.get(cell);
    if (!previous || previous.owner === next.owner) continue;

    updates.set(cell, next);
    reassigned.add(cell);

    // Ha a domináns szomszédos terület az aktivitás szereplőjéé, ez a GPS-hiba
    // miatt kimaradt cella is a lopás része és ugyanúgy számít a végső gainbe.
    if (next.owner === actorId) {
      fates.set(cell, 'stolen');
      counts.stolen += 1;
      stolenFrom[previous.owner] = (stolenFrom[previous.owner] ?? 0) + 1;
      weightedClaimM2 += multiplierFor(1, cfg) * cfg.CELL_AREA_M2;
      gainedM2 += cfg.CELL_AREA_M2;
    }
    // Ha egy harmadik owner a domináns, a world korrekció megtörténik, de az
    // aktuális actor nem kap érte GP-t vagy stolen statot.
  }

  return {
    reassigned,
    claim: {
      ...claim,
      updates,
      fates,
      counts,
      stolenFrom,
      weightedClaimM2,
      gainedM2,
    },
  };
}
