/**
 * A sportágankénti banda-ranglista számlálóinak alapértéke régi usereknél.
 *
 * Ezek új, bevezetéstől mért aktivitási számlálók: a futás és séta a régi
 * `foot` területből utólag nem választható szét hitelesen, ezért nem találunk
 * ki történelmi arányt. Alapból száraz futás; éles íráshoz két kapcsoló kell.
 *
 *   npm run backfill:banda-stats -- --apply --allow-production
 */
import { adminApp, COLLECTIONS, db } from '../lib/firebase';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowProduction = args.has('--allow-production');
const project = adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';

if (!project) throw new Error('Állítsd be a GOOGLE_CLOUD_PROJECT környezeti változót.');
if (project === 'grundo' && apply && !allowProduction) {
  throw new Error('Éles íráshoz az --apply és az --allow-production is kötelező.');
}

const zero = () => ({
  areaDayM2: 0, areaWeekM2: 0, areaMonthM2: 0, areaTotalM2: 0,
  gpDay: 0, gpWeek: 0, gpMonth: 0, gpTotal: 0,
});
const users = await db.collection(COLLECTIONS.users).select('bandaStats').get();
const missing = users.docs.filter((doc) => doc.data().bandaStats === undefined);

console.log(`Projekt: ${project}`);
console.log(`Felhasználók: ${users.size}; hiányzó bandaStats: ${missing.length}`);
if (!apply) {
  console.log('Száraz futás. Íráshoz add hozzá az --apply kapcsolót.');
  process.exit(0);
}

for (let from = 0; from < missing.length; from += 400) {
  const batch = db.batch();
  for (const doc of missing.slice(from, from + 400)) {
    batch.set(doc.ref, { bandaStats: { run: zero(), walk: zero(), ride: zero() } }, { merge: true });
  }
  await batch.commit();
}
console.log(`Kész: ${missing.length} dokumentum frissült.`);
process.exit(0);
