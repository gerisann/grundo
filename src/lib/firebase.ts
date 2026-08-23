import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';
import { isNativeApp } from './platform';

/**
 * A GRUNDO NEM az alapértelmezett Firestore adatbázist használja, hanem egy
 * dedikáltat: `grundo-db`. Ha a második paramétert elhagyod, csendben a
 * `(default)` adatbázisra írsz — ez a hiba nehezen vehető észre, mert minden
 * "működik", csak rossz helyen keletkeznek az adatok.
 */
export const FIRESTORE_DATABASE_ID =
  import.meta.env.VITE_FIRESTORE_DATABASE_ID || 'grundo-db';

const CONFIG_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

/** Melyik kötelező változó hiányzik? Üres tömb = minden megvan. */
export const missingFirebaseConfig: string[] = CONFIG_KEYS.filter(
  (key) => !import.meta.env[key],
);

/**
 * Konfigurált-e a Firebase?
 *
 * Korábban a modul betöltéskor dobott, ha hiányzott egy változó — ettől a
 * helyi fejlesztés fehér képernyőre futott, mindenféle magyarázat nélkül.
 * Most a hiány kezelhető állapot: az app elindul, és a bejelentkezési
 * képernyő megmondja, mi hiányzik.
 */
export const firebaseConfigured = missingFirebaseConfig.length === 0;

function buildApp(): FirebaseApp | null {
  if (!firebaseConfigured) return null;
  return initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
}

export const app: FirebaseApp | null = buildApp();
/**
 * A Firebase alapértelmezett IndexedDB-perzisztenciája egyes iOS WKWebView
 * környezetekben nem oldja fel a kezdeti auth-állapotot. A Capacitor appban
 * ezért a tartós, de egyszerűbb localStorage-t kényszerítjük. Weben marad a
 * Firebase alapértelmezett (IndexedDB-t preferáló) viselkedése.
 */
export const auth: Auth | null = app
  ? (isNativeApp()
    ? initializeAuth(app, { persistence: browserLocalPersistence })
    : getAuth(app))
  : null;
export const db: Firestore | null = app ? getFirestore(app, FIRESTORE_DATABASE_ID) : null;
export const storage: FirebaseStorage | null = app ? getStorage(app) : null;

if (app && auth && db && storage && import.meta.env.VITE_USE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8081);
  connectStorageEmulator(storage, 'localhost', 9199);
  // eslint-disable-next-line no-console
  console.info('[GRUNDO] Firebase emulátorokhoz csatlakozva.');

  /*
    FEJLESZTŐI BEJELENTKEZÉS — csak emulátoron.

    A `seed:emulator` szkript által létrehozott teszt-fiókba lép be, a
    böngésző konzoljából (vagy egy automatizált ellenőrzésből) hívva:

        await __grundoDevSignIn()

    MIÉRT KELL? Mert a felületek nagy része bejelentkezés nélkül meg sem
    jelenik, és a fejlesztői ellenőrzés így nem kér senkitől jelszót — a
    fiók az emulátoré, leállításkor elszáll vele együtt.

    Az éles build ezt a blokkot NEM tartalmazza: a `VITE_USE_EMULATORS` ott
    nincs beállítva, a feltétel behelyettesítés után hamis, és a
    csomagolóból kiesik.
  */
  const dev = window as unknown as {
    __grundoDevSignIn?: (email?: string, password?: string) => Promise<unknown>;
  };
  dev.__grundoDevSignIn = async (
    email = 'geri@grundo.local',
    password = 'grundo-emulator',
  ) => {
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    return signInWithEmailAndPassword(auth, email, password);
  };
}

/** Ott használd, ahol a hiányzó konfiguráció programozói hiba lenne. */
export function requireAuth(): Auth {
  if (!auth) throw new Error('A Firebase nincs konfigurálva. Lásd .env.example.');
  return auth;
}

export function requireDb(): Firestore {
  if (!db) throw new Error('A Firebase nincs konfigurálva. Lásd .env.example.');
  return db;
}

/**
 * Hívás a Cloud Run backendhez, a bejelentkezett felhasználó tokenjével.
 *
 * MINDEN játékadat-írás ezen megy keresztül — a kliens Firestore-ba
 * közvetlenül csak a saját, engedélyezett mezőit írhatja (lásd firestore.rules).
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL;
  if (!base) {
    throw new Error('A háttérszolgáltatás még nincs beállítva (VITE_API_BASE_URL).');
  }

  const user = auth?.currentUser ?? null;
  const token = user ? await user.getIdToken() : null;

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'A művelet nem sikerült. Próbáld újra.');
  }
  return response.json() as Promise<T>;
}
