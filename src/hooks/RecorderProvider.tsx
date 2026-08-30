import { createContext, useContext, type ReactNode } from 'react';
import { useRecorder, type RecorderApi, type RecorderOptions, type UploadState } from './useRecorder';
import { useAuth } from './AuthProvider';
import { useTrackingCloudSync, type SyncedTrackingState } from '@/tracking/cloudSync';
import type { PositionSource } from '@/tracking/types';

/**
 * A rögzítés az ALKALMAZÁS szintjén él, nem a rögzítés képernyőjén.
 *
 * Miért? Mert a vezérlők a dokkba kerültek, a dokk pedig minden képernyőn ott
 * van. Ha a rögzítő a képernyőhöz tartozna, egyetlen koppintás a dokk bármely
 * elemére leválasztaná a képernyőt, lefuttatná a takarítást, és a mérés
 * csendben leállna — miközben a felhasználó azt hinné, hogy fut tovább.
 *
 * Korábban ezt a dokk elrejtésével kerültük ki. Az működött, de zsákutca volt:
 * így viszont a rögzítés túléli a képernyőváltást, és később bármelyik
 * képernyőn megjeleníthető, hogy épp mérés zajlik.
 */

export type RecorderContextApi = RecorderApi & { remoteState: SyncedTrackingState | null };

const RecorderContext = createContext<RecorderContextApi | null>(null);

export function useRecorderContext(): RecorderContextApi {
  const value = useContext(RecorderContext);
  if (!value) throw new Error('useRecorderContext csak a RecorderProvider alatt hívható');
  return value;
}

/**
 * KÜLÖN, KÖNNYŰ CONTEXT — csak a feltöltés státuszához.
 *
 * ⚠️ GRUNDO #21 energiaelemzés, B5: az `App.tsx` `Router()`-je (a TELJES
 * útválasztó, minden képernyő szülője) korábban a teljes
 * `useRecorderContext()`-et kérte le, pedig kizárólag az `upload.status`-t
 * használja (`savePanelOpen`). Mivel a `RecorderContextApi` a `state`-et
 * (a GPS-pontok tömbjét) is tartalmazza, ami MINDEN mintánál új objektum,
 * a `Router()` — vele együtt a teljes app-fa React-egyeztetése — minden
 * egyes GPS-mintánál újra lefutott, akkor is, ha a képernyőn épp valami
 * egészen más volt látható.
 *
 * A `Provider`-nek átadott érték itt egyetlen PRIMITÍV string — React a
 * Context-fogyasztókat `Object.is` szerint hasonlítja össze, tehát amíg a
 * feltöltés státusza ténylegesen nem változik (`'idle'` marad mozgás
 * közben), ez a context NEM vált ki újrarenderelést, `useMemo` sem kell
 * hozzá. A `Dock`/`TrackingScreen` továbbra is a teljes
 * `useRecorderContext()`-et használja, változatlanul — nekik valóban kell
 * az élő állapot.
 */
const RecorderUploadStatusContext = createContext<UploadState['status'] | null>(null);

export function useRecorderUploadStatus(): UploadState['status'] {
  const value = useContext(RecorderUploadStatusContext);
  if (value === null) throw new Error('useRecorderUploadStatus csak a RecorderProvider alatt hívható');
  return value;
}

export interface RecorderProviderProps {
  children: ReactNode;
  /** Alapból valódi browser/native GPS; LAB-ban SimulationPositionSource. */
  source?: PositionSource;
  /** Alapból production storage/uploader; LAB-ban izolált memória + sandbox. */
  options?: RecorderOptions;
  /**
   * A valódi appban több eszköz közt szinkronizál. LAB-ban kötelezően false:
   * egy szimuláció nem írhat a user production `private/tracking` dokumentumába.
   */
  cloudSync?: boolean;
}

export function RecorderProvider({
  children,
  source,
  options,
  cloudSync = true,
}: RecorderProviderProps) {
  const recorder = useRecorder(source, options);
  const { user } = useAuth();
  // A hook mindig ugyanabban a sorrendben fut; kikapcsolva egyszerűen nem kap
  // uid-t, ezért sem listenert, sem Firestore-írást nem hoz létre.
  const remoteState = useTrackingCloudSync(cloudSync ? user?.uid : undefined, recorder.state);
  return (
    <RecorderUploadStatusContext.Provider value={recorder.upload.status}>
      <RecorderContext.Provider value={{ ...recorder, remoteState }}>
        {children}
      </RecorderContext.Provider>
    </RecorderUploadStatusContext.Provider>
  );
}
