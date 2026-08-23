import { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import './profileTabs.css';

export type ProfileTab = 'profile' | 'missions' | 'rivals' | 'stats' | 'clans' | 'badges';

const TABS: { id: ProfileTab; label: string; to: string }[] = [
  { id: 'profile', label: 'Profil', to: '/profil' },
  { id: 'stats', label: 'Statisztika', to: '/profil/statisztikak' },
  { id: 'missions', label: 'Küldetések', to: '/kuldetesek' },
  { id: 'rivals', label: 'Riválisok', to: '/profil/rivalisok' },
  { id: 'clans', label: 'Klánok', to: '/profil/klanok' },
  { id: 'badges', label: 'Badgek', to: '/profil/badgek' },
];

export function ProfileTabs({ active }: { active: ProfileTab }) {
  const navRef = useRef<HTMLElement>(null);
  const drag = useRef({ active: false, moved: false, pointerId: -1, x: 0, left: 0 });
  const suppressClick = useRef(false);
  return (
    <nav
      ref={navRef}
      className="profile-tabs"
      aria-label="Profil fülek"
      onPointerDown={(event) => {
        const nav = navRef.current;
        if (!nav || event.pointerType !== 'mouse' || event.button !== 0) return;
        drag.current = {
          active: true,
          moved: false,
          pointerId: event.pointerId,
          x: event.clientX,
          left: nav.scrollLeft,
        };
      }}
      onPointerMove={(event) => {
        const nav = navRef.current;
        if (!nav || !drag.current.active) return;
        const delta = event.clientX - drag.current.x;
        if (!drag.current.moved && Math.abs(delta) > 6) {
          drag.current.moved = true;
          suppressClick.current = true;
          nav.setPointerCapture(event.pointerId);
        }
        if (!drag.current.moved) return;
        event.preventDefault();
        nav.scrollLeft = drag.current.left - delta;
      }}
      onPointerUp={(event) => {
        const nav = navRef.current;
        if (nav?.hasPointerCapture(event.pointerId)) nav.releasePointerCapture(event.pointerId);
        drag.current.active = false;
        if (drag.current.moved) requestAnimationFrame(() => { suppressClick.current = false; });
      }}
      onPointerCancel={() => {
        drag.current.active = false;
        suppressClick.current = false;
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.id}
          to={tab.to}
          draggable={false}
          className={active === tab.id ? 'profile-tabs__item profile-tabs__item--active' : 'profile-tabs__item'}
          aria-current={active === tab.id ? 'page' : undefined}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
