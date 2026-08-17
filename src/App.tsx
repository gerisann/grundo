import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './hooks/ThemeProvider';
import { AuthProvider, useAuth } from './hooks/AuthProvider';
import { ProfileProvider, useProfile } from './hooks/ProfileProvider';
import { RecorderProvider } from './hooks/RecorderProvider';
import { Dock } from './components/Dock';
import { Button } from './components/ui';
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
          {/**
            * A React Router v7-ben két viselkedés megváltozik, és a v6
            * figyelmeztet, amíg nem nyilatkozunk róluk. Most kapcsoljuk be
            * mindkettőt: így a mai kód már a v7 szerint működik, a későbbi
            * frissítés nem hoz meglepetést, és a konzol is tiszta marad.
            *
            *  v7_startTransition   — az útvonalváltás állapotfrissítései
            *                         React.startTransition-be kerülnek
            *  v7_relativeSplatPath — a relatív útvonalak feloldása a
            *                         csillagos (*) útvonalakon belül változik
            */}
          <BrowserRouter
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <RecorderProvider>
              <Router />
            </RecorderProvider>
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
  /**
   * A profil betöltésének hibája NEM engedhető át némán.
   *
   * Korábban itt nem volt ág, így a hiba egyszerűen a Home-ra vitt: a
   * felhasználó profil nélkül, de látszólag rendben belépett, és semmi nem
   * jelezte, hogy baj van. Egy elrontott szerveroldali útvonal-bekötés így
   * napokig észrevétlen maradhat. Inkább álljunk meg és mondjuk meg, mi a baj.
   */
  if (profileStatus === 'error') return <ProfileError />;

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
      {/* A dokk MINDIG látszik: a rögzítés vezérlői benne vannak, és a
          rögzítő az alkalmazás szintjén él, tehát a képernyőváltás nem
          állítja le a mérést. */}
      <Dock />
    </>
  );
}

function ProfileError() {
  const { error, reload } = useProfile();
  const { signOut } = useAuth();

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: 'var(--bg-primary)',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center', display: 'grid', gap: 16 }}>
        <span style={{ fontSize: 40 }} aria-hidden="true">
          ⚠️
        </span>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
          Nem sikerült betölteni a profilodat
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          {error || 'Ismeretlen hiba történt.'}
        </p>
        <Button block onClick={() => void reload()}>
          Újrapróbálom
        </Button>
        <Button variant="ghost" block onClick={() => void signOut()}>
          Kijelentkezés
        </Button>
      </div>
    </main>
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
