/**
 * A napi forduló DÖNTÉSEI — tiszta függvényen, Firestore nélkül.
 *
 * A forduló szabályai (fagyasztás, hétforduló, mérföldkő, lemaradás-behozás)
 * pontosan az a fajta logika, ahol a határesetek számítanak: az utolsó
 * fagyasztás, a vasárnapról hétfőre forduló hét, a másodszor elért mérföldkő.
 * Ezért van a `planRollover` külön, tiszta függvényként — emulátorral minden
 * ilyen esetet körbekeríteni kényelmetlen lenne, és a kényelmetlen tesztet
 * senki nem írja meg.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_GAMEPLAY } from '../../../src/config/gameplay';
import { planRollover, type RolloverUserState } from './dailyRollover';

const TZ = 'Europe/Budapest';
const cfg = DEFAULT_GAMEPLAY;

/** 2026-08-17 hétfő. */
const MONDAY = Math.floor(Date.UTC(2026, 7, 17) / 86_400_000);
const SUNDAY = MONDAY - 1;
const TUESDAY = MONDAY + 1;

/** Egy időpont az adott játéknap délelőttjén, budapesti idő szerint. */
function at(day: number): Date {
  return new Date(day * 86_400_000 + 10 * 3_600_000);
}

function user(overrides: Partial<RolloverUserState> = {}): RolloverUserState {
  return {
    timezone: TZ,
    gpTotal: 1000,
    territoryM2: { foot: 0, bike: 0 },
    streak: { current: 5, longest: 10, lastActiveDay: null, freezesLeftThisWeek: 1, weeks: 0 },
    rollover: { lastDay: TUESDAY },
    ...overrides,
  };
}

const plan = (state: RolloverUserState, now: Date, holdFactor = 1) =>
  planRollover(state, { now, cfg, holdFactor });

describe('planRollover — mikor csinál egyáltalán valamit', () => {
  it('az első találkozáskor CSAK bejegyez, nem ír jóvá', () => {
    const result = plan(user({ rollover: null, territoryM2: { foot: 5_000_000 } }), at(TUESDAY));

    expect(result.kind).toBe('seed');
    expect(result.gpDelta).toBe(0);
    expect(result.hold.total).toBe(0);
  });

  it('ugyanazon a napon másodszor futva nem csinál semmit', () => {
    const result = plan(user({ rollover: { lastDay: TUESDAY } }), at(TUESDAY));
    expect(result.kind).toBe('noop');
    expect(result.gpDelta).toBe(0);
  });

  it('lemaradásból EGY napot lép, és azonnal esedékes marad', () => {
    const now = at(TUESDAY + 3);
    const result = plan(user({ rollover: { lastDay: TUESDAY } }), now);

    expect(result.kind).toBe('advance');
    expect(result.closedDay).toBe(TUESDAY);
    expect(result.newDay).toBe(TUESDAY + 1);
    // Még le vagyunk maradva → a következő futás azonnal vigye tovább.
    expect(result.nextDueAt.getTime()).toBe(now.getTime());
  });

  it('naprakészen a következő helyi éjfélre időzít', () => {
    const now = at(TUESDAY + 1);
    const result = plan(user({ rollover: { lastDay: TUESDAY } }), now);
    expect(result.nextDueAt.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('planRollover — hold-bónusz', () => {
  it('a birtokolt terület után jár, rétegenként', () => {
    const result = plan(
      user({
        territoryM2: { foot: 500_000, bike: 250_000 },
        streak: { current: 3, longest: 3, lastActiveDay: TUESDAY, freezesLeftThisWeek: 1, weeks: 0 },
      }),
      at(TUESDAY + 1),
    );

    // 100 GP/km²: 0,5 km² → 50, 0,25 km² → 25
    expect(result.hold).toMatchObject({ foot: 50, bike: 25, total: 75 });
    expect(result.gpDelta).toBe(75);
  });

  it('a plafon RÉTEGENKÉNT külön érvényes', () => {
    const result = plan(
      user({
        territoryM2: { foot: 20_000_000, bike: 20_000_000 },
        streak: { current: 3, longest: 3, lastActiveDay: TUESDAY, freezesLeftThisWeek: 1, weeks: 0 },
      }),
      at(TUESDAY + 1),
    );

    expect(result.hold.foot).toBe(cfg.HOLD_GP_DAILY_CAP);
    expect(result.hold.bike).toBe(cfg.HOLD_GP_DAILY_CAP);
    expect(result.hold.total).toBe(cfg.HOLD_GP_DAILY_CAP * 2);
  });

  it('az inaktív birodalom nem termel', () => {
    const lastActive = TUESDAY - cfg.HOLD_REQUIRES_ACTIVE_DAYS - 1;
    const result = plan(
      user({
        territoryM2: { foot: 5_000_000 },
        streak: { current: 0, longest: 3, lastActiveDay: lastActive, freezesLeftThisWeek: 1, weeks: 0 },
      }),
      at(TUESDAY + 1),
    );

    expect(result.hold.total).toBe(0);
  });

  it('a határon még jár — a feltétel nem szigorúbb a konstansnál', () => {
    const lastActive = TUESDAY - cfg.HOLD_REQUIRES_ACTIVE_DAYS;
    const result = plan(
      user({
        territoryM2: { foot: 1_000_000 },
        streak: { current: 0, longest: 3, lastActiveDay: lastActive, freezesLeftThisWeek: 1, weeks: 0 },
      }),
      at(TUESDAY + 1),
    );

    expect(result.hold.foot).toBe(cfg.HOLD_GP_PER_KM2);
  });

  it('aki még sosem mozgott, nem kap tartás-bónuszt', () => {
    const result = plan(user({ territoryM2: { foot: 5_000_000 } }), at(TUESDAY + 1));
    expect(result.hold.total).toBe(0);
  });

  it('a hold-modifier a PLAFON ELŐTT hat', () => {
    const active = {
      current: 3,
      longest: 3,
      lastActiveDay: TUESDAY,
      freezesLeftThisWeek: 1,
      weeks: 0,
    };

    const doubled = plan(
      user({ territoryM2: { foot: 1_000_000 }, streak: active }),
      at(TUESDAY + 1),
      2,
    );
    expect(doubled.hold.foot).toBe(cfg.HOLD_GP_PER_KM2 * 2);

    // Aki már a plafonon ül, ott is a plafont kapja — nem többet.
    const capped = plan(
      user({ territoryM2: { foot: 20_000_000 }, streak: active }),
      at(TUESDAY + 1),
      2,
    );
    expect(capped.hold.foot).toBe(cfg.HOLD_GP_DAILY_CAP);
  });
});

describe('planRollover — sorozat', () => {
  it('aktív napon nem nyúl a sorozathoz, csak a heti számlálót lépteti', () => {
    const result = plan(
      user({
        streak: { current: 5, longest: 10, lastActiveDay: TUESDAY, freezesLeftThisWeek: 1, weeks: 0 },
      }),
      at(TUESDAY + 1),
    );

    expect(result.streak.current).toBe(5);
    expect(result.streak.weekActiveDays).toBe(1);
    expect(result.freezeUsed).toBe(false);
    expect(result.streakBroken).toBe(false);
  });

  it('kihagyott napot a fagyasztás elnyel — a sorozat megmarad', () => {
    const result = plan(
      user({
        streak: {
          current: 200,
          longest: 200,
          lastActiveDay: TUESDAY - 1,
          freezesLeftThisWeek: 1,
          weeks: 0,
        },
      }),
      at(TUESDAY + 1),
    );

    expect(result.freezeUsed).toBe(true);
    expect(result.streak.current).toBe(200);
    expect(result.streak.freezesLeftThisWeek).toBe(0);
    expect(result.streakBroken).toBe(false);
  });

  it('a fagyasztás a NAPI sorozatot védi, a hetit nem', () => {
    const result = plan(
      user({
        streak: {
          current: 200,
          longest: 200,
          lastActiveDay: TUESDAY - 1,
          freezesLeftThisWeek: 1,
          weeks: 0,
        },
      }),
      at(TUESDAY + 1),
    );

    // A kihagyott nap attól még kihagyott: a heti aktív napokba nem számít.
    expect(result.streak.weekActiveDays).toBe(0);
  });

  it('fagyasztás nélkül a sorozat megszakad', () => {
    const result = plan(
      user({
        streak: {
          current: 200,
          longest: 200,
          lastActiveDay: TUESDAY - 1,
          freezesLeftThisWeek: 0,
          weeks: 0,
        },
      }),
      at(TUESDAY + 1),
    );

    expect(result.streakBroken).toBe(true);
    expect(result.streak.current).toBe(0);
    // A csúcs a felhasználó teljesítménye, nem az aktuális állapota.
    expect(result.streak.longest).toBe(200);
  });

  it('a nulláról induló sorozatot nem „töri meg" újra', () => {
    const result = plan(
      user({
        streak: { current: 0, longest: 3, lastActiveDay: null, freezesLeftThisWeek: 0, weeks: 0 },
      }),
      at(TUESDAY + 1),
    );

    expect(result.streakBroken).toBe(false);
    expect(result.freezeUsed).toBe(false);
  });
});

describe('planRollover — hét- és hónapzárás', () => {
  it('vasárnapról hétfőre zárja a hetet és tölti újra a fagyasztást', () => {
    const result = plan(
      user({
        rollover: { lastDay: SUNDAY },
        streak: {
          current: 5,
          longest: 5,
          lastActiveDay: SUNDAY,
          freezesLeftThisWeek: 0,
          weeks: 2,
          weekActiveDays: 2, // + a mostani vasárnap = 3
        },
      }),
      at(MONDAY),
    );

    expect(result.weekClosed).toBe(true);
    expect(result.streak.weeks).toBe(3);
    expect(result.streak.weekActiveDays).toBe(0);
    expect(result.streak.freezesLeftThisWeek).toBe(cfg.STREAK_FREEZES_PER_WEEK);
  });

  it('három aktív nap alatt a heti sorozat nullázódik', () => {
    const result = plan(
      user({
        rollover: { lastDay: SUNDAY },
        streak: {
          current: 1,
          longest: 5,
          lastActiveDay: SUNDAY - 3,
          freezesLeftThisWeek: 1,
          weeks: 8,
          weekActiveDays: 1,
        },
      }),
      at(MONDAY),
    );

    expect(result.streak.weeks).toBe(0);
  });

  it('hét közben nem zár hetet', () => {
    const result = plan(user({ rollover: { lastDay: TUESDAY } }), at(TUESDAY + 1));
    expect(result.weekClosed).toBe(false);
  });

  it('a hónap első napján zárja a hónapot', () => {
    const aug31 = Math.floor(Date.UTC(2026, 7, 31) / 86_400_000);
    const result = plan(user({ rollover: { lastDay: aug31 } }), at(aug31 + 1));
    expect(result.monthClosed).toBe(true);
  });
});

describe('planRollover — heti mérföldkövek', () => {
  const fourWeeks = (milestonesAwarded: number[] = []) =>
    user({
      rollover: { lastDay: SUNDAY },
      streak: {
        current: 20,
        longest: 20,
        lastActiveDay: SUNDAY,
        freezesLeftThisWeek: 1,
        weeks: 3,
        weekActiveDays: 5,
        milestonesAwarded,
      },
    });

  it('a negyedik hétnél kiosztja a jutalmat', () => {
    const result = plan(fourWeeks(), at(MONDAY));

    expect(result.streak.weeks).toBe(4);
    expect(result.milestoneWeeks).toBe(4);
    expect(result.milestoneGp).toBe(cfg.WEEK_STREAK_MILESTONES[4]);
    expect(result.gpDelta).toBe(cfg.WEEK_STREAK_MILESTONES[4]);
  });

  it('ugyanazt a mérföldkövet MÁSODSZOR nem osztja ki', () => {
    const result = plan(fourWeeks([4]), at(MONDAY));

    expect(result.streak.weeks).toBe(4);
    expect(result.milestoneWeeks).toBeNull();
    expect(result.milestoneGp).toBe(0);
  });

  it('a nem mérföldkő heteknél nem ad semmit', () => {
    const result = plan(
      user({
        rollover: { lastDay: SUNDAY },
        streak: {
          current: 20,
          longest: 20,
          lastActiveDay: SUNDAY,
          freezesLeftThisWeek: 1,
          weeks: 4,
          weekActiveDays: 5,
          milestonesAwarded: [4],
        },
      }),
      at(MONDAY),
    );

    expect(result.streak.weeks).toBe(5);
    expect(result.milestoneWeeks).toBeNull();
  });
});

describe('planRollover — időzóna', () => {
  it('a felhasználó helyi napja szerint fordul', () => {
    // 2026-08-18 12:00 UTC: Aucklandben már 19-e, Budapesten még 18-a.
    const now = new Date('2026-08-18T12:00:00Z');
    const budapestDay = Math.floor(Date.UTC(2026, 7, 18) / 86_400_000);

    const hungarian = plan(
      user({ timezone: TZ, rollover: { lastDay: budapestDay } }),
      now,
    );
    const kiwi = plan(
      user({ timezone: 'Pacific/Auckland', rollover: { lastDay: budapestDay } }),
      now,
    );

    expect(hungarian.kind).toBe('noop');
    expect(kiwi.kind).toBe('advance');
  });

  it('hiányzó időzónánál a játékidőzónát használja', () => {
    const result = plan(user({ timezone: null }), at(TUESDAY + 1));
    expect(result.timezone).toBe('Europe/Budapest');
  });
});
