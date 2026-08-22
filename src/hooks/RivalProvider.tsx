import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, apiConfigured } from '@/lib/api';
import { useAuth } from './AuthProvider';

/**
 * Kik a riválisaim — a név melletti „RIVÁLIS" címkéhez.
 *
 * MIÉRT PROVIDER, ÉS NEM LEKÉRDEZÉS KOMPONENSENKÉNT? Mert a címke a spec
 * szerint MINDENHOL megjelenik, ahol egy felhasználó neve látszik: a feedben,
 * a hozzászólásoknál, a ranglistán, a keresésben, a követő-listákban. Ha
 * mindegyik hely külön kérdezné meg, egy feed-görgetés tucatnyi azonos kérést
 * indítana. Így EGY lekérdezés van, és a válasz egy halmaz, amiből minden
 * névsor O(1)-ben megválaszolja magának a kérdést.
 *
 * ⚠️ AZONOSÍTÓK, NEM NEVEK. A halmaz csak uid-eket tartalmaz, tehát akkor is
 * használható, ha a felület éppen csak uid-et ismer (például egy régi
 * hozzászólásnál), és nem hízik meg akkor sem, ha valakinek több száz
 * riválisa van.
 *
 * A tiltottakat a szerver már kiszűrte (`routes/rivals.ts`), tehát letiltott
 * felhasználó neve mellé itt nem kerülhet címke.
 */

export interface RivalApi {
  /** Rivális-e ez a felhasználó? Ismeretlen vagy saját uid-re hamis. */
  isRival: (uid: string | null | undefined) => boolean;
  /** Hány riválisom van (a betöltött halmazban). */
  count: number;
  /** Újratöltés — egy összecsapás után a lista változhat. */
  reload: () => Promise<void>;
}

const RivalContext = createContext<RivalApi | null>(null);

/**
 * ⚠️ NEM DOB, ha nincs fölötte provider — a `useProfile`-lal ellentétben.
 *
 * A címke MELLÉKES DÍSZ: ha valamiért nincs adat, a név ugyanúgy olvasható
 * marad. Egy dobás viszont az egész képernyőt elvinné — például egy
 * bejelentkezés előtti nézetben, ahol a provider nem is fut. Ezért az
 * alapértelmezés a „senki nem rivális", nem a hiba.
 */
export function useRivals(): RivalApi {
  return useContext(RivalContext) ?? EMPTY;
}

const EMPTY: RivalApi = {
  isRival: () => false,
  count: 0,
  reload: async () => {},
};

export function RivalProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useAuth();
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  const load = useCallback(async () => {
    if (authStatus !== 'signed-in' || !apiConfigured) {
      setIds(new Set());
      return;
    }
    try {
      const { ids: next } = await api.rivalIds();
      setIds(new Set(next));
    } catch {
      // A címke elmaradása nem hiba, amit a felhasználó elé kell vinni.
      setIds(new Set());
    }
  }, [authStatus]);

  useEffect(() => {
    void load();
  }, [load, user?.uid]);

  const value = useMemo<RivalApi>(
    () => ({
      isRival: (uid) => (uid ? ids.has(uid) : false),
      count: ids.size,
      reload: load,
    }),
    [ids, load],
  );

  return <RivalContext.Provider value={value}>{children}</RivalContext.Provider>;
}
