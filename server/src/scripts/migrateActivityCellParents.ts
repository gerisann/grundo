/**
 * A NAGY HURKOK BELSEJÉNEK pótlása a már mentett aktivitásokban.
 *
 * MIÉRT KELL? A compact (nagy) hurkok belseje sosem került bele az
 * `activityCells` mezőbe — az szándékosan csak a falat és a pontos határsávot
 * tartalmazza, a belsőt a parentek képviselik (lásd `ActivityPlan`
 * `candidateCellParents`). A kliens viszont ebből a mezőből rajzol, ezért a
 * nagy hurkok KÖZEPE üresen maradt a térképen.
 *
 * ÉLES MÉRÉS (2026-08-29, `77cbb397…`): három hurok, a legnagyobb 15 745
 * cellás és compact. A tárolt `activityCells` 6 582 elem volt, a valódi
 * foglalás 15 745 — 9 163 cella (58 %) hiányzott. Ugyanaz a terület tömören
 * MINDÖSSZE 85 index (~1 kB).
 *
 * A mentés 2026-08-29 óta írja az `activityCellParents` mezőt; ez a script a
 * KORÁBBI aktivitásokat pótolja.
 *
 * ⚠️ NEM SZÁMOL ÚJRA FOGLALÁST. Kizárólag MEGJELENÍTÉSI mezőket ír
 * (`activityCells`, `activityCellParents`) — a birtokviszonyhoz, a ponthoz és
 * a területhez nem nyúl. A geometria a nyomvonalból következik, tehát a
 * script idempotens: ugyanarra a dokumentumra mindig ugyanazt írja.
 *
 * HASZNÁLAT (a `server` mappából):
 *   npm run migrate:cell-parents                      → jelentés, nem ír
 *   npm run migrate:cell-parents -- --limit 20        → csak az első 20 érintett
 *   npm run migrate:cell-parents -- --apply --allow-production
 */
import { FieldPath } from 'firebase-admin/firestore';
import { adminApp, COLLECTIONS, db, FIRESTORE_DATABASE_ID } from '../lib/firebase';
import { processActivity } from '../../../src/game';
import type { ActivityType, TracePoint } from '../../../src/types';

const args = process.argv.slice(2);
const flags = new Set(args);
const apply = flags.has('--apply');
const allowProduction = flags.has('--allow-production');
/** Minden aktivitást átszámol, nem csak azokat, ahol hiányt mértünk. */
const all = flags.has('--all');
const limit = numberFlag('--limit') ?? Infinity;

const configuredProject = adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';
if (!configuredProject) {
  throw new Error('Állítsd be a GOOGLE_CLOUD_PROJECT környezeti változót a futtatás előtt.');
}
if (configuredProject === 'grundo' && apply && !allowProduction) {
  throw new Error('Éles íráshoz az --apply mellett az --allow-production kapcsoló is kötelező.');
}

/**
 * Ugyanazok a plafonok, mint az API-ban (`routes/activities.ts`) — a
 * dokumentum 1 MB-os Firestore-korlátja miatt is. Egy parent ~49 res12 cellát
 * képvisel, tehát 4 000 parent bőven lefed egy nagyon nagy kört.
 */
const MAX_CELLS = 20_000;
const MAX_PARENTS = 4_000;

/** Kisebb lap, mint a többi migrációnál: dokumentumonként geometriát számolunk. */
const PAGE_SIZE = 50;

let scanned = 0;
let candidates = 0;
let changed = 0;
let skipped = 0;
let failed = 0;
let cellsAdded = 0;
let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

do {
  let query = db
    .collection(COLLECTIONS.activities)
    .orderBy(FieldPath.documentId())
    .limit(PAGE_SIZE);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;

  const batch = apply ? db.batch() : null;
  let wroteInBatch = false;

  for (const doc of page.docs) {
    if (changed >= limit) break;
    scanned += 1;
    try {
      const data = doc.data() as Record<string, unknown>;
      if (data.deletedAt != null) {
        skipped += 1;
        continue;
      }

      const stored = Array.isArray(data.activityCells) ? data.activityCells.length : 0;
      const existingParents = Array.isArray(data.activityCellParents)
        ? data.activityCellParents.length
        : 0;

      /*
        OLCSÓ ELŐSZŰRŐ, geometria nélkül: a `claimCounts` megmondja, hány
        cellát foglalt az aktivitás. Ha ez több, mint amennyi cellát tárolunk,
        akkor pont a compact hurok belseje hiányzik. Így a futás nem számol
        újra több ezer aktivitást feleslegesen.
      */
      const claimed = claimedCellCount(data.claimCounts);
      const missing = claimed - stored;
      if (!all && (existingParents > 0 || missing <= 0)) {
        skipped += 1;
        continue;
      }
      candidates += 1;

      const track = await doc.ref.collection('private').doc('track').get();
      const points = track.data()?.points as TracePoint[] | undefined;
      if (!Array.isArray(points) || points.length < 2) {
        // Nyomvonal nélkül nincs mit újraszámolni (pl. importált aktivitás).
        skipped += 1;
        continue;
      }

      const result = processActivity({
        points,
        type: (data.type as ActivityType) ?? 'run',
        distanceKm: Number(data.distanceM ?? 0) / 1000,
        actorId: String(data.userId ?? ''),
        // ÜRES ownership: itt kizárólag a GEOMETRIA kell, a birtokviszonyhoz
        // nem nyúlunk. A motor compact hurokra amúgy is csak így fut le.
        ownership: new Map(),
        streakDays: 0,
        gpEarnedToday: 0,
      });

      const cells = [...result.claimedCells].slice(0, MAX_CELLS);
      const parents = result.compactClaim
        ? [...result.compactClaim.parents.keys()].slice(0, MAX_PARENTS)
        : [];

      if (parents.length === 0 && cells.length <= stored) {
        // Nincs compact belső, és nem tudunk többet adni a tároltnál.
        skipped += 1;
        continue;
      }

      changed += 1;
      cellsAdded += Math.max(0, result.claimedCellCount - stored);
      console.log(
        `${doc.id}: tarolt=${stored} -> cellak=${cells.length} + parentek=${parents.length}` +
          `  (valodi foglalas=${result.claimedCellCount}${claimed > 0 ? `, claimCounts=${claimed}` : ''})`,
      );

      if (batch) {
        batch.update(doc.ref, { activityCells: cells, activityCellParents: parents });
        wroteInBatch = true;
      }
    } catch (error) {
      failed += 1;
      console.error(`[hiba] ${doc.id}`, error);
    }
  }

  if (batch && wroteInBatch) await batch.commit();
  if (changed >= limit) break;
  cursor = page.docs.at(-1);
} while (cursor);

console.log({
  mode: apply ? 'apply' : 'dry-run',
  project: configuredProject,
  database: FIRESTORE_DATABASE_ID,
  scanned,
  candidates,
  changed,
  skipped,
  failed,
  cellsAdded,
});

/** Hány cellát foglalt az aktivitás a mentett összesítő szerint. */
function claimedCellCount(raw: unknown): number {
  const counts = (raw ?? {}) as Record<string, unknown>;
  const free = Number(counts.free ?? 0);
  const stolen = Number(counts.stolen ?? 0);
  const reclaimed = Number(counts.reclaimed ?? 0);
  // Az áttörés (`breakthrough`) NEM cserél gazdát, tehát nem is számít bele.
  const total = free + stolen + reclaimed;
  return Number.isFinite(total) ? total : 0;
}

function numberFlag(name: string): number | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
