/**
 * A napi forduló VALÓDI Firestore ellen.
 *
 * A tervező döntéseit a `dailyRollover.test.ts` fedi. Itt az van bizonyítva,
 * ami csak igazi adatbázison látszik: hogy a jóváírás pontosan egyszer
 * történik, hogy a főkönyv és a profil együtt mozdul, és hogy a forduló
 * TÉNYLEG NEM NYÚL A RÁCSHOZ.
 *
 * FUTTATÁS (a repo gyökeréből, egyetlen parancs):
 *
 *   firebase.cmd emulators:exec --only firestore --project demo-grundo "npx vitest run server/src/jobs/dailyRollover.emulator.test.ts"
 *
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD, tehát a sima `npm test` nem törik el.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GAMEPLAY } from '../../../src/config/gameplay';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

/** 2026-08-17 hétfő. */
const MONDAY = Math.floor(Date.UTC(2026, 7, 17) / 86_400_000);
const SUNDAY = MONDAY - 1;
const TUESDAY = MONDAY + 1;

/** Délelőtt 12:00 budapesti idő szerint az adott játéknapon. */
const at = (day: number) => new Date(day * 86_400_000 + 10 * 3_600_000);

describe.skipIf(!EMULATOR)('runDailyRollover — valódi Firestore ellen', () => {
  let db: FirebaseFirestore.Firestore;
  let collections: Record<string, string>;
  let runDailyRollover: (now: Date, options?: { limit?: number }) => Promise<Record<string, number>>;

  beforeEach(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;
    collections = firebase.COLLECTIONS as unknown as Record<string, string>;

    const job = await import('./dailyRollover');
    runDailyRollover = job.runDailyRollover;

    const { resetGameplayCache } = await import('../lib/gameplayConfig');
    const { resetModifierCache } = await import('../lib/modifiers');
    resetGameplayCache();
    resetModifierCache();

    for (const name of ['users', 'gpLedger', 'grid', 'modifiers', 'appConfig', 'rolloverRuns']) {
      const snap = await db.collection(collections[name]!).get();
      await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
    }
  });

  async function seedUser(
    uid: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    await db
      .collection(collections.users!)
      .doc(uid)
      .set({
        username: uid,
        timezone: 'Europe/Budapest',
        gpTotal: 1000,
        gpWeek: 400,
        gpMonth: 900,
        level: 2,
        territoryM2: { foot: 1_000_000, bike: 0 },
        streak: {
          current: 3,
          longest: 3,
          lastActiveDay: TUESDAY,
          freezesLeftThisWeek: 1,
          weeks: 0,
          weekActiveDays: 0,
          milestonesAwarded: [],
        },
        rollover: { lastDay: TUESDAY, nextDueAt: at(TUESDAY + 1) },
        ...overrides,
      });
  }

  const readUser = async (uid: string) =>
    (await db.collection(collections.users!).doc(uid).get()).data() as Record<string, any>;

  it('kiosztja a tartás-bónuszt, és bevezeti a főkönyvbe', async () => {
    await seedUser('alice');

    const summary = await runDailyRollover(at(TUESDAY + 1));
    expect(summary.usersProcessed).toBe(1);
    expect(summary.holdGpAwarded).toBe(GAMEPLAY.HOLD_GP_PER_KM2); // 1 km² → 100 GP

    const user = await readUser('alice');
    expect(user.gpTotal).toBe(1000 + GAMEPLAY.HOLD_GP_PER_KM2);
    expect(user.rollover.lastDay).toBe(TUESDAY + 1);

    const ledger = await db
      .collection(collections.gpLedger!)
      .doc(`hold_alice_${TUESDAY}`)
      .get();
    expect(ledger.exists).toBe(true);
    expect(ledger.data()).toMatchObject({
      userId: 'alice',
      source: 'hold',
      amount: GAMEPLAY.HOLD_GP_PER_KM2,
    });
  });

  it('kétszer futtatva NEM ír jóvá kétszer', async () => {
    await seedUser('bob');

    await runDailyRollover(at(TUESDAY + 1));
    const afterFirst = await readUser('bob');

    await runDailyRollover(at(TUESDAY + 1));
    const afterSecond = await readUser('bob');

    expect(afterSecond.gpTotal).toBe(afterFirst.gpTotal);

    const entries = await db
      .collection(collections.gpLedger!)
      .where('userId', '==', 'bob')
      .get();
    expect(entries.size).toBe(1);
  });

  /**
   * REGRESSZIÓ-ŐRSZEM a 2026-08-19-i spec-tisztázáshoz.
   *
   * A `docs/03` korábbi szövege felsorolt egy „védelem visszaállítása" lépést a
   * fordulóban. Ez ellentmondott az olvasáskori elévülésnek. Ha valaki egyszer
   * mégis megírja azt a lépést, itt bukik el — nem élesben, hetekkel később.
   */
  it('NEM nyúl a rácshoz', async () => {
    await seedUser('carol');
    await db
      .collection(collections.grid!)
      .doc('foot_teszt')
      .set({ layer: 'foot', cells: { abc: { o: 'carol', d: 5, u: SUNDAY } } });

    await runDailyRollover(at(TUESDAY + 1));

    const block = await db.collection(collections.grid!).doc('foot_teszt').get();
    expect(block.data()).toEqual({ layer: 'foot', cells: { abc: { o: 'carol', d: 5, u: SUNDAY } } });
  });

  it('hétfőn nullázza a heti GP-t, és az új napi jóváírást már az új hétre könyveli', async () => {
    await seedUser('dora', {
      gpWeek: 4000,
      streak: {
        current: 5,
        longest: 5,
        lastActiveDay: SUNDAY,
        freezesLeftThisWeek: 0,
        weeks: 0,
        weekActiveDays: 2,
        milestonesAwarded: [],
      },
      rollover: { lastDay: SUNDAY, nextDueAt: at(MONDAY) },
    });

    await runDailyRollover(at(MONDAY));

    const user = await readUser('dora');
    expect(user.gpWeek).toBe(GAMEPLAY.HOLD_GP_PER_KM2);
    expect(user.streak.weeks).toBe(1); // 2 + a vasárnapi aktív nap = 3
    expect(user.streak.freezesLeftThisWeek).toBe(GAMEPLAY.STREAK_FREEZES_PER_WEEK);
  });

  it('akinek még nem járt le a napja, azt nem bántja', async () => {
    await seedUser('emil', { rollover: { lastDay: TUESDAY, nextDueAt: at(TUESDAY + 5) } });

    const summary = await runDailyRollover(at(TUESDAY + 1));
    expect(summary.usersProcessed).toBe(0);

    const user = await readUser('emil');
    expect(user.gpTotal).toBe(1000);
  });

  it('a globális hold-modifier felszorozza a bónuszt', async () => {
    await seedUser('fanni');
    await db.collection(collections.modifiers!).doc('dupla').set({
      kind: 'hold_multiplier',
      scope: 'global',
      value: 2,
      from: at(TUESDAY),
      to: at(TUESDAY + 5),
      reason: 'Teszt hétvége',
      source: 'manual',
    });

    const summary = await runDailyRollover(at(TUESDAY + 1));
    expect(summary.holdGpAwarded).toBe(GAMEPLAY.HOLD_GP_PER_KM2 * 2);

    const ledger = await db
      .collection(collections.gpLedger!)
      .doc(`hold_fanni_${TUESDAY}`)
      .get();
    expect(ledger.data()?.multiplier).toBe(2);
  });

  it('az appConfig felülírása azonnal érvényesül a jóváíráson', async () => {
    await seedUser('gabor');
    await db
      .collection(collections.appConfig!)
      .doc('gameplay')
      .set({ version: 7, overrides: { HOLD_GP_PER_KM2: 250 } });

    const { resetGameplayCache } = await import('../lib/gameplayConfig');
    resetGameplayCache();

    const summary = await runDailyRollover(at(TUESDAY + 1));
    expect(summary.holdGpAwarded).toBe(250);
    expect(summary.configVersion).toBe(7);

    const ledger = await db
      .collection(collections.gpLedger!)
      .doc(`hold_gabor_${TUESDAY}`)
      .get();
    expect(ledger.data()?.configVersion).toBe(7);
  });

  it('naplózza a futást', async () => {
    await seedUser('hanna');
    await runDailyRollover(at(TUESDAY + 1));

    const runs = await db.collection(collections.rolloverRuns!).get();
    expect(runs.size).toBe(1);
    expect(runs.docs[0]?.data()).toMatchObject({ usersProcessed: 1 });
  });
});
