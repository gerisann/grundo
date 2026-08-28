/**
 * BUDAPESTI TESZT-AKTIVITÁSOK a területmegjelenítés próbájához.
 *
 * MIÉRT KELL? Mert a térkép területrétegét (az összefüggő foltokat, a
 * méret szerinti láthatóságot, a tulajdonosi színeket) csak VALÓDI,
 * változatos birtokviszonyon lehet értékelni. Egy-két kézzel rajzolt
 * blokkból nem derül ki, hogy a foltok összeolvadnak-e rendesen, hogy a
 * kizoomolt nézet a helyes méretűeket mutatja-e, és hogy a lopás
 * kettévágja-e az áldozat foltját.
 *
 * MIT HOZ LÉTRE? Alapból 100 kört Budapest fölött, néhány gócpontba
 * csoportosítva, 0,1 és 10 km² közötti területtel. Az egy gócponton belüli
 * körök szándékosan átfedik egymást — így keletkeznek nagy, összeolvadt
 * foltok és lopások is —, a gócpontok viszont külön állnak, hogy legyenek
 * önálló, kicsi foltok is.
 *
 * A szkript a VALÓDI végponton megy be (`POST /api/activities`), nem a
 * Firestore-ba ír közvetlenül: így a teljes mentési út lefut, beleértve a
 * területfoltok újraszámolását is.
 *
 * ⚠️ CSAK EMULÁTORRAL. A szkript megtagadja a futást, ha nem `demo-`
 * előtagú projektre néz.
 *
 * FUTTATÁS (futó emulátor ÉS futó backend mellett, a `server/` mappából):
 *
 *   npm run seed:budapest
 *   npm run seed:budapest -- --count 250
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

const args = process.argv.slice(2);
function argValue(name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const COUNT = Math.round(argValue('--count', 100));
const API_BASE = process.env.GRUNDO_API_BASE ?? 'http://127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;

/** Budapest — a vetített koordináták középpontja. */
const CENTRE = { lat: 47.4979, lng: 19.0402 };

/** A gócpontok ekkora sugarú körben szóródnak szét a középpont körül. */
const CLUSTER_SPREAD_KM = 5;
const CLUSTER_COUNT = 12;

/** A körök területének alsó és felső határa — a feladat kérése. */
const MIN_AREA_KM2 = 0.1;
const MAX_AREA_KM2 = 10;

const KM_PER_DEG_LAT = 111.32;
const kmPerDegLng = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

/**
 * Determinisztikus álvéletlen — hogy a szkript kétszer futtatva ugyanazt a
 * világot állítsa elő. Enélkül minden futás más képet adna, és nem lehetne
 * összehasonlítani, mit változtatott egy kódmódosítás.
 */
let seed = 20260828;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

interface Point {
  lat: number;
  lng: number;
  t: number;
}

interface Vec {
  x: number;
  y: number;
}

/**
 * SZÖGLETES, UTCAKÖVETŐ hurok — nem kör.
 *
 * Geri kérése (2026-08-28): a teszt-nyomvonalak ne mértani ívek legyenek,
 * hanem egyenes szakaszokból álló sokszögek, ahogy egy valódi városi kör
 * kinéz. Ez nem szépészeti kérdés: az ívelt hurok kerülete minden cellában
 * más szöget zár be a ráccsal, a derékszögű viszont hosszú, egyenes
 * cellaláncokat ad — a körvonal-egyszerűsítést és a foltok összeolvadását
 * épp ez teszi valósághűen próbára.
 *
 * A forma egy téglalap, amibe oldalanként „kitérőket" (jog) vágunk: a
 * nyomvonal egy darabon merőlegesen kilép, halad, majd visszalép. Minden
 * szakasz tengelyirányú marad, tehát a sarkok derékszögűek — mint a
 * háztömbök körüli futás. A végén az egészet elforgatjuk, mert az utcahálók
 * sem észak-déli tájolásúak.
 */
function rectilinearOutline(): Vec[] {
  const width = 1;
  const height = 0.6 + random() * 1;
  const corners: Vec[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  const outline: Vec[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    outline.push(a);

    // Nem minden oldal kap kitérőt — így nem lesz minden alak egyforma.
    if (random() > 0.65) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    // Merőleges egységvektor — ebbe az irányba lép ki a kitérő.
    const px = -uy;
    const py = ux;

    const from = (0.25 + random() * 0.2) * length;
    const to = from + (0.2 + random() * 0.25) * length;
    /**
     * A kitérő mélysége a RÖVIDEBB oldalhoz kötött, és legfeljebb annak
     * 18%-a. Enélkül két szemközti, befelé mutató kitérő átérhetne egymáson,
     * és a hurok önmagát metszené — abból pedig nem lesz zárt terület.
     */
    const depth = (0.12 + random() * 0.18) * Math.min(width, height) * (random() < 0.5 ? 1 : -1);

    outline.push({ x: a.x + ux * from, y: a.y + uy * from });
    outline.push({ x: a.x + ux * from + px * depth, y: a.y + uy * from + py * depth });
    outline.push({ x: a.x + ux * to + px * depth, y: a.y + uy * to + py * depth });
    outline.push({ x: a.x + ux * to, y: a.y + uy * to });
  }

  return outline;
}

/** Sokszög előjeles területe (cipőfűző-képlet) — a méretezéshez kell. */
function polygonArea(points: readonly Vec[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * A sokszög nyomvonala adott területtel.
 *
 * Az alakot NORMALIZÁLT egységekben állítjuk elő, kiszámoljuk a valódi
 * területét, és abból méretezzük a kívánt km²-re — így a szabálytalan
 * kitérők ellenére is pontosan akkora lesz a kör, amekkorát kértünk.
 *
 * Az éleket ~18 méterenként mintázzuk: egy res 12 cella átmérője ennyi,
 * tehát ennél sűrűbb mintavétel felesleges, ritkábbnál viszont lyukas lenne
 * a cellalánc.
 */
function loopTrack(
  centre: { lat: number; lng: number },
  areaKm2: number,
  startedAt: number,
  speedMps: number,
): Point[] {
  const outline = rectilinearOutline();
  const scale = Math.sqrt(areaKm2 / polygonArea(outline));
  const rotation = random() * Math.PI * 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Középre igazítás, méretezés, forgatás — km-ben, helyi síkon.
  const centroid = outline.reduce(
    (acc, p) => ({ x: acc.x + p.x / outline.length, y: acc.y + p.y / outline.length }),
    { x: 0, y: 0 },
  );
  const corners = outline.map((p) => {
    const x = (p.x - centroid.x) * scale;
    const y = (p.y - centroid.y) * scale;
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  });

  const points: Point[] = [];
  let travelledM = 0;

  const push = (corner: Vec, distanceM: number) => {
    points.push({
      lat: centre.lat + corner.y / KM_PER_DEG_LAT,
      lng: centre.lng + corner.x / kmPerDegLng(centre.lat),
      t: startedAt + Math.round((distanceM / speedMps) * 1000),
    });
  };

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const segmentM = Math.hypot(b.x - a.x, b.y - a.y) * 1000;
    const steps = Math.max(1, Math.round(segmentM / 18));

    // A szakasz VÉGPONTJÁT a következő szakasz kezdete adja, ezért itt csak
    // a kezdőpontot és a köztes mintákat írjuk ki — így nem duplázódnak a
    // sarkok, és szigorúan növekvő marad az idő.
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, travelledM + (segmentM * step) / steps);
    }
    travelledM += segmentM;
  }

  // A hurok ZÁRÁSA: az utolsó pont egybeesik az elsővel. Enélkül nem
  // záródna be a kör, és nem keletkezne elfoglalt terület.
  push(corners[0]!, travelledM);
  return points;
}

/**
 * A korábbi teszt-világ eltakarítása.
 *
 * MIÉRT KELL A `--reset`? Mert az aktivitás-azonosítók determinisztikusak
 * (hogy a szkript idempotens legyen), tehát újrafuttatáskor a végpont
 * ismétlésként dobná vissza mindet, és a rács a régi állapotban maradna.
 * Ha a megjelenítést akarjuk mérni, tiszta lappal kell indulni.
 *
 * A felhasználókat NEM törli — azokat a `seed:emulator` hozza létre.
 */
async function reset(db: FirebaseFirestore.Firestore, collections: string[]): Promise<void> {
  for (const name of collections) {
    let removed = 0;
    // Kötegelve, hogy egy nagy teszt-világ se feszítse szét a memóriát.
    for (;;) {
      const page = await db.collection(name).limit(400).get();
      if (page.empty) break;
      const batch = db.batch();
      for (const doc of page.docs) batch.delete(doc.ref);
      await batch.commit();
      removed += page.size;
    }
    // A blokkindex alkollekcióban él, ezért külön kell összeszedni.
    if (name === 'grid') {
      const indexes = await db.collectionGroup('blockIndex').get();
      for (let i = 0; i < indexes.docs.length; i += 400) {
        const batch = db.batch();
        for (const doc of indexes.docs.slice(i, i + 400)) batch.delete(doc.ref);
        await batch.commit();
      }
      removed += indexes.size;
    }
    console.log(`  törölve: ${name} (${removed})`);
  }
}

async function main() {
  const { auth, db, COLLECTIONS } = await import('../lib/firebase');

  if (args.includes('--reset')) {
    console.log('Teszt-világ ürítése…');
    await reset(db, [COLLECTIONS.activities, COLLECTIONS.grid, COLLECTIONS.territoryBlobs]);
    console.log('');
  }

  const usersSnapshot = await db.collection(COLLECTIONS.users).get();
  const users = usersSnapshot.docs
    .map((doc) => ({ uid: doc.id, username: (doc.data() as { username?: string }).username ?? doc.id }))
    .filter((user) => !user.uid.startsWith('rival-'));

  if (users.length === 0) {
    throw new Error('Nincs felhasználó az emulátorban. Futtasd előbb: npm run seed:emulator');
  }

  /**
   * KÜLÖNBÖZŐ CELLASZÍN minden teszt-felhasználónak.
   *
   * A `seed:emulator` nem állít színt, márpedig szín nélkül mindenki az
   * alapértelmezett palettaszínt kapja — és pont azt NEM lehetne ellenőrizni,
   * amiért ez az egész készült: hogy a térképen mindenki a SAJÁT színében
   * látszik-e. A paletta kulcsai a `src/lib/cellColors.ts`-ből valók.
   */
  const palette = ['electric-blue', 'neon-green', 'gold', 'hot-pink', 'coral', 'ice', 'neon-red'];
  await Promise.all(
    users.map((user, i) =>
      db
        .collection(COLLECTIONS.users)
        .doc(user.uid)
        .set({ cellColor: palette[i % palette.length] }, { merge: true }),
    ),
  );

  console.log(`Projekt:  ${process.env.GOOGLE_CLOUD_PROJECT}`);
  console.log(`Backend:  ${API_BASE}`);
  console.log(
    `Felhasználó: ${users.length} — ` +
      users.map((u, i) => `${u.username} (${palette[i % palette.length]})`).join(', '),
  );
  console.log(`Aktivitás: ${COUNT}\n`);

  // Bejelentkezési jegy felhasználónként. A custom tokent az Auth-emulátor
  // REST végpontja váltja át ID tokenre — ugyanaz az út, amit a kliens jár.
  const tokens = new Map<string, string>();
  for (const user of users) {
    const custom = await auth.createCustomToken(user.uid);
    const response = await fetch(
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: custom, returnSecureToken: true }),
      },
    );
    if (!response.ok) {
      throw new Error(`Nem sikerült bejelentkezni (${user.uid}): ${response.status} ${await response.text()}`);
    }
    tokens.set(user.uid, ((await response.json()) as { idToken: string }).idToken);
  }

  // A gócpontok: ide csoportosulnak a körök, hogy legyenek átfedő,
  // összeolvadó területek és önálló kis foltok is.
  const clusters = Array.from({ length: CLUSTER_COUNT }, () => {
    const angle = random() * Math.PI * 2;
    const distanceKm = Math.sqrt(random()) * CLUSTER_SPREAD_KM;
    return {
      lat: CENTRE.lat + (distanceKm / KM_PER_DEG_LAT) * Math.cos(angle),
      lng: CENTRE.lng + (distanceKm / kmPerDegLng(CENTRE.lat)) * Math.sin(angle),
    };
  });

  let created = 0;
  let duplicate = 0;
  let failed = 0;
  let totalAreaKm2 = 0;

  for (let i = 0; i < COUNT; i++) {
    const user = users[i % users.length]!;
    const cluster = clusters[i % clusters.length]!;

    /**
     * A terület LOGARITMIKUSAN oszlik el 0,1 és 10 km² között. Lineáris
     * eloszlásnál a minta majdnem minden eleme a felső tartományba esne, és
     * pont a kis foltok viselkedését — a méret szerinti eltűnést — nem
     * lehetne kipróbálni.
     */
    const areaKm2 = MIN_AREA_KM2 * Math.pow(MAX_AREA_KM2 / MIN_AREA_KM2, random());

    // A kör közepe a gócponton belül szóródik, hogy az azonos gócponthoz
    // tartozó körök átfedjék egymást.
    const jitterKm = random() * 0.8;
    const jitterAngle = random() * Math.PI * 2;
    const centre = {
      lat: cluster.lat + (jitterKm / KM_PER_DEG_LAT) * Math.cos(jitterAngle),
      lng: cluster.lng + (jitterKm / kmPerDegLng(cluster.lat)) * Math.sin(jitterAngle),
    };

    const type = random() < 0.55 ? 'run' : 'walk';
    const speedMps = type === 'run' ? 3.0 : 1.4;
    // Az elmúlt hat napban — a végpont a hét napnál régebbi kört elutasítja.
    const startedAt = Date.now() - Math.round((0.5 + random() * 5.5) * 24 * 60 * 60 * 1000);

    const points = loopTrack(centre, areaKm2, startedAt, speedMps);
    const endedAt = points[points.length - 1]!.t;

    const response = await fetch(`${API_BASE}/api/activities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.get(user.uid)}`,
      },
      body: JSON.stringify({
        activityId: `seedbp-${String(i).padStart(4, '0')}-${user.uid.slice(0, 12)}`.replace(/[^A-Za-z0-9_-]/g, '-'),
        type,
        points,
        startedAt,
        endedAt,
        movingMs: endedAt - startedAt,
      }),
    });

    if (!response.ok) {
      failed++;
      if (failed <= 5) console.error(`  HIBA #${i} (${user.username}): ${response.status} ${await response.text()}`);
      continue;
    }

    const result = (await response.json()) as { duplicate?: boolean };
    if (result.duplicate) duplicate++;
    else created++;
    totalAreaKm2 += areaKm2;

    if ((i + 1) % 10 === 0) {
      console.log(`  ${i + 1}/${COUNT} — új: ${created}, ismétlés: ${duplicate}, hiba: ${failed}`);
    }
  }

  console.log(
    `\nKész. Új: ${created}, ismétlés: ${duplicate}, hiba: ${failed}. ` +
      `Rajzolt terület összesen ~${totalAreaKm2.toFixed(1)} km² (átfedésekkel).`,
  );
  console.log('A térképen: /grund — Budapest, 47.4979 / 19.0402 környéke.');
}

await main();
process.exit(0);
