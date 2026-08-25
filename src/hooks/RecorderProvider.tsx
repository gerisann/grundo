import { createContext, useContext, type ReactNode } from 'react';
import { useRecorder, type RecorderApi, type RecorderOptions } from './useRecorder';
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
    <RecorderContext.Provider value={{ ...recorder, remoteState }}>
      {children}
    </RecorderContext.Provider>
  );
}
