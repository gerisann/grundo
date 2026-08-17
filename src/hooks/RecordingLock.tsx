import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * „Rögzítés folyamatban" jelzés az alkalmazás héjának.
 *
 * NEM csak kozmetika. A dokkon elnavigálva a rögzítés képernyője leválna a
 * DOM-ról, a `useRecorder` takarítása lefutna, és a helymeghatározás leállna —
 * a felhasználó pedig azt hinné, hogy a futása tovább mérődik. A dokk
 * elrejtése rögzítés közben tehát adatvesztést előz meg.
 *
 * Külön fájlban, hogy az `App.tsx` és a `Dock.tsx` ugyanarra hivatkozhasson
 * körkörös import nélkül — ugyanaz az ok, amiért a `ThemeProvider` is külön él.
 */

interface RecordingLockApi {
  /** Igaz, amíg aktív vagy szüneteltetett rögzítés fut. */
  locked: boolean;
  setLocked: (value: boolean) => void;
}

const RecordingLockContext = createContext<RecordingLockApi>({
  locked: false,
  setLocked: () => {},
});

export function useRecordingLock(): RecordingLockApi {
  return useContext(RecordingLockContext);
}

export function RecordingLockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const value = useMemo(() => ({ locked, setLocked }), [locked]);
  return <RecordingLockContext.Provider value={value}>{children}</RecordingLockContext.Provider>;
}
