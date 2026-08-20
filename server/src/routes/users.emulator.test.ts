/**
 * Nyilvános profil és közösségi gráf VALÓDI Firestore ellen.
 *
 * Amit itt bizonyítani kell, és amit egy mockolt adatbázis NEM bizonyítana:
 *   - a követés SZÁMLÁLÓI együtt mozognak az élekkel, és a kétszer elküldött
 *     kérés nem duplázza őket (tranzakció),
 *   - a tiltás mindkét irányban bontja a kapcsolatot, tehát nem marad követő,
 *   - a kétirányú tiltás két külön választ ad: aki engem tiltott → 404, akit
 *     én tiltottam → fejléc + a feloldás lehetősége,
 *   - a privát fiók profilja NEM szivárogtat játékadatot.
 *
 * FUTTATÁS (a repo gyökeréből): `npm.cmd run test:emulator`
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

/** A kérő — minden teszt ezzel az uid-del hív, hacsak nem állítja át. */
const ME = 'uid-en';
const OTHER = 'uid-masik';

describe.skipIf(!EMULATOR)('Users API — valódi Firestore ellen', () => {
  let server: Server;
  let base: string;
  let db: FirebaseFirestore.Firestore;
  let currentUid = ME;

  beforeAll(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;

    const { usersRouter } = await import('./users');
    const { HttpError } = await import('../lib/errors');

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { uid?: string }).uid = currentUid;
      next();
    });
    app.use('/api/users', usersRouter);
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
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Egy felhasználó teljes törlése az alkollekcióival együtt. */
  async function wipeUser(uid: string) {
    const ref = db.collection('users').doc(uid);
    for (const sub of ['following', 'followers', 'blocks', 'mutes']) {
      const snap = await ref.collection(sub).get();
      for (const doc of snap.docs) await doc.ref.delete();
    }
    await ref.delete();
    const requests = await db.collection('followRequests').doc(uid).collection('items').get();
    for (const doc of requests.docs) await doc.ref.delete();
  }

  async function makeUser(uid: string, username: string, account: 'public' | 'private') {
    await db
      .collection('users')
      .doc(uid)
      .set({
        username,
        usernameLower: username.toLowerCase(),
        photoURL: null,
        createdAt: new Date('2026-04-01T00:00:00Z'),
        pro: { active: false },
        gpTotal: 4200,
        territoryM2: { foot: 50_000, bike: 0 },
        cellCount: { foot: 163, bike: 0 },
        zoneCount: { foot: 2, bike: 0 },
        streak: { current: 3, longest: 9, weeks: 1 },
        counters: {
          activities: 11,
          followers: 0,
          following: 0,
          distanceKm: { run: 40, walk: 12, ride: 0 },
        },
        privacy: { account },
      });
    await db.collection('usernames').doc(username.toLowerCase()).set({ uid, username });
  }

  beforeEach(async () => {
    currentUid = ME;
    await wipeUser(ME);
    await wipeUser(OTHER);
    for (const name of ['en', 'masik']) {
      await db.collection('usernames').doc(name).delete();
    }
    const reports = await db.collection('reports').get();
    for (const doc of reports.docs) await doc.ref.delete();

    await makeUser(ME, 'En', 'public');
    await makeUser(OTHER, 'Masik', 'public');
  });

  async function call(
    path: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(`${base}/api/users${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  const counters = async (uid: string) =>
    ((await db.collection('users').doc(uid).get()).data() as any).counters;

  /* ── Profil ──────────────────────────────────────────────────── */

  it('a felhasználónév kis- és nagybetűtől függetlenül feloldódik', async () => {
    const upper = await call('/MASIK');
    expect(upper.status).toBe(200);
    expect(upper.body.profile.username).toBe('Masik');
  });

  it('ismeretlen névre 404 jön, nem üres profil', async () => {
    const result = await call('/nincsilyen');
    expect(result.status).toBe(404);
    expect(result.body.code).toBe('user_not_found');
  });

  it('nyilvános profilnál a játékadat is kimegy', async () => {
    const result = await call('/masik');
    expect(result.body.restricted).toBe(false);
    expect(result.body.profile.territoryM2.foot).toBe(50_000);
    expect(result.body.profile.counters.activities).toBe(11);
  });

  it('privát fióknál CSAK a fejléc megy ki — játékadat nem', async () => {
    await db.collection('users').doc(OTHER).update({ 'privacy.account': 'private' });
    const result = await call('/masik');
    expect(result.body.restricted).toBe(true);
    expect(result.body.profile.username).toBe('Masik');
    expect(result.body.profile.territoryM2).toBeUndefined();
    expect(result.body.profile.counters).toBeUndefined();
    expect(result.body.profile.gpTotal).toBeUndefined();
  });

  /* ── Követés ─────────────────────────────────────────────────── */

  it('a követés mindkét élt létrehozza és mindkét számlálót lépteti', async () => {
    expect((await call('/masik/follow', 'POST')).body.status).toBe('following');

    const following = await db.collection('users').doc(ME).collection('following').doc(OTHER).get();
    const follower = await db.collection('users').doc(OTHER).collection('followers').doc(ME).get();
    expect(following.exists).toBe(true);
    expect(follower.exists).toBe(true);
    expect((await counters(ME)).following).toBe(1);
    expect((await counters(OTHER)).followers).toBe(1);
  });

  it('kétszer elküldve NEM duplázza a számlálót', async () => {
    await call('/masik/follow', 'POST');
    await call('/masik/follow', 'POST');
    expect((await counters(ME)).following).toBe(1);
    expect((await counters(OTHER)).followers).toBe(1);
  });

  it('a követés visszavonása nullázza, kétszer visszavonva sem megy negatívba', async () => {
    await call('/masik/follow', 'POST');
    await call('/masik/follow', 'DELETE');
    await call('/masik/follow', 'DELETE');
    expect((await counters(ME)).following).toBe(0);
    expect((await counters(OTHER)).followers).toBe(0);
  });

  it('privát fióknál nem követés lesz, hanem KÉRÉS', async () => {
    await db.collection('users').doc(OTHER).update({ 'privacy.account': 'private' });
    const result = await call('/masik/follow', 'POST');
    expect(result.body.status).toBe('requested');

    const edge = await db.collection('users').doc(ME).collection('following').doc(OTHER).get();
    expect(edge.exists).toBe(false);
    expect((await counters(OTHER)).followers).toBe(0);

    const request = await db
      .collection('followRequests')
      .doc(OTHER)
      .collection('items')
      .doc(ME)
      .get();
    expect(request.exists).toBe(true);
  });

  it('magamat nem követhetem', async () => {
    const result = await call('/en/follow', 'POST');
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('self_follow');
  });

  /* ── Tiltás ──────────────────────────────────────────────────── */

  it('a tiltás MINDKÉT irányban bontja a követést', async () => {
    // Ő követ engem, én is őt.
    await call('/masik/follow', 'POST');
    currentUid = OTHER;
    await call('/en/follow', 'POST');
    currentUid = ME;
    expect((await counters(ME)).followers).toBe(1);

    await call('/masik/block', 'POST');

    expect((await counters(ME)).following).toBe(0);
    expect((await counters(ME)).followers).toBe(0);
    expect((await counters(OTHER)).following).toBe(0);
    expect((await counters(OTHER)).followers).toBe(0);
  });

  it('akit ÉN tiltottam le: látom a fejlécet és a tiltás tényét', async () => {
    await call('/masik/block', 'POST');
    const result = await call('/masik');
    expect(result.status).toBe(200);
    expect(result.body.restricted).toBe(true);
    expect(result.body.relationship.blocked).toBe(true);
    expect(result.body.profile.username).toBe('Masik');
  });

  it('aki ENGEM tiltott le: 404, nem „le vagy tiltva”', async () => {
    currentUid = OTHER;
    await call('/en/block', 'POST');
    currentUid = ME;

    const result = await call('/masik');
    expect(result.status).toBe(404);
    expect(result.body.code).toBe('user_not_found');
  });

  it('letiltottat nem lehet követni, feloldás után igen', async () => {
    await call('/masik/block', 'POST');
    const blocked = await call('/masik/follow', 'POST');
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('blocked');

    await call('/masik/block', 'DELETE');
    expect((await call('/masik/follow', 'POST')).body.status).toBe('following');
  });

  /* ── Bejelentés ──────────────────────────────────────────────── */

  it('a bejelentés a kategóriának megfelelő ágra kerül', async () => {
    const result = await call('/masik/report', 'POST', { category: 'gps_spoof', note: 'Repült.' });
    expect(result.status).toBe(200);

    const reports = await db.collection('reports').get();
    expect(reports.size).toBe(1);
    const report = reports.docs[0]!.data();
    expect(report.branch).toBe('technical');
    expect(report.targetType).toBe('user');
    expect(report.targetId).toBe(OTHER);
    expect(report.reporterId).toBe(ME);
    expect(report.status).toBe('open');
  });

  it('a sértő tartalom a tartalmi ágra megy', async () => {
    await call('/masik/report', 'POST', { category: 'offensive' });
    const reports = await db.collection('reports').get();
    expect(reports.docs[0]!.data().branch).toBe('content');
  });

  it('ismeretlen kategóriát visszautasít', async () => {
    const result = await call('/masik/report', 'POST', { category: 'nem_letezik' });
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('invalid_category');
    expect((await db.collection('reports').get()).size).toBe(0);
  });

  it('ugyanarról a felhasználóról nem lehet kétszer nyitott bejelentés', async () => {
    await call('/masik/report', 'POST', { category: 'other' });
    const second = await call('/masik/report', 'POST', { category: 'other' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('already_reported');
    expect((await db.collection('reports').get()).size).toBe(1);
  });
});
