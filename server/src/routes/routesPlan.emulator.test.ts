/**
 * `POST /api/routes/plan` — a kapu VALÓDI Firestore ellen.
 *
 * Amit itt bizonyítani kell, és amit egy mockolt adatbázis NEM bizonyítana:
 *   - a heti keret UGYANAZ a mező, mint a küldetés-ajánlónál (`missionQuota`),
 *     tehát a tervező nem kerüli meg a küldetés-ajánló korlátját;
 *   - a keret fogyása ténylegesen ÍRÓDIK, és a következő kérés már látja;
 *   - Pro és admin nem fogyaszt keretet;
 *   - a geometria-előnézet NEM adminnak néma módon kimarad (nem hibázik).
 *
 * ⚠️ A TERVEZÉS MAGA NEM FUT ITT. A `planTwoSidedLoop` valódi GraphHopper-hívás
 * lenne (mérve 3,6–7 s, és a CI-ben nincs gráf), ezért a tervezőmotort
 * mockoljuk. Amit ez a fájl véd, az a KAPU: validálás, kvóta, jogosultság —
 * nem az útvonal minősége. Azt a `routeBenchmark` méri.
 *
 * FUTTATÁS (a repo gyökeréből): `npm.cmd run test:emulator`
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

const FREE = 'uid-ingyenes';
const PRO = 'uid-pro';
const ADMIN = 'uid-admin';

/* A tervezőmotor és a GraphHopper-elérhetőség mockolva — lásd a fejlécet. */
vi.mock('../lib/directions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/directions')>()),
  directionsConfigured: () => true,
}));

vi.mock('../lib/routePlan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/routePlan')>();
  const leg = {
    route: { polyline: '', distanceM: 5000, durationS: 1200, snappedWaypoints: [] },
    points: [
      { lat: 47.4979, lng: 19.0402 },
      { lat: 47.5100, lng: 19.0600 },
    ],
  };
  return {
    ...actual,
    planTwoSidedLoop: vi.fn(async () => ({
      ok: true as const,
      loop: {
        outbound: leg,
        inbound: leg,
        totalDistanceM: 10_000,
        directDistanceM: 4_000,
        totalDurationS: 2_400,
        quality: {},
      },
    })),
    planDirectRoute: vi.fn(async () => [
      { polyline: '', distanceM: 5000, durationS: 1200, snappedWaypoints: [] },
    ]),
  };
});

describe.skipIf(!EMULATOR)('POST /api/routes/plan — kapu valódi Firestore ellen', () => {
  let server: Server;
  let base: string;
  let db: FirebaseFirestore.Firestore;
  let currentUid = FREE;
  let currentRole: string | undefined;
  let freeLimit = 5;

  beforeAll(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;

    const { routesRouter } = await import('./routes');
    const { HttpError } = await import('../lib/errors');

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { uid?: string; role?: string }).uid = currentUid;
      (req as { uid?: string; role?: string }).role = currentRole;
      next();
    });
    app.use('/api/routes', routesRouter);
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        if (err instanceof HttpError) {
          return res.status(err.status).json({ code: err.code, message: err.message });
        }
        res.status(500).json({ code: 'internal', message: String(err) });
      },
    );

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const { GAMEPLAY } = await import('../../../src/config/gameplay');
    freeLimit = GAMEPLAY.FREE_ROUTE_GENERATIONS_PER_WEEK;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    currentUid = FREE;
    currentRole = undefined;
    for (const uid of [FREE, PRO, ADMIN]) await db.collection('users').doc(uid).delete();
    await db.collection('users').doc(PRO).set({ pro: { active: true } });
  });

  const BUDAPEST = {
    from: { lat: 47.4979, lng: 19.0402 },
    to: { lat: 47.5350, lng: 19.0900 },
  };

  async function plan(body: Record<string, unknown> = {}) {
    const response = await fetch(`${base}/api/routes/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BUDAPEST, ...body }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('megtervezi a kört, és fogyasztja a heti keretet', async () => {
    const first = await plan();
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.closesLoop).toBe(true);
    expect(first.body.quotaLeft).toBe(freeLimit - 1);

    const stored = await db.collection('users').doc(FREE).get();
    expect(stored.data()?.missionQuota?.used).toBe(1);

    /* A második kérés MÁR LÁTJA az elsőt — ez a Firestore-körút bizonyítéka. */
    const second = await plan();
    expect(second.body.quotaLeft).toBe(freeLimit - 2);
  });

  it('a küldetés-ajánlóval KÖZÖS keretből fogyaszt', async () => {
    /* Mintha a héten már elhasználta volna küldetés-generálásra. */
    const { weekOf, gameDay } = await import('../lib/grid');
    const week = weekOf(gameDay(new Date()));
    await db.collection('users').doc(FREE).set({ missionQuota: { week, used: freeLimit } });

    const response = await plan();
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('route_quota_exhausted');
  });

  it('Pro és admin nem fogyaszt keretet', async () => {
    currentUid = PRO;
    const pro = await plan();
    expect(pro.body.quotaLeft).toBeNull();
    expect((await db.collection('users').doc(PRO).get()).data()?.missionQuota).toBeUndefined();

    currentUid = ADMIN;
    currentRole = 'admin';
    const admin = await plan();
    expect(admin.body.quotaLeft).toBeNull();
    expect((await db.collection('users').doc(ADMIN).get()).data()?.missionQuota).toBeUndefined();
  });

  it('a zsákmány-előnézet MINDENKINEK jár, kapcsoló nélkül', async () => {
    const free = await plan();
    expect(free.status).toBe(200);
    /*
      A mockolt tervező egyetlen, oda-vissza azonos leget ad — az nem zár
      kört, tehát `closesArea: false`. Amit ez bizonyít: a számítás LEFUTOTT
      (külön szálon), és a válasz tartalmazza az eredményét, nem hiányzik.
    */
    expect(free.body.reward).not.toBeNull();
    expect((free.body.reward as Record<string, unknown>).closesArea).toBe(false);
    expect(free.body.rewardSkipped).toBeNull();
  });

  it('a „Csak oda” nem zár kört, tehát nem ad területet', async () => {
    const response = await plan({ mode: 'direct' });
    expect(response.body.mode).toBe('direct');
    expect(response.body.closesLoop).toBe(false);
  });

  it('elutasítja a hibás vagy értelmetlen bemenetet', async () => {
    expect((await plan({ from: null })).status).toBe(400);
    expect((await plan({ to: { lat: 200, lng: 19 } })).status).toBe(400);
    /* Túl közel: a rajt és a cél gyakorlatilag egy helyen. */
    expect((await plan({ to: BUDAPEST.from })).body.code).toBe('too_close');
    /* Túl messze: Budapest → Bécs. */
    expect((await plan({ to: { lat: 48.2082, lng: 16.3738 } })).body.code).toBe('too_far');
    /* Hat megálló — a plafon öt. */
    const stops = Array.from({ length: 6 }, () => ({ lat: 47.5, lng: 19.05 }));
    expect((await plan({ stops })).body.code).toBe('too_many_stops');
  });

  it('a keret elfogyása NEM ír kvótát feleslegesen', async () => {
    const { weekOf, gameDay } = await import('../lib/grid');
    const week = weekOf(gameDay(new Date()));
    await db.collection('users').doc(FREE).set({ missionQuota: { week, used: freeLimit } });

    await plan();
    const stored = await db.collection('users').doc(FREE).get();
    expect(stored.data()?.missionQuota?.used).toBe(freeLimit);
  });
});
