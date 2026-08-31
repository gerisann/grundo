/** Az aktivitásfotó API jogosultsági tesztje valódi Firestore + Storage ellen. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-grundo';
const DATABASE = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';

describe.skipIf(!EMULATOR)('GET /api/activities/:id/photos/:fileName', () => {
  let server: Server;
  let base: string;
  let currentUid = 'bob';
  let db: FirebaseFirestore.Firestore;
  let bucket: ReturnType<(typeof import('../lib/firebase'))['storage']['bucket']>;
  const activityId = 'activity-media1';
  const path = `activities/alice/${activityId}/photo.jpg`;

  beforeAll(async () => {
    const firebase = await import('../lib/firebase');
    db = firebase.db;
    bucket = firebase.storage.bucket(firebase.FIREBASE_STORAGE_BUCKET);

    const { activitiesRouter } = await import('./activities');
    const { HttpError } = await import('../lib/errors');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { uid?: string }).uid = currentUid;
      next();
    });
    app.use('/api/activities', activitiesRouter);
    app.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        if (error instanceof HttpError) {
          return res.status(error.status).json({ code: error.code, message: error.message });
        }
        return res.status(500).json({ message: String((error as Error)?.message ?? error) });
      },
    );

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    const url = `http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
    await fetch(url, { method: 'DELETE' });
    currentUid = 'bob';
    await Promise.all([
      db.collection('users').doc('alice').set({ username: 'alice' }),
      db.collection('users').doc('bob').set({ username: 'bob' }),
      db.collection('activities').doc(activityId).set({
        userId: 'alice',
        visibility: 'everyone',
        startedAt: new Date(),
        photos: [{ path, url: 'https://legacy-token.example/photo.jpg' }],
      }),
      bucket.file(path).save(Buffer.from([1, 2, 3]), { contentType: 'image/jpeg' }),
    ]);
  });

  it('a látható képet binárisan adja vissza, tartós URL kiszivárogtatása nélkül', async () => {
    const response = await fetch(`${base}/api/activities/${activityId}/photos/photo.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const detail = await fetch(`${base}/api/activities/${activityId}`);
    const body = (await detail.json()) as {
      activity: { photos: Array<{ path: string; url: string }> };
    };
    expect(body.activity.photos).toHaveLength(1);
    expect(body.activity.photos[0]!.path).toBe(path);
    expect(body.activity.photos[0]!.url).toContain('X-Goog-Expires=900');
    expect(body.activity.photos[0]!.url).not.toContain('legacy-token');

    // A már telepített natív kliens ezt a mezőt közvetlenül `<img src>`-ként
    // használja, Authorization fejléc nélkül — ezért a tényleges letöltést is
    // ellenőrizzük, nem csak azt, hogy URL alakú sztring érkezett.
    const legacyResponse = await fetch(body.activity.photos[0]!.url);
    expect(legacyResponse.status).toBe(200);
    expect(new Uint8Array(await legacyResponse.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const feed = await fetch(`${base}/api/activities?scope=world&limit=5`);
    const feedBody = (await feed.json()) as {
      activities: Array<{ photos: Array<{ path: string; url: string }> }>;
    };
    expect(feedBody.activities[0]!.photos[0]).toMatchObject({ path, url: expect.any(String) });
  });

  it('a csak saját aktivitás képét idegennek 404-ként rejti el', async () => {
    await db.collection('activities').doc(activityId).update({ visibility: 'only_me' });
    const response = await fetch(`${base}/api/activities/${activityId}/photos/photo.jpg`);
    expect(response.status).toBe(404);
  });

  it('a követőknek szánt képet csak elfogadott követő kapja meg', async () => {
    await db.collection('activities').doc(activityId).update({ visibility: 'followers' });
    const hidden = await fetch(`${base}/api/activities/${activityId}/photos/photo.jpg`);
    expect(hidden.status).toBe(404);

    await db.collection('users').doc('bob').collection('following').doc('alice').set({});
    const visible = await fetch(`${base}/api/activities/${activityId}/photos/photo.jpg`);
    expect(visible.status).toBe(200);
  });

  it('tiltás esetén a publikus kép sem olvasható', async () => {
    await db.collection('users').doc('alice').collection('blocks').doc('bob').set({});
    const response = await fetch(`${base}/api/activities/${activityId}/photos/photo.jpg`);
    expect(response.status).toBe(404);
  });
});
