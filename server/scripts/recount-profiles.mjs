/**
 * A profil-összesítők ÚJRASZÁMOLÁSA a valóságból.
 *
 * MIÉRT KELL? Egy aktivitás kétszer is feldolgozódhatott: az idempotencia-
 * ellenőrzés a tranzakción kívül volt, tehát két egyszerre érkező feltöltés
 * mindkettő „még nincs ilyen"-t látott, és mindkettő írt. Az AKTIVITÁS csak
 * egyszer jött létre (azonos azonosítóval), a profil összesítői viszont
 * kétszer nőttek — innen a duplázódott km² és GP.
 *
 * MIÉRT NEM FELEZÜNK? Mert nem minden aktivitás duplázódott, és nem tudjuk
 * megbízhatóan, melyik. A felezés csak akkor adna helyes eredményt, ha
 * pontosan minden feltöltés kétszer futott volna le. Ehelyett a valóságból
 * számolunk újra:
 *
 *   terület és mezőszám  ← a RÁCSBÓL (grid): ez az igazság, ezt látod a
 *                          térképen. Ráadásul az elvesztett cellákat is
 *                          helyesen kezeli, amit az aktivitások összege nem.
 *   GP, táv, aktivitás   ← az AKTIVITÁSOKBÓL: mindegyik pontosan egyszer
 *                          létezik, tehát az összegük hiteles.
 *
 * Így a szkript nem csak ezt a hibát javítja, hanem bármikor újrafuttatható,
 * ha az összesítők valaha elcsúsznának.
 *
 * FUTTATÁS (Cloud Shell):
 *
 *   cd ~/grundo && node server/scripts/recount-profiles.mjs           # megmutatja
 *   cd ~/grundo && node server/scripts/recount-profiles.mjs --apply   # ír
 *   cd ~/grundo && node server/scripts/recount-profiles.mjs --user geri --apply
 *
 * Alapból száraz futás. A `--user` szűkíthet egy felhasználónévre.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';

/** Egy H3 res 12 cella területe. Forrás: src/config/gameplay.ts */
const CELL_AREA_M2 = 307.09;

const apply = process.argv.includes('--apply');
const userFilter = (() => {
  const i = process.argv.indexOf('--user');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const app = initializeApp({ credential: applicationDefault() });
const db = getFirestore(app, DATABASE_ID);

const LAYERS = ['foot', 'bike'];
const TYPES = ['run', 'walk', 'ride'];

/** Hétfő 00:00 és a hónap eleje — a heti/havi GP újraszámolásához. */
function periodStarts(now = new Date()) {
  const week = new Date(now);
  const weekday = (week.getDay() + 6) % 7; // hétfő = 0
  week.setDate(week.getDate() - weekday);
  week.setHours(0, 0, 0, 0);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return { week: week.getTime(), month: month.getTime() };
}

/** A rácsból: hány cellája van a felhasználónak rétegenként? */
async function countCellsFromGrid(uid) {
  const counts = { foot: 0, bike: 0 };

  const index = await db.collection('users').doc(uid).collection('blocks').get();
  if (index.empty) return counts;

  const refs = index.docs.map((doc) => db.collection('grid').doc(doc.id));
  for (const snapshot of await db.getAll(...refs)) {
    if (!snapshot.exists) continue;
    const block = snapshot.data();
    const layer = block.layer;
    if (!LAYERS.includes(layer)) continue;
    for (const stored of Object.values(block.cells ?? {})) {
      if (stored?.o === uid) counts[layer] += 1;
    }
  }
  return counts;
}

/** Az aktivitásokból: darabszám, táv típusonként, GP. */
async function sumFromActivities(uid) {
  const { week, month } = periodStarts();
  const snapshot = await db.collection('activities').where('userId', '==', uid).get();

  const result = {
    activities: 0,
    distanceKm: { run: 0, walk: 0, ride: 0 },
    gpTotal: 0,
    gpWeek: 0,
    gpMonth: 0,
  };

  for (const doc of snapshot.docs) {
    const data = doc.data();
    result.activities += 1;

    const type = TYPES.includes(data.type) ? data.type : 'run';
    result.distanceKm[type] += Number(data.distanceM ?? 0) / 1000;

    const gp = Number(data.gp?.total ?? 0);
    result.gpTotal += gp;

    const startedAt = data.startedAt?.toMillis?.() ?? 0;
    if (startedAt >= week) result.gpWeek += gp;
    if (startedAt >= month) result.gpMonth += gp;
  }

  return result;
}

function line(label, before, after) {
  const changed = Math.abs(before - after) > 0.001;
  const mark = changed ? '→' : ' =';
  return `    ${label.padEnd(22)} ${String(before).padStart(12)} ${mark} ${after}`;
}

async function main() {
  console.log(`adatbázis: ${DATABASE_ID}`);
  console.log(apply ? 'MÓD: írás' : 'MÓD: száraz futás (nem ír semmit)');
  if (userFilter) console.log(`szűrés: ${userFilter}`);
  console.log('');

  const users = await db.collection('users').get();
  let changed = 0;

  for (const doc of users.docs) {
    const data = doc.data();
    if (userFilter && data.username !== userFilter && data.usernameLower !== userFilter) continue;

    const cells = await countCellsFromGrid(doc.id);
    const sums = await sumFromActivities(doc.id);

    const next = {
      territoryM2: {
        foot: Math.round(cells.foot * CELL_AREA_M2),
        bike: Math.round(cells.bike * CELL_AREA_M2),
      },
      cellCount: cells,
      counters: { activities: sums.activities, distanceKm: sums.distanceKm },
      gpTotal: Math.round(sums.gpTotal),
      gpWeek: Math.round(sums.gpWeek),
      gpMonth: Math.round(sums.gpMonth),
    };

    console.log(`${doc.id}  (${data.username ?? 'névtelen'})`);
    console.log(line('gpTotal', data.gpTotal ?? 0, next.gpTotal));
    console.log(line('territoryM2.foot', data.territoryM2?.foot ?? 0, next.territoryM2.foot));
    console.log(line('territoryM2.bike', data.territoryM2?.bike ?? 0, next.territoryM2.bike));
    console.log(line('cellCount.foot', data.cellCount?.foot ?? 0, next.cellCount.foot));
    console.log(line('cellCount.bike', data.cellCount?.bike ?? 0, next.cellCount.bike));
    console.log(line('aktivitás', data.counters?.activities ?? 0, next.counters.activities));
    for (const type of TYPES) {
      const before = Number(data.counters?.distanceKm?.[type] ?? 0).toFixed(2);
      console.log(line(`táv ${type} (km)`, before, next.counters.distanceKm[type].toFixed(2)));
    }
    console.log('');

    changed += 1;
    // A beágyazott térképeket összefésüljük, hogy a többi mező (pl. followers)
    // érintetlen maradjon.
    if (apply) await doc.ref.set(next, { merge: true });
  }

  if (changed === 0) {
    console.log('Nem találtam felhasználót.');
  } else if (apply) {
    console.log(`Kész: ${changed} profil újraszámolva.`);
  } else {
    console.log(`${changed} profil. Futtasd újra a --apply kapcsolóval, ha rendben van.`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
