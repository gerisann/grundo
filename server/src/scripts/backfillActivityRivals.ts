/**
 * Az aktivitások `stolenFrom` mezőjének visszatöltése a `territoryEvents`
 * történetből.
 *
 * MIÉRT LEHET EZT VISSZAMENŐLEG PONTOSAN MEGCSINÁLNI? Mert nem újraszámoljuk,
 * hanem egy MÁR LEÍRT tényt formálunk át. A mentés minden károsultról ír egy
 * `territoryEvents/{activityId}_{victimId}` dokumentumot (`activityCommit.ts`
 * és `activityChunked.ts`), benne a tőle elvett cellák számával. Ezek
 * változtathatatlanok, és sehol nem törli őket semmi.
 *
 * ⚠️ ÚJRASZÁMOLNI NEM IS LEHETNE. Ahhoz a mentés PILLANATÁBAN érvényes
 * birtokviszony kellene; a világ azóta változott, tehát a mai állapotból
 * visszafejtve más — rosszabb — eredmény jönne ki, mint ami valójában történt.
 *
 * ⚠️ A LEFEDETTSÉG TELJES. A `territoryEvents` írása az `54854af` commit óta
 * (2026-08-17) létezik, vagyis ugyanabban a commitban jelent meg, amelyik az
 * aktivitás-mentést bevezette. Nincs tehát olyan aktivitás, ami lophatott
 * volna anélkül, hogy eseményt írt volna: az esemény HIÁNYA valóban azt
 * jelenti, hogy nem vett el senkitől területet, nem azt, hogy nincs róla adat.
 *
 * A `claimCounts` mezőt NEM írjuk ki hamis értékekkel: a `reclaimed` és a
 * `breakthrough` visszamenőleg nem ismert, és nullát írni rájuk hazugság
 * lenne. A felület a régi aktivitásoknál a `stolenFrom`-ból és az
 * `areaGainedM2`-ből számol (lásd `routes/activities.ts` → `claimCountsOf`).
 *
 * Idempotens: a teljes eseménytörténetből számol és felülír, tehát többször is
 * lefuttatható. Alapból csak jelentést készít; éles íráshoz egyszerre kell az
 * `--apply` és az `--allow-production`.
 */
import { adminApp, COLLECTIONS, db } from '../lib/firebase';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowProduction = args.includes('--allow-production');
const configuredProject = adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';

if (!configuredProject) throw new Error('A Google Cloud projekt nincs beállítva.');
if (configuredProject === 'grundo' && apply && !allowProduction) {
  throw new Error('Éles íráshoz az --apply mellett az --allow-production kapcsoló is kötelező.');
}

/**
 * Hány károsult kerülhet egy dokumentumra — ugyanaz a korlát, amit a mentés
 * használ (`activityCommit.ts` → `MAX_STORED_VICTIMS`). Szándékosan itt is
 * kiírva: ha a mentés korlátja változik, ez a szkript ne írjon vele
 * összeegyeztethetetlen alakot a régi sorokra.
 */
const MAX_STORED_VICTIMS = 6;

const events = await db.collection(COLLECTIONS.territoryEvents).get();

/** activityId → { victimId: elvett cellák } */
const byActivity = new Map<string, Record<string, number>>();
for (const doc of events.docs) {
  const data = doc.data() as { activityId?: unknown; recipientId?: unknown; cellCount?: unknown };
  const activityId = String(data.activityId ?? '');
  const victimId = String(data.recipientId ?? '');
  const cells = Number(data.cellCount ?? 0);
  if (!activityId || !victimId || !Number.isFinite(cells) || cells <= 0) continue;

  const current = byActivity.get(activityId) ?? {};
  // Ugyanahhoz az aktivitás–károsult párhoz egyetlen dokumentum tartozik
  // (determinisztikus azonosító), de az összeadás egy esetleges duplikátumot
  // is helyesen kezel.
  current[victimId] = (current[victimId] ?? 0) + cells;
  byActivity.set(activityId, current);
}

const activities = await db.collection(COLLECTIONS.activities).get();

const frissitendo: { id: string; stolenFrom: Record<string, number> }[] = [];
let mar = 0;
let lopasNelkul = 0;
let levagott = 0;

for (const doc of activities.docs) {
  const data = doc.data() as { stolenFrom?: unknown; claimCounts?: unknown };
  // Amit a mentés már kiírt, ahhoz nem nyúlunk: az az elsődleges igazság.
  if (data.stolenFrom !== undefined || data.claimCounts !== undefined) {
    mar += 1;
    continue;
  }

  const osszes = byActivity.get(doc.id) ?? {};
  const rendezett = Object.entries(osszes).sort((a, b) => b[1] - a[1]);
  if (rendezett.length > MAX_STORED_VICTIMS) levagott += 1;
  if (rendezett.length === 0) lopasNelkul += 1;

  frissitendo.push({
    id: doc.id,
    stolenFrom: Object.fromEntries(rendezett.slice(0, MAX_STORED_VICTIMS)),
  });
}

console.log(`Projekt: ${configuredProject}`);
console.log(`Területesemény: ${events.size} (${byActivity.size} aktivitást érint)`);
console.log(`Aktivitás: ${activities.size}`);
console.log(`  már van adata:        ${mar}`);
console.log(`  visszatöltendő:       ${frissitendo.length}`);
console.log(`    ebből lopás nélkül: ${lopasNelkul} (üres \`stolenFrom\`)`);
if (levagott > 0) console.log(`    ${MAX_STORED_VICTIMS}-nál több károsult: ${levagott}`);

if (!apply) {
  console.log('\nSzáraz futás. Nem történt adatbázis-írás.');
  process.exit(0);
}

const CHUNK = 400;
for (let from = 0; from < frissitendo.length; from += CHUNK) {
  const batch = db.batch();
  for (const { id, stolenFrom } of frissitendo.slice(from, from + CHUNK)) {
    // `merge`, hogy az aktivitás többi mezőjéhez ne nyúljunk hozzá.
    batch.set(db.collection(COLLECTIONS.activities).doc(id), { stolenFrom }, { merge: true });
  }
  await batch.commit();
}

console.log(`\nKész: ${frissitendo.length} aktivitás \`stolenFrom\` mezője visszatöltve.`);
process.exit(0);
