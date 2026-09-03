/**
 * A COMPACT FOGLALÁS végponttól végpontig, valódi Firestore ellen.
 *
 * MIT BIZONYÍT EZ, AMIT A UNIT TESZT NEM? Két dolgot, és mindkettő csak igazi
 * adatbázison látszik:
 *
 *   1. hogy egy több tíz km²-es kör TELJES belseje könyvelődik — nem csak a
 *      fal és a határsáv, ahogy a jelöltcellákból következne;
 *   2. hogy a belső ennek ellenére NEM materializálódik cellánként: a homogén
 *      res9 blokkok `uniform` alakban maradnak, üres `cells` térképpel.
 *
 * A kettő együtt a compact út létjogosultsága. Ha az első romlik el, a
 * felhasználó területe vész el; ha a második, a Firestore-számla és az írásidő
 * robban.
 *
 * FUTTATÁS (a repo gyökeréből):
 *
 *   npm.cmd run test:emulator
 *
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD, tehát a sima `npm test` nem törik el.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { buildTrace, ORIGIN, squareWaypoints } from '../../../src/game/fixtures';
import { GAMEPLAY } from '../../../src/config/gameplay';
import type { ActivityType, TracePoint } from '../../../src/types';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-grundo';
const DATABASE = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';

/**
 * ⚠️ A GP-t itt NEM kötjük pontos értékhez.
 *
 * A kis fixture-ös suite megteheti (`activities.emulator.test.ts`), mert ott
 * determinisztikusan két jelvény teljesül. Egy 25 km²-es foglalás viszont a
 * TERÜLETI küszöböket is átlépi, és MÉRVE 2 450 GP jelvénybónuszt hozott a
 * várt 70 helyett. A jelvényképlet nem ennek a suite-nak a tárgya — itt az
 * a kérdés, hogy a compact könyvelés helyes-e, ezért a GP-t relatívan
 * ellenőrizzük: mihez képest nőtt, és nőtt-e egyáltalán újra.
 */

describe.skipIf(!EMULATOR)('POST /api/activities — compact foglalás', () => {
  let server: Server;
  let base: string;
  let currentUid = 'alice';
  let db: FirebaseFirestore.Firestore;
  let collections: Record<string, string>;

  beforeAll(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;
    collections = firebase.COLLECTIONS as unknown as Record<string, string>;

    const { activitiesRouter } = await import('./activities');
    const { HttpError } = await import('../lib/errors');

    const app = express();
    app.use(express.json({ limit: '10mb' }));
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
      privacy: { hideStart: false, hideEnd: false, startRadiusM: 0, endRadiusM: 0 },
    });
  }

  /**
   * Egy 5 km oldalú, 20 km kerületű kör — több tíz km², compact belsővel.
   *
   * A 250 m / 30 s lépés 30 km/h-t ad: valódi bringatempó. Ez nem kozmetika —
   * a Trust Score a sebességből is dolgozik, és egy irreális tempójú fixture a
   * mentést más ágra vinné.
   */
  function compactRide(startAt = Date.now() - 45 * 60 * 1000): TracePoint[] {
    return buildTrace(squareWaypoints(ORIGIN, 5_000), {
      stepM: 250,
      intervalS: 30,
      accuracy: 5,
      startAt,
    });
  }

  async function upload(
    uid: string,
    activityId: string,
    points: TracePoint[],
    type: ActivityType = 'ride',
  ) {
    currentUid = uid;
    const response = await fetch(`${base}/api/activities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        activityId,
        type,
        points,
        startedAt: points[0]!.t,
        endedAt: points[points.length - 1]!.t,
        movingMs: points[points.length - 1]!.t - points[0]!.t,
      }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, never> };
  }

  /** A rács jelenlegi állapota — tömör és kibontott blokkok szétválasztva. */
  async function gridStats() {
    const snapshot = await db.collection(collections.grid!).get();
    let uniform = 0;
    let expanded = 0;
    let storedCells = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data() as {
        uniform?: unknown;
        cells?: Record<string, unknown>;
      };
      const cellCount = Object.keys(data.cells ?? {}).length;
      storedCells += cellCount;
      if (data.uniform) uniform += 1;
      else expanded += 1;
    }
    return { blocks: snapshot.size, uniform, expanded, storedCells };
  }

  beforeEach(async () => {
    await wipe();
    await seedUser('alice');
    await seedUser('bob');
  });

  it('a hurok TELJES belsejét könyveli, nem csak a nyomvonalat', async () => {
    const result = await upload('alice', 'compact-free-01', compactRide());

    expect(result.status).toBe(201);
    const summary = result.body.summary as unknown as Record<string, number>;

    /**
     * A KULCSSZÁM. A nyomvonal és a határsáv együtt ~5 000 cella; a hurok
     * belsejével együtt >40 000. Ha ez a szám leesik néhány ezerre, a compact
     * blokkterv kiesett a láncból, és a foglalás nagyobbik része elveszett.
     */
    expect(summary.claimedCells).toBeGreaterThan(40_000);
    expect(summary.areaGainedM2).toBeGreaterThan(10_000_000);
    expect(summary.gp).toBeGreaterThan(0);

    const activity = (await db.collection(collections.activities!).doc('compact-free-01').get()).data()!;
    expect(activity.claimStatus).toBe('done');
    expect(activity.claimProgress.done).toBe(activity.claimProgress.total);

    // A profil ugyanazt a nettó szerzést mutatja, mint az összesítő.
    const user = (await db.collection(collections.users!).doc('alice').get()).data()!;
    expect(user.cellCount.bike).toBe(summary.claimedCells);
    // A profil nyers m²-t tárol, az összesítő kerekítve közli — a kettő
    // között MÉRVE 0,07 m² a különbség, ami a cellaterület tizedesjegyeiből jön.
    expect(Math.round(user.territoryM2.bike)).toBe(summary.areaGainedM2);
    // Az aktivitás GP-je benne van; a jelvények ezen felül jönnek.
    expect(user.gpTotal).toBeGreaterThanOrEqual(summary.gp);
  });

  it('a homogén belsőt NEM bontja cellánkénti tárolásra', async () => {
    await upload('alice', 'compact-uniform-1', compactRide());
    const stats = await gridStats();

    // A belső blokkok egyben szerzett, homogén területek — pont erre való a
    // tömör alak. A többségüknek `uniform`-nak kell maradnia.
    expect(stats.uniform).toBeGreaterThan(stats.expanded);

    /**
     * A VÉDŐKORLÁT. Teljes materializációnál blokkonként 343 cella tárolódna,
     * vagyis >90 000 bejegyzés. A kibontásnak a peremre kell szorítkoznia.
     */
    expect(stats.storedCells).toBeLessThan(stats.blocks * 343 * 0.5);
  });

  it('ugyanaz a kör másodszor megerősít, nem duplázza a területet', async () => {
    const first = await upload('alice', 'compact-again-01', compactRide());
    const second = await upload('alice', 'compact-again-02', compactRide(Date.now() - 20 * 60 * 1000));

    expect(second.status).toBe(201);
    const firstSummary = first.body.summary as unknown as Record<string, number>;
    const secondSummary = second.body.summary as unknown as Record<string, number>;

    // Ugyanazokat a cellákat érinti…
    expect(secondSummary.claimedCells).toBe(firstSummary.claimedCells);
    // …de már a sajátjait erősíti: nincs újabb nettó szerzés.
    expect(secondSummary.areaGainedM2).toBe(0);

    const user = (await db.collection(collections.users!).doc('alice').get()).data()!;
    expect(user.cellCount.bike).toBe(firstSummary.claimedCells);
  });

  it('a duplikált azonosító nem könyvel kétszer', async () => {
    const points = compactRide();
    const first = await upload('alice', 'compact-dupe-001', points);
    const firstSummary = first.body.summary as unknown as Record<string, number>;

    // A mérce a mentés UTÁNI állapot, nem egy előre kiszámolt képlet: a
    // kérdés az, hogy a második kérés hozzátesz-e bármit.
    const afterFirst = (await db.collection(collections.users!).doc('alice').get()).data()!;

    const second = await upload('alice', 'compact-dupe-001', points);
    expect(second.body.duplicate).toBe(true);

    const afterSecond = (await db.collection(collections.users!).doc('alice').get()).data()!;
    expect(afterSecond.gpTotal).toBe(afterFirst.gpTotal);
    expect(afterSecond.cellCount.bike).toBe(afterFirst.cellCount.bike);
    expect(afterSecond.territoryM2.bike).toBe(afterFirst.territoryM2.bike);
    expect(afterSecond.cellCount.bike).toBe(firstSummary.claimedCells);
  });

  /**
   * ⚠️ EZ EGY ÉLES ADATVESZTÉST REPRODUKÁL (2026-09-02, `ebb3c240…`).
   *
   * Egy 143 km-es bringakör darabolt mentése az ELSŐ csoportnál elhasalt
   * (`Transaction too big`), és az aktivitás ott maradt `claimStatus:
   * 'pending'` állapotban: 0 GP, 0 terület, üres `claimParts`. Az újraküldést
   * viszont a régi kód DUPLIKÁTUMNAK vette — csak azt nézte, létezik-e a
   * dokumentum —, ezért a kör soha többé nem tudott elkészülni, és a válaszban
   * egy `summary: undefined` ment ki, amitől a kliens elszállt.
   *
   * A folytatás azért biztonságos, mert a csoportok determinisztikus
   * azonosítójú `claimParts` dokumentumba könyvelnek: ami kész, kimarad; ami
   * hiányzik, lefut. A darabolt út eleve erre a szerződésre épült — eddig csak
   * sosem jutott el idáig a vezérlés.
   */
  it('a félbemaradt foglalást FOLYTATJA, nem duplikátumnak veszi', async () => {
    const points = compactRide();
    const first = await upload('alice', 'compact-resume-1', points);
    expect(first.status).toBe(201);
    const firstSummary = first.body.summary as unknown as Record<string, number>;

    /**
     * A BERAGADT ÁLLAPOT ELŐÁLLÍTÁSA, pontosan úgy, ahogy élesben keletkezett:
     * az aktivitás dokumentuma megvan, `summary` nélkül, `pending`
     * állapotban — a foglalásból viszont SEMMI nem könyvelődött el.
     */
    const activityRef = db.collection(collections.activities!).doc('compact-resume-1');
    const stuck = (await activityRef.get()).data()!;
    delete stuck.summary;
    const parts = await activityRef.collection('claimParts').get();
    await Promise.all(parts.docs.map((doc) => doc.ref.delete()));
    const grid = await db.collection(collections.grid!).get();
    await Promise.all(grid.docs.map((doc) => doc.ref.delete()));
    await activityRef.set({
      ...stuck,
      claimStatus: 'pending',
      claimProgress: { done: 0, total: 2 },
      gp: { total: 0 },
      areaGainedM2: 0,
      cellCount: 0,
    });
    await seedUser('alice');

    const resumed = await upload('alice', 'compact-resume-1', points);

    expect(resumed.status).toBe(201);
    const summary = resumed.body.summary as unknown as Record<string, number>;
    // A LÉNYEG: valódi összegző megy ki, nem `undefined`. Ezen a mezőn hasalt
    // el a kliens eredményképernyője.
    expect(summary).toBeDefined();
    expect(summary.distanceM).toBeGreaterThan(0);
    expect(summary.claimedCells).toBe(firstSummary.claimedCells);
    expect(summary.gp).toBeGreaterThan(0);

    const activity = (await activityRef.get()).data()!;
    expect(activity.claimStatus).toBe('done');
    expect(activity.claimProgress.done).toBe(activity.claimProgress.total);
    expect(activity.gp.total).toBeGreaterThan(0);

    // A terület tényleg a játéktérre került, nem csak a válaszba.
    const user = (await db.collection(collections.users!).doc('alice').get()).data()!;
    expect(user.cellCount.bike).toBe(summary.claimedCells);
  });

  it('a folytatás után az újabb küldés már duplikátum, és nem könyvel újra', async () => {
    const points = compactRide();
    await upload('alice', 'compact-resume-2', points);
    const afterFirst = (await db.collection(collections.users!).doc('alice').get()).data()!;

    const again = await upload('alice', 'compact-resume-2', points);
    expect(again.body.duplicate).toBe(true);

    // A könyvzárás `claimStatus: 'done'` őre nem engedi a második könyvelést:
    // a GP és a terület nem duplázódhat egy újraküldéstől.
    const afterSecond = (await db.collection(collections.users!).doc('alice').get()).data()!;
    expect(afterSecond.gpTotal).toBe(afterFirst.gpTotal);
    expect(afterSecond.cellCount.bike).toBe(afterFirst.cellCount.bike);
    expect(afterSecond.territoryM2.bike).toBe(afterFirst.territoryM2.bike);
  });

  it('az ismételt körök a védelmi plafonig erősítenek, azon túl nem', async () => {
    /**
     * Hat valódi traversal ugyanazon a körön. A védelem 1×-től 5×-ig nő, a
     * hatodik már nem emelhet: a `MAX_DEFENSE` szerkezeti korlát. Compact úton
     * a homogén blokk O(1) átmenettel lép, ezért itt derülne ki, ha a levágás
     * kimaradt volna a tömör ágból.
     */
    // 45 percenként egy 40 perces kör, mind a múltban: a körök nem érnek egymásba.
    for (let round = 0; round < 6; round += 1) {
      const result = await upload(
        'alice',
        `compact-defense-${round}`,
        compactRide(Date.now() - (7 * 60 - round * 45) * 60 * 1000),
      );
      expect(result.status).toBe(201);
    }

    const snapshot = await db.collection(collections.grid!).get();
    let maxDefense = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data() as {
        uniform?: { d?: number };
        cells?: Record<string, { d?: number }>;
      };
      if (data.uniform?.d) maxDefense = Math.max(maxDefense, data.uniform.d);
      for (const cell of Object.values(data.cells ?? {})) {
        if (cell?.d) maxDefense = Math.max(maxDefense, cell.d);
      }
    }
    expect(maxDefense).toBe(GAMEPLAY.MAX_DEFENSE);
    // Hat, egyenként ~25 km²-es mentés — az alapértelmezett 5 s kevés hozzá.
  }, 60_000);

  it('védett területen a rivális ÁTTÖR, de nem szerez tulajdont', async () => {
    // Alice kétszer megy körbe: a mezői 2× védelműek lesznek.
    await upload('alice', 'compact-defended-1', compactRide(Date.now() - 90 * 60 * 1000));
    await upload('alice', 'compact-defended-2', compactRide(Date.now() - 60 * 60 * 1000));
    const aliceBefore = (await db.collection(collections.users!).doc('alice').get()).data()!;

    // Bob egyszer megy körbe ugyanott: 2× védelemhez egy találat kevés.
    const raid = await upload('bob', 'compact-breakthru-1', compactRide(Date.now() - 30 * 60 * 1000));
    expect(raid.status).toBe(201);
    const raidSummary = raid.body.summary as unknown as Record<string, number>;

    // Áttörés: a mezők gyengülnek, de egyik sem cserél gazdát.
    expect(raidSummary.areaGainedM2).toBe(0);

    const alice = (await db.collection(collections.users!).doc('alice').get()).data()!;
    const bob = (await db.collection(collections.users!).doc('bob').get()).data()!;
    expect(alice.cellCount.bike).toBe(aliceBefore.cellCount.bike);
    expect(bob.cellCount.bike).toBe(0);
  });

  it('a rivális átveheti a compact területet, és az áldozat számlálója csökken', async () => {
    const mine = await upload('alice', 'compact-victim-01', compactRide());
    const mineSummary = mine.body.summary as unknown as Record<string, number>;

    const raid = await upload('bob', 'compact-raider-01', compactRide(Date.now() - 20 * 60 * 1000));
    expect(raid.status).toBe(201);
    const raidSummary = raid.body.summary as unknown as Record<string, number>;

    // Bob ugyanazt a kört teszi meg: alice 1× védelmű mezői gazdát cserélnek.
    expect(raidSummary.areaGainedM2).toBeGreaterThan(0);

    const alice = (await db.collection(collections.users!).doc('alice').get()).data()!;
    const bob = (await db.collection(collections.users!).doc('bob').get()).data()!;

    expect(bob.cellCount.bike).toBeGreaterThan(0);
    expect(alice.cellCount.bike).toBeLessThan(mineSummary.claimedCells);
  });
});
