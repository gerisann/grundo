/**
 * Rivális-tükrök visszatöltése a teljes `territoryEvents` történetből.
 *
 * A rivalitás funkció bevezetése előtti lopásokhoz nem keletkezett
 * `users/{uid}/rivals/{otherUid}` dokumentum. Ez a szkript a szerver által
 * írt, változtathatatlan területeseményekből újraszámolja mindkét oldalt.
 * Nem incrementel, hanem a teljes történetből számolt pontos értékekkel
 * felülírja az érintett tükördokumentumokat, ezért ismételten is biztonságos.
 *
 * Alapból csak jelentést készít. Éles íráshoz egyszerre kell az `--apply` és
 * az `--allow-production`. Egy konkrét kapcsolat méréséhez használható a
 * `--pair=felhasznalo1,felhasznalo2` kapcsoló.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminApp, COLLECTIONS, db } from '../lib/firebase';
import { aggregateRivalEvents } from '../lib/rivalBackfill';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowProduction = args.includes('--allow-production');
const listPairs = args.includes('--list');
const pairArg = args.find((arg) => arg.startsWith('--pair='))?.slice('--pair='.length) ?? '';
const pairNames = pairArg.split(',').map((part) => part.trim().toLocaleLowerCase('hu-HU')).filter(Boolean);
const configuredProject = adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';

if (!configuredProject) throw new Error('A Google Cloud projekt nincs beállítva.');
if (configuredProject === 'grundo' && apply && !allowProduction) {
  throw new Error('Éles íráshoz az --apply mellett az --allow-production kapcsoló is kötelező.');
}
if (pairArg && pairNames.length !== 2) {
  throw new Error('A --pair értéke két, vesszővel elválasztott felhasználónév legyen.');
}

const events = await db.collection(COLLECTIONS.territoryEvents).get();
const { aggregates, touchedUsers, stolenEvents, stolenCells } = aggregateRivalEvents(
  events.docs.map((doc) => doc.data()),
);

console.log(`Projekt: ${configuredProject}`);
console.log(`Területrablási esemény: ${stolenEvents}`);
console.log(`Gazdát cserélt mező: ${stolenCells}`);
console.log(`Érintett felhasználó: ${touchedUsers.size}`);
console.log(`Rivális tükördokumentum: ${aggregates.size}`);

if (pairNames.length === 2) await reportPair(pairNames[0]!, pairNames[1]!);
if (listPairs) await reportAllPairs();

if (!apply) {
  console.log('\nSzáraz futás. Nem történt adatbázis-írás.');
  process.exit(0);
}

const entries = [...aggregates.entries()];
const CHUNK = 400;
for (let from = 0; from < entries.length; from += CHUNK) {
  const batch = db.batch();
  for (const [key, record] of entries.slice(from, from + CHUNK)) {
    const [uid, otherUid] = key.split('|');
    if (!uid || !otherUid) continue;
    batch.set(db.collection(COLLECTIONS.users).doc(uid).collection('rivals').doc(otherUid), {
      gainedCells: record.gainedCells,
      lostCells: record.lostCells,
      exchangedCells: record.gainedCells + record.lostCells,
      gainedEvents: record.gainedEvents,
      lostEvents: record.lostEvents,
      lastAt: record.lastAt ?? FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

console.log(`\nKész: ${entries.length} rivális-tükördokumentum újraszámolva.`);
process.exit(0);

async function reportPair(first: string, second: string): Promise<void> {
  const users = await db.collection(COLLECTIONS.users).where('usernameLower', 'in', [first, second]).get();
  const byName = new Map(users.docs.map((doc) => [String(doc.data().usernameLower), doc.id]));
  const firstId = byName.get(first);
  const secondId = byName.get(second);
  if (!firstId || !secondId) {
    console.log(`\nKapcsolat: nem található mindkét felhasználó (${first}, ${second}).`);
    return;
  }
  const record = aggregates.get(`${firstId}|${secondId}`);
  if (!record) {
    console.log(`\nKapcsolat ${first} ↔ ${second}: nincs területrablási esemény.`);
    return;
  }
  console.log(`\nKapcsolat ${first} ↔ ${second}:`);
  console.log(`  összecsapás: ${record.gainedEvents + record.lostEvents}×`);
  console.log(`  szerzett/vesztett mező: +${record.gainedCells} / -${record.lostCells}`);
  console.log(`  összes gazdát cserélt mező: ${record.gainedCells + record.lostCells}`);
}

async function reportAllPairs(): Promise<void> {
  const users = touchedUsers.size > 0
    ? await db.getAll(...[...touchedUsers].map((uid) => db.collection(COLLECTIONS.users).doc(uid)))
    : [];
  const names = new Map(
    users.map((doc) => [doc.id, String((doc.data() as { username?: unknown } | undefined)?.username ?? doc.id)]),
  );
  console.log('\nTényleges riválispárok:');
  for (const [key, record] of [...aggregates.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [uid, otherUid] = key.split('|');
    if (!uid || !otherUid || uid.localeCompare(otherUid) >= 0) continue;
    console.log(
      `  ${names.get(uid) ?? uid} ↔ ${names.get(otherUid) ?? otherUid}: ` +
      `${record.gainedEvents + record.lostEvents}×, +${record.gainedCells}/-${record.lostCells} mező`,
    );
  }
}
