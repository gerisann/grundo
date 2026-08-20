/**
 * A `badges` katalógus-kollekció feltöltése a kódban tartott listából.
 *
 * A jelvények IGAZSÁGFORRÁSA a kód (`src/game/badges.ts`), nem a Firestore —
 * lásd az ottani fejlécet. Ez a szkript csak VETÍTI a katalógust
 * Firestore-ba, hogy:
 *   - a séma készen álljon egy jövőbeli admin-szerkesztőhöz (docs/06 → 8.),
 *   - a `challenges.rewardBadgeId` hivatkozások feloldhatók legyenek,
 *   - a kliens (ha valaha közvetlenül Firestore-ból akarna olvasni, nem a
 *     beágyazott katalógusból) találjon ott adatot.
 *
 * IDEMPOTENS: újrafuttatva csak a MEGVÁLTOZOTT dokumentumokat írja felül, és
 * jelzi, ha egy Firestore-ban lévő jelvény már nincs a kódban (ez soha ne
 * történjen meg — egy már kiosztott jelvényt nem szabad kivezetni).
 *
 * Alapértelmezésben csak jelentést készít. Íráshoz `--apply` kell, az éles
 * projekthez pedig ezen felül `--allow-production`.
 *
 * FUTTATÁS (Cloud Shell vagy saját, író jogú hitelesítéssel):
 *
 *   cd ~/grundo/server && npm run seed:badges -- --apply --allow-production
 */
import { adminApp, COLLECTIONS, db } from '../lib/firebase';
import { BADGES } from '../../../src/game/badges';

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

const collection = db.collection(COLLECTIONS.badges);
const existing = await collection.get();
const existingIds = new Set(existing.docs.map((doc) => doc.id));
const codeIds = new Set(BADGES.map((entry) => entry.id));

const toWrite = BADGES.filter((entry) => {
  const current = existing.docs.find((doc) => doc.id === entry.id)?.data();
  return (
    !current ||
    current.name !== entry.name ||
    current.description !== entry.description ||
    current.tier !== entry.tier ||
    current.rewardGp !== entry.rewardGp ||
    current.category !== entry.category
  );
});

const orphaned = [...existingIds].filter((id) => !codeIds.has(id));

// eslint-disable-next-line no-console
console.log(`Katalógus a kódban: ${BADGES.length} jelvény.`);
// eslint-disable-next-line no-console
console.log(`Firestore-ban most: ${existing.size} dokumentum.`);
// eslint-disable-next-line no-console
console.log(`Írandó (új vagy változott): ${toWrite.length}.`);
if (orphaned.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(
    `⚠️ ${orphaned.length} Firestore-jelvény nincs a kódban — SOSEM törlődik automatikusan: ${orphaned.join(', ')}`,
  );
}

if (!apply) {
  // eslint-disable-next-line no-console
  console.log('Csak jelentés (dry-run). Íráshoz: --apply');
  process.exit(0);
}

const batchSize = 400;
for (let index = 0; index < toWrite.length; index += batchSize) {
  const batch = db.batch();
  for (const entry of toWrite.slice(index, index + batchSize)) {
    batch.set(collection.doc(entry.id), {
      name: entry.name,
      description: entry.description,
      icon: entry.tier,
      tier: entry.tier,
      category: entry.category,
      rewardGp: entry.rewardGp,
      criteria: entry.id,
    });
  }
  await batch.commit();
}

// eslint-disable-next-line no-console
console.log(`Kész: ${toWrite.length} dokumentum írva.`);
