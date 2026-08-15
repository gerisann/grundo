import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithPopup,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, firebaseConfigured, requireAuth } from '@/lib/firebase';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'unconfigured';

export interface AuthApi {
  status: AuthStatus;
  user: User | null;
  /** Igaz, ha a felhasználó megerősítette az e-mail-címét. */
  emailVerified: boolean;
  registerWithEmail: (input: RegisterInput) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
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
