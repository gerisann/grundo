/**
 * Teszt-adat a HELYI EMULÁTORBA — hogy a felületeket végig lehessen kattintani.
 *
 * MIÉRT VAN ERRE SZÜKSÉG? Mert a GRUNDO képernyőinek nagy része bejelentkezés
 * nélkül meg sem jelenik, az éles adaton való próbálgatás pedig valódi
 * következményekkel jár (egy törölt értesítés tényleg eltűnik). Az emulátor
 * homokozó: a benne lévő minden adat a leállításkor elszáll, és a `demo-`
 * előtagú projektazonosító miatt a Firebase eszközei hozzá sem nyúlnak az
 * éles `grundo` projekthez.
 *
 * MIT HOZ LÉTRE?
 *   - egy bejelentkezhető teszt-fiókot (`geri@grundo.local`),
 *   - a profilját, négy másik felhasználót, követéseket mindkét irányban,
 *   - 25 értesítést vegyes típussal és olvasottsággal (a lapozáshoz 20-nál
 *     többet), és
 *   - egy tárolt pozíciót, hogy az időjárás-widget magától megjelenjen.
 *
 * FUTTATÁS (a `server/` mappából, futó emulátor mellett):
 *
 *   npm run seed:emulator
 *
 * A szkript MEGTAGADJA a futást, ha nem emulátorra mutat a környezet.
 */

/*
  A környezeti változóknak a firebase-admin BETÖLTÉSE ELŐTT kell megvenniük a
  helyüket — az `../lib/firebase` modul importáláskor azonnal inicializál.
  Ezért van itt dinamikus import lentebb, és ezért nem a fájl tetején.
*/
export {};

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8081';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-grundo';

if (!process.env.GOOGLE_CLOUD_PROJECT.startsWith('demo-')) {
  throw new Error(
    `Ez a szkript csak emulátorba tölt. A GOOGLE_CLOUD_PROJECT (${process.env.GOOGLE_CLOUD_PROJECT}) ` +
      'nem `demo-` előtagú — állítsd át, vagy ne futtasd.',
  );
}

const { auth, db, COLLECTIONS } = await import('../lib/firebase');

/** A bejelentkezhető teszt-fiók. A jelszó szándékosan nyilvános: emulátoré. */
const ME = { uid: 'demo-geri', email: 'geri@grundo.local', password: 'grundo-emulator' };

const PEOPLE = [
  { uid: 'demo-kata', username: 'Kata_fut' },
  { uid: 'demo-peti', username: 'Peti' },
  { uid: 'demo-zsofi', username: 'ZsofiWalks' },
  { uid: 'demo-mark', username: 'MarkOnBike' },
];

const DAY = 24 * 60 * 60 * 1000;

async function makeUser(uid: string, username: string, extra: Record<string, unknown> = {}) {
  await db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .set({
      username,
      usernameLower: username.toLowerCase(),
      photoURL: null,
      createdAt: new Date(Date.now() - 90 * DAY),
      pro: { active: false },
      gpTotal: 120,
      territoryM2: { foot: 12_000, bike: 0 },
      // A ranglista ezt kéri, nem a nyers `territoryM2`-t — lásd
      // `routes/tiles.ts` → GET /leaderboard.
      hasOwnedArea: { foot: true, bike: false },
      cellCount: { foot: 39, bike: 0 },
      zoneCount: { foot: 1, bike: 0 },
      streak: { current: 1, longest: 4, weeks: 0 },
      counters: {
        activities: 3,
        followers: 0,
        following: 0,
        distanceKm: { run: 12, walk: 4, ride: 0 },
      },
      privacy: { account: 'public' },
      ...extra,
    });
  await db.collection(COLLECTIONS.usernames).doc(username.toLowerCase()).set({ uid, username });
}

/** Követés MINDKÉT éllel és a számlálókkal — ahogy a szerver is írná. */
async function follow(followerUid: string, targetUid: string) {
  const users = db.collection(COLLECTIONS.users);
  const batch = db.batch();
  batch.set(users.doc(followerUid).collection('following').doc(targetUid), {
    createdAt: new Date(),
  });
  batch.set(users.doc(targetUid).collection('followers').doc(followerUid), {
    createdAt: new Date(),
  });
  await batch.commit();

  const bump = async (uid: string, field: 'followers' | 'following') => {
    const ref = users.doc(uid);
    const snap = await ref.get();
    const counters = (snap.data()?.counters ?? {}) as Record<string, number>;
    await ref.update({ [`counters.${field}`]: (counters[field] ?? 0) + 1 });
  };
  await bump(followerUid, 'following');
  await bump(targetUid, 'followers');
}

const NOTIFICATIONS = [
  { type: 'territory_stolen', title: 'Elvették a területed', body: 'Kata_fut átment a gazdagréti körödön — 12 mező gazdát cserélt.' },
  { type: 'territory_defended', title: 'Megvédted a területed', body: 'Peti nekifutott a Csíkihegyek utcai blokkodnak, de nem tört át.' },
  { type: 'gp_activity', title: '+29 GP', body: 'Reggeli kör a Duna-parton — 1,55 km, 91 mező.' },
  { type: 'gp_daily', title: 'Napi tartás-bónusz', body: '+18 GP a megtartott területeidért.' },
  { type: 'activity_liked', title: 'Kata_fut kedvelte az aktivitásod', body: 'Esti kör' },
  { type: 'activity_commented', title: 'Peti hozzászólt', body: '„Ezt a kört én is szeretem, főleg naplementében."' },
  { type: 'comment_replied', title: 'ZsofiWalks válaszolt neked', body: '„Legközelebb együtt!"' },
  { type: 'badge_awarded', title: 'Új jelvény: Éjszakai bagoly', body: 'Öt aktivitás sötétedés után.' },
  { type: 'new_follower', title: 'MarkOnBike követni kezdett', body: '' },
  { type: 'followed_activity', title: 'Kata_fut futott egyet', body: '6,2 km a Normafán.' },
  { type: 'modifier_started', title: 'Gazdagrét Rush indult', body: 'Két órán át dupla GP mindenkinek.' },
];

async function seedNotifications() {
  const items = db.collection('notifications').doc(ME.uid).collection('items');
  const existing = await items.get();
  for (const doc of existing.docs) await doc.ref.delete();

  /*
    25 sor, hogy a LAPOZÁS is látszódjon: a panel 20-szal indul, a
    „továbbiak" gomb csak akkor jelenik meg, ha van 21. Az első hat
    olvasatlan — ennyivel a harang pöttye és a húzásos „olvasott" is
    kipróbálható.
  */
  for (let index = 0; index < 25; index += 1) {
    const template = NOTIFICATIONS[index % NOTIFICATIONS.length]!;
    await items.add({
      ...template,
      data: {},
      read: index >= 6,
      createdAt: new Date(Date.now() - index * 3 * 60 * 60 * 1000),
    });
  }
  return 25;
}

/* ── Futás ────────────────────────────────────────────────────────── */

console.log(`Projekt: ${process.env.GOOGLE_CLOUD_PROJECT}`);
console.log(`Firestore: ${process.env.FIRESTORE_EMULATOR_HOST}`);
console.log(`Auth: ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);

// A fiók újratöltésnél is ugyanaz maradjon: előbb töröljük, aztán létrehozzuk.
await auth.deleteUser(ME.uid).catch(() => {});
await auth.createUser({
  uid: ME.uid,
  email: ME.email,
  password: ME.password,
  displayName: 'Gerivagyok',
  emailVerified: true,
});

await makeUser(ME.uid, 'Gerivagyok', {
  gpTotal: 570,
  territoryM2: { foot: 278_000, bike: 0 },
  cellCount: { foot: 905, bike: 0 },
  zoneCount: { foot: 4, bike: 0 },
  streak: { current: 3, longest: 11, weeks: 2 },
  counters: {
    activities: 12,
    followers: 0,
    following: 0,
    distanceKm: { run: 84, walk: 31, ride: 12 },
  },
});

for (const person of PEOPLE) await makeUser(person.uid, person.username);

// Hárman követnek engem, én kettőt követek — a profil két számlálója így nem
// ugyanazt a számot mutatja, tehát a listák sem cserélhetők fel észrevétlenül.
await follow('demo-kata', ME.uid);
await follow('demo-peti', ME.uid);
await follow('demo-zsofi', ME.uid);
await follow(ME.uid, 'demo-kata');
await follow(ME.uid, 'demo-mark');

// Tárolt pozíció (Gazdagrét) — enélkül az időjárás-widget engedélyt kérne.
await db
  .collection(COLLECTIONS.users)
  .doc(ME.uid)
  .collection('private')
  .doc('position')
  .set({ lat: 47.4735, lng: 18.9975, updatedAt: new Date() });

const notifications = await seedNotifications();

console.log('\nKész.');
console.log(`  felhasználó:   ${ME.email} / ${ME.password} (uid: ${ME.uid})`);
console.log(`  további fiók:  ${PEOPLE.length}`);
console.log('  követés:       3 követő, 2 követett');
console.log(`  értesítés:     ${notifications} (ebből 6 olvasatlan)`);
console.log('\nA böngészőben: await __grundoDevSignIn()');
process.exit(0);
