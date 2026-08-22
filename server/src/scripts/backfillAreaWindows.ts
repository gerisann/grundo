/**
 * Az `areaDay`/`areaWeek`/`areaMonth` mezők nullás alapértéke a MÁR MEGLÉVŐ
 * felhasználóknál.
 *
 * MIÉRT KELL? 2026-08-22-től minden ÚJ regisztráció megkapja ezt a három
 * mezőt (`lib/user.ts`), és a napi/heti/havi ranglista erre rendez
 * (`routes/tiles.ts` → GET /leaderboard). A Firestore `orderBy` viszont
 * KIHAGYJA azt a dokumentumot, amelyiken a rendező mező EGYÁLTALÁN NEM
 * LÉTEZIK — a régi felhasználóknál nem, tehát enélkül a szkript nélkül a
 * napi/heti/havi nézet gyakorlatilag üresen jönne vissza éles adaton (ugyanaz
 * a hiba, ami a `hasOwnedArea` próbálkozásnál is előjött az all-time
 * ranglistánál — lásd HANDOFF.md).
 *
 * A szkript NULLÁRA állítja a hiányzó mezőket — ez nem hamisít történetet: a
 * bevezetés pillanatában senkinek nincs még mért időszaki szerzése az ÚJ
 * számláló szerint, a nulla a helyes kezdőállapot.
 *
 * Alapértelmezésben csak jelentést készít. Íráshoz `--apply` kell, az éles
 * projekthez pedig ezen felül `--allow-production`.
 *
 * FUTTATÁS (Cloud Shell, író jogú hitelesítéssel):
 *
 *   cd ~/grundo/server && npm run backfill:area-windows -- --apply --allow-production
 */
import { adminApp, COLLECTIONS, db } from '../lib/firebase';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowProduction = args.has('--allow-production');
const configuredProject = adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';

if (!configuredProject) {
  throw new Error('Állítsd be a GOOGLE_CLOUD_PROJECT környezeti változót a futtatás előtt.');
}
if (configuredProject === 'grundo' && apply && !allowProduction) {
  throw new Error('Éles íráshoz az --apply mellett az --allow-production kapcsoló is kötelező.');
}

const ZERO = { foot: 0, bike: 0 };

const users = await db.collection(COLLECTIONS.users).select('areaDay', 'areaWeek', 'areaMonth').get();

const missing = users.docs.filter((doc) => {
  const data = doc.data();
  return data.areaDay === undefined || data.areaWeek === undefined || data.areaMonth === undefined;
});

console.log(`Projekt: ${configuredProject}`);
console.log(`Felhasználók összesen: ${users.size}`);
console.log(`Hiányzó időablak-mező: ${missing.length}`);

if (!apply) {
  console.log('\nSzáraz futás. Íráshoz add hozzá az --apply kapcsolót.');
  process.exit(0);
}

let written = 0;
const CHUNK = 400;
for (let from = 0; from < missing.length; from += CHUNK) {
  const batch = db.batch();
  for (const doc of missing.slice(from, from + CHUNK)) {
    const data = doc.data();
    const update: Record<string, unknown> = {};
    if (data.areaDay === undefined) update.areaDay = ZERO;
    if (data.areaWeek === undefined) update.areaWeek = ZERO;
    if (data.areaMonth === undefined) update.areaMonth = ZERO;
    batch.set(doc.ref, update, { merge: true });
    written += 1;
  }
  await batch.commit();
}

console.log(`\nKész: ${written} felhasználó kapott alapértelmezett időablak-mezőt.`);
process.exit(0);
