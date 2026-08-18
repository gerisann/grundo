/**
 * A rács-blokk mutató átköltöztetése egyetlen index-dokumentumba.
 *
 * MI VÁLTOZOTT? A foglalás korábban blokkonként EGY dokumentumot írt a
 * `users/{uid}/blocks/{blockId}` útvonalra. Ez két bajt okozott:
 *
 *   1. Megduplázta a tranzakció írásszámát, így a Firestore 500-as korlátjába
 *      fele akkora körnél ütköztünk bele, mint kellett volna (~18 km helyett
 *      ~26 km kerületű kör fér bele mostantól).
 *   2. A `users/{uid}/blocks/` alkollekciót a felhasználó-TILTÁS is használja,
 *      és azt a felhasználó maga írhatja (lásd firestore.rules). Vagyis a
 *      saját rács-mutatóit letörölhette volna, amitől a területe eltűnik a
 *      saját térképéről.
 *
 * Mostantól rétegenként egyetlen dokumentum: `users/{uid}/blockIndex/{layer}`,
 * benne a blokkazonosítók tömbje.
 *
 * MIT CSINÁL EZ A SZKRIPT? Végigmegy a felhasználókon, összegyűjti a régi
 * alkollekcióból a blokkazonosítókat rétegenként, és megírja belőlük az
 * index-dokumentumot. A RÉGI DOKUMENTUMOKAT NEM TÖRLI — az olvasási oldal
 * addig visszaesik rájuk, amíg az index nem létezik, tehát a migráció alatt
 * senkinek nem tűnik el a területe. A takarítás külön, később futtatható,
 * amikor már biztos, hogy minden felhasználónak van indexe.
 *
 * FUTTATÁS (Cloud Shell, a repo gyökeréből):
 *
 *   node server/scripts/migrate-block-index.mjs                  # megmutatja
 *   node server/scripts/migrate-block-index.mjs --apply          # ír
 *
 * Éles projekten az `--apply` mellé az `--allow-production` is kötelező.
 * Alapból száraz futás. Újrafuttatható és idempotens: a már meglévő, azonos
 * tartalmú indexet kihagyja.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? '';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowProduction = args.has('--allow-production');

if (!PROJECT) {
  throw new Error('Állítsd be a GOOGLE_CLOUD_PROJECT környezeti változót a futtatás előtt.');
}
if (PROJECT === 'grundo' && apply && !allowProduction) {
  throw new Error('Éles íráshoz az --apply mellett az --allow-production kapcsoló is kötelező.');
}

const app = initializeApp({ credential: applicationDefault() });
const db = getFirestore(app, DATABASE_ID);

const PAGE_SIZE = 200;
const LAYERS = ['foot', 'bike'];

let scannedUsers = 0;
let written = 0;
let skipped = 0;
let empty = 0;
let failed = 0;

let cursor;
for (;;) {
  let query = db.collection('users').orderBy('__name__').limit(PAGE_SIZE);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;

  for (const user of page.docs) {
    scannedUsers += 1;
    try {
      const legacy = await user.ref.collection('blocks').get();

      /**
       * A régi alkollekció VEGYES: a rács-mutatók mellett a felhasználó-
       * tiltások is itt vannak. A kettőt a `layer` mező különbözteti meg —
       * tiltásnál nincs ilyen. Enélkül a migráció tiltott felhasználók
       * azonosítóit írná bele a blokklistába.
       */
      const byLayer = new Map(LAYERS.map((layer) => [layer, []]));
      for (const doc of legacy.docs) {
        const layer = doc.data()?.layer;
        if (typeof layer === 'string' && byLayer.has(layer)) byLayer.get(layer).push(doc.id);
      }

      for (const [layer, blockIds] of byLayer) {
        if (blockIds.length === 0) continue;

        const indexRef = user.ref.collection('blockIndex').doc(layer);
        const existing = await indexRef.get();

        if (existing.exists) {
          const current = new Set(existing.data()?.blocks ?? []);
          const missing = blockIds.filter((id) => !current.has(id));
          if (missing.length === 0) {
            skipped += 1;
            continue;
          }
        }

        blockIds.sort();
        console.log(
          `${apply ? 'ÍRÁS ' : 'terv '} ${user.id} / ${layer}: ${blockIds.length} blokk`,
        );
        if (apply) {
          await indexRef.set(
            { layer, blocks: blockIds, updatedAt: new Date(), migratedAt: new Date() },
            { merge: true },
          );
        }
        written += 1;
      }

      if (legacy.empty) empty += 1;
    } catch (error) {
      failed += 1;
      console.error(`HIBA ${user.id}: ${error?.message ?? error}`);
    }
  }

  cursor = page.docs[page.docs.length - 1];
  if (page.size < PAGE_SIZE) break;
}

console.log({
  mode: apply ? 'apply' : 'dry-run',
  project: PROJECT,
  database: DATABASE_ID,
  scannedUsers,
  indexesWritten: written,
  alreadyUpToDate: skipped,
  usersWithoutBlocks: empty,
  failed,
});

if (!apply) {
  console.log('\nSzáraz futás volt — semmi nem íródott. Írás: --apply');
}
