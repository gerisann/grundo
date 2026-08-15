import { createContext, useContext, type ReactNode } from 'react';
import { useTheme } from './useTheme';
import type { Coords } from '@/lib/theme';

type ThemeApi = ReturnType<typeof useTheme>;

const ThemeContext = createContext<ThemeApi | null>(null);

/**
 * A téma állapota és vezérlője.
 *
 * Külön fájlban van (nem az App.tsx-ben), mert a Beállítások képernyő is
 * importálja — az App.tsx-ből importálva körkörös függőség keletkezne.
 */
export function useThemeContext(): ThemeApi {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useThemeContext csak a ThemeProvider alatt hívható');
  return value;
}

export function ThemeProvider({
  children,
  coords = null,
  recordingActive = false,
}: {
  children: ReactNode;
  coords?: Coords | null;
  recordingActive?: boolean;
}) {
  // Enélkül az index.html inline szkriptje beállítja ugyan az induló témát,
  // de az automatikus (napszak szerinti) váltás soha nem következne be.
  const theme = useTheme({ coords, recordingActive });
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
