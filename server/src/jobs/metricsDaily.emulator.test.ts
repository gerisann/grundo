/**
 * A napi aggregátum (`metricsDaily`) VALÓDI Firestore ellen.
 *
 * Amit itt bizonyítani kell: a `createdAt`-alapú tartományhatárok tényleg a
 * megadott naphoz tartoznak (nem csúsznak el egy időzóna-eltolással), a
 * `streak.lastActiveDay`-alapú DAU/WAU/MAU a helyes küszöbön vág, és az
 * írás determinisztikus dokumentumnévvel idempotens.
 *
 * FUTTATÁS (a repo gyökeréből, egyetlen parancs):
 *
 *   npm.cmd run test:emulator
 *
 * Egyetlen fájl futtatása:
 *
 *   firebase.cmd emulators:exec --only firestore --project demo-grundo "npx vitest run server/src/jobs/metricsDaily.emulator.test.ts"
 *
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD, tehát a sima `npm test` nem törik el.
 */

import { beforeEach, describe, expect, it } from 'vitest';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

/** 2026-08-17 hétfő — nyári időszámítás, Budapest = UTC+2, nincs óraátállítási él. */
const MONDAY = Math.floor(Date.UTC(2026, 7, 17) / 86_400_000);

describe.skipIf(!EMULATOR)('metricsDaily — valódi Firestore ellen', () => {
  let db: FirebaseFirestore.Firestore;
  let collections: Record<string, string>;
  let Timestamp: typeof FirebaseFirestore.Timestamp;
  let computeMetricsDaily: (day: number) => Promise<Record<string, number>>;
  let writeMetricsDaily: (summary: Record<string, unknown>) => Promise<void>;
  let maybeRunMetricsDaily: (now: Date) => Promise<Record<string, number> | null>;
  let localDayWindow: (day: number, tz: string) => { start: Date; end: Date };

  beforeEach(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;
    collections = firebase.COLLECTIONS as unknown as Record<string, string>;

    const firestore = await import('firebase-admin/firestore');
    Timestamp = firestore.Timestamp;

    const gridMath = await import('../lib/gridMath');
    localDayWindow = gridMath.localDayWindow;

    const job = await import('./metricsDaily');
    computeMetricsDaily = job.computeMetricsDaily;
    writeMetricsDaily = job.writeMetricsDaily;
    maybeRunMetricsDaily = job.maybeRunMetricsDaily;

    for (const name of ['users', 'activities', 'metricsDaily']) {
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
        createdAt: Timestamp.fromDate(new Date(MONDAY * 86_400_000 - 100 * 86_400_000)),
        streak: { current: 0, longest: 0, lastActiveDay: null },
        ...overrides,
      });
  }

  async function seedActivity(
    id: string,
    uid: string,
    createdAt: Date,
    fields: Record<string, unknown> = {},
  ): Promise<void> {
    await db
      .collection(collections.activities!)
      .doc(id)
      .set({
        userId: uid,
        createdAt: Timestamp.fromDate(createdAt),
        distanceM: 5000,
        summary: { claimedCells: 12 },
        ...fields,
      });
  }

  it('a regisztrációt a nap valódi időhatárai szerint számolja, nem a szomszédos napokét', async () => {
    const { start, end } = localDayWindow(MONDAY, 'Europe/Budapest');
    await seedUser('signup-inside-start', { createdAt: Timestamp.fromDate(start) });
    await seedUser('signup-inside-late', { createdAt: Timestamp.fromDate(new Date(end.getTime() - 1000)) });
    await seedUser('signup-before', { createdAt: Timestamp.fromDate(new Date(start.getTime() - 1000)) });
    await seedUser('signup-after', { createdAt: Timestamp.fromDate(end) });

    const summary = await computeMetricsDaily(MONDAY);
    expect(summary.signups).toBe(2);
  });

  it('az aktivitásokat és a napi táv-összeget a nap ablakára szűri', async () => {
    const { start } = localDayWindow(MONDAY, 'Europe/Budapest');
    const inside = new Date(start.getTime() + 3_600_000);
    const outside = new Date(start.getTime() - 3_600_000);

    await seedActivity('act-1', 'u1', inside, { distanceM: 5000, summary: { claimedCells: 10 } });
    await seedActivity('act-2', 'u2', inside, { distanceM: 3000, summary: { claimedCells: 4 } });
    await seedActivity('act-3', 'u3', outside, { distanceM: 9000, summary: { claimedCells: 99 } });

    const summary = await computeMetricsDaily(MONDAY);
    expect(summary.activities).toBe(2);
    expect(summary.distanceKm).toBeCloseTo(8, 5);
    expect(summary.claimedCellsNet).toBe(14);
  });

  it('a DAU/WAU/MAU a streak.lastActiveDay küszöbén vág', async () => {
    await seedUser('today', { streak: { current: 1, lastActiveDay: MONDAY } });
    await seedUser('six-days-ago', { streak: { current: 0, lastActiveDay: MONDAY - 6 } });
    await seedUser('seven-days-ago', { streak: { current: 0, lastActiveDay: MONDAY - 7 } });
    await seedUser('twentynine-days-ago', { streak: { current: 0, lastActiveDay: MONDAY - 29 } });
    await seedUser('thirty-days-ago', { streak: { current: 0, lastActiveDay: MONDAY - 30 } });
    await seedUser('never-active', { streak: { current: 0, lastActiveDay: null } });

    const summary = await computeMetricsDaily(MONDAY);
    expect(summary.dau).toBe(1);
    expect(summary.wau).toBe(2);
    expect(summary.mau).toBe(4);
  });

  it('az aktív sorozatok száma a streak.current > 0 pillanatnyi állapota, nem a naphoz kötött', async () => {
    await seedUser('active-streak', { streak: { current: 3, lastActiveDay: MONDAY - 50 } });
    await seedUser('broken-streak', { streak: { current: 0, lastActiveDay: MONDAY } });

    const summary = await computeMetricsDaily(MONDAY);
    expect(summary.activeStreaks).toBe(1);
  });

  it('az írás determinisztikus dokumentumnévvel idempotens', async () => {
    const summary = await computeMetricsDaily(MONDAY);
    await writeMetricsDaily(summary);
    await writeMetricsDaily(summary);

    const snap = await db.collection(collections.metricsDaily!).get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0]!.id).toBe(String(MONDAY));
    expect(snap.docs[0]!.data().day).toBe(MONDAY);
  });

  it('maybeRunMetricsDaily csak a helyi éjfél utáni órában ír, egyébként nem csinál semmit', async () => {
    await seedActivity('act-1', 'u1', new Date(MONDAY * 86_400_000 + 10 * 3_600_000));

    const noonBudapest = new Date(MONDAY * 86_400_000 + 10 * 3_600_000); // 12:00 helyi idő
    const resultAtNoon = await maybeRunMetricsDaily(noonBudapest);
    expect(resultAtNoon).toBeNull();

    let snap = await db.collection(collections.metricsDaily!).get();
    expect(snap.size).toBe(0);

    // 22:05 UTC = 00:05 Budapesten (nyári időszámítás) — ez a MÁSNAP első órája,
    // tehát a most záruló nap az `MONDAY`.
    const justAfterMidnight = new Date((MONDAY + 1) * 86_400_000 - 2 * 3_600_000 + 5 * 60_000);
    const result = await maybeRunMetricsDaily(justAfterMidnight);
    expect(result?.day).toBe(MONDAY);
    expect(result?.activities).toBe(1);

    snap = await db.collection(collections.metricsDaily!).get();
    expect(snap.size).toBe(1);
    expect(snap.docs[0]!.id).toBe(String(MONDAY));
  });
});
