/**
 * A TERÜLETFOLTOK ELSŐ KISZÁMOLÁSA a már meglévő birtokviszonyhoz.
 *
 * MIÉRT KELL? Mert 2026-08-28-tól a térkép nem menet közben vonja össze a
 * betöltött cellákat, hanem előszámolt, nézettől független foltokat rajzol
 * (`lib/territoryBlobStore.ts`). Ezek a foltok mostantól MINDEN aktivitás
 * mentésekor frissülnek — de a szkript előtt mentett területekhez még
 * egyetlen folt sem tartozik, tehát azok nem jelennének meg a térképen,
 * amíg a tulajdonosuk nem fut újra egy kört.
 *
 * A szkript minden felhasználóra, mindkét rétegre újraszámolja a foltokat a
 * jelenlegi rácsállapotból. Idempotens: bármikor újrafuttatható, és a
 * meglévő foltokat a friss állapotra igazítja (a megszűnteket törli).
 *
 * Alapértelmezésben csak jelentést készít. Íráshoz `--apply` kell, az éles
 * projekthez pedig ezen felül `--allow-production`.
 *
 * FUTTATÁS (Cloud Shell, író jogú hitelesítéssel):
 *
 *   cd ~/grundo/server && npm run backfill:territory-blobs -- --apply --allow-production
 */
import { adminApp, COLLECTIONS, db } from '../lib/firebase';
import { recomputeTerritoryBlobs } from '../lib/territoryBlobStore';
import type { Layer } from '../../../src/types';

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

const LAYERS: Layer[] = ['foot', 'bike'];

console.log(`Projekt: ${configuredProject}`);
console.log(apply ? 'MÓD: írás (--apply)' : 'MÓD: száraz futás — semmi nem íródik ki');

/**
 * A `blockIndex` alkollekcióból indulunk, nem a teljes felhasználólistából.
 *
 * Akinek nincs blokkindexe, annak területe sincs, tehát foltja sem lehet —
 * fölösleges lenne minden regisztrált fiókra ráolvasni a rácsot. A
 * `collectionGroup` egyetlen lekérdezéssel adja meg, kinek van egyáltalán
 * mit újraszámolni.
 */
const indexes = await db.collectionGroup('blockIndex').get();

const targets = new Map<string, Set<Layer>>();
for (const doc of indexes.docs) {
  const uid = doc.ref.parent.parent?.id;
  if (!uid) continue;
  const layer = doc.id as Layer;
  if (!LAYERS.includes(layer)) continue;
  const existing = targets.get(uid);
  if (existing) existing.add(layer);
  else targets.set(uid, new Set([layer]));
}

console.log(`Érintett felhasználó: ${targets.size}`);

if (!apply) {
  for (const [uid, layers] of targets) {
    console.log(`  ${uid}: ${[...layers].join(', ')}`);
  }
  console.log('\nSzáraz futás vége. Íráshoz add hozzá az --apply kapcsolót.');
  process.exit(0);
}

let done = 0;
let blobCount = 0;
let failed = 0;

for (const [uid, layers] of targets) {
  for (const layer of layers) {
    try {
      blobCount += await recomputeTerritoryBlobs(uid, layer);
    } catch (error) {
      failed++;
      console.error(`  HIBA ${uid} / ${layer}:`, error);
    }
  }
  done++;
  if (done % 25 === 0) console.log(`  ${done}/${targets.size} felhasználó kész…`);
}

// A régi, gazdátlan foltok takarítása: ha egy felhasználónak időközben
// megszűnt a blokkindexe, a foltjai itt ragadnának.
const orphans = await db.collection(COLLECTIONS.territoryBlobs).get();
const known = new Set([...targets.keys()]);
const stale = orphans.docs.filter((doc) => !known.has((doc.data() as { owner?: string }).owner ?? ''));

for (let i = 0; i < stale.length; i += 400) {
  const batch = db.batch();
  for (const doc of stale.slice(i, i + 400)) batch.delete(doc.ref);
  await batch.commit();
}

console.log(`\nKész. Folt: ${blobCount}, felhasználó: ${done}, törölt árva: ${stale.length}, hiba: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
