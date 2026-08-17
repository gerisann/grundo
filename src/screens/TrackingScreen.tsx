import { useEffect, useMemo, useState } from 'react';
import { Button, SegmentedControl } from '@/components/ui';
import { HexMap } from '@/components/HexMap';
import { useRecorder } from '@/hooks/useRecorder';
import { cellsToM2, traceToCellPath } from '@/game/cells';
import { movingMs, paceSecPerKm } from '@/tracking/recorder';
import { formatArea, formatDistance, formatDuration, formatPace } from '@/lib/format';
import type { ActivityType } from '@/types';
import './tracking.css';

/**
 * Rögzítés.
 *
 * Állapotok: indítás előtt · aktív · szüneteltetve · összegzés.
 *
 * A KORLÁT, amit nem hallgatunk el: böngészőben a rögzítés csak addig megy,
 * amíg az oldal látható. Ha a felhasználó lezárja a telefont vagy másik appra
 * vált, a mérés megszakad — sem az iOS, sem az Android nem ad webes API-t
 * háttér-helymeghatározásra. Ezt a felület KIÍRJA, mert a csendben elvesző
 * futás sokkal rosszabb, mint az őszinte figyelmeztetés.
 */
export function TrackingScreen() {
  const recorder = useRecorder();
  const { state } = recorder;
  const [type, setType] = useState<ActivityType>('run');

  // Az eltelt idő magától nem változik — az állapot csak mintaérkezéskor
  // frissül, márpedig állva percekig nem jön minta. Saját ütem kell hozzá.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.status !== 'recording') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.status]);

  /**
   * A cellák újraszámolása a nyomvonal hosszával arányos munka, ezért NEM
   * futtatjuk minden mintánál: ötösével frissítünk. Egy órás futás végén a
   * különbség másodpercenkénti néhány ezredmásodperc és egy akadozó felület
   * között van. A pontosságon nem ront: a lemaradó néhány cella a következő
   * frissítéskor megjelenik.
   */
  const cellBucket = Math.floor(state.points.length / 5);
  const cells = useMemo(
    () => (state.points.length >= 2 ? traceToCellPath(state.points).path : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cellBucket, state.status],
  );

  const running = state.status === 'recording';
  const paused = state.status === 'paused';
  const done = state.status === 'finished';
  const idle = state.status === 'idle';

  const pace = paceSecPerKm(state, now);
  const elapsed = Math.floor(movingMs(state, now) / 1000);

  return (
    <div className="track">
      <header className="screen-header">
        <h1 className="screen-header__title">Rögzítés</h1>
      </header>

      <div className="track__body">
        {recorder.resumable !== null ? (
          <div className="track__note track__note--warn">
            <strong>Van egy félbehagyott rögzítésed.</strong> {recorder.resumable.points.length}{' '}
            pont, {formatDistance(recorder.resumable.distanceM / 1000)}.
            <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
              <Button size="sm" onClick={() => void recorder.restore()}>
                Folytatom
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void recorder.dismissResumable()}>
                Eldobom
              </Button>
            </div>
          </div>
        ) : null}

        {(running || paused) && !recorder.supportsBackground ? (
          <div className="track__note track__note--warn">
            Tartsd bekapcsolva a képernyőt. Böngészőben a rögzítés megáll, ha a telefon
            lezáródik vagy másik appra váltasz.
            {recorder.wakeLockActive
              ? ' A képernyőt ébren tartjuk.'
              : ' A képernyő ébren tartása nem sikerült — állítsd hosszabbra a képernyő-időkorlátot.'}
          </div>
        ) : null}

        {recorder.error !== null ? (
          <div className="track__note track__note--error" role="alert">
            {recorder.error.message}
          </div>
        ) : null}

        {running || paused ? (
          <div className="track__signal">
            <span
              className={`track__dot ${recorder.hasFix ? 'track__dot--live' : 'track__dot--searching'}`}
            />
            {recorder.hasFix ? `${state.points.length} pont rögzítve` : 'Jelet keresünk…'}
          </div>
        ) : null}

        {idle ? (
          <>
            <p className="track__note">
              Válaszd ki a mozgásformát, aztán indíts. Legalább 100 méter kell ahhoz, hogy az
              aktivitás számítson.
            </p>
            <SegmentedControl
              label="Mozgásforma"
              block
              value={type}
              onChange={setType}
              options={[
                { value: 'run', label: 'Futás' },
                { value: 'walk', label: 'Séta' },
                { value: 'ride', label: 'Bringa' },
              ]}
            />
          </>
        ) : (
          <>
            <div className="track__primary">
              <span className="track__distance">{formatDistance(state.distanceM / 1000)}</span>
            </div>

            <div className="track__stats">
              <div className="track__stat">
                <span className="track__stat-value">{formatDuration(elapsed)}</span>
                <span className="track__stat-label">idő</span>
              </div>
              <div className="track__stat">
                <span className="track__stat-value">{pace === null ? '—' : formatPace(pace)}</span>
                <span className="track__stat-label">tempó</span>
              </div>
              <div className="track__stat">
                <span className="track__stat-value">{formatArea(cellsToM2(cells.length))}</span>
                <span className="track__stat-label">érintett</span>
              </div>
            </div>

            {cells.length > 0 || state.points.length > 1 ? (
              <HexMap
                layers={[{ role: 'trail', cells }]}
                track={state.points}
                height={260}
              />
            ) : null}

            {done ? (
              <p className="track__note">
                A terület kiszámítása és a pontok jóváírása a feltöltéskor történik.{' '}
                {/* TODO(F1): POST /api/activities — a motor szerveroldalon fut,
                    mert a foglalás hiteles eredménye nem jöhet a klienstől. */}
                A feltöltés még nincs bekötve.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="track__controls">
        {idle ? (
          <Button block onClick={() => void recorder.begin(type)}>
            Indítás
          </Button>
        ) : null}

        {running ? (
          <>
            <Button variant="secondary" onClick={recorder.pause}>
              Szünet
            </Button>
            <Button variant="danger" onClick={() => void recorder.finish()}>
              Befejezés
            </Button>
          </>
        ) : null}

        {paused ? (
          <>
            <Button onClick={recorder.resume}>Folytatás</Button>
            <Button variant="danger" onClick={() => void recorder.finish()}>
              Befejezés
            </Button>
          </>
        ) : null}

        {done ? (
          <Button variant="secondary" block onClick={() => void recorder.discard()}>
            Új rögzítés
          </Button>
        ) : null}
      </div>
    </div>
  );
}
