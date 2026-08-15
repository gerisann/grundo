import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

function required(name: string): string {
  const value = import.meta.env[name as keyof ImportMetaEnv] as string | undefined;
  if (!value) {
    throw new Error(
      `Hiányzó környezeti változó: ${name}. Másold a .env.example fájlt .env.local néven, és töltsd ki.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = import.meta.env[name as keyof ImportMetaEnv] as string | undefined;
  return value && value.length > 0 ? value : fallback;
}

const config = {
  apiKey: required('VITE_FIREBASE_API_KEY'),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: required('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: required('VITE_FIREBASE_APP_ID'),
};

/**
 * A GRUNDO NEM az alapértelmezett Firestore adatbázist használja, hanem egy
 * dedikáltat: `grundo-db`. Ha a második paramétert elhagyod, csendben a
 * `(default)` adatbázisra írsz — ez a hiba nehezen vehető észre, mert minden
 * "működik", csak rossz helyen keletkeznek az adatok.
 */
export const FIRESTORE_DATABASE_ID = optional('VITE_FIRESTORE_DATABASE_ID', 'grundo-db');

export const app: FirebaseApp = initializeApp(config);
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app, FIRESTORE_DATABASE_ID);
export const storage: FirebaseStorage = getStorage(app);

if (import.meta.env.VITE_USE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8081);
  connectStorageEmulator(storage, 'localhost', 9199);
  // eslint-disable-next-line no-console
  console.info('[GRUNDO] Firebase emulátorokhoz csatlakozva.');
}

/**
 * Hívás a Cloud Run backendhez, a bejelentkezett felhasználó tokenjével.
 *
 * MINDEN játékadat-írás ezen megy keresztül — a kliens Firestore-ba
 * közvetlenül csak a saját, engedélyezett mezőit írhatja (lásd firestore.rules).
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;

  const baseUrl = optional('VITE_API_BASE_URL', '');
  if (!baseUrl) {
    throw new Error('A backend címe nincs beállítva (VITE_API_BASE_URL).');
  }

  const response = await fetch(`${baseUrl}${path}`, {
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
