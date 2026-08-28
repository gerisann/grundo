import { useLayoutEffect, useRef } from 'react';
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
  const activeRef = useRef<HTMLAnchorElement>(null);
  const drag = useRef({ active: false, moved: false, pointerId: -1, x: 0, left: 0 });
  const suppressClick = useRef(false);

  /**
   * AZ AKTÍV FÜL KÖZÉPRE — a széleken ütközve.
   *
   * ⚠️ MIÉRT KELL EGYÁLTALÁN? Mert minden fül külön képernyő, tehát fülváltáskor
   * ez a sáv ÚJRA FELÉPÜL, és a vízszintes görgetése nullázódik. A felhasználó
   * ezt úgy látta, hogy „visszaugrik az elejére az egész": rákattintott a
   * Riválisokra, mire a sáv a Profilhoz csúszott vissza, és a most kiválasztott
   * fül ki is eshetett a képből.
   *
   * A KÖZÉPRE IGAZÍTÁS LEVÁGVA a lényeg. A cél a fül közepe, de a görgetést a
   * sáv határaira szorítjuk, ezért:
   *   - az első két fülnél a cél negatív → nullára vágva, tehát bal szélen
   *     maradnak, ahogy eddig;
   *   - középen (Küldetések, Riválisok) valóban középre kerül;
   *   - a végénél a cél nagyobb a maximumnál → oda vágva, tehát a Badgek
   *     a jobb szélen marad látható.
   * Visszafelé ugyanez, tükrözve. Pontosan ez a kért viselkedés, és nem kell
   * hozzá fülönkénti szabály — a levágás magától adja.
   *
   * `useLayoutEffect`, nem `useEffect`: a kirajzolás ELŐTT fut, így a sáv
   * sosem villan fel a nulla pozícióban, mielőtt a helyére ugrana.
   */
  useLayoutEffect(() => {
    const nav = navRef.current;
    const item = activeRef.current;
    if (!nav || !item) return;

    /*
      A pozíciót befoglaló téglalapokból számoljuk, nem `offsetLeft`-ből: az
      utóbbi a legközelebbi POZICIONÁLT ősre vonatkozik, ami itt nem
      feltétlenül maga a sáv — elmozdulna a számítás, ha a szülő elrendezése
      valaha változna.
    */
    const itemCentre =
      item.getBoundingClientRect().left -
      nav.getBoundingClientRect().left +
      nav.scrollLeft +
      item.offsetWidth / 2;

    const target = itemCentre - nav.clientWidth / 2;
    const furthest = nav.scrollWidth - nav.clientWidth;
    nav.scrollLeft = Math.max(0, Math.min(target, furthest));
  }, [active]);

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
          ref={active === tab.id ? activeRef : undefined}
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
