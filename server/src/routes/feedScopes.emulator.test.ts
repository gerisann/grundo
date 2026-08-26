/**
 * A feed ÚJ nézetei valódi Firestore ellen: `following` és `user`.
 *
 * Amit itt bizonyítani kell, mert egyik sem következik a kódra ránézésből:
 *   - a `following` a követési gráfból dolgozik, és NEM hozza azok
 *     aktivitásait, akiket nem követek,
 *   - a 30-as `in` korláton túl is teljes marad a lista, és az összefésült
 *     eredmény IDŐRENDBEN jön — nem darabonként csoportosítva (ez a merge
 *     legvalószínűbb hibája),
 *   - idegen profilon csak a `visibility: 'everyone'` aktivitás látszik, a
 *     sajátomon a rejtett is.
 *
 * FUTTATÁS (a repo gyökeréből): `npm.cmd run test:emulator`
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

const ME = 'feed-en';

describe.skipIf(!EMULATOR)('Feed-nézetek — valódi Firestore ellen', () => {
  let server: Server;
  let base: string;
  let db: FirebaseFirestore.Firestore;

  beforeAll(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;

    const { activitiesRouter } = await import('./activities');
    const { HttpError } = await import('../lib/errors');

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { uid?: string }).uid = ME;
      next();
    });
    app.use('/api/activities', activitiesRouter);
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

  beforeEach(async () => {
    for (const name of ['activities', 'users']) {
      const snap = await db.collection(name).get();
      for (const doc of snap.docs) {
        const following = await doc.ref.collection('following').get();
        for (const edge of following.docs) await edge.ref.delete();
        await doc.ref.delete();
      }
    }
  });

  /** Egy minimális, de a feed számára teljes értékű aktivitás. */
  async function seedActivity(
    id: string,
    userId: string,
    startedAt: Date,
    visibility: 'everyone' | 'only_me' = 'everyone',
  ) {
    await db.collection('activities').doc(id).set({
      userId,
      type: 'run',
      layer: 'foot',
      visibility,
      startedAt,
      distanceM: 5000,
      movingS: 1800,
      areaGainedM2: 0,
      route: '',
      likeCount: 0,
      commentCount: 0,
    });
  }

  async function seedUser(uid: string) {
    await db
      .collection('users')
      .doc(uid)
      .set({ username: uid, usernameLower: uid, photoURL: null });
  }

  async function follow(targetUid: string) {
    await db
      .collection('users')
      .doc(ME)
      .collection('following')
      .doc(targetUid)
      .set({ createdAt: new Date() });
  }

  async function feed(query: string): Promise<any> {
    const response = await fetch(`${base}/api/activities?${query}`);
    return response.json();
  }

  /**
   * A RÉGI aktivitásokon nincs `claimCounts` — a mentés csak 2026-08-26 óta
   * írja. A rivális-sáv mégis megjelenik rajtuk: a károsultak a
   * `territoryEvents`-ből visszatöltött `stolenFrom`-ból jönnek, a szerzett
   * mezők száma pedig az `areaGainedM2`-ből, ami definíció szerint
   * `cellák × CELL_AREA_M2`.
   *
   * Ez a teszt azt rögzíti, hogy a visszaosztás EGÉSZ számot ad, és hogy a
   * szabad föld a maradék — vagyis a `+N` és a lila/korall arány a régi
   * sorokon is helyes. Kódra ránézésből ez nem látszik: a hányados
   * lebegőpontos, és egy elrontott kerekítés csendben egyel kevesebb mezőt
   * mutatna.
   */
  it('a régi, `claimCounts` nélküli aktivitáson is helyes a rivális-sáv', async () => {
    await seedUser('aldozat');
    await seedUser('masik');
    // 79 mező × 307,09 m² — valódi éles arány (2026-08-18), ebből 7 lopott.
    await db.collection('activities').doc('regi').set({
      userId: ME,
      type: 'run',
      layer: 'foot',
      visibility: 'everyone',
      startedAt: new Date('2026-08-18T10:00:00Z'),
      distanceM: 5000,
      movingS: 1800,
      areaGainedM2: Math.round(79 * 307.09),
      stolenFrom: { aldozat: 5, masik: 2 },
      route: '',
      likeCount: 0,
      commentCount: 0,
    });

    const result = await feed('scope=world');
    const row = result.activities.find((item: any) => item.id === 'regi');

    expect(row.cellsGained).toBe(79);
    expect(row.cellsStolen).toBe(7);
    // A sáv lila fele: 79 − 7 = 72 mező szabad földről.
    expect(row.cellsGained - row.cellsStolen).toBe(72);
    // A legtöbbet vesztett áll elöl — az ő képe kerül a villámhoz.
    expect(row.victims.map((v: any) => [v.username, v.cells])).toEqual([
      ['aldozat', 5],
      ['masik', 2],
    ]);
  });

  it('a követett feed üres, ha nem követek senkit', async () => {
    await seedUser('idegen');
    await seedActivity('a1', 'idegen', new Date('2026-08-19T10:00:00Z'));

    const result = await feed('scope=following');
    expect(result.activities).toEqual([]);
  });

  it('csak a KÖVETETT emberek aktivitásai jönnek', async () => {
    await seedUser('kovetett');
    await seedUser('idegen');
    await seedActivity('a1', 'kovetett', new Date('2026-08-19T10:00:00Z'));
    await seedActivity('a2', 'idegen', new Date('2026-08-19T11:00:00Z'));
    await follow('kovetett');

    const result = await feed('scope=following');
    expect(result.activities.map((row: any) => row.id)).toEqual(['a1']);
  });

  /**
   * A LÉNYEGI eset: 35 követett ember két `in` darabra esik. Ha az összefésülés
   * hiányozna, a lista darabonként csoportosítva jönne — az első 30 ember
   * bejegyzései előbb, majd az utolsó 5-é —, és az időrend széttörne.
   */
  it('a 30-as `in` korláton túl is időrendben jön a lista', async () => {
    const base = new Date('2026-08-01T00:00:00Z').getTime();
    for (let index = 0; index < 35; index += 1) {
      const uid = `tag${String(index).padStart(2, '0')}`;
      await seedUser(uid);
      // A KÉSŐBBI index KORÁBBI időpont: a helyes sorrend így pont fordítottja
      // annak, ahogy a darabok egymás után jönnének.
      await seedActivity(`akt${index}`, uid, new Date(base - index * 3_600_000));
      await follow(uid);
    }

    const result = await feed('scope=following&limit=35');
    const times = result.activities.map((row: any) => row.startedAt);
    expect(result.activities).toHaveLength(35);
    expect([...times].sort((a: number, b: number) => b - a)).toEqual(times);
    expect(result.activities[0].id).toBe('akt0');
  });

  it('idegen profilján csak a nyilvános aktivitás látszik', async () => {
    await seedUser('idegen');
    await seedActivity('nyilvanos', 'idegen', new Date('2026-08-19T10:00:00Z'), 'everyone');
    await seedActivity('rejtett', 'idegen', new Date('2026-08-19T11:00:00Z'), 'only_me');

    const result = await feed('scope=user&userId=idegen');
    expect(result.activities.map((row: any) => row.id)).toEqual(['nyilvanos']);
  });

  it('a SAJÁT profilomon a rejtett aktivitásom is látszik', async () => {
    await seedUser(ME);
    await seedActivity('sajat-rejtett', ME, new Date('2026-08-19T11:00:00Z'), 'only_me');

    const result = await feed(`scope=user&userId=${ME}`);
    expect(result.activities.map((row: any) => row.id)).toEqual(['sajat-rejtett']);
  });

  it('a `user` nézet felhasználó nélkül hibát ad, nem üres listát', async () => {
    const response = await fetch(`${base}/api/activities?scope=user`);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('missing_user');
  });
});
