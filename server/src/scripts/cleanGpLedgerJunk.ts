/**
 * A `gpLedger` régi, `source` mező nélküli sorainak eltakarítása.
 *
 * MIÉRT KELL? A 2026-08-19 előtti aktivitás-feldolgozó véletlen azonosítóval
 * írt a főkönyvbe, és egy időszakban a védelem-számítás hibája miatt
 * eltúlzott értékkel is (lásd `inspectWorld.ts`). A javítás óta minden írás
 * determinisztikus azonosítót (`activity_<id>`, `hold_<uid>_<nap>`,
 * `milestone_<uid>_<hét>`) és kötelező `source`+`amount` mezőt kap — lásd
 * `activityCommit.ts`, `activityChunked.ts`, `dailyRollover.ts`. A régi sorok
 * ezt nem hordozzák, ezért biztonságosan megkülönböztethetők: aminek nincs
 * `source` mezője, az a hibás/duplikált korszakból maradt.
 *
 * Ez az egyetlen forrás alapján dolgozik: `gpTotal`, `dailyGp` már csak a
 * determinisztikus sorokra épül (megnézve 2026-08-20-án, `inspectWorld.ts`-
 * sel), tehát a törlés a jelenlegi összesítőket NEM módosítja. Ha ez a jövőben
 * már nem igaz, a szkript hibát dob, mielőtt bármit törölne.
 *
 * Alapértelmezésben csak jelentést készít. Íráshoz `--apply` kell, az éles
 * projekthez pedig ezen felül `--allow-production`.
 *
 * FUTTATÁS (Cloud Shell vagy saját, író jogú hitelesítéssel):
 *
 *   cd ~/grundo/server && npm run clean:gp-ledger-junk -- --apply --allow-production
 */
import { adminApp, COLLECTIONS, db, FIRESTORE_DATABASE_ID } from '../lib/firebase';

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

const snap = await db.collection(COLLECTIONS.gpLedger).get();

const junk = snap.docs.filter((doc) => !('source' in doc.data()));
const kept = snap.docs.filter((doc) => 'source' in doc.data());

/* Önellenőrzés: minden felhasználó gpTotal-ja stimmeljen a MEGTARTOTT sorok
 * összegével. Ha nem, valahol egy `source`-os sor is szükséges lenne a
 * jelenlegi egyenleghez, és a törlés károkat okozna — ekkor megállunk. */
const users = await db.collection(COLLECTIONS.users).get();
const sumByUser = new Map<string, number>();
for (const doc of kept) {
  const data = doc.data() as { userId?: string; amount?: number };
  const uid = String(data.userId ?? '');
  sumByUser.set(uid, (sumByUser.get(uid) ?? 0) + Number(data.amount ?? 0));
}

const mismatches: string[] = [];
for (const user of users.docs) {
  const stored = Number((user.data() as { gpTotal?: number }).gpTotal ?? 0);
  const fromKept = sumByUser.get(user.id) ?? 0;
  if (stored !== fromKept) {
    mismatches.push(`${user.id}: gpTotal=${stored}, megtartott sorokból=${fromKept}`);
  }
}

if (mismatches.length > 0) {
  throw new Error(
    `Önellenőrzés elbukott — a megtartott sorok összege nem egyezik a tárolt gpTotal-lal. ` +
      `NEM törlök. Eltérések:\n  ${mismatches.join('\n  ')}`,
  );
}

console.log(
  `Önellenőrzés OK — a megtartott ${kept.length} sor összege minden felhasználónál egyezik a gpTotal-lal.`,
);

if (apply) {
  const batch = db.batch();
  for (const doc of junk) batch.delete(doc.ref);
  if (junk.length > 0) await batch.commit();
}

console.log({
  mode: apply ? 'apply' : 'dry-run',
  project: configuredProject,
  database: FIRESTORE_DATABASE_ID,
  osszesSor: snap.size,
  megtartva: kept.length,
  torolve: apply ? junk.length : 0,
  torlesre_var: apply ? 0 : junk.length,
});
