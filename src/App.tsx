import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './hooks/ThemeProvider';
import { Dock } from './components/Dock';
import { HomeScreen } from './screens/HomeScreen';
import { TerritoryScreen } from './screens/TerritoryScreen';
import { TrackingScreen } from './screens/TrackingScreen';
import { CommunityScreen } from './screens/CommunityScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { AppearanceScreen } from './screens/settings/AppearanceScreen';
import { ReplayScreen } from './screens/dev/ReplayScreen';

export function App() {
  // TODO(F1): a `coords` a helymeghatározásból, a `recordingActive` a tracking
  // store-ból jöjjön. Addig a fix idősávos automatika fut, napnyugta helyett.
  return (
    <ThemeProvider coords={null} recordingActive={false}>
      <BrowserRouter>
        <div className="app-shell">
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/terulet" element={<TerritoryScreen />} />
            <Route path="/rogzites" element={<TrackingScreen />} />
            <Route path="/kozosseg" element={<CommunityScreen />} />
            <Route path="/profil" element={<ProfileScreen />} />
            <Route path="/beallitasok" element={<SettingsScreen />} />
            <Route path="/beallitasok/megjelenes" element={<AppearanceScreen />} />
            <Route path="/dev/replay" element={<ReplayScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <Dock />
      </BrowserRouter>
    </ThemeProvider>
  );
}
