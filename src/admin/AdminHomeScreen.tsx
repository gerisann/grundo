import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type AdminMetrics, type AdminStatus } from '@/lib/api';
import { formatArea, formatDistance } from '@/lib/format';
import { GAMEPLAY } from '@/config/gameplay';

/**
 * Admin áttekintő.
 *
 * A `docs/06` §1 szerinti napi-használati számok (DAU/WAU/MAU, regisztrációk,
 * aktivitások, elfoglalt terület, aktív streakek) a `metricsDaily`
 * aggregátumból jönnek — azt a napi forduló írja, naponta egyszer
 * (`server/src/jobs/metricsDaily.ts`). Amíg egyszer sem futott, a felület ezt
 * jelzi, nem nullát mutat: a kettő más állapotot jelent.
 */

export function AdminHomeScreen() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);

  useEffect(() => {
    api.adminStatus().then(setStatus).catch(() => setStatus(null));
    api.adminMetrics().then(setMetrics).catch(() => setMetrics(null));
  }, []);

  const latest = metrics?.latest ?? null;

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
        <h2>Napi használat</h2>
        {latest ? (
          <>
            <p className="admin-muted">{formatDay(latest.day)}, utoljára számolva</p>
            <div className="admin-tiles">
              <div className="admin-tile admin-tile--static">
                <span className="admin-tile__value">{latest.dau}</span>
                <span className="admin-tile__label">DAU</span>
                <span className="admin-muted">
                  WAU {latest.wau} · MAU {latest.mau}
                </span>
              </div>
              <div className="admin-tile admin-tile--static">
                <span className="admin-tile__value">{latest.signups}</span>
                <span className="admin-tile__label">Új regisztráció</span>
              </div>
              <div className="admin-tile admin-tile--static">
                <span className="admin-tile__value">{latest.activities}</span>
                <span className="admin-tile__label">Aktivitás</span>
                <span className="admin-muted">{formatDistance(latest.distanceKm * 1000)}</span>
              </div>
              <div className="admin-tile admin-tile--static">
                <span className="admin-tile__value">
                  {formatArea(latest.claimedCellsNet * GAMEPLAY.CELL_AREA_M2)}
                </span>
                <span className="admin-tile__label">Elfoglalt terület</span>
              </div>
              <div className="admin-tile admin-tile--static">
                <span className="admin-tile__value">{latest.activeStreaks}</span>
                <span className="admin-tile__label">Aktív sorozat</span>
              </div>
            </div>
          </>
        ) : (
          <p className="admin-muted">
            Még nem futott a napi aggregátum — az első `Europe/Budapest` szerinti éjfél utáni
            napi forduló írja meg.
          </p>
        )}
      </section>

      <section className="admin-card">
        <h2>Ami még nincs kész</h2>
        <p className="admin-muted">
          Felhasználókezelés, moderáció és útvonal-jóváhagyás — ezek a következő menetekben
          jönnek. Pro-konverzió, konnektor-hibaarány és hibás job-futások a napi áttekintőben
          egyelőre nincsenek, mert nincs mögöttük adatforrás. Az aktivitás-audit és a
          visszajátszó viszont már itt van a felső sávban.
        </p>
      </section>
    </div>
  );
}

/** A napszámból olvasható dátum — a napszám UTC `Date.UTC(y,m,d)`-ből jön, tehát UTC-ben formázva helyes. */
function formatDay(day: number): string {
  return new Date(day * 86_400_000).toLocaleDateString('hu-HU', { timeZone: 'UTC' });
}
