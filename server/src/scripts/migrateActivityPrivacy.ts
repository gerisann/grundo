/**
 * Régi aktivitások trust- és helyadatvédelmi tisztítása.
 *
 * Alapértelmezésben csak jelentést készít. Íráshoz `--apply` kell, az éles
 * projekthez pedig ezen felül `--allow-production`. A script idempotens.
 */
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { decodePolyline } from '../../../src/game/polyline';
import { adminApp, COLLECTIONS, db, FIRESTORE_DATABASE_ID } from '../lib/firebase';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const allowProduction = args.has('--allow-production');
const configuredProject = adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';

if (!configuredProject) {
  throw new Error('Állítsd be a GOOGLE_CLOUD_PROJECT környezeti változót a futtatás előtt.');
}
if (configuredProject === 'grundo' && apply && !allowProduction) {
  throw new Error('Éles íráshoz az --apply mellett az --allow-production kapcsoló is kötelező.');
}

const PAGE_SIZE = 200;
let scanned = 0;
let changed = 0;
let skipped = 0;
let failed = 0;
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
  for (const doc of page.docs) {
    scanned += 1;
    try {
      const data = doc.data() as Record<string, unknown>;
      const summary = (data.summary ?? {}) as Record<string, unknown>;
      const hasTrustLeak =
        'trustScore' in data || 'trustReasons' in data || 'trustReasons' in summary;
      const route = typeof data.route === 'string' ? data.route : '';
      const publicBounds = boundsFromRoute(route);
      const boundsChanged = JSON.stringify(data.bounds ?? null) !== JSON.stringify(publicBounds);

      if (!hasTrustLeak && !boundsChanged) {
        skipped += 1;
        continue;
      }
      changed += 1;
      if (!batch) continue;

      const patch: Record<string, unknown> = {
        trustScore: FieldValue.delete(),
        trustReasons: FieldValue.delete(),
        'summary.trustReasons': FieldValue.delete(),
        bounds: publicBounds,
      };
      batch.update(doc.ref, patch);

      if (hasTrustLeak) {
        const score = Number(data.trustScore);
        const reasons = Array.isArray(data.trustReasons)
          ? data.trustReasons.filter((value): value is string => typeof value === 'string')
          : Array.isArray(summary.trustReasons)
            ? summary.trustReasons.filter((value): value is string => typeof value === 'string')
            : [];
        batch.set(
          db.collection(COLLECTIONS.activityTrust).doc(doc.id),
          {
            activityId: doc.id,
            userId: String(data.userId ?? ''),
            ...(Number.isFinite(score) ? { score } : {}),
            reasons,
            measuredVerdict: data.trustVerdict ?? summary.trustVerdict ?? 'trusted',
            migratedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    } catch (error) {
      failed += 1;
      console.error(`[hiba] ${doc.id}`, error);
    }
  }

  if (batch) await batch.commit();
  cursor = page.docs.at(-1);
} while (cursor);

console.log({
  mode: apply ? 'apply' : 'dry-run',
  project: configuredProject,
  database: FIRESTORE_DATABASE_ID,
  scanned,
  changed,
  skipped,
  failed,
});

function boundsFromRoute(route: string) {
  if (!route) return null;
  try {
    const points = decodePolyline(route);
    if (points.length === 0) return null;
    let north = -90;
    let south = 90;
    let east = -180;
    let west = 180;
    for (const point of points) {
      north = Math.max(north, point.lat);
      south = Math.min(south, point.lat);
      east = Math.max(east, point.lng);
      west = Math.min(west, point.lng);
    }
    return { north, south, east, west };
  } catch {
    // Bizonytalan geometriát nem tartunk meg: a privát adat törlése a
    // biztonságos alapértelmezés.
    return null;
  }
}
