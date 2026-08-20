/**
 * A `blockedBy` tükör feltöltése a MÁR MEGLÉVŐ tiltásokból.
 *
 * MIÉRT KELL? 2026-08-20-tól a tiltás két helyre íródik: `users/{tiltó}/
 * blocks/{tiltott}` és `users/{tiltott}/blockedBy/{tiltó}`. A második a
 * feed KÉTIRÁNYÚ szűrésének adatforrása (lásd `routes/activities.ts`) — de
 * csak az ezután keletkező tiltásokhoz jön létre magától. A korábbiakhoz ez
 * a szkript írja meg, egyszer.
 *
 * Amíg ez nem futott le, a régi tiltásoknál a „ki tiltott engem" irány
 * továbbra sem szűr. Az ELLENKEZŐJE nem fordulhat elő: a szkript csak ír,
 * soha nem töröl — egy fölösleges `blockedBy` sor pedig nem keletkezhet
 * belőle, mert minden sor egy létező `blocks` dokumentumból származik.
 *
 * Alapértelmezésben csak jelentést készít. Íráshoz `--apply` kell, az éles
 * projekthez pedig ezen felül `--allow-production`.
 *
 * FUTTATÁS (Cloud Shell, író jogú hitelesítéssel):
 *
 *   cd ~/grundo/server && npm run backfill:blocked-by -- --apply --allow-production
 */
import { FieldValue } from 'firebase-admin/firestore';
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

/*
  Kollekciócsoportos lekérdezés: EGY olvasással megvan az összes tiltás,
  akárhány felhasználó alatt vannak. A dokumentum azonosítója a tiltott
  felhasználó, a szülő szülője a tiltó — más mezőre nincs is szükség, ezért
  a `select()` üres.
*/
const blocks = await db.collectionGroup('blocks').select().get();

interface Pair {
  blocker: string;
  blocked: string;
}

const pairs: Pair[] = [];
for (const doc of blocks.docs) {
  const blocker = doc.ref.parent.parent?.id;
  if (!blocker) continue;
  /*
    ⚠️ Csak a FELHASZNÁLÓK alatti `blocks` érdekel minket. A név máshol is
    előfordulhat egy kollekciócsoportos lekérdezésben, és egy idegen
    dokumentumból írt tükör néma hibát okozna.
  */
  if (doc.ref.parent.parent?.parent.id !== COLLECTIONS.users) continue;
  pairs.push({ blocker, blocked: doc.id });
}

const missing: Pair[] = [];
for (const pair of pairs) {
  const mirror = await db
    .collection(COLLECTIONS.users)
    .doc(pair.blocked)
    .collection('blockedBy')
    .doc(pair.blocker)
    .get();
  if (!mirror.exists) missing.push(pair);
}

console.log(`Projekt: ${configuredProject}`);
console.log(`Tiltások összesen: ${pairs.length}`);
console.log(`Hiányzó tükör: ${missing.length}`);
for (const pair of missing) {
  console.log(`  ${pair.blocker} -> ${pair.blocked}`);
}

if (!apply) {
  console.log('\nSzáraz futás. Íráshoz add hozzá az --apply kapcsolót.');
  process.exit(0);
}

let written = 0;
const CHUNK = 400;
for (let from = 0; from < missing.length; from += CHUNK) {
  const batch = db.batch();
  for (const pair of missing.slice(from, from + CHUNK)) {
    batch.set(
      db.collection(COLLECTIONS.users).doc(pair.blocked).collection('blockedBy').doc(pair.blocker),
      { createdAt: FieldValue.serverTimestamp() },
    );
    written += 1;
  }
  await batch.commit();
}

console.log(`\nKész: ${written} tükör-dokumentum létrejött.`);
process.exit(0);
