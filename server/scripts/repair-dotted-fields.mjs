/**
 * Egyszeri javítás: a pontot tartalmazó NEVŰ mezők visszaköltöztetése oda,
 * ahová valók.
 *
 * MI TÖRTÉNT? A szerver így írta a profilt:
 *
 *     tx.set(userRef, { 'territoryM2.foot': increment(x) }, { merge: true })
 *
 * A Firestore `set()`-je viszont a pontot NEM útvonalnak érti, hanem a mezőnév
 * részének — csak az `update()` kezeli útvonalként. Így egy „territoryM2.foot"
 * NEVŰ, felső szintű mező jött létre, a beágyazott `territoryM2.foot` pedig
 * nulla maradt. A hiba a kódban javítva van; ez a szkript a már beírt adatot
 * hozza helyre.
 *
 * MIT CSINÁL? Minden `users` dokumentumban megkeresi a pontot tartalmazó nevű
 * mezőket, az értéküket HOZZÁADJA a helyes, beágyazott mezőhöz, majd törli a
 * hibás nevűt. Hozzáadja, nem felülírja: a javítás óta született aktivitások
 * már a helyes helyre írtak, azt nem szabad eldobni.
 *
 * FUTTATÁS (Cloud Shell):
 *
 *   cd ~/grundo/server && npm install
 *   node scripts/repair-dotted-fields.mjs           # csak megmutatja
 *   node scripts/repair-dotted-fields.mjs --apply   # ténylegesen ír
 *
 * Alapból SZÁRAZ FUTÁS: kiírja, mit tenne, de nem nyúl semmihez. Írni csak a
 * `--apply` kapcsolóval ír — egy adatjavító szkriptnél a véletlen indítás
 * legyen ártalmatlan.
 *
 * Többször is futtatható: a második futás már nem talál pontos nevű mezőt.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath, FieldValue } from 'firebase-admin/firestore';

const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';
const apply = process.argv.includes('--apply');

const app = initializeApp({ credential: applicationDefault() });
const db = getFirestore(app, DATABASE_ID);

/** Csak számot költöztetünk: a pontos nevű mezők mind számlálók. */
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A beágyazott érték kiolvasása útvonal szerint. */
function readPath(data, segments) {
  let current = data;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

async function main() {
  console.log(`adatbázis: ${DATABASE_ID}`);
  console.log(apply ? 'MÓD: írás\n' : 'MÓD: száraz futás (nem ír semmit)\n');

  const snapshot = await db.collection('users').get();
  let touched = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const broken = Object.keys(data).filter((key) => key.includes('.'));
    if (broken.length === 0) continue;

    console.log(`\n${doc.id}  (${data.username ?? 'névtelen'})`);
    const updates = [];

    for (const key of broken) {
      const value = data[key];
      if (!isNumber(value)) {
        console.log(`  ! ${key} — nem szám (${typeof value}), kihagyva`);
        continue;
      }

      const segments = key.split('.');
      const existing = readPath(data, segments);
      const current = isNumber(existing) ? existing : 0;
      const merged = current + value;

      console.log(`  ${key} = ${value}`);
      console.log(`    → ${segments.join(' → ')}: ${current} + ${value} = ${merged}`);

      // A NEVE pontot tartalmaz: egyetlen szegmensként kell címezni.
      updates.push([new FieldPath(key), FieldValue.delete()]);
      // Itt viszont valódi útvonal kell, szegmensekre bontva.
      updates.push([new FieldPath(...segments), merged]);
    }

    if (updates.length > 0) {
      touched += 1;
      if (apply) {
        await doc.ref.update(...updates.flat());
        console.log('  ✓ javítva');
      }
    }
  }

  if (touched === 0) {
    console.log('\nNincs javítandó mező — vagy már lefutott a javítás.');
  } else if (!apply) {
    console.log(`\n${touched} dokumentum várna javításra.`);
    console.log('Futtasd újra a --apply kapcsolóval, ha rendben van.');
  } else {
    console.log(`\nKész: ${touched} dokumentum javítva.`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
