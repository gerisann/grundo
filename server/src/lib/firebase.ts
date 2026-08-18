import { initializeApp, applicationDefault, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

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
export const db: Firestore = getFirestore(adminApp, FIRESTORE_DATABASE_ID);

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
} as const;
