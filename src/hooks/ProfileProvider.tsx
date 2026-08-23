import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, apiConfigured, type Profile } from '@/lib/api';
import { useAuth } from './AuthProvider';

/**
 * A GRUNDO-profil (`users/{uid}`) betöltése.
 *
 * Külön a Firebase Auth-tól: egy Firebase-fiók létezhet GRUNDO-profil nélkül
 * is (pl. ha a regisztráció félbeszakadt, vagy a fiók még a backend előtt
 * jött létre). Ilyenkor a felhasználót a felhasználónév-választóra visszük.
 */

export type ProfileStatus =
  | 'idle' // nincs bejelentkezve
  | 'loading'
  | 'ready'
  | 'missing' // van Firebase-fiók, de nincs GRUNDO-profil
  | 'unavailable' // a backend nincs beállítva (VITE_API_BASE_URL)
  | 'error';

export interface ProfileApi {
  status: ProfileStatus;
  profile: Profile | null;
  error: string;
  reload: () => Promise<void>;
  createProfile: (username: string) => Promise<void>;
}

const ProfileContext = createContext<ProfileApi | null>(null);

export function useProfile(): ProfileApi {
  const value = useContext(ProfileContext);
  if (!value) throw new Error('useProfile csak a ProfileProvider alatt hívható');
  return value;
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<ProfileStatus>('idle');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (authStatus !== 'signed-in') {
      setProfile(null);
      setStatus('idle');
      return;
    }
    if (!apiConfigured) {
      // A backend még nincs beállítva — az app nem áll meg emiatt.
      setStatus('unavailable');
      return;
    }

    setStatus('loading');
    setError('');
    let timeout: number | undefined;
    try {
      /**
       * Egy elvesző native/CORS kérés nem maradhat örökké a Splash mögött.
       * A backend hibáját a már létező ProfileError képernyő mutatja meg.
       */
      const { profile: next } = await Promise.race([
        api.me(),
        new Promise<never>((_resolve, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error('A profil betöltése időtúllépés miatt megszakadt. Ellenőrizd az internetkapcsolatot, majd próbáld újra.')),
            12_000,
          );
        }),
      ]);
      setProfile(next);
      setStatus('ready');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'profile_missing') {
        setProfile(null);
        setStatus('missing');
        return;
      }
      setError(err instanceof Error ? err.message : 'Nem sikerült betölteni a profilt.');
      setStatus('error');
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
    }
  }, [authStatus]);

  useEffect(() => {
    void load();
  }, [load, user?.uid]);

  const createProfile = useCallback(async (username: string) => {
    const { profile: next } = await api.register(username);
    setProfile(next);
    setStatus('ready');
  }, []);

  return (
    <ProfileContext.Provider value={{ status, profile, error, reload: load, createProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}
