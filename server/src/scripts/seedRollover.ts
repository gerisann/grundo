/**
 * Egyszeri szkript: a napi forduló könyvelésének bejegyzése a MEGLÉVŐ
 * felhasználókra.
 *
 * A forduló egyetlen indexelt lekérdezéssel keresi meg, kire jár le az óra:
 * `users.rollover.nextDueAt <= most`. Akinél ez a mező nincs meg, azt a
 * lekérdezés SOSEM hozza vissza — és Firestore-ban nem lehet „hiányzó mezőre"
 * keresni, tehát a job magától nem venné észre őket.
 *
 * Az új fiókoknál a `newUserDoc` már kitölti. Ez a szkript a régieket hozza be.
 *
 * ⚠️ NEM oszt jóváírást. A `lastDay` a MAI napra áll, tehát az első valódi
 * forduló a következő helyi éjfélkor lesz — különben egy régi fiók egyetlen
 * napra kapná meg az addigi teljes tartását.
 *
 * FUTTATÁS (a `server/` mappából, PowerShellben):
 *
 *   npm.cmd run rollover:seed          — megmutatja, mit tenne
 *   npm.cmd run rollover:seed -- --apply
 */

import { COLLECTIONS, db } from '../lib/firebase';
import { localDay, nextLocalMidnight } from '../lib/gridMath';

const DEFAULT_TIMEZONE = 'Europe/Budapest';
const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const now = new Date();
  const snapshot = await db.collection(COLLECTIONS.users).get();

  let missing = 0;
  let present = 0;
  const batchSize = 400;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() as {
      timezone?: string;
      rollover?: { nextDueAt?: unknown; lastDay?: unknown };
    };

    if (data.rollover?.nextDueAt !== undefined && typeof data.rollover?.lastDay === 'number') {
      present += 1;
      continue;
    }

    missing += 1;
    const timezone = data.timezone || DEFAULT_TIMEZONE;
    const rollover = {
      lastDay: localDay(now, timezone),
      nextDueAt: nextLocalMidnight(now, timezone),
    };

    console.log(
      `  ${doc.id.padEnd(30)} ${timezone.padEnd(20)} lastDay=${rollover.lastDay}  következő=${rollover.nextDueAt.toISOString()}`,
    );

    if (apply) {
      batch.set(doc.ref, { rollover }, { merge: true });
      pending += 1;
      if (pending >= batchSize) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (apply && pending > 0) await batch.commit();

  console.log('');
  console.log(`Felhasználók összesen: ${snapshot.size}`);
  console.log(`  már be van jegyezve: ${present}`);
  console.log(`  ${apply ? 'bejegyezve most' : 'bejegyzésre várna'}: ${missing}`);
  if (!apply && missing > 0) {
    console.log('');
    console.log('Ez csak előnézet volt. Éles futtatás:  npm.cmd run rollover:seed -- --apply');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
