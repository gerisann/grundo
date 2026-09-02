import { initializeApp, applicationDefault, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getAppCheck, type AppCheck } from 'firebase-admin/app-check';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Storage } from 'firebase-admin/storage';

/**
 * Dedikált Firestore adatbázis.
 *
 * A `getFirestore(app)` a `(default)` adatbázist adná vissza — a GRUNDO adatai
 * a `grundo-db` adatbázisban vannak. Ha ez elmarad, minden „működik", csak
 * rossz helyen keletkeznek az adatok, és ez hetekkel később derül ki.
 */
export const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID ?? 'grundo-db';

function currentApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({ credential: applicationDefault() });
}

export const adminApp: App = currentApp();
export const auth: Auth = getAuth(adminApp);
export const appCheck: AppCheck = getAppCheck(adminApp);
export const db: Firestore = getFirestore(adminApp, FIRESTORE_DATABASE_ID);
export const storage: Storage = getStorage(adminApp);

/**
 * A Storage-bucket neve explicit konfigurációból jön élesben.
 *
 * A projektazonosítóból képzett érték az emulátort és a fejlesztői projekteket
 * szolgálja; a Cloud Run telepítés a tényleges `grundo.firebasestorage.app`
 * bucketet adja át. Így nem függünk az Admin SDK implicit alapértelmezésétől.
 */
export const FIREBASE_STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET ??
  defaultBucket(adminApp.options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'grundo');

function defaultBucket(projectId: string): string {
  // Az új éles projektek `.firebasestorage.app`, az emulátor bevett bucketje
  // `.appspot.com`. Élesben ezt a cloudbuild.yaml amúgy is explicit felülírja.
  return projectId === 'grundo' ? 'grundo.firebasestorage.app' : `${projectId}.appspot.com`;
}

/** Kollekció-nevek egy helyen, hogy ne szóródjanak el elgépelve. */
export const COLLECTIONS = {
  users: 'users',
  usernames: 'usernames',
  otpCodes: 'otpCodes',
  activities: 'activities',
  grid: 'grid',
  zones: 'zones',
  gpLedger: 'gpLedger',
  dailyGp: 'dailyGp',
  territoryEvents: 'territoryEvents',
  activityTrust: 'activityTrust',
  activityAudits: 'activityAudits',
  /** Server-only életjel a hosszú, még véglegesítés előtt álló mentésekhez. */
  activityUploads: 'activityUploads',
  adminAudit: 'adminAudit',
  reports: 'reports',
  followRequests: 'followRequests',
  badges: 'badges',
  notifications: 'notifications',
  devices: 'devices',
  appConfig: 'appConfig',
  modifiers: 'modifiers',
  metricsDaily: 'metricsDaily',
  rolloverRuns: 'rolloverRuns',
  /** Server-only, transactionally updated abuse-prevention counters. */
  rateLimits: 'rateLimits',
  /** Előszámolt, összefüggő területfoltok a térkép távoli nézetéhez. */
  territoryBlobs: 'territoryBlobs',
} as const;

/** Az `appConfig` dokumentumainak azonosítói. */
export const APP_CONFIG_DOCS = {
  gameplay: 'gameplay',
} as const;
