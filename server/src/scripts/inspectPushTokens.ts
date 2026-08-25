/**
 * Push-diagnózis — CSAK OLVAS, soha nem ír.
 *
 * MIÉRT KELL? Az iOS push hibakeresésénél két dolgot nem lehet a kódból
 * eldönteni, csak az éles adatból:
 *
 *   1. Regisztrálódott-e egyáltalán `platform: 'ios'` token az eszközről.
 *      Ha nincs, a hiba a kliens/natív oldalon van, és a szerverküldést
 *      felesleges nézni.
 *   2. Ha van, hány darab és milyen régi. Egy elavult, már nem érvényes token
 *      ugyanúgy „csendes" hibát ad, mint a hiányzó.
 *
 * A token értékét SOHA nem írjuk ki egészben: az eszközazonosító, és a naplóba
 * kerülve más is push-t küldhetne vele. Csak az eleje/vége látszik.
 *
 * FUTTATÁS (PowerShell, a `server` mappából):
 *
 *   $env:GOOGLE_CLOUD_PROJECT="grundo"; npm.cmd run inspect:push
 */

import { COLLECTIONS, db, FIRESTORE_DATABASE_ID } from '../lib/firebase';

const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? '(ismeretlen)';

console.log(`Projekt: ${project} · adatbázis: ${FIRESTORE_DATABASE_ID}`);
console.log('');

const deviceDocs = await db.collection(COLLECTIONS.devices).listDocuments();
if (deviceDocs.length === 0) {
  console.log('Egyetlen eszköz-dokumentum sincs a `devices` gyűjteményben.');
}

const byPlatform = new Map<string, number>();

for (const deviceDoc of deviceDocs) {
  const tokens = await deviceDoc.collection('tokens').get();
  if (tokens.empty) {
    console.log(`${deviceDoc.id}: nincs regisztrált token`);
    continue;
  }

  console.log(`${deviceDoc.id}: ${tokens.size} token`);
  for (const token of tokens.docs) {
    const data = token.data() as { platform?: unknown; updatedAt?: { toDate?: () => Date } };
    const platform = String(data.platform ?? 'ismeretlen');
    byPlatform.set(platform, (byPlatform.get(platform) ?? 0) + 1);
    const updated = data.updatedAt?.toDate?.();
    console.log(
      `   ${platform.padEnd(8)} ${mask(token.id)}  hossz: ${token.id.length}`
      + `  frissítve: ${updated ? updated.toISOString() : '(nincs)'}`,
    );
  }
}

console.log('');
console.log('Platformonként:');
for (const [platform, count] of [...byPlatform].sort()) {
  console.log(`   ${platform.padEnd(8)} ${count}`);
}
if (!byPlatform.has('ios')) {
  console.log('');
  console.log('⚠️  NINCS ios platformú token — a hiba a kliens/natív oldalon van.');
}

/** A token eleje és vége; a közepe sosem kerül naplóba. */
function mask(token: string): string {
  if (token.length <= 16) return `${token.slice(0, 4)}…`;
  return `${token.slice(0, 8)}…${token.slice(-6)}`;
}
