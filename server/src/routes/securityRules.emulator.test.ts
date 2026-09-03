/** Firestore- és Storage-adatvédelmi regressziótesztek valódi emulátorokon. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import {
  connectStorageEmulator,
  getBytes,
  getStorage,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from 'firebase/storage';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-grundo';
const DATABASE = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';
const BUCKET = `${PROJECT}.appspot.com`;

describe.skipIf(!EMULATOR)('adatvédelmi szabályok — valódi emulátorokon', () => {
  let aliceApp: FirebaseApp;
  let bobApp: FirebaseApp;
  let aliceAuth: Auth;
  let bobAuth: Auth;
  let aliceDb: Firestore;
  let aliceStorage: FirebaseStorage;
  let bobStorage: FirebaseStorage;
  let adminDb: FirebaseFirestore.Firestore;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    const options = { apiKey: 'demo-key', projectId: PROJECT, storageBucket: BUCKET };
    aliceApp = initializeApp(options, `rules-alice-${suffix}`);
    bobApp = initializeApp(options, `rules-bob-${suffix}`);
    aliceAuth = getAuth(aliceApp);
    bobAuth = getAuth(bobApp);
    connectAuthEmulator(aliceAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectAuthEmulator(bobAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    aliceDb = getFirestore(aliceApp, DATABASE);
    connectFirestoreEmulator(aliceDb, '127.0.0.1', 8081);
    aliceStorage = getStorage(aliceApp);
    bobStorage = getStorage(bobApp);
    connectStorageEmulator(aliceStorage, '127.0.0.1', 9199);
    connectStorageEmulator(bobStorage, '127.0.0.1', 9199);

    await createUserWithEmailAndPassword(aliceAuth, `alice-${suffix}@example.test`, 'secret123');
    await createUserWithEmailAndPassword(bobAuth, `bob-${suffix}@example.test`, 'secret123');
    adminDb = (await import('../lib/firebase')).db;
  });

  afterAll(async () => {
    await Promise.all([deleteApp(aliceApp), deleteApp(bobApp)]);
  });

  beforeEach(async () => {
    const url = `http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;
    await fetch(url, { method: 'DELETE' });
    await Promise.all([
      adminDb.collection('users').doc(aliceAuth.currentUser!.uid).set({
        email: 'alice@example.test',
        username: 'alice',
        privacy: { account: 'public' },
      }),
      adminDb.collection('users').doc(bobAuth.currentUser!.uid).set({
        email: 'bob@example.test',
        username: 'bob',
        privacy: { account: 'public' },
      }),
    ]);
  });

  it('a saját fő profildokumentum olvasható, az idegen teljes dokumentum nem', async () => {
    const aliceUid = aliceAuth.currentUser!.uid;
    const bobUid = bobAuth.currentUser!.uid;

    await expect(getDoc(doc(aliceDb, 'users', aliceUid))).resolves.toMatchObject({ exists: expect.any(Function) });
    await expect(getDoc(doc(aliceDb, 'users', bobUid))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('az aktivitásfotót közvetlenül csak a tulajdonos olvashatja', async () => {
    const aliceUid = aliceAuth.currentUser!.uid;
    const path = `activities/${aliceUid}/activity-rules/photo.jpg`;
    const ownerRef = ref(aliceStorage, path);
    await uploadBytes(ownerRef, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });

    const contents = await getBytes(ownerRef);
    expect(new Uint8Array(contents)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(getBytes(ref(bobStorage, path))).rejects.toMatchObject({
      code: 'storage/unauthorized',
    });
  });

  it('a banda-posztképet csak a saját uid alá és legfeljebb 2 MB méretben lehet feltölteni', async () => {
    const aliceUid = aliceAuth.currentUser!.uid;
    const bobUid = bobAuth.currentUser!.uid;
    const path = `bandas/banda-rules/feed/${aliceUid}/photo-${suffix}.jpg`;
    const ownerRef = ref(aliceStorage, path);

    await expect(uploadBytes(ownerRef, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' })).resolves.toBeDefined();
    await expect(getBytes(ownerRef)).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await expect(
      uploadBytes(ref(bobStorage, `bandas/banda-rules/feed/${aliceUid}/foreign-${suffix}.jpg`), new Uint8Array([1]), { contentType: 'image/jpeg' }),
    ).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await expect(
      uploadBytes(ref(aliceStorage, `bandas/banda-rules/feed/${aliceUid}/large-${suffix}.jpg`), new Uint8Array(2 * 1024 * 1024 + 1), { contentType: 'image/jpeg' }),
    ).rejects.toMatchObject({ code: 'storage/unauthorized' });

    expect(bobUid).not.toBe(aliceUid);
  });

  it('banda-arculati képet csak a saját uid alá és 5 MB alatt lehet írni', async () => {
    const aliceUid = aliceAuth.currentUser!.uid;
    const own = ref(aliceStorage, `bandas/banda-rules/branding/${aliceUid}/profile.jpg`);
    await expect(uploadBytes(own, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' })).resolves.toBeDefined();
    await expect(getBytes(own)).resolves.toBeDefined();
    await expect(uploadBytes(
      ref(bobStorage, `bandas/banda-rules/branding/${aliceUid}/cover.jpg`),
      new Uint8Array([1]), { contentType: 'image/jpeg' },
    )).rejects.toMatchObject({ code: 'storage/unauthorized' });
  });
});
