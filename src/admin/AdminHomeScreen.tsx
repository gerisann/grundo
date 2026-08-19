import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type AdminStatus } from '@/lib/api';

/**
 * Admin áttekintő.
 *
 * Egyelőre a rendszer állapotát mutatja: a konfiguráció verzióját és a napi
 * forduló utolsó futását. A `docs/06` §1 szerinti teljes áttekintő (DAU/WAU/MAU,
 * regisztrációk, elfoglalt km²) a `metricsDaily` aggregátumra épül majd — az a
 * kollekció már be van jegyezve, de még nem íródik.
 */

export function AdminHomeScreen() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AdminStatus | null>(null);

  useEffect(() => {
    api.adminStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1>Áttekintő</h1>
          <p className="admin-muted">A rendszer állapota egy pillantásra.</p>
        </div>
      </header>

      <div className="admin-tiles">
        <button
          type="button"
          className="admin-tile"
          onClick={() => navigate('/admin/jatekszabalyok')}
        >
          <span className="admin-tile__value">
            {status ? (status.configVersion === 0 ? 'alapérték' : `v${status.configVersion}`) : '—'}
          </span>
          <span className="admin-tile__label">Játékkonfiguráció</span>
          <span className="admin-muted">
            {status ? `${status.tunableCount} hangolható érték` : ''}
          </span>
        </button>

        <button type="button" className="admin-tile" onClick={() => navigate('/admin/akciok')}>
          <span className="admin-tile__value">★</span>
          <span className="admin-tile__label">Akciók</span>
          <span className="admin-muted">Időszakos szorzók</span>
        </button>

        <div className="admin-tile admin-tile--static">
          <span className="admin-tile__value">
            {status?.lastRollover ? status.lastRollover.usersProcessed : '—'}
          </span>
          <span className="admin-tile__label">Utolsó napi forduló</span>
          <span className="admin-muted">
            {status?.lastRollover?.at
              ? `${new Date(status.lastRollover.at).toLocaleString('hu-HU')} · ${status.lastRollover.holdGpAwarded} GP`
              : 'Még nem futott'}
          </span>
          {status?.lastRollover && status.lastRollover.errors > 0 ? (
            <span className="admin-error">{status.lastRollover.errors} hibás felhasználó</span>
          ) : null}
        </div>
      </div>

      <section className="admin-card">
        <h2>Ami még nincs kész</h2>
        <p className="admin-muted">
          Használati statisztika (DAU/WAU/MAU), felhasználókezelés, moderáció és
          útvonal-jóváhagyás — ezek a következő menetekben jönnek. Az aktivitás-audit és a
          visszajátszó viszont már itt van a felső sávban.
        </p>
      </section>
    </div>
  );
}
