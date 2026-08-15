import { NavLink, useNavigate } from 'react-router-dom';
import './Dock.css';

/**
 * Alsó dock — a navigáció gerince.
 * Középen a domináns indítógomb, ami a dock fölé lóg.
 *
 * docs/01-kepernyoterkep.md → Navigációs architektúra
 */
export function Dock() {
  const navigate = useNavigate();

  return (
    <nav className="dock" aria-label="Fő navigáció">
      <NavLink to="/" className="dock__item" aria-label="Kezdőlap">
        <HomeIcon />
      </NavLink>
      <NavLink to="/terulet" className="dock__item" aria-label="Terület">
        <HexIcon />
      </NavLink>

      <button
        className="dock__play"
        onClick={() => navigate('/rogzites')}
        aria-label="Aktivitás indítása"
      >
        <PlayIcon />
      </button>

      <NavLink to="/kozosseg" className="dock__item" aria-label="Közösség">
        <PeopleIcon />
      </NavLink>
      <NavLink to="/profil" className="dock__item" aria-label="Profil">
        <PersonIcon />
      </NavLink>
    </nav>
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
