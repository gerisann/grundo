import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Dock } from './components/Dock';
import { HomeScreen } from './screens/HomeScreen';
import { TerritoryScreen } from './screens/TerritoryScreen';
import { TrackingScreen } from './screens/TrackingScreen';
import { CommunityScreen } from './screens/CommunityScreen';
import { ProfileScreen } from './screens/ProfileScreen';

export function App() {
  return (
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
  );
}
