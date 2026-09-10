import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import {
  api,
  type AdminMetrics,
  type AdminUsageOverview,
  type AdminPushTest,
  type AdminStatus,
  type BandaRolloverResult,
} from '@/lib/api';
import { formatArea, formatDistance } from '@/lib/format';
import { buildInfo } from '@/lib/buildInfo';
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
  const [usage, setUsage] = useState<AdminUsageOverview | null>(null);
  const [pushTest, setPushTest] = useState<AdminPushTest | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [bandaRollover, setBandaRollover] = useState<BandaRolloverResult | null>(null);
  const [bandaRolloverBusy, setBandaRolloverBusy] = useState(false);
  const [bandaRolloverError, setBandaRolloverError] = useState<string | null>(null);

  useEffect(() => {
    api.adminStatus().then(setStatus).catch(() => setStatus(null));
    api.adminMetrics().then(setMetrics).catch(() => setMetrics(null));
    const refreshUsage = () => api.adminUsage().then(setUsage).catch(() => undefined);
    void refreshUsage();
    const timer = window.setInterval(refreshUsage, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const latest = metrics?.latest ?? null;

  async function runPushTest() {
    setPushBusy(true);
    setPushError(null);
    setPushTest(null);
    try {
      setPushTest(await api.adminTestPush());
    } catch (error) {
      setPushError(error instanceof Error ? error.message : 'A teszt-értesítés küldése nem sikerült.');
    } finally {
      setPushBusy(false);
    }
  }

  async function runBandaRollover() {
    setBandaRolloverBusy(true);
    setBandaRolloverError(null);
    setBandaRollover(null);
    try {
      setBandaRollover(await api.adminRunBandaRollover());
    } catch (error) {
      setBandaRolloverError(
        error instanceof Error ? error.message : 'A banda-összesítés futtatása nem sikerült.',
      );
    } finally {
      setBandaRolloverBusy(false);
    }
  }

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

        <button
          type="button"
          className="admin-tile"
          onClick={() => navigate('/admin/verziotortenet')}
        >
          <span className="admin-tile__value">v{buildInfo.version}</span>
          <span className="admin-tile__label">Verziótörténet</span>
          <span className="admin-muted">Changelog</span>
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

      <section className="admin-card admin-usage">
        <div className="admin-usage__heading">
          <div>
            <h2>Apphasználat</h2>
            <p className="admin-muted">Ténylegesen előtérben töltött idő, Europe/Budapest szerint.</p>
          </div>
          {usage ? <span className="admin-muted">Frissítve: {new Date(usage.generatedAt).toLocaleTimeString('hu-HU')}</span> : null}
        </div>
        {usage ? (
          <>
            <div className="admin-tiles admin-usage__periods">
              <UsageTile label="Ma" value={usage.periods.day} />
              <UsageTile label="Elmúlt 7 nap" value={usage.periods.week} />
              <UsageTile label="Elmúlt 30 nap" value={usage.periods.month} />
              <UsageTile label="Mindenkor" value={usage.periods.all} />
            </div>

            <h3>Elmúlt 30 nap</h3>
            <UsageBars
              points={usage.daily.map((point) => ({
                key: String(point.day),
                label: shortDay(point.day),
                value: point.durationMs,
                title: `${formatDay(point.day)}: ${formatUsage(point.durationMs)}, ${point.activeUsers} fő`,
              }))}
            />

            <h3>Mai használat óránként</h3>
            <UsageBars
              points={usage.todayHours.map((point) => ({
                key: String(point.hour),
                label: point.hour % 3 === 0 ? `${point.hour}` : '',
                value: point.durationMs,
                title: `${String(point.hour).padStart(2, '0')}:00–${String(point.hour + 1).padStart(2, '0')}:00: ${formatUsage(point.durationMs)}, ${point.activeUsers} fő`,
              }))}
            />

            <div className="admin-table-wrap">
              <table className="admin-usage-table">
                <thead><tr><th>Felhasználó</th><th>Mai használat</th><th>Óránként</th></tr></thead>
                <tbody>
                  {usage.todayUsers.map((entry) => (
                    <tr key={entry.uid}>
                      <td><strong>{entry.name}</strong><small>{entry.uid}</small></td>
                      <td>{formatUsage(entry.durationMs)}<small>{usageWindow(entry.hours)}</small></td>
                      <td><UserHourStrip hours={entry.hours} /></td>
                    </tr>
                  ))}
                  {usage.todayUsers.length === 0 ? (
                    <tr><td colSpan={3} className="admin-muted">Ma még nincs mért használat.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="admin-muted">A használati statisztika még nem érhető el.</p>
        )}
      </section>

      <section className="admin-card">
        <h2>Push-diagnosztika</h2>
        <p className="admin-muted">
          Teszt-értesítés a SAJÁT eszközeidre. A push csendben tud elhasalni: a felhasználó
          sikeres bekapcsolást lát, a hiba pedig a szerver naplójában marad. Itt eszközönként
          látszik a nyers FCM hibakód.
        </p>
        <div className="admin-push-actions">
          <Button variant="secondary" onClick={() => void runPushTest()} disabled={pushBusy}>
            {pushBusy ? 'Küldés…' : 'Teszt-értesítés küldése'}
          </Button>
        </div>
        {pushError ? <p className="admin-push-error">{pushError}</p> : null}
        {pushTest && pushTest.attempts.length === 0 ? (
          <p className="admin-muted">
            Ehhez a fiókhoz nincs regisztrált eszköz. Kapcsold be az értesítéseket a
            Beállítások → Értesítések alatt.
          </p>
        ) : null}
        {pushTest && pushTest.attempts.length > 0 ? (
          <ul className="admin-push-list">
            {pushTest.attempts.map((attempt) => (
              <li
                key={attempt.token}
                className={attempt.ok ? 'admin-push--ok' : 'admin-push--bad'}
              >
                <div className="admin-push-head">
                  <strong>{attempt.platform}</strong>
                  <code>{attempt.token}</code>
                </div>
                <span>
                  {attempt.ok
                    ? 'Az FCM átvette kézbesítésre.'
                    : `${attempt.code}${attempt.message ? ` — ${attempt.message}` : ''}`}
                </span>
                {!attempt.ok && pushHint(attempt.code) ? (
                  <small className="admin-muted">{pushHint(attempt.code)}</small>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="admin-card">
        <h2>Banda-összesítés</h2>
        <p className="admin-muted">
          A `bandas/{'{id}'}.totals` mezőt egyelőre nem tölti automatikusan
          semmi — a Cloud Scheduler bejegyzése még hiányzik (lásd
          `docs/06-architektura-es-admin.md` → `jobs` → `banda-rollover`).
          Amíg ez nincs bekötve, itt indítható kézzel.
        </p>
        <div className="admin-push-actions">
          <Button variant="secondary" onClick={() => void runBandaRollover()} disabled={bandaRolloverBusy}>
            {bandaRolloverBusy ? 'Fut…' : 'Banda-összesítés futtatása'}
          </Button>
        </div>
        {bandaRolloverError ? <p className="admin-push-error">{bandaRolloverError}</p> : null}
        {bandaRollover ? (
          <p className="admin-muted">
            {bandaRollover.bandasProcessed} banda feldolgozva, {bandaRollover.errors} hiba,{' '}
            {bandaRollover.durationMs} ms alatt.
          </p>
        ) : null}
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

/**
 * A leggyakoribb FCM hibakódokhoz a TEENDŐ, nem csak a kód.
 *
 * A `third-party-auth-error` mérve is előfordult: 2026-08-25-én emiatt nem
 * érkezett meg egyetlen iOS push sem, miközben a token érvényes volt és a
 * webes push működött. Kódból nem javítható — a Firebase-projekt APNs-kulcsát
 * kell rendbe tenni.
 */
function pushHint(code: string | null): string | null {
  if (!code) return null;
  if (code.includes('third-party-auth-error')) {
    return 'Az APNs hitelesítés utasította el. Firebase Console → Project settings → '
      + 'Cloud Messaging → Apple app configuration: töltsd fel újra az APNs Auth Key-t (.p8), '
      + 'egyező Key ID és Team ID mellett. A token és a kód rendben van.';
  }
  if (code.includes('registration-token-not-registered')) {
    return 'Az eszköz leiratkozott vagy törölték az appot — a token most már törlődött is.';
  }
  if (code.includes('mismatched-credential')) {
    return 'A token másik Firebase-projekthez tartozik, mint amelyikből küldünk.';
  }
  return null;
}

/** A napszámból olvasható dátum — a napszám UTC `Date.UTC(y,m,d)`-ből jön, tehát UTC-ben formázva helyes. */
function formatDay(day: number): string {
  return new Date(day * 86_400_000).toLocaleDateString('hu-HU', { timeZone: 'UTC' });
}

function shortDay(day: number): string {
  return new Date(day * 86_400_000).toLocaleDateString('hu-HU', {
    month: 'numeric', day: 'numeric', timeZone: 'UTC',
  });
}

function formatUsage(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  if (minutes < 60) return `${minutes} perc`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ó ${rest} p` : `${hours} ó`;
}

function UsageTile({ label, value }: {
  label: string;
  value: { durationMs: number; activeUsers: number };
}) {
  return (
    <div className="admin-tile admin-tile--static">
      <span className="admin-tile__value">{formatUsage(value.durationMs)}</span>
      <span className="admin-tile__label">{label}</span>
      <span className="admin-muted">{value.activeUsers} aktív felhasználó</span>
    </div>
  );
}

function UsageBars({ points }: {
  points: Array<{ key: string; label: string; value: number; title: string }>;
}) {
  const max = Math.max(1, ...points.map((point) => point.value));
  return (
    <div className="admin-usage-chart">
      {points.map((point) => (
        <div className="admin-usage-chart__column" key={point.key} title={point.title}>
          <div className="admin-usage-chart__track">
            <span style={{ height: `${Math.max(point.value > 0 ? 3 : 0, point.value / max * 100)}%` }} />
          </div>
          <small>{point.label}</small>
        </div>
      ))}
    </div>
  );
}

function UserHourStrip({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  return (
    <div className="admin-hour-strip" aria-label="Mai óránkénti használat">
      {hours.map((value, hour) => (
        <span
          key={hour}
          title={`${hour}:00 — ${formatUsage(value)}`}
          style={{ opacity: value === 0 ? 0.08 : Math.max(0.25, value / max) }}
        />
      ))}
    </div>
  );
}

function usageWindow(hours: number[]): string {
  const active = hours.map((value, hour) => value > 0 ? hour : -1).filter((hour) => hour >= 0);
  if (active.length === 0) return '—';
  return `${String(active[0]).padStart(2, '0')}:00–${String(active.at(-1)! + 1).padStart(2, '0')}:00`;
}
