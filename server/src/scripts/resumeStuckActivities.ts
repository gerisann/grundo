/**
 * BERAGADT DARABOLT MENTÉS HELYREÁLLÍTÁSA.
 *
 * MIÉRT KELL? Mert a darabolt foglalás (`activityChunked.ts`) az aktivitás
 * dokumentumát már az első fázisban létrehozza, a könyvelést viszont csak
 * több tranzakcióval később zárja le. Ha közben bármi elhasal, a kör ott
 * marad `claimStatus: 'pending'` állapotban: megvan a nyomvonal, de nincs
 * terület, nincs GP, és magától SOHA nem készül el — a szerveren nincs
 * söprögető job, ami visszatérne rá.
 *
 * ⚠️ EGY VALÓDI ESETBŐL SZÜLETETT (2026-09-02, `ebb3c240…`): egy 143 km-es
 * bringakör az első csoportnál `Transaction too big` hibával elhasalt. Az ok
 * és a megelőzés a `activityChunked.ts` fejlécében van — ez a szkript a MÁR
 * beragadt köröket menti meg.
 *
 * MIT CSINÁL? Pontosan azt, amit egy újraküldés tenne: a TÁROLT nyomvonalból
 * újratervezi a geometriát, és folytatja a foglalást a hiányzó csoportoktól.
 * A `claimParts` determinisztikus azonosítói miatt a már kész csoportok
 * kimaradnak, tehát a futtatás ismételhető.
 *
 * A kliens nem kell hozzá: a teljes nyomvonal a szerveren van
 * (`activities/{id}/private/track`).
 *
 * FUTTATÁS (a `server` mappából, Git Bashből):
 *
 *   npx tsx src/scripts/resumeStuckActivities.ts                 # csak megmutatja
 *   npx tsx src/scripts/resumeStuckActivities.ts --apply         # végre is hajtja
 *   npx tsx src/scripts/resumeStuckActivities.ts <id> --apply    # egyetlen kört
 *
 * ⚠️ Az írás ADC-VÁLTÁST igényel: a fejlesztői gépen az alapértelmezett
 * hitelesítés a csak olvasó `grundo-reader` fiókot személyesíti meg.
 */

import { COLLECTIONS, db } from '../lib/firebase';
import { planActivity } from '../lib/activityCommit';
import { commitChunkedActivity } from '../lib/activityChunked';
import { evaluateAndAwardBadges } from '../lib/badges';
import { recordRivalry } from '../lib/rivals';
import { recomputeTerritoryBlobs } from '../lib/territoryBlobStore';
import { layerOf } from '../../../src/game/cells';
import type { ActivityType, TracePoint } from '../../../src/types';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const onlyId = args.find((arg) => !arg.startsWith('--'));

const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? '(ismeretlen)';
console.log(`\n═══ Beragadt aktivitások — ${project} ═══`);
console.log(apply ? 'MÓD: VÉGREHAJTÁS (ír az adatbázisba)\n' : 'MÓD: száraz futás (nem ír semmit)\n');

const stuck = onlyId
  ? [await db.collection(COLLECTIONS.activities).doc(onlyId).get()]
  : (await db.collection(COLLECTIONS.activities).where('claimStatus', '==', 'pending').get()).docs;

if (stuck.length === 0 || !stuck[0]?.exists) {
  console.log('Nincs beragadt aktivitás.');
  process.exit(0);
}

for (const snapshot of stuck) {
  if (!snapshot.exists) {
    console.log(`⚠️  Nincs ilyen aktivitás: ${onlyId}`);
    continue;
  }

  const data = snapshot.data() as Record<string, unknown>;
  const activityId = snapshot.id;
  const uid = String(data.userId ?? '');
  const type = data.type as ActivityType;

  console.log(`▸ ${activityId}`);
  console.log(`    felhasználó: ${uid} · ${type} · ${Number(data.distanceM ?? 0)} m`);
  console.log(`    állapot: claimStatus=${String(data.claimStatus)} progress=${JSON.stringify(data.claimProgress)}`);

  if (data.claimStatus !== 'pending') {
    console.log('    KIHAGYVA: nem beragadt (a foglalás lezárult).\n');
    continue;
  }

  const track = await snapshot.ref.collection('private').doc('track').get();
  const points = (track.data() as { points?: TracePoint[] } | undefined)?.points;
  if (!points || points.length < 2) {
    console.log('    ⚠️  KIHAGYVA: nincs tárolt nyomvonal, amiből újraszámolható lenne.\n');
    continue;
  }

  /**
   * ⚠️ A MÁR KÖNYVELT RÉSZEK figyelmeztetést érdemelnek.
   *
   * A csoporthatárokat a `BLOCKS_PER_GROUP` szabja meg. Ha az érték a
   * beragadás ÓTA változott, a `group-N` azonosító már más blokkokat fed le,
   * tehát a „kész" jelölés nem ugyanarra a halmazra vonatkozik. Területet ez
   * nem duplázhat (a már saját cellát a motor megerősítésnek látja, nem új
   * szerzésnek), de a rész-számok eltérhetnek — ezt látni kell.
   */
  const parts = await snapshot.ref.collection('claimParts').get();
  if (!parts.empty) {
    console.log(`    ⚠️  ${parts.size} csoport MÁR könyvelt. Ha a csoportméret azóta változott,`);
    console.log('        a határok eltolódtak — nézd át az eredményt a futás után.');
  }

  const plan = planActivity({
    activityId,
    uid,
    type,
    points,
    startedAt: (data.startedAt as { toMillis: () => number }).toMillis(),
    endedAt: (data.endedAt as { toMillis: () => number }).toMillis(),
    movingMs: Number(data.movingS ?? 0) * 1000,
  });

  console.log(`    terv: ${plan.loops.length} hurok · ${plan.candidateCells.length} cella · ${plan.blockIds.length} blokk`);

  if (!apply) {
    console.log('    (száraz futás — a folytatáshoz add meg a --apply kapcsolót)\n');
    continue;
  }

  const started = Date.now();
  const committed = await commitChunkedActivity(plan);
  const summary = committed.summary as Record<string, number> | undefined;

  if (committed.duplicate) {
    console.log('    A foglalás időközben lezárult — nem könyveltünk újra.\n');
    continue;
  }

  console.log(`    ✓ FOGLALÁS KÉSZ ${Math.round((Date.now() - started) / 1000)} mp alatt`);
  console.log(`      cella: ${summary?.claimedCells ?? 0} · terület: ${summary?.areaGainedM2 ?? 0} m² · GP: ${summary?.gp ?? 0}`);

  // Innentől ugyanaz, amit a mentés végpontja is elvégez a commit után.
  const victims = Object.entries(committed.stolenFrom ?? {}).filter(([, count]) => count > 0);
  if (victims.length > 0) {
    await recordRivalry(uid, Object.fromEntries(victims));
    console.log(`      rivalitás rögzítve: ${victims.length} károsult`);
  }

  const badges = await evaluateAndAwardBadges(uid);
  if (badges.length > 0) {
    console.log(`      jelvény (${badges.length}): ${badges.map((badge) => badge.name).join(', ')}`);
  }

  /**
   * A TERÜLETFOLTOK a térkép megjelenítéséhez kellenek — a támadóra ÉS az
   * áldozataira. Enélkül a visszaszerzett terület a rácsban ott van, de a
   * térképen nem rajzolódna ki.
   */
  const layer = layerOf(type);
  for (const target of [uid, ...victims.map(([victimId]) => victimId)]) {
    const blobs = await recomputeTerritoryBlobs(target, layer);
    console.log(`      területfolt újraszámolva: ${target} → ${blobs} folt`);
  }

  // A sikertelen feldolgozás életjele már nem érvényes.
  await db.collection(COLLECTIONS.activityUploads).doc(activityId).delete().catch(() => undefined);
  console.log('');
}

console.log('Kész.');
