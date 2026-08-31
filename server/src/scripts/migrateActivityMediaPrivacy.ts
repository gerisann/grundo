/**
 * Aktivitásfotók tartós letöltési tokenjeinek visszavonása.
 *
 * Alapértelmezésben csak jelentést készít. Íráshoz `--apply` kell, az éles
 * projekthez pedig ezen felül `--allow-production`. A művelet idempotens:
 * a Firestore-ban csak a Storage-útvonal marad, az objektumok Firebase
 * letöltési token metaadata pedig törlődik.
 */
import { FieldPath } from 'firebase-admin/firestore';
import {
  adminApp,
  COLLECTIONS,
  db,
  FIREBASE_STORAGE_BUCKET,
  FIRESTORE_DATABASE_ID,
  storage,
} from '../lib/firebase';

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
let activityScanned = 0;
let activityChanged = 0;
let objectScanned = 0;
let tokenRevoked = 0;
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
    activityScanned += 1;
    const raw = doc.data().photos;
    if (!Array.isArray(raw)) continue;

    const normalized = raw
      .filter((item): item is { path: string } => {
        const photo = item as { path?: unknown };
        return typeof photo?.path === 'string';
      })
      .slice(0, 5)
      .map((photo) => ({ path: photo.path }));
    if (JSON.stringify(raw) === JSON.stringify(normalized)) continue;

    activityChanged += 1;
    batch?.update(doc.ref, { photos: normalized });
  }

  if (batch) await batch.commit();
  cursor = page.docs.at(-1);
} while (cursor);

const bucket = storage.bucket(FIREBASE_STORAGE_BUCKET);
for await (const file of bucket.getFilesStream({ prefix: 'activities/' })) {
  objectScanned += 1;
  try {
    const [metadata] = await file.getMetadata();
    const token = metadata.metadata?.firebaseStorageDownloadTokens;
    if (typeof token !== 'string' || token.length === 0) continue;

    tokenRevoked += 1;
    if (apply) {
      await file.setMetadata({
        metadata: {
          ...metadata.metadata,
          firebaseStorageDownloadTokens: null,
        },
      });
    }
  } catch (error) {
    failed += 1;
    console.error(`[hiba] ${file.name}`, error);
  }
}

console.log({
  mode: apply ? 'apply' : 'dry-run',
  project: configuredProject,
  database: FIRESTORE_DATABASE_ID,
  bucket: FIREBASE_STORAGE_BUCKET,
  activityScanned,
  activityChanged,
  objectScanned,
  tokenRevoked,
  failed,
});
