/**
 * Az értesítési KAPU valódi Firestore ellen.
 *
 * A fejléc szerint `createNotification` az EGYETLEN hely, ahol a
 * felhasználó kapcsolóit ellenőrizzük — ez a tulajdonság itt van
 * bizonyítva: egy kikapcsolt típus se alkalmazáson belüli sort, se
 * (elméletben) push-t nem kap. A push-küldést magát nem teszteljük itt
 * (ahhoz valódi FCM-tokenre lenne szükség) — az `sendPush` üres token-
 * listánál nem csinál semmit, ezt viszont a "nincs eszköz regisztrálva"
 * teszt fedi.
 *
 * FUTTATÁS (a repo gyökeréből): `npm.cmd run test:emulator`
 * Emulátor nélkül a fájl MAGÁTÓL KIMARAD.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const UID = 'notif-teszt-uid';

describe.skipIf(!EMULATOR)('createNotification — valódi Firestore ellen', () => {
  let db: FirebaseFirestore.Firestore;
  let createNotification: typeof import('./notifications').createNotification;

  beforeAll(async () => {
    const firebase = await import('./firebase');
    db = firebase.db;
    const notifications = await import('./notifications');
    createNotification = notifications.createNotification;
  });

  afterAll(async () => {
    // Semmi teendő — az emulátor a futás végén magától leáll.
  });

  beforeEach(async () => {
    const items = await db.collection('notifications').doc(UID).collection('items').get();
    for (const doc of items.docs) await doc.ref.delete();
    await db.collection('users').doc(UID).collection('private').doc('settings').delete();
    const tokens = await db.collection('devices').doc(UID).collection('tokens').get();
    for (const doc of tokens.docs) await doc.ref.delete();
  });

  async function items() {
    const snap = await db.collection('notifications').doc(UID).collection('items').get();
    return snap.docs.map((doc) => doc.data());
  }

  it('alapból BE van kapcsolva minden típus — íródik az alkalmazáson belüli sor', async () => {
    await createNotification({ uid: UID, type: 'badge_awarded', title: 'Cím', body: 'Szöveg' });
    const rows = await items();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('badge_awarded');
    expect(rows[0]!.read).toBe(false);
  });

  it('kikapcsolt típusnál SEMMI nem íródik', async () => {
    await db
      .collection('users')
      .doc(UID)
      .collection('private')
      .doc('settings')
      .set({ notifications: { badge_awarded: false } });

    await createNotification({ uid: UID, type: 'badge_awarded', title: 'Cím', body: 'Szöveg' });
    expect(await items()).toHaveLength(0);
  });

  it('a kapcsoló TÍPUSONKÉNT hat, nem globálisan', async () => {
    await db
      .collection('users')
      .doc(UID)
      .collection('private')
      .doc('settings')
      .set({ notifications: { badge_awarded: false } });

    await createNotification({ uid: UID, type: 'badge_awarded', title: 'Jelvény', body: '' });
    await createNotification({ uid: UID, type: 'territory_stolen', title: 'Lopás', body: '' });

    const rows = await items();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('territory_stolen');
  });

  it('token nélküli felhasználónál a push csendben kimarad, az alkalmazáson belüli sor megvan', async () => {
    // Nincs `devices/{uid}/tokens` dokumentum — a `sendPush` üres listán
    // azonnal visszatér, nem dob, és a hívás sikeresen lefut.
    await expect(
      createNotification({ uid: UID, type: 'gp_daily', title: 'Napi összegzés', body: '+10 GP' }),
    ).resolves.toBeUndefined();
    expect(await items()).toHaveLength(1);
  });

  it('sose dob — egy hibás uid mellett is lefut, csak nem ír semmit', async () => {
    // Az `uid` üres string — a Firestore-hívás elhasal, de a `createNotification`
    // ezt elnyeli (lásd a `try/catch`-et a modul fejlécében leírtak szerint).
    await expect(
      createNotification({ uid: '', type: 'badge_awarded', title: 'Cím', body: '' }),
    ).resolves.toBeUndefined();
  });
});
