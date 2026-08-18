/**
 * Az aktivitásmentés VÉGPONTTÓL VÉGPONTIG, valódi Firestore ellen.
 *
 * MIÉRT EMULÁTOR ÉS NEM MOCK? Mert amit itt bizonyítani kell — hogy két
 * egyszerre érkező mentés közül pontosan az egyik nyeri a cellát, és hogy a
 * duplikált mentés nem könyvel kétszer —, az a Firestore ütközéskezelésének és
 * tranzakció-újrapróbálásának a viselkedése. Egy mock azt mutatná, amit
 * beleírunk; itt a valódi adatbázis dönt.
 *
 * FUTTATÁS (a repo gyökeréből, egyetlen parancs):
 *
 *   firebase.cmd emulators:exec --only firestore --project demo-grundo "npx vitest run server/src/routes/activities.emulator.test.ts"
 *
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD, tehát a sima `npm test` nem törik el.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { simpleLoop } from '../../../src/game/fixtures';
import { decodePolyline } from '../../../src/game/polyline';
import { distanceM } from '../../../src/game/geo';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { TracePoint } from '../../../src/types';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-grundo';
const DATABASE = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';

describe.skipIf(!EMULATOR)('POST /api/activities — valódi Firestore ellen', () => {
  let server: Server;
  let base: string;
  let currentUid = 'alice';
  let db: FirebaseFirestore.Firestore;
  let collections: Record<string, string>;
  let gameDay: (date: Date) => number;

  beforeAll(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;
    collections = firebase.COLLECTIONS as unknown as Record<string, string>;
    gameDay = (await import('../lib/grid')).gameDay;

    const { activitiesRouter } = await import('./activities');
    const { HttpError } = await import('../lib/errors');

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    // Hitelesítés helyett: a teszt mondja meg, ki a kérő.
    app.use((req, _res, next) => {
      (req as { uid?: string }).uid = currentUid;
      next();
    });
    app.use('/api/activities', activitiesRouter);
    app.use(
      (
        err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        if (err instanceof HttpError) {
          return res.status(err.status).json({ code: err.code, message: err.message });
        }
        return res
          .status(500)
          .json({ code: 'internal', message: String((err as Error)?.message ?? err) });
      },
    );

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Az emulátor teljes ürítése — minden teszt tiszta lappal indul. */
  async function wipe(): Promise<void> {
    const url = `http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
    await fetch(url, { method: 'DELETE' });
  }

  async function seedUser(uid: string): Promise<void> {
    await db.collection(collections.users!).doc(uid).set({
      username: uid,
      gpTotal: 0,
      territoryM2: { foot: 0, bike: 0 },
      cellCount: { foot: 0, bike: 0 },
      // Levágás nélkül, hogy a foglalás és a nyomvonal jól összevethető legyen.
      privacy: { hideStart: false, hideEnd: false, startRadiusM: 0, endRadiusM: 0 },
    });
  }

  /**
   * A fixture-nyomvonal időbélyegeit a jelenbe hozza.
   *
   * A fixture-ök szándékosan fix időbélyeggel készülnek (determinizmus), a
   * végpont viszont a `MAX_AGE_MS`-nél régebbi aktivitást elutasítja.
   */
  function freshLoop(sideM = 200): TracePoint[] {
    const points = simpleLoop(sideM);
    const first = points[0]!.t;
    const start = Date.now() - 30 * 60 * 1000;
    return points.map((point) => ({ ...point, t: start + (point.t - first) }));
  }

  async function upload(uid: string, activityId: string, points: TracePoint[]) {
    currentUid = uid;
    const response = await fetch(`${base}/api/activities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        activityId,
        type: 'run',
        points,
        startedAt: points[0]!.t,
        endedAt: points[points.length - 1]!.t,
        movingMs: points[points.length - 1]!.t - points[0]!.t,
      }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, never> };
  }

  beforeEach(async () => {
    await wipe();
    await seedUser('alice');
    await seedUser('bob');
  });

  it('elmenti az aktivitást, és területet ad', async () => {
    const result = await upload('alice', 'activity-alpha1', freshLoop());

    expect(result.status).toBe(201);
    const summary = result.body.summary as unknown as Record<string, number>;
    expect(summary.claimedCells).toBeGreaterThan(0);
    expect(summary.areaGainedM2).toBeGreaterThan(0);

    const user = (await db.collection(collections.users!).doc('alice').get()).data()!;
    expect(user.gpTotal).toBe(summary.gp);
    // A profil a NETTÓ szerzést könyveli, nem az összes érintett mezőt.
    expect(user.cellCount.foot).toBeLessThanOrEqual(summary.claimedCells);
    expect(user.cellCount.foot).toBeGreaterThan(0);
  });

  it('a duplikált azonosító nem ad kétszer területet és GP-t', async () => {
    const points = freshLoop();
    const first = await upload('alice', 'activity-dupe01', points);
    const second = await upload('alice', 'activity-dupe01', points);

    expect(first.status).toBe(201);
    expect(second.body.duplicate).toBe(true);
    // A második a TÁROLT összegzőt adja vissza, nem egy újraszámoltat.
    expect(second.body.summary).toEqual(first.body.summary);

    const user = (await db.collection(collections.users!).doc('alice').get()).data()!;
    const summary = first.body.summary as unknown as Record<string, number>;
    expect(user.gpTotal).toBe(summary.gp);
    expect(user.counters.activities).toBe(1);

    const ledger = await db.collection(collections.gpLedger!).get();
    expect(ledger.size).toBe(1);
  });

  it('a nyilvános dokumentumban nincs trust pontszám és indoklás', async () => {
    await upload('alice', 'activity-trust1', freshLoop());

    const activity = (
      await db.collection(collections.activities!).doc('activity-trust1').get()
    ).data()!;
    expect(activity.trustScore).toBeUndefined();
    expect(activity.trustReasons).toBeUndefined();
    expect(activity.summary.trustReasons).toBeUndefined();
    expect(activity.trustVerdict).toBeDefined();

    // A részletek külön, admin-only dokumentumban.
    const trust = await db.collection(collections.activityTrust!).doc('activity-trust1').get();
    expect(trust.exists).toBe(true);
    expect(typeof trust.data()!.score).toBe('number');
    expect(Array.isArray(trust.data()!.reasons)).toBe(true);
  });

  it('a napi lágy plafon a már megszerzett napi GP-ből számol', async () => {
    const today = gameDay(new Date());
    const already = GAMEPLAY.SOFT_CAP_GP_PER_DAY + 1000;
    await db
      .collection(collections.dailyGp!)
      .doc(`alice_${today}`)
      .set({ userId: 'alice', day: today, total: already });

    const result = await upload('alice', 'activity-cap001', freshLoop());
    expect(result.status).toBe(201);

    // A plafon fölött a hozam feleződik, tehát VAN levonás.
    const activity = (
      await db.collection(collections.activities!).doc('activity-cap001').get()
    ).data()!;
    expect(activity.gp.softCapReduction).toBeGreaterThan(0);

    const summary = result.body.summary as unknown as Record<string, number>;
    const daily = await db.collection(collections.dailyGp!).doc(`alice_${today}`).get();
    expect(daily.data()!.total).toBe(already + summary.gp);
  });

  it('területrabláskor mindkét fél összesítője helyesen változik', async () => {
    const points = freshLoop();
    const alice = await upload('alice', 'activity-steal1', points);
    // Bob ugyanazt a kört futja: Alice mezői 1-es védelmen állnak, elveszi őket.
    const bob = await upload('bob', 'activity-steal2', points);

    expect(bob.status).toBe(201);

    const aliceDoc = (await db.collection(collections.users!).doc('alice').get()).data()!;
    const bobDoc = (await db.collection(collections.users!).doc('bob').get()).data()!;
    const aliceSummary = alice.body.summary as unknown as Record<string, number>;

    expect(bobDoc.cellCount.foot).toBeGreaterThan(0);
    // Alice veszített, de SOHA nem mehet nulla alá.
    expect(aliceDoc.cellCount.foot).toBeLessThan(aliceSummary.claimedCells);
    expect(aliceDoc.cellCount.foot).toBeGreaterThanOrEqual(0);
    expect(aliceDoc.territoryM2.foot).toBeGreaterThanOrEqual(0);

    // Területesemény pontosan egy, determinisztikus azonosítóval.
    const events = await db.collection(collections.territoryEvents!).get();
    expect(events.size).toBe(1);
    expect(events.docs[0]!.id).toBe('activity-steal2_alice');
    expect(events.docs[0]!.data().recipientId).toBe('alice');
  });

  it('a duplikált mentés nem hoz létre második területeseményt', async () => {
    const points = freshLoop();
    await upload('alice', 'activity-evt0001', points);
    await upload('bob', 'activity-evt0002', points);
    await upload('bob', 'activity-evt0002', points);

    const events = await db.collection(collections.territoryEvents!).get();
    expect(events.size).toBe(1);
  });

  it('a publikus bounds a levágott útvonalból készül, a teljes a privátba megy', async () => {
    await db
      .collection(collections.users!)
      .doc('alice')
      .set(
        { privacy: { hideStart: true, hideEnd: true, startRadiusM: 200, endRadiusM: 200 } },
        { merge: true },
      );
    await upload('alice', 'activity-priv01', freshLoop(400));

    const activityRef = db.collection(collections.activities!).doc('activity-priv01');
    const activity = (await activityRef.get()).data()!;
    const track = (await activityRef.collection('private').doc('track').get()).data()!;

    expect(track.bounds).toBeTruthy();
    const full = track.bounds as Record<string, number>;
    const publicBounds = activity.bounds as Record<string, number> | null;
    expect(publicBounds).toBeTruthy();

    // A publikus doboz soha nem lóghat túl a teljesen.
    expect(publicBounds!.north).toBeLessThanOrEqual(full.north);
    expect(publicBounds!.south).toBeGreaterThanOrEqual(full.south);
    expect(publicBounds!.east).toBeLessThanOrEqual(full.east);
    expect(publicBounds!.west).toBeGreaterThanOrEqual(full.west);

    /**
     * A VALÓDI garancia nem a kisebb doboz, hanem a levágott VÉGEK.
     *
     * Egy sarokból induló négyzetes körnél a maradék útvonal még mindig
     * érinti mind a négy szélső koordinátát, tehát a befoglaló doboz jogosan
     * azonos lehet. Ami viszont soha nem lehet igaz: hogy a nyilvános
     * nyomvonal a védőkörön belül kezdődjön vagy végződjön — abból pont a
     * lakcím lenne kiolvasható.
     */
    const publicPoints = decodePolyline(activity.route as string);
    expect(publicPoints.length).toBeGreaterThan(1);

    const trackPoints = track.points as TracePoint[];
    const realStart = trackPoints[0]!;
    const realEnd = trackPoints[trackPoints.length - 1]!;

    expect(distanceM(realStart, publicPoints[0]!)).toBeGreaterThan(200);
    expect(distanceM(realEnd, publicPoints[publicPoints.length - 1]!)).toBeGreaterThan(200);
  });

  it('két egyszerre érkező mentés közül pontosan az egyik viszi a cellát', async () => {
    const points = freshLoop();
    // EGYSZERRE indul a kettő — a Firestore ütközéskezelése dönt.
    const [alice, bob] = await Promise.all([
      upload('alice', 'activity-race001', points),
      upload('bob', 'activity-race002', points),
    ]);

    expect(alice.status).toBe(201);
    expect(bob.status).toBe(201);

    // A rácsban minden cellának PONTOSAN EGY tulajdonosa van.
    const blocks = await db.collection(collections.grid!).get();
    const owners = new Map<string, string>();
    for (const block of blocks.docs) {
      const cells = (block.data().cells ?? {}) as Record<string, { o: string }>;
      for (const [key, cell] of Object.entries(cells)) {
        owners.set(`${block.id}:${key}`, cell.o);
      }
    }
    expect(owners.size).toBeGreaterThan(0);

    // A két profil cellaszámának összege nem lehet több a rácsban lévő cellák
    // számánál — ha duplán könyvelnénk, ez itt megbukna.
    const aliceDoc = (await db.collection(collections.users!).doc('alice').get()).data()!;
    const bobDoc = (await db.collection(collections.users!).doc('bob').get()).data()!;
    const claimed = aliceDoc.cellCount.foot + bobDoc.cellCount.foot;
    expect(claimed).toBeLessThanOrEqual(owners.size);
  });
});
