import { useLayoutEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import './tabStrip.css';

export interface ScrollableTabItem<T extends string> {
  id: T;
  label: string;
  to: string;
}

/**
 * Vízszintesen görgethető, útvonalanként külön képernyőre mutató fülsor.
 *
 * A Profil fülsorból kiemelve (GRUNDO #28), hogy a Közösség fülsor ne
 * másolja le a teljes drag-scroll és középre-igazítás logikát — lásd az
 * AZ AKTÍV FÜL KÖZÉPRE megjegyzést lentebb, ami mindkét helyen ugyanaz az ok.
 */
export function ScrollableTabs<T extends string>({
  tabs,
  active,
  ariaLabel,
}: {
  tabs: readonly ScrollableTabItem<T>[];
  active: T;
  ariaLabel: string;
}) {
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
   *   - középen valóban középre kerül;
   *   - a végénél a cél nagyobb a maximumnál → oda vágva, tehát az utolsó fül
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
      className="tab-strip"
      aria-label={ariaLabel}
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
      {tabs.map((tab) => (
        <NavLink
          key={tab.id}
          to={tab.to}
          ref={active === tab.id ? activeRef : undefined}
          draggable={false}
          className={active === tab.id ? 'tab-strip__item tab-strip__item--active' : 'tab-strip__item'}
          aria-current={active === tab.id ? 'page' : undefined}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
