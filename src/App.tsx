import { createContext, useContext } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useTheme } from './hooks/useTheme';
import { Dock } from './components/Dock';
import { HomeScreen } from './screens/HomeScreen';
import { TerritoryScreen } from './screens/TerritoryScreen';
import { TrackingScreen } from './screens/TrackingScreen';
import { CommunityScreen } from './screens/CommunityScreen';
import { ProfileScreen } from './screens/ProfileScreen';

type ThemeApi = ReturnType<typeof useTheme>;

const ThemeContext = createContext<ThemeApi | null>(null);

/**
 * A téma állapota és vezérlője.
 * A Beállítások → Megjelenés képernyő ezen keresztül állítja a módot.
 */
export function useThemeContext(): ThemeApi {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useThemeContext csak a ThemeContext alatt hívható');
  return value;
}

export function App() {
  // A useTheme itt, a fa tetején fut — enélkül az index.html inline szkriptje
  // beállítja ugyan az induló témát, de az automatikus (napszak szerinti)
  // váltás soha nem következne be.
  //
  // TODO(F1): a `coords` a helymeghatározásból, a `recordingActive` a tracking
  // store-ból jöjjön. Addig a fix idősávos automatika fut, napnyugta helyett.
  const theme = useTheme({ coords: null, recordingActive: false });

  return (
    <ThemeContext.Provider value={theme}>
      <BrowserRouter>
        <div className="app-shell">
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/terulet" element={<TerritoryScreen />} />
            <Route path="/rogzites" element={<TrackingScreen />} />
            <Route path="/kozosseg" element={<CommunityScreen />} />
            <Route path="/profil" element={<ProfileScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <Dock />
      </BrowserRouter>
    </ThemeContext.Provider>
  );
}
