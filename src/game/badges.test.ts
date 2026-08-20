/**
 * Jelvény-kiértékelés — tiszta függvény, Firestore nélkül.
 *
 * docs/04-pontrendszer.md → Jelvények
 */

import { describe, expect, it } from 'vitest';
import { BADGES, BADGES_BY_ID, earnedBadgeIds, type BadgeContext } from './badges';
import { GAMEPLAY } from '@/config/gameplay';

const EMPTY: BadgeContext = {
  activitiesCount: 0,
  distanceKm: { run: 0, walk: 0, ride: 0 },
  territoryM2Total: 0,
  stealCount: 0,
  streakLongestDays: 0,
  weekMilestonesAwarded: [],
  accountAgeDays: 0,
};

describe('a katalógus önmagában konzisztens', () => {
  it('minden azonosító egyedi', () => {
    const ids = BADGES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a BADGES_BY_ID minden bejegyzést tartalmaz, ugyanazzal a kulccsal', () => {
    expect(BADGES_BY_ID.size).toBe(BADGES.length);
    for (const entry of BADGES) {
      expect(BADGES_BY_ID.get(entry.id)).toEqual(entry);
    }
  });

  it('minden jutalom pozitív egész', () => {
    for (const entry of BADGES) {
      expect(entry.rewardGp).toBeGreaterThan(0);
      expect(Number.isInteger(entry.rewardGp)).toBe(true);
    }
  });
});

describe('earnedBadgeIds — üres állapot', () => {
  it('friss fióknál semmi nem jár', () => {
    expect(earnedBadgeIds(EMPTY)).toEqual([]);
  });
});

describe('earnedBadgeIds — első lépések', () => {
  it('az első aktivitás magától nem ad se kört, se lopást', () => {
    const ids = earnedBadgeIds({ ...EMPTY, activitiesCount: 1 });
    expect(ids).toContain('first_activity');
    expect(ids).not.toContain('first_loop');
    expect(ids).not.toContain('first_steal');
  });

  it('a bezárt kör CSAK a birtokolt területből derül ki, nem az aktivitásszámból', () => {
    // Elméletileg soha nem fordulhat elő aktivitás nélkül birtoklás, de a
    // függvénynek CSAK a ctx-re szabad támaszkodnia — ez a teszt ezt zárja ki.
    const ids = earnedBadgeIds({ ...EMPTY, territoryM2Total: 1 });
    expect(ids).toContain('first_loop');
  });

  it('a lopás a `stealCount`-ból, nem a `justStole`-szerű jelzőből', () => {
    const ids = earnedBadgeIds({ ...EMPTY, stealCount: 1 });
    expect(ids).toContain('first_steal');
  });
});

describe('earnedBadgeIds — távolság-létra, rétegenként', () => {
  it('a gyalogos táv a futás ÉS a séta összege', () => {
    const ids = earnedBadgeIds({ ...EMPTY, distanceKm: { run: 6, walk: 5, ride: 0 } });
    expect(ids).toContain(`distance_foot_${GAMEPLAY.DISTANCE_BADGE_LADDER_KM[0]}`);
  });

  it('a bringás táv NEM keveredik a gyalogossal', () => {
    const ids = earnedBadgeIds({ ...EMPTY, distanceKm: { run: 0, walk: 0, ride: 12 } });
    expect(ids).toContain(`distance_bike_${GAMEPLAY.DISTANCE_BADGE_LADDER_KM[0]}`);
    expect(ids.some((id) => id.startsWith('distance_foot_'))).toBe(false);
  });

  it('egyetlen nagy ugrás EGYSZERRE több fokozatot is megad', () => {
    const bigKm = GAMEPLAY.DISTANCE_BADGE_LADDER_KM[3]!;
    const ids = earnedBadgeIds({ ...EMPTY, distanceKm: { run: bigKm, walk: 0, ride: 0 } });
    const footBadges = ids.filter((id) => id.startsWith('distance_foot_'));
    expect(footBadges).toHaveLength(4);
  });
});

describe('earnedBadgeIds — terület, hódító, kitartás, hűség', () => {
  it('a terület-küszöb a KÉT réteg összegéből számol', () => {
    const ids = earnedBadgeIds({ ...EMPTY, territoryM2Total: 100_000 });
    expect(ids).toContain('territory_100000');
    expect(ids).not.toContain('territory_500000');
  });

  it('a hódító-létra a stealCount-ot lépcsőzi', () => {
    const ids = earnedBadgeIds({ ...EMPTY, stealCount: 55 });
    expect(ids).toContain('conqueror_10');
    expect(ids).toContain('conqueror_50');
    expect(ids).not.toContain('conqueror_100');
  });

  it('a napi sorozat a LEGHOSSZABBAT nézi, nem a jelenlegit', () => {
    // streakLongestDays sosem csökken a valóságban — a függvénynek ebből kell
    // dolgoznia, hogy egy megszakadt sorozat ne vegye el a már elért jelvényt.
    const ids = earnedBadgeIds({ ...EMPTY, streakLongestDays: 30 });
    expect(ids).toContain('streak_7');
    expect(ids).toContain('streak_30');
    expect(ids).not.toContain('streak_100');
  });

  it('a heti sorozat a mérföldkő-listát ellenőrzi, nem a jelenlegi hetet', () => {
    const ids = earnedBadgeIds({ ...EMPTY, weekMilestonesAwarded: [4, 12] });
    expect(ids).toContain('week_streak_4');
    expect(ids).toContain('week_streak_12');
    expect(ids).not.toContain('week_streak_26');
  });

  it('a hűség a fiók korából számol', () => {
    const ids = earnedBadgeIds({ ...EMPTY, accountAgeDays: 200 });
    expect(ids).toContain('loyalty_30');
    expect(ids).toContain('loyalty_182');
    expect(ids).not.toContain('loyalty_365');
  });
});

describe('earnedBadgeIds — idempotens és determinisztikus', () => {
  it('ugyanaz a ctx mindig ugyanazt az eredményt adja', () => {
    const ctx: BadgeContext = {
      activitiesCount: 12,
      distanceKm: { run: 40, walk: 5, ride: 120 },
      territoryM2Total: 620_000,
      stealCount: 14,
      streakLongestDays: 40,
      weekMilestonesAwarded: [4],
      accountAgeDays: 400,
    };
    expect(earnedBadgeIds(ctx)).toEqual(earnedBadgeIds(ctx));
  });

  it('minden visszaadott azonosító létezik a katalógusban', () => {
    const ctx: BadgeContext = {
      activitiesCount: 999,
      distanceKm: { run: 30000, walk: 0, ride: 30000 },
      territoryM2Total: 60_000_000,
      stealCount: 1000,
      streakLongestDays: 400,
      weekMilestonesAwarded: [4, 12, 26, 52],
      accountAgeDays: 800,
    };
    for (const id of earnedBadgeIds(ctx)) {
      expect(BADGES_BY_ID.has(id)).toBe(true);
    }
  });
});
