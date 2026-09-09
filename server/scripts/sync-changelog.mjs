/**
 * A gyökér CHANGELOG.md szinkronizálása a Firestore `changelog`
 * gyűjteménybe (grundo-db), hogy az admin felület (`/admin/verziotortenet`)
 * élesben ezt olvashassa.
 *
 * MIÉRT KÉT HELYEN VAN A VERZIÓTÖRTÉNET? A `CHANGELOG.md` a git-történettel
 * követhető, PR-ekben olvasható eredeti; a Firestore-tükör az admin
 * felületnek kell, mert az nem éri el a repót futásidőben. A doc id a
 * verziószám, ezért az újrafuttatás nem duplikál, csak felülír — bármikor
 * biztonságosan újrafuttatható.
 *
 * FUTTATÁS (Cloud Shell, minden verzióemelés + deploy után):
 *
 *   cd ~/grundo && node server/scripts/sync-changelog.mjs
 *
 * A `.claude/rules/versioning.md` szerint ez a `scripts/bump-version.mjs`
 * utáni, deploy körüli lépés.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const app = initializeApp({ credential: applicationDefault() });
const db = getFirestore(app, DATABASE_ID);

const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const raw = readFileSync(changelogPath, 'utf8');

// `## [1.2.0] - 2026-09-09 (Új funkció)` fejléc, alatta `- ` listaelemek a következő fejlécig.
//
// A fejlécek pozícióját külön keressük meg, és a köztük lévő szöveget
// szeleteljük ki — egy lusta `[\s\S]*?` + `$` kombináció a `gm` flaggel
// minden sorvégen (nem csak szakaszvégen) megállt volna, üres bejegyzéseket
// eredményezve.
const headerPattern = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2}) \((Javítás|Új funkció|Nagy verzió)\)$/gm;
const typeMap = { Javítás: 'patch', 'Új funkció': 'minor', 'Nagy verzió': 'major' };

const headers = [...raw.matchAll(headerPattern)];
const entries = [];
for (let i = 0; i < headers.length; i++) {
  const [, version, date, typeLabel] = headers[i];
  const bodyStart = headers[i].index + headers[i][0].length;
  const bodyEnd = i + 1 < headers.length ? headers[i + 1].index : raw.length;
  const body = raw.slice(bodyStart, bodyEnd);
  const changes = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());
  if (changes.length === 0) continue;
  entries.push({ version, date, type: typeMap[typeLabel], changes });
}

if (entries.length === 0) {
  console.error('Nem talált egyetlen feldolgozható CHANGELOG.md szakaszt sem — nincs mit szinkronizálni.');
  process.exit(1);
}

for (const entry of entries) {
  await db
    .collection('changelog')
    .doc(entry.version)
    .set({
      version: entry.version,
      buildNumber: null,
      type: entry.type,
      changes: entry.changes,
      releasedAt: Timestamp.fromDate(new Date(`${entry.date}T00:00:00Z`)),
    });
  console.log(`v${entry.version} szinkronizálva (${entry.changes.length} bejegyzés).`);
}

console.log(`Kész: ${entries.length} verzió a "changelog" gyűjteményben (${DATABASE_ID}).`);
