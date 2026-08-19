import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithPopup,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, firebaseConfigured, requireAuth } from '@/lib/firebase';
// `backend` néven, mert az AuthProvider saját visszatérési objektuma is `api`.
import { api as backend, apiConfigured } from '@/lib/api';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'unconfigured';

export interface AuthApi {
  status: AuthStatus;
  user: User | null;
  /** Igaz, ha a felhasználó megerősítette az e-mail-címét. */
  emailVerified: boolean;
  registerWithEmail: (input: RegisterInput) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Belépés e-mail-címmel VAGY felhasználónévvel — a mező tartalma dönti el. */
  signInWithIdentifier: (identifier: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  linkGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

/**
 * „Ezt a fiókot Google-lel hoztad létre."
 *
 * Saját hibatípus, hogy a belépőképernyő fel tudja ismerni, és ne csak egy
 * szöveget mutasson, hanem a Google-gombra is irányíthasson.
 */
export class GoogleAccountError extends Error {
  readonly code = 'use_google';

  constructor() {
    super('Ezt a fiókot Google-fiókkal hoztad létre. Lépj be a Google-gombbal.');
    this.name = 'GoogleAccountError';
  }
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth csak az AuthProvider alatt hívható');
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(
    firebaseConfigured ? 'loading' : 'unconfigured',
  );

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setStatus(next ? 'signed-in' : 'signed-out');
    });
  }, []);

  const api = useMemo<AuthApi>(() => {
    return {
      status,
      user,
      emailVerified: user?.emailVerified ?? false,

      async registerWithEmail({ username, email, password }) {
        const instance = requireAuth();
        const credential = await createUserWithEmailAndPassword(instance, email, password);
        // A megjelenített név azonnal beáll, hogy a felület ne legyen üres.
        await updateProfile(credential.user, { displayName: username });

        // TODO(F0/backend): a felhasználónév EGYEDISÉGÉT szerveroldalon kell
        // lefoglalni (`usernames/{lowercase}` tranzakcióval), és ott jön létre
        // a `users/{uid}` dokumentum is. A firestore.rules szándékosan tiltja,
        // hogy a kliens ezt írja — addig a név csak a profilon él.
      },

      async signInWithEmail(email, password) {
        await signInWithEmailAndPassword(requireAuth(), email, password);
      },

      /**
       * Két út, és a döntést a `@` hozza meg.
       *
       * E-mail-cím → közvetlenül a Firebase-hez. Így a jelszó a mi
       * backendünket meg sem érinti, és a Firebase saját hibakódjait kapjuk
       * (rossz jelszó, felfüggesztett fiók, túl sok próbálkozás).
       *
       * Felhasználónév → a backendhez, mert a Firebase nem ismeri a neveket.
       * Lásd a szerveroldali `loginHandler` magyarázatát arról, miért nem
       * kérdezhetjük le egyszerűen a névhez tartozó e-mail-címet.
       */
      async signInWithIdentifier(identifier, password) {
        const instance = requireAuth();
        const value = identifier.trim();

        if (value.includes('@')) {
          try {
            await signInWithEmailAndPassword(instance, value, password);
          } catch (error) {
            /**
             * A GOOGLE-FIÓKOS FELHASZNÁLÓ ITT RAGADT MEG.
             *
             * E-mail-lel a Firebase-hez fordulunk közvetlenül, és onnan csak
             * annyi jön vissza, hogy „hibás adat" — pedig a fiókhoz egyáltalán
             * nem tartozik jelszó, tehát a felhasználó a világ végezetéig
             * próbálkozhatna. Azt, hogy ez a helyzet, csak a szerver tudja
             * megmondani, ezért kérdezzük meg — de CSAK a hiba után, hogy a
             * sikeres belépés ne kapjon fölösleges körbefordulót.
             */
            if (apiConfigured) {
              const { googleOnly } = await backend.signInMethod(value);
              if (googleOnly) throw new GoogleAccountError();
            }
            throw error;
          }
          return;
        }

        if (!apiConfigured) {
          throw new Error(
            'Felhasználónévvel csak a háttérszolgáltatással lehet belépni. ' +
              'Használd az e-mail-címed.',
          );
        }

        const { customToken } = await backend.login(value, password);
        await signInWithCustomToken(instance, customToken);
      },

      async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(requireAuth(), provider);
      },

      async linkGoogle() {
        const instance = requireAuth();
        if (!instance.currentUser) throw new Error('Nincs bejelentkezett felhasználó.');
        await linkWithPopup(instance.currentUser, new GoogleAuthProvider());
      },

      async sendPasswordReset(email) {
        await sendPasswordResetEmail(requireAuth(), email);
      },

      async signOut() {
        await fbSignOut(requireAuth());
      },
    };
  }, [status, user]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}
