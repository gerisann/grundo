import { describe, expect, it } from 'vitest';
import { applyClaimCredits, finalClaimFate, resolveClaimCredits } from './claimCredits';

describe('claim credit transition', () => {
  it('gazdátlan cellán N credit azonnal N defense-et épít a plafonig', () => {
    expect(applyClaimCredits(undefined, 'A', 1)).toEqual({ owner: 'A', defense: 1 });
    expect(applyClaimCredits(undefined, 'A', 4)).toEqual({ owner: 'A', defense: 4 });
    expect(applyClaimCredits(undefined, 'A', 99)).toEqual({ owner: 'A', defense: 5 });
  });

  it('saját cellán a creditek a meglévő defense-re épülnek', () => {
    expect(applyClaimCredits({ owner: 'A', defense: 2 }, 'A', 2)).toEqual({ owner: 'A', defense: 4 });
    expect(applyClaimCredits({ owner: 'A', defense: 4 }, 'A', 20)).toEqual({ owner: 'A', defense: 5 });
  });

  it('rivális defense-et áttör, majd lop, a maradék hit már saját defense-et épít', () => {
    const before = { owner: 'B', defense: 5 } as const;
    expect(applyClaimCredits(before, 'A', 1)).toEqual({ owner: 'B', defense: 4 });
    expect(applyClaimCredits(before, 'A', 4)).toEqual({ owner: 'B', defense: 1 });
    expect(applyClaimCredits(before, 'A', 5)).toEqual({ owner: 'A', defense: 1 });
    expect(applyClaimCredits(before, 'A', 6)).toEqual({ owner: 'A', defense: 2 });
    expect(applyClaimCredits(before, 'A', 20)).toEqual({ owner: 'A', defense: 5 });
  });

  it('nulla credit nem hoz létre tulajdont', () => {
    expect(applyClaimCredits(undefined, 'A', 0)).toBeUndefined();
    expect(applyClaimCredits({ owner: 'B', defense: 3 }, 'A', 0)).toEqual({ owner: 'B', defense: 3 });
  });

  it('a végső fate az aktivitás előtti és utáni állapotból számol', () => {
    expect(finalClaimFate(undefined, { owner: 'A', defense: 3 }, 'A')).toBe('free');
    expect(finalClaimFate({ owner: 'A', defense: 1 }, { owner: 'A', defense: 4 }, 'A')).toBe('reclaimed');
    expect(finalClaimFate({ owner: 'B', defense: 5 }, { owner: 'A', defense: 2 }, 'A')).toBe('stolen');
    expect(finalClaimFate({ owner: 'B', defense: 5 }, { owner: 'B', defense: 2 }, 'A')).toBe('breakthrough');
  });

  it('a bulk transition ugyanazokat az aggregálható statokat adja, mint a claim szabály', () => {
    const stolen = resolveClaimCredits({ owner: 'B', defense: 5 }, 'A', 6);
    expect(stolen.after).toEqual({ owner: 'A', defense: 2 });
    expect(stolen.fate).toBe('stolen');
    expect(stolen.gainedCells).toBe(1);
    expect(stolen.stolenFrom).toBe('B');
    expect(stolen.breakthroughFrom).toBeNull();
    expect(stolen.weightedCells).toBeGreaterThan(1);

    const breakthrough = resolveClaimCredits({ owner: 'B', defense: 5 }, 'A', 2);
    expect(breakthrough.after).toEqual({ owner: 'B', defense: 3 });
    expect(breakthrough.fate).toBe('breakthrough');
    expect(breakthrough.gainedCells).toBe(0);
    expect(breakthrough.stolenFrom).toBeNull();
    expect(breakthrough.breakthroughFrom).toBe('B');
    expect(breakthrough.weightedCells).toBe(0);
  });
});
