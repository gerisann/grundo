import { DEFAULT_GAMEPLAY, type GameplayConfig } from '@/config/gameplay';
import type { CellFate, CellOwnership } from '@/types';
import { multiplierFor } from './claim';

/**
 * Egy cellára ugyanazon aktivitás alatt érkező N jogos claim-credit
 * végállapotának összefoglalása.
 *
 * A credit nem defense: nincs 5-nél levágva. Például egy rivális 5× cellára
 * 6 hit = négy áttörés + lopás + egy saját megerősítés, vagyis a végállapot
 * saját 2×. A publikus claim-statisztika azonban a `mergeClaims` szabályával
 * összhangban CELLÁNKÉNT EGYSZER, az aktivitás előtti és végső állapotból
 * számol — ezért a végső fate ebben a példában `stolen`.
 */
export interface ClaimCreditTransition {
  after: CellOwnership | undefined;
  fate: CellFate | null;
  /** GP-súlyozáshoz használt res12-egyenértékű cellaszorzó. */
  weightedCells: number;
  /** Nettó újonnan megszerzett res12-egyenértékű cellák száma: 0 vagy 1. */
  gainedCells: number;
  /** Rivális, akitől a cella végül átkerült hozzánk. */
  stolenFrom: string | null;
  /** Rivális, akinek a cellája végül nála maradt, de gyengült. */
  breakthroughFrom: string | null;
}

/**
 * N azonos claim-jóváírás hatása egyetlen cellára, iteráció nélkül.
 *
 * Nulla creditnél a bemeneti állapot változatlan; gazdátlan cellából nem
 * keletkezhet tulajdon. A defense felső korlátja kizárólag a végállapotra
 * vonatkozik, a credit száma tetszőlegesen nagy lehet.
 */
export function applyClaimCredits(
  before: CellOwnership | undefined,
  actorId: string,
  credits: number,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): CellOwnership | undefined {
  const hits = Math.max(0, Math.trunc(credits));
  if (hits === 0) return before;

  if (before === undefined) {
    return { owner: actorId, defense: Math.min(hits, cfg.MAX_DEFENSE) };
  }

  if (before.owner === actorId) {
    return {
      owner: actorId,
      defense: Math.min(before.defense + hits, cfg.MAX_DEFENSE),
    };
  }

  if (hits < before.defense) {
    return { owner: before.owner, defense: before.defense - hits };
  }

  // `before.defense` hit kell a lopásig: d-1 áttörés, majd lopás 1×-re.
  // Az ezen felüli hitek már az új tulajdonos defense-ét építik.
  return {
    owner: actorId,
    defense: Math.min(1 + (hits - before.defense), cfg.MAX_DEFENSE),
  };
}

/** A végső fate ugyanaz a definíció, amit `mergeClaims()` használ. */
export function finalClaimFate(
  before: CellOwnership | undefined,
  after: CellOwnership,
  actorId: string,
): CellFate {
  if (after.owner !== actorId) return 'breakthrough';
  if (before === undefined) return 'free';
  if (before.owner === actorId) return 'reclaimed';
  return 'stolen';
}

/**
 * Egy cella teljes végső claim-könyvelése. Bulk parent/blokk feldolgozásnál a
 * hívó ezt az eredményt egyszerűen megszorozhatja az azonos állapotú res12
 * cellák számával — nincs szükség a gyerekindexek materializálására.
 */
export function resolveClaimCredits(
  before: CellOwnership | undefined,
  actorId: string,
  credits: number,
  cfg: GameplayConfig = DEFAULT_GAMEPLAY,
): ClaimCreditTransition {
  const after = applyClaimCredits(before, actorId, credits, cfg);
  if (after === undefined) {
    return {
      after: undefined,
      fate: null,
      weightedCells: 0,
      gainedCells: 0,
      stolenFrom: null,
      breakthroughFrom: null,
    };
  }

  const fate = finalClaimFate(before, after, actorId);
  return {
    after,
    fate,
    weightedCells: fate === 'breakthrough' ? 0 : multiplierFor(after.defense, cfg),
    gainedCells: fate === 'free' || fate === 'stolen' ? 1 : 0,
    stolenFrom: fate === 'stolen' && before ? before.owner : null,
    breakthroughFrom: fate === 'breakthrough' && before ? before.owner : null,
  };
}
