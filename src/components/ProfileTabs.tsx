import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './profileTabs.css';

type ProfileTab = 'profile' | 'missions' | 'rivals' | 'stats' | 'clans' | 'badges';

const TABS: { id: ProfileTab; label: string; to: string }[] = [
  { id: 'profile', label: 'Profil', to: '/profil' },
  { id: 'stats', label: 'Statisztika', to: '/profil/statisztikak' },
  { id: 'missions', label: 'Küldetések', to: '/kuldetesek' },
  { id: 'rivals', label: 'Riválisok', to: '/profil/rivalisok' },
  { id: 'clans', label: 'Klánok', to: '/profil/klanok' },
  { id: 'badges', label: 'Badges', to: '/profil/badges' },
];

export function ProfileTabs({ active }: { active: ProfileTab }) {
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement>(null);
  const drag = useRef({ active: false, moved: false, x: 0, left: 0 });
  return (
    <nav
      ref={navRef}
      className="profile-tabs"
      aria-label="Profil fülek"
      onPointerDown={(event) => {
        const nav = navRef.current;
        if (!nav) return;
        drag.current = { active: true, moved: false, x: event.clientX, left: nav.scrollLeft };
        nav.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const nav = navRef.current;
        if (!nav || !drag.current.active) return;
        const delta = event.clientX - drag.current.x;
        if (Math.abs(delta) > 4) drag.current.moved = true;
        nav.scrollLeft = drag.current.left - delta;
      }}
      onPointerUp={(event) => {
        drag.current.active = false;
        navRef.current?.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current.active = false; }}
    >
      {TABS.map((tab) => (
        <button
          type="button"
          key={tab.id}
          className={active === tab.id ? 'profile-tabs__item profile-tabs__item--active' : 'profile-tabs__item'}
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={(event) => {
            if (drag.current.moved) {
              event.preventDefault();
              drag.current.moved = false;
              return;
            }
            navigate(tab.to);
          }}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
