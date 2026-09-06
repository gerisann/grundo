import { queryClient } from '@/lib/queryClient';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { auth, firebaseConfigured, requireAuth } from '@/lib/firebase';
// `backend` néven, mert az AuthProvider saját visszatérési objektuma is `api`.
import { api as backend, apiConfigured } from '@/lib/api';
import { isNativeApp } from '@/lib/platform';
import { nativeGoogleErrorMessage } from '@/lib/googleAuthErrors';
import { nativeAppleErrorMessage } from '@/lib/appleAuthErrors';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'unconfigured';

export interface AuthApi {
  status: AuthStatus;
  user: User | null;
  /** Igaz, ha a felhasználó megerősítette az e-mail-címét. */
  emailVerified: boolean;
  /**
   * Az admin szerepkör a Firebase custom claimből (`owner` / `admin` /
   * `moderator` / `support` / `readonly`), vagy `null`.
   *
   * ⚠️ EZ NEM VÉDELEM, csak a felület udvariassága: ebből tudjuk, mutassuk-e
   * az admin belépőt. A tiltást a szerver kényszeríti ki minden végponton —
   * a claim a kliensen olvasható, tehát önmagában semmit nem őriz.
   */
  role: string | null;
  registerWithEmail: (input: RegisterInput) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Belépés e-mail-címmel VAGY felhasználónévvel — a mező tartalma dönti el. */
  signInWithIdentifier: (identifier: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  linkGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  linkApple: () => Promise<void>;
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

/** A `GoogleAccountError` párja Apple-fiókokhoz — lásd ott a magyarázatot. */
export class AppleAccountError extends Error {
  readonly code = 'use_apple';

  constructor() {
    super('Ezt a fiókot Apple-fiókkal hoztad létre. Lépj be az Apple-gombbal.');
    this.name = 'AppleAccountError';
  }
}

class AuthTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthTimeoutError';
  }
}

async function nativeGoogleCredential() {
  try {
    const result = await FirebaseAuthentication.signInWithGoogle({
      // A natív SDK a rendszer fiókválasztóját adja, de a tartós auth-állapot
      // továbbra is a GRUNDO meglévő Firebase JS rétegében marad.
      skipNativeAuth: true,
      // Csak Androidon van hatása (Credential Manager); iOS-en a plugin a
      // GoogleSignIn SDK-t hívja, és ezt a mezőt figyelmen kívül hagyja.
      useCredentialManager: true,
    });
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('A Google-belépés nem adott azonosító tokent. Próbáld újra.');
    }
    return GoogleAuthProvider.credential(idToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) {
      const cancelled = new Error('A bejelentkezést megszakítottad.');
      Object.assign(cancelled, { code: 'auth/popup-closed-by-user' });
      throw cancelled;
    }
    const friendly = nativeGoogleErrorMessage(message);
    if (friendly) {
      // A nyers natív szöveget megtartjuk a diagnosztikának, de a felhasználó
      // magyar mondatot lát az angol SDK-hibakód helyett.
      throw new Error(friendly, { cause: error });
    }
    throw error;
  }
}

/**
 * Az Apple `signInWithApple()` a Google-lel ellentétben `idToken` MELLÉ
 * `nonce`-t is ad vissza (`credential.nonce`) — a Firebase `OAuthProvider`
 * ezt `rawNonce` néven várja a hitelesítő adat összeállításához. Enélkül a
 * `signInWithCredential`/`linkWithCredential` `auth/missing-or-invalid-nonce`
 * hibával utasítaná el a tokent.
 */
async function nativeAppleCredential(): Promise<AuthCredential> {
  try {
    const result = await FirebaseAuthentication.signInWithApple({ skipNativeAuth: true });
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('Az Apple-belépés nem adott azonosító tokent. Próbáld újra.');
    }
    const provider = new OAuthProvider('apple.com');
    return provider.credential({ idToken, rawNonce: result.credential?.nonce });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) {
      const cancelled = new Error('A bejelentkezést megszakítottad.');
      Object.assign(cancelled, { code: 'auth/popup-closed-by-user' });
      throw cancelled;
    }
    const friendly = nativeAppleErrorMessage(message);
    if (friendly) {
      throw new Error(friendly, { cause: error });
    }
    throw error;
  }
}

const INITIAL_AUTH_TIMEOUT_MS = 4_000;
const AUTH_ACTION_TIMEOUT_MS = 15_000;

async function withAuthTimeout<T>(operation: Promise<T>, operationName: string): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(
          () => reject(new AuthTimeoutError(`${operationName} nem válaszol. Ellenőrizd az internetkapcsolatot, majd próbáld újra.`)),
          AUTH_ACTION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
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
  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>(
    firebaseConfigured ? 'loading' : 'unconfigured',
  );

  useEffect(() => {
    if (!auth) return;
    let receivedInitialState = false;
    const unsubscribe = onAuthStateChanged(auth, (next) => {
      receivedInitialState = true;
      queryClient.clear();
      setUser(next);
      setStatus(next ? 'signed-in' : 'signed-out');

      /**
       * A szerepkör külön, aszinkron lépésben jön.
       *
       * A `getIdTokenResult()` a MÁR MEGLÉVŐ tokenből olvas, nem kér újat —
       * ezért ha valakinek most adtunk szerepkört, az csak a token
       * megújulása után (max egy óra) vagy újbóli belépés után látszik. Ez
       * elfogadható: a szerepkör-adás ritka, adminisztratív esemény, és a
       * szerver amúgy is a friss tokent ellenőrzi.
       */
      if (!next) {
        setRole(null);
        return;
      }
      void next
        .getIdTokenResult()
        .then((result) => {
          const claim = result.claims.role;
          setRole(typeof claim === 'string' ? claim : null);
        })
        .catch(() => setRole(null));
    }, (error) => {
      receivedInitialState = true;
      console.error('[GRUNDO] Firebase Auth indítási hiba.', error);
      setUser(null);
      setRole(null);
      setStatus('signed-out');
    });

    /**
     * A Firebase böngészős SDK-jának normál esetben azonnal jeleznie kell a
     * kezdeti auth-állapotot. WKWebView-ban azonban hálózati/persistence hiba
     * esetén ez korlátlanul várhat; korábban ettől az egész app splashen maradt.
     *
     * Ilyenkor a belépőképernyőt megmutatjuk. Ha a Firebase később mégis
     * visszaszól, a listener a valódi állapotára frissíti a felületet.
     */
    const timeout = window.setTimeout(() => {
      if (!receivedInitialState) {
        console.error('[GRUNDO] A Firebase Auth 12 másodpercen belül nem adta vissza a kezdeti állapotot.');
        setStatus('signed-out');
      }
    }, INITIAL_AUTH_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const api = useMemo<AuthApi>(() => {
    return {
      status,
      user,
      role,
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
        await withAuthTimeout(
          signInWithEmailAndPassword(requireAuth(), email, password),
          'A Firebase-belépés',
        );
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
            await withAuthTimeout(
              signInWithEmailAndPassword(instance, value, password),
              'A Firebase-belépés',
            );
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
            if (apiConfigured && !(error instanceof AuthTimeoutError)) {
              const { googleOnly, appleOnly } = await withAuthTimeout(
                backend.signInMethod(value),
                'A belépési mód ellenőrzése',
              );
              if (googleOnly) throw new GoogleAccountError();
              if (appleOnly) throw new AppleAccountError();
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

        const { customToken } = await withAuthTimeout(
          backend.login(value, password),
          'A belépési szerver',
        );
        await withAuthTimeout(
          signInWithCustomToken(instance, customToken),
          'A Firebase-belépés',
        );
      },

      async signInWithGoogle() {
        // Androidon és iOS-en is a natív fiókválasztó adja az ID tokent; a
        // WKWebView/Chrome Custom Tab popup flow natív appban nem megbízható.
        if (isNativeApp()) {
          const credential = await nativeGoogleCredential();
          await signInWithCredential(requireAuth(), credential);
          return;
        }
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(requireAuth(), provider);
      },

      async linkGoogle() {
        const instance = requireAuth();
        if (!instance.currentUser) throw new Error('Nincs bejelentkezett felhasználó.');
        if (isNativeApp()) {
          const credential = await nativeGoogleCredential();
          await linkWithCredential(instance.currentUser, credential);
          return;
        }
        await linkWithPopup(instance.currentUser, new GoogleAuthProvider());
      },

      async signInWithApple() {
        // Ugyanaz az elv, mint a Google-nél: natívon az ASAuthorizationController
        // (iOS) / a plugin saját webes folyamata (Android) adja a tokent, a
        // tartós munkamenetet innentől a Firebase JS SDK viszi tovább.
        if (isNativeApp()) {
          const credential = await nativeAppleCredential();
          await signInWithCredential(requireAuth(), credential);
          return;
        }
        const provider = new OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        await signInWithPopup(requireAuth(), provider);
      },

      async linkApple() {
        const instance = requireAuth();
        if (!instance.currentUser) throw new Error('Nincs bejelentkezett felhasználó.');
        if (isNativeApp()) {
          const credential = await nativeAppleCredential();
          await linkWithCredential(instance.currentUser, credential);
          return;
        }
        await linkWithPopup(instance.currentUser, new OAuthProvider('apple.com'));
      },

      async sendPasswordReset(email) {
        await sendPasswordResetEmail(requireAuth(), email);
      },

      async signOut() {
        await fbSignOut(requireAuth());
      },
    };
  }, [status, user, role]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}
