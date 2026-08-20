/**
 * A pontrendszer tesztjei.
 * A számpéldák forrása: docs/04-pontrendszer.md — ha a doksi változik,
 * ezeknek a teszteknek is változniuk kell (és fordítva).
 */

import { describe, expect, it } from 'vitest';
import { GAMEPLAY } from '@/config/gameplay';
import { computeActivityGp, streakMultiplier, applySoftCap, computeHoldBonus } from './scoring';
import { multiplierFor } from './claim';
import type { CellFate, ClaimResult } from '@/types';

/** Segéd: ClaimResult összeállítása cellaszámokból. */
function claimOf(parts: {
  freeCells?: number;
  reclaimedCells?: number;
  reclaimedDefense?: number;
  stolenCells?: number;
  breakthroughCells?: number;
}): ClaimResult {
  const A = GAMEPLAY.CELL_AREA_M2;
  const free = parts.freeCells ?? 0;
  const reclaimed = parts.reclaimedCells ?? 0;
  const stolen = parts.stolenCells ?? 0;
  const broken = parts.breakthroughCells ?? 0;
  const reclaimMult = multiplierFor(parts.reclaimedDefense ?? 2);

  const counts: Record<CellFate, number> = {
    free, reclaimed, stolen, breakthrough: broken,
  };

  return {
    updates: new Map(),
    fates: new Map(),
    counts,
    stolenFrom: {},
    breakthroughFrom: {},
    weightedClaimM2: (free * 1 + reclaimed * reclaimMult + stolen * 1) * A,
    gainedM2: (free + stolen) * A,
  };
}

/** m²-ből cellaszám, hogy a doksi példáit pontosan reprodukáljuk. */
const cells = (m2: number) => m2 / GAMEPLAY.CELL_AREA_M2;

describe('A) példa — területet foglaló futás', () => {
  it('6,83 km, 840 000 m² (500k szabad, 200k saját 2×, 140k lopott), 8. napos sorozat → 272 GP', () => {
    const gp = computeActivityGp({
      type: 'run',
      distanceKm: 6.83,
      claim: claimOf({
        freeCells: cells(500_000),
        reclaimedCells: cells(200_000),
        reclaimedDefense: 2,
        stolenCells: cells(140_000),
      }),
      streakDays: 8,
      gpEarnedToday: 0,
    });

    /**
     * A számok 2026-08-17-én változtak: az igénypont a terület GYÖKÉVEL nő,
     * nem magával a területtel.
     *
     * Korábban 940 GP volt (500 + 300 + 140, azaz 1 GP / 1000 m²), és emiatt
     * a geometria uralta a játékot: egy nagyobb kör négyszer akkora területet
     * zár be, mint a feleakkora, holott csak kétszer annyit kell menni érte.
     *
     * Most: 840 000 m² foglalt terület → √0,84 km² × 120 = 110 pont, ezt
     * szorozza az átlagos védelmi szint (940/840 = 1,119) → 123,1.
     */
    expect(gp.base).toBeCloseTo(68.3, 1);
    expect(gp.claim).toBeCloseTo(123.1, 1);
    expect(gp.steal).toBeCloseTo(10.3, 1);
    expect(gp.streakMult).toBe(1.35);
    expect(gp.total).toBe(272);
  });
});

describe('B) példa — kör nélküli séta', () => {
  it('5,2 km séta, 3. napos sorozat → 57 GP', () => {
    const gp = computeActivityGp({
      type: 'walk',
      distanceKm: 5.2,
      claim: null,
      streakDays: 3,
      gpEarnedToday: 0,
    });
    expect(gp.total).toBe(57);   // 52 × 1,10
  });
});

describe('sorozat-szorzó', () => {
  it('az 1. napon 1,0, a 11. naptól a plafon', () => {
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(3)).toBe(1.1);
    expect(streakMultiplier(7)).toBe(1.3);
    expect(streakMultiplier(11)).toBe(GAMEPLAY.DAILY_STREAK_MAX);
    expect(streakMultiplier(400)).toBe(GAMEPLAY.DAILY_STREAK_MAX);
  });
});

describe('lágy plafon', () => {
  it('a plafon alatt teljes értéken számol', () => {
    expect(applySoftCap(1000, 0).granted).toBe(1000);
  });

  it('a plafon fölötti rész fele értéken számít', () => {
    const { granted } = applySoftCap(2000, 4000); // 1000 fér bele, 1000 megy felezve
    expect(granted).toBe(1500);
  });

  it('a plafon fölött indulva minden felezve megy', () => {
    expect(applySoftCap(1000, 6000).granted).toBe(500);
  });
});

describe('napi tartás-bónusz', () => {
  it('3 100 000 m² → 310 GP', () => {
    expect(computeHoldBonus(3_100_000, 1)).toBe(310);
  });

  it('a plafon 1 000 GP', () => {
    expect(computeHoldBonus(50_000_000, 1)).toBe(GAMEPLAY.HOLD_GP_DAILY_CAP);
  });

  it('az inaktív birodalom nem termel', () => {
    expect(computeHoldBonus(3_100_000, 30)).toBe(0);
  });
});

describe('védelmi szorzó', () => {
  it('a doksi táblája szerint', () => {
    expect(multiplierFor(1)).toBe(1.0);
    expect(multiplierFor(2)).toBe(1.5);
    expect(multiplierFor(3)).toBe(2.0);
    expect(multiplierFor(4)).toBe(3.0);
    expect(multiplierFor(5)).toBe(5.0);
    expect(multiplierFor(9)).toBe(5.0); // a maximumon ragad
  });
});

describe('C) példa — körbe-körbe futás', () => {
  it('ugyanaz a 300 000 m²-es kör négyszer — a védelmi szorzó teljes súllyal jár', () => {
    // Minden kör külön bezárásként detektálódik, egyre magasabb védelemmel.
    const perLap = [1, 2, 3, 4].map((defense) =>
      computeActivityGp({
        type: 'run',
        distanceKm: 0,
        claim: claimOf(
          defense === 1
            ? { freeCells: cells(300_000) }
            : { reclaimedCells: cells(300_000), reclaimedDefense: defense },
        ),
        streakDays: 1,
        gpEarnedToday: 0,
      }).total,
    );
    /**
     * A LÉNYEG, ami nem változott: a védelmi szorzó teljes súllyal érvényesül.
     *
     * A terület gyökösen számít, de a védelem NEM a gyök alatt van — ha ott
     * lenne, a négyszer megfutott kör csak 1,7× pontot érne 3× helyett, és a
     * körbe-körbe futás elveszítené az értelmét.
     *
     * 300 000 m² → √0,3 km² × 120 = 65,7 alappont, ezt szorozza a szint:
     */
    expect(perLap).toEqual([66, 99, 131, 197]);
    expect(perLap[3]! / perLap[0]!).toBeCloseTo(3, 1);

    const base = computeActivityGp({
      type: 'run', distanceKm: 8, claim: null, streakDays: 1, gpEarnedToday: 0,
    }).total;
    expect(base).toBe(80);
  });
});

