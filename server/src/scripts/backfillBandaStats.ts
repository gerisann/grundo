/**
 * A sportágankénti banda-ranglista MINDENKORI számlálóinak visszaszámolása.
 *
 * ── MIÉRT ÍRÓDOTT ÚJRA (GRUNDO #36) ──────────────────────────────────────
 *
 * Az első változat csak a hiányzó `bandaStats` mezőt hozta létre NULLÁKKAL,
 * abból a feltevésből, hogy a történelmi adat nem nyerhető vissza: a
 * felhasználón tárolt terület `foot`/`bike` RÉTEG szerint áll, abból a futás
 * és a séta valóban nem választható szét. A feltevés a rossz szinten nézte az
 * adatot — az AKTIVITÁS-dokumentum megőrzi a `type`-ot, az `areaGainedM2`-t és
 * a `gp`-t.
 *
 * A következménye élesben látszott: a banda-ranglista minden tagnál 0 km²-t és
 * 0 GP-t mutatott, miközben a felhasználóknak több km²-ük és több ezer GP-jük
 * volt. A `bandaStats` ugyanis csak a bevezetés ÓTA rögzített aktivitásoknál
 * nő (`lib/activityCommit.ts`), és azóta nem volt új futás.
 *
 * ── MIT ÍR ÉS MIT NEM ────────────────────────────────────────────────────
 *
 * Kizárólag a mindenkori mezőket (`areaTotalM2`, `gpTotal`) számolja újra a
 * teljes előtörténetből. A napi/heti/havi ablakokat NEM bántja: azokat a napi
 * forduló nullázza a határokon, tehát a visszamenőleges pontosságuknak nincs
 * értelme, a rossz határszámítás viszont valódi kárt okozna.
 *
 * A számítás IDEMPOTENS: felülír, nem hozzáad. Kétszer futtatva ugyanaz jön ki.
 *
 * Alapból száraz futás; éles íráshoz két kapcsoló kell:
 *
 *   npm run backfill:banda-stats
 *   npm run backfill:banda-stats -- --apply --allow-production
 */
import { adminApp, COLLECTIONS, db } from '../lib/firebase';
import {
  aggregateBandaStatsFromActivities,
  BANDA_SPORTS,
  type BandaActivityRecord,
} from '../lib/bandas';

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

const users = await db.collection(COLLECTIONS.users).select('username', 'bandaStats', 'gpTotal').get();

/**
 * A törölt aktivitás is kell — a törlés csak az aktivitás- és a
 * távolságszámlálót csökkenti, a területet és a GP-t nem.
 */
const activities = await db
  .collection(COLLECTIONS.activities)
  .select('userId', 'type', 'areaGainedM2', 'gp')
  .get();

const computed = aggregateBandaStatsFromActivities(
  activities.docs.map((doc) => doc.data() as BandaActivityRecord),
);

console.log(`Projekt: ${project}`);
console.log(`Felhasználók: ${users.size}; aktivitások: ${activities.size}`);
console.log('');

const km2 = (m2: number) => (m2 / 1_000_000).toFixed(3);
const writes: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];

for (const doc of users.docs) {
  const data = doc.data() as {
    username?: string;
    gpTotal?: number;
    bandaStats?: Record<string, { areaTotalM2?: number; gpTotal?: number }>;
  };
  const stats = computed.get(doc.id);
  const stored = data.bandaStats;

  const next: Record<string, { areaTotalM2: number; gpTotal: number }> = {};
  let areaSum = 0;
  let gpSum = 0;
  let changed = stored === undefined;

  for (const sport of BANDA_SPORTS) {
    const value = stats?.[sport] ?? { areaTotalM2: 0, gpTotal: 0 };
    next[sport] = value;
    areaSum += value.areaTotalM2;
    gpSum += value.gpTotal;
    const before = stored?.[sport];
    if ((before?.areaTotalM2 ?? 0) !== value.areaTotalM2 || (before?.gpTotal ?? 0) !== value.gpTotal) {
      changed = true;
    }
  }

  /**
   * A felhasználó `gpTotal`-ja TÖBB lehet, mint az aktivitásokból jövő összeg:
   * a napi forduló tartási bónuszt is ír rá. Az eltérés tehát nem hiba, csak
   * annyit jelez, mennyi GP nem futásból származik.
   */
  const profileGp = Number(data.gpTotal ?? 0);
  console.log(
    `${(data.username ?? doc.id).padEnd(16)} `
    + `futás ${km2(next.run!.areaTotalM2)} km²/${next.run!.gpTotal} GP · `
    + `séta ${km2(next.walk!.areaTotalM2)} km²/${next.walk!.gpTotal} GP · `
    + `kerékpár ${km2(next.ride!.areaTotalM2)} km²/${next.ride!.gpTotal} GP`
    + `  [összes ${km2(areaSum)} km², ${gpSum} GP; profil gpTotal ${profileGp}]`
    + (changed ? '' : '  — változatlan'),
  );

  if (!changed) continue;
  writes.push({
    ref: doc.ref,
    data: {
      bandaStats: Object.fromEntries(
        BANDA_SPORTS.map((sport) => [sport, { ...zero(), ...stored?.[sport], ...next[sport] }]),
      ),
    },
  });
}

console.log('');
console.log(`Frissítendő felhasználó: ${writes.length}`);

if (!apply) {
  console.log('Száraz futás. Íráshoz add hozzá: --apply --allow-production');
  process.exit(0);
}

for (let from = 0; from < writes.length; from += 400) {
  const batch = db.batch();
  for (const write of writes.slice(from, from + 400)) {
    batch.set(write.ref, write.data, { merge: true });
  }
  await batch.commit();
}

console.log(`Kész: ${writes.length} dokumentum frissült.`);
console.log('A banda-összesítéshez futtasd le utána a banda-rollovert (admin gomb vagy Scheduler).');
process.exit(0);
