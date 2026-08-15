import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './hooks/ThemeProvider';
import { AuthProvider, useAuth } from './hooks/AuthProvider';
import { ProfileProvider, useProfile } from './hooks/ProfileProvider';
import { Dock } from './components/Dock';
import { HomeScreen } from './screens/HomeScreen';
import { TerritoryScreen } from './screens/TerritoryScreen';
import { TrackingScreen } from './screens/TrackingScreen';
import { CommunityScreen } from './screens/CommunityScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { AppearanceScreen } from './screens/settings/AppearanceScreen';
import { ReplayScreen } from './screens/dev/ReplayScreen';
import { WelcomeScreen } from './screens/auth/WelcomeScreen';
import { LoginScreen } from './screens/auth/LoginScreen';
import { RegisterScreen } from './screens/auth/RegisterScreen';
import { ForgotPasswordScreen } from './screens/auth/ForgotPasswordScreen';
import { CompleteProfileScreen } from './screens/auth/CompleteProfileScreen';

export function App() {
  return (
    <AuthProvider>
      {/* TODO(F1): a `coords` a helymeghatározásból, a `recordingActive` a
          tracking store-ból jöjjön. Addig a fix idősávos automatika fut. */}
      <ProfileProvider>
        <ThemeProvider coords={null} recordingActive={false}>
          <BrowserRouter>
            <Router />
          </BrowserRouter>
        </ThemeProvider>
      </ProfileProvider>
    </AuthProvider>
  );
}

function Router() {
  const { status } = useAuth();
  const { status: profileStatus } = useProfile();

  if (status === 'loading') return <Splash />;

  /**
   * Helyi fejlesztésben, Firebase-konfiguráció nélkül átengedjük a
   * felhasználót az appba, hogy a felületek fejleszthetők legyenek.
   * Élesben a hiányzó konfiguráció a bejelentkezésen áll meg.
   */
  const devBypass = import.meta.env.DEV && status === 'unconfigured';
  const signedIn = status === 'signed-in' || devBypass;

  const authRoutes = (
    <>
      <Route path="/udvozles" element={<WelcomeScreen />} />
      <Route path="/belepes" element={<LoginScreen />} />
      <Route path="/regisztracio" element={<RegisterScreen />} />
      <Route path="/elfelejtett-jelszo" element={<ForgotPasswordScreen />} />
    </>
  );

  if (!signedIn) {
    return (
      <Routes>
        {authRoutes}
        <Route path="*" element={<Navigate to="/udvozles" replace />} />
      </Routes>
    );
  }

  // Van Firebase-fiók, de nincs GRUNDO-profil → előbb felhasználónév kell.
  // A `unavailable` (nincs backend) NEM állítja meg az appot.
  if (profileStatus === 'missing') return <CompleteProfileScreen />;
  if (profileStatus === 'loading') return <Splash />;

  return (
    <>
      <div className="app-shell">
        <Routes>
          {/* Fejlesztői átengedés esetén a belépési képernyők is elérhetők
              maradnak, különben nem lehetne rajtuk dolgozni. */}
          {devBypass ? authRoutes : null}
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
    </>
  );
}

function Splash() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg-primary)',
      }}
    >
      <span
        style={{ fontSize: 40, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.02em' }}
      >
        GRUNDO
      </span>
    </main>
  );
}
