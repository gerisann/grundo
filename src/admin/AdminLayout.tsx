import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ApiError, api, type AdminStatus } from '@/lib/api';
import { Button } from '@/components/ui';
import './admin.css';

/**
 * Az admin terület kerete.
 *
 * ⚠️ MAPPAFEGYELEM (docs/06 → Admin felület). Az `src/admin/` alatti kód
 * importálhat a közös `src/lib/`-ből, `src/game/`-ből és `src/components/`-ből,
 * de a játékos-képernyőkből SOHA — és a játékos-képernyők innen SOHA. Ez teszi
 * a későbbi külön alkalmazásra bontást költöztetéssé átírás helyett. Ha ez a
 * szabály elcsúszik, a döntés visszafordíthatatlanná válik.
 *
 * A teljes terület lustán töltődik (lásd `App.tsx`), tehát a játékos böngészője
 * egyetlen bájtot sem tölt le belőle.
 */

const NAV = [
  { to: '/admin', end: true, label: 'Áttekintő', icon: '◆' },
  { to: '/admin/jatekszabalyok', label: 'Játékszabályok', icon: '⚖' },
  { to: '/admin/akciok', label: 'Akciók', icon: '★' },
  { to: '/admin/aktivitasok', label: 'Aktivitások', icon: '⌖' },
  { to: '/admin/visszajatszas', label: 'Visszajátszás', icon: '▶' },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .adminStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        /**
         * A 403 nem hiba, hanem válasz: ez a felhasználó nem admin.
         *
         * Ezért kap külön képernyőt — a „valami elromlott" üzenet itt
         * félrevezetne, és az újrapróbálás sem segítene rajta.
         */
        if (cause instanceof ApiError && cause.status === 403) setDenied(true);
        else setError(cause instanceof Error ? cause.message : 'Ismeretlen hiba.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (denied) {
    return (
      <main className="admin-gate">
        <span className="admin-gate__icon" aria-hidden="true">
          ⛔
        </span>
        <h1>Ehhez nincs jogosultságod</h1>
        <p>
          Az admin felület `owner`, `admin`, `moderator`, `support` vagy `readonly`
          szerepkört igényel. A szerepkört a szerveren lehet kiosztani.
        </p>
        <Button onClick={() => navigate('/')}>Vissza a GRUNDO-ba</Button>
      </main>
    );
  }

  if (error) {
    return (
      <main className="admin-gate">
        <span className="admin-gate__icon" aria-hidden="true">
          ⚠️
        </span>
        <h1>Nem sikerült betölteni az admin felületet</h1>
        <p>{error}</p>
        <Button onClick={() => window.location.reload()}>Újrapróbálom</Button>
      </main>
    );
  }

  return (
    <div className="admin">
      <header className="admin__bar">
        <button type="button" className="admin__home" onClick={() => navigate('/')}>
          ← GRUNDO
        </button>
        <span className="admin__title">Admin</span>
        {status ? (
          <span className="admin__role" title={status.canWrite ? 'Írási jog' : 'Csak olvasás'}>
            {status.role}
            {status.canWrite ? '' : ' · csak olvasás'}
          </span>
        ) : null}
      </header>

      <nav className="admin__nav" aria-label="Admin szakaszok">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `admin__tab${isActive ? ' admin__tab--on' : ''}`}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="admin__body">
        <Outlet />
      </main>
    </div>
  );
}
