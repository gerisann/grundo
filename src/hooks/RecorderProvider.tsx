import { createContext, useContext, type ReactNode } from 'react';
import { useRecorder, type RecorderApi } from './useRecorder';

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

const RecorderContext = createContext<RecorderApi | null>(null);

export function useRecorderContext(): RecorderApi {
  const value = useContext(RecorderContext);
  if (!value) throw new Error('useRecorderContext csak a RecorderProvider alatt hívható');
  return value;
}

export function RecorderProvider({ children }: { children: ReactNode }) {
  const recorder = useRecorder();
  return <RecorderContext.Provider value={recorder}>{children}</RecorderContext.Provider>;
}
