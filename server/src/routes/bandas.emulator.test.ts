/**
 * Bandák VALÓDI Firestore ellen.
 *
 * Amit itt bizonyítani kell, és amit egy mockolt adatbázis NEM bizonyítana:
 *   - a létrehozás EGYSZERRE írja a banda dokumentumot, a tag-alkollekciót
 *     és a `users/{uid}/bandas` tükröt (batch), és a `GET /mine` erre épül,
 *   - privát bandánál a meghívókód EGYEDI (`inviteCodes/{code}` tranzakció),
 *   - a csatlakozás tranzakciós — kétszer nem lehet tag valaki,
 *   - privát banda idegen tagnak `forbidden`, tagnak látszik.
 *
 * FUTTATÁS (a repo gyökeréből): `npm.cmd run test:emulator`
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

const OWNER = 'uid-alapito';
const OTHER = 'uid-masik';

describe.skipIf(!EMULATOR)('Bandák API — valódi Firestore ellen', () => {
  let server: Server;
  let base: string;
  let db: FirebaseFirestore.Firestore;
  let currentUid = OWNER;

  beforeAll(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;

    const { bandasRouter } = await import('./bandas');
    const { HttpError } = await import('../lib/errors');

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { uid?: string }).uid = currentUid;
      next();
    });
    app.use('/api/bandas', bandasRouter);
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

  async function wipe() {
    const bandas = await db.collection('bandas').get();
    for (const doc of bandas.docs) {
      const members = await doc.ref.collection('members').get();
      for (const member of members.docs) await member.ref.delete();
      await doc.ref.delete();
    }
    const codes = await db.collection('inviteCodes').get();
    for (const doc of codes.docs) await doc.ref.delete();
    for (const uid of [OWNER, OTHER]) {
      const mine = await db.collection('users').doc(uid).collection('bandas').get();
      for (const doc of mine.docs) await doc.ref.delete();
    }
  }

  /** A `GET /:id/members` a `users/{uid}` dokumentumból olvassa a nevet. */
  async function makeUser(uid: string, username: string) {
    await db.collection('users').doc(uid).set({ username, photoURL: null });
  }

  beforeEach(async () => {
    currentUid = OWNER;
    await wipe();
    await makeUser(OWNER, 'alapito');
    await makeUser(OTHER, 'masik');
  });

  function call(path: string, uid: string, init?: RequestInit) {
    currentUid = uid;
    return fetch(`${base}/api/bandas${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  }

  it('publikus banda létrehozása: a hívó owner lesz, meghívókód nincs', async () => {
    const res = await call('/', OWNER, {
      method: 'POST',
      body: JSON.stringify({ name: 'Gazdagréti Grundozók', visibility: 'public' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe('owner');
    expect(body.inviteCode).toBeNull();
    expect(body.banda.memberCount).toBe(1);

    const mine = await (await call('/mine', OWNER)).json();
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].role).toBe('owner');
  });

  it('privát banda létrehozása egyedi meghívókódot ad', async () => {
    const res = await call('/', OWNER, {
      method: 'POST',
      body: JSON.stringify({ name: 'Titkos Banda', visibility: 'private' }),
    });
    const body = await res.json();
    expect(typeof body.inviteCode).toBe('string');
    expect(body.inviteCode).toHaveLength(8);

    const codeDoc = await db.collection('inviteCodes').doc(body.inviteCode).get();
    expect(codeDoc.exists).toBe(true);
    expect(codeDoc.data()?.bandaId).toBe(body.banda.id);
  });

  it('publikus bandához azonnal csatlakozhat más felhasználó, kétszer nem', async () => {
    const created = await (
      await call('/', OWNER, {
        method: 'POST',
        body: JSON.stringify({ name: 'Nyílt Banda', visibility: 'public' }),
      })
    ).json();
    const bandaId = created.banda.id as string;

    const joined = await call(`/${bandaId}/join`, OTHER, { method: 'POST' });
    expect(joined.status).toBe(200);
    expect((await joined.json()).role).toBe('member');

    const again = await call(`/${bandaId}/join`, OTHER, { method: 'POST' });
    expect(again.status).toBe(409);

    const detail = await (await call(`/${bandaId}`, OWNER)).json();
    expect(detail.banda.memberCount).toBe(2);

    const members = await (await call(`/${bandaId}/members`, OWNER)).json();
    expect(members.items.map((m: { uid: string }) => m.uid).sort()).toEqual([OTHER, OWNER].sort());
  });

  it('privát bandához meghívókóddal csatlakozhat, érvénytelen kóddal nem', async () => {
    const created = await (
      await call('/', OWNER, {
        method: 'POST',
        body: JSON.stringify({ name: 'Zárt Banda', visibility: 'private' }),
      })
    ).json();

    const bad = await call('/join-by-code', OTHER, {
      method: 'POST',
      body: JSON.stringify({ code: 'HIBAKOD1' }),
    });
    expect(bad.status).toBe(404);

    const good = await call('/join-by-code', OTHER, {
      method: 'POST',
      body: JSON.stringify({ code: created.inviteCode }),
    });
    expect(good.status).toBe(200);
    expect((await good.json()).bandaId).toBe(created.banda.id);
  });

  it('privát banda idegen felhasználónak forbidden, tagnak látszik', async () => {
    const created = await (
      await call('/', OWNER, {
        method: 'POST',
        body: JSON.stringify({ name: 'Csak Nekünk', visibility: 'private' }),
      })
    ).json();
    const bandaId = created.banda.id as string;

    const stranger = await call(`/${bandaId}`, OTHER);
    expect(stranger.status).toBe(403);

    await call('/join-by-code', OTHER, {
      method: 'POST',
      body: JSON.stringify({ code: created.inviteCode }),
    });

    const member = await call(`/${bandaId}`, OTHER);
    expect(member.status).toBe(200);
    expect((await member.json()).role).toBe('member');
  });
});
