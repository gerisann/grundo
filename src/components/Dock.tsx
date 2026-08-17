import { useLocation, useNavigate, NavLink } from 'react-router-dom';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import './Dock.css';

/**
 * Alsó dock — a navigáció gerince ÉS a rögzítés vezérlője.
 *
 * A középső gomb nem csak egy menüpont: ez a képernyő domináns akciója, és
 * a rögzítés állapotától függően mást csinál.
 *
 *   nincs rögzítés   → Play. Máshonnan a rögzítés képernyőre visz, ott indít.
 *   rögzítés fut     → Pause, és két gomb nyúlik ki belőle: Kör és Befejezés.
 *   szüneteltetve    → Play (folytatás), ugyanazzal a két gombbal.
 *   befejezve        → „Új rögzítés" felirat, kiszélesített gombban.
 *
 * A kinyúló gombok miatt a menüpontok a szélek felé csúsznak — erről a
 * `dock--wide` osztály gondoskodik.
 *
 * docs/01-kepernyoterkep.md → Navigációs architektúra
 */
export function Dock() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, begin, pause, resume, markLap, finish, discard } = useRecorderContext();

  const onTrackingScreen = location.pathname === '/rogzites';
  const running = state.status === 'recording';
  const paused = state.status === 'paused';
  const done = state.status === 'finished';
  const active = running || paused;

  /**
   * Mi történjen a középső gombra?
   *
   * Ha nem a rögzítés képernyőn állunk, előbb oda visszük a felhasználót —
   * indítani vakon, a mérés visszajelzése nélkül félrevezető lenne.
   */
  function primaryAction() {
    if (running) return pause();
    if (paused) return resume();
    if (done) return void discard();
    if (!onTrackingScreen) return navigate('/rogzites');
    // A választott mozgásforma a rögzítőben él — lásd `pendingType`.
    return void begin();
  }

  /**
   * A „Új rögzítés" felirat CSAK a rögzítés képernyőn jelenik meg.
   *
   * A lezárt rögzítés állapota az egész alkalmazásban él, ezért a felirat
   * korábban a kezdőlapon is ott volt — ahol viszont értelmetlen: onnan nem
   * új rögzítést indítani akar a felhasználó, hanem odajutni. Máshol tehát
   * marad a Play ikon, ami a rögzítés képernyőre visz.
   */
  const showFinishedLabel = done && onTrackingScreen;

  const primaryLabel = running
    ? 'Szünet'
    : paused
      ? 'Folytatás'
      : showFinishedLabel
        ? 'Új rögzítés'
        : 'Aktivitás indítása';

  const controls = (
    <div className="dock__center">
      {active ? (
        <button className="dock__side dock__side--left" onClick={markLap}>
          Új kör
        </button>
      ) : null}

      <button
        className={`dock__play${showFinishedLabel ? ' dock__play--wide' : ''}${
          state.status === 'idle' ? ' dock__play--idle' : ''
        }${active ? ' dock__play--large' : ''}`}
        onClick={primaryAction}
        aria-label={primaryLabel}
      >
        {showFinishedLabel ? (
          <span className="dock__play-text">Új rögzítés</span>
        ) : running ? (
          <PauseIcon />
        ) : (
          <PlayIcon />
        )}
      </button>

      {active ? (
        <button className="dock__side dock__side--right" onClick={() => void finish()}>
          Befejezés
        </button>
      ) : null}
    </div>
  );

  /**
   * Rögzítés közben CSAK a három vezérlő látszik.
   *
   * A menüpontok ilyenkor nemcsak fölöslegesek, hanem zavaróak is: a
   * felhasználó futás közben, egy pillantásra nyúl a képernyőhöz, és a
   * legrosszabb, ami történhet, hogy a Befejezés helyett a Profilt találja el.
   */
  if (active) {
    return (
      <nav className="dock dock--controls" aria-label="Rögzítés vezérlése">
        {controls}
      </nav>
    );
  }

  return (
    <nav className="dock" aria-label="Fő navigáció és rögzítés">
      <NavLink to="/" className="dock__item" aria-label="Kezdőlap">
        <HomeIcon />
      </NavLink>
      <NavLink to="/grund" className="dock__item" aria-label="Grund">
        <HexIcon />
      </NavLink>
      {controls}
      <NavLink to="/kozosseg" className="dock__item" aria-label="Közösség">
        <PeopleIcon />
      </NavLink>
      <NavLink to="/profil" className="dock__item" aria-label="Profil">
        <PersonIcon />
      </NavLink>
    </nav>
  );
}

function PauseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="6.5" y="5" width="4" height="14" rx="1.4" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.4" />
    </svg>
  );
}

/* Az ikonok inline SVG-k, hogy ne kelljen ikonkészletet behúzni a belépő
   csomagba. Ha később ikonkönyvtár kell, ezek cserélhetők. */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" {...stroke}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h14V9.5" />
  </svg>
);

const HexIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" {...stroke}>
    <path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" />
  </svg>
);

const PeopleIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" {...stroke}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6" />
    <path d="M16.5 5.4a3.2 3.2 0 0 1 0 6.1M17.5 14.8c2.3.5 3.9 2.4 3.9 5.2" />
  </svg>
);

const PersonIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" {...stroke}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
  </svg>
);

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);
