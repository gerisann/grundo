import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Button, SegmentedControl } from '@/components/ui';
import { HexMap } from '@/components/HexMap';

/**
 * A Mapbox lustán töltődik: saját csomagja 521 kB tömörítve — hatszorosa a
 * belépő csomagnak (88 kB) —, és csak ezen a képernyőn kell. Statikus
 * importtal minden felhasználó fizetne érte a belépéskor is.
 */
const MapView = lazy(() =>
  import('@/components/MapView').then((m) => ({ default: m.MapView })),
);
import { useRecorder } from '@/hooks/useRecorder';
import { useRecordingLock } from '@/hooks/RecordingLock';
import { mapboxConfigured } from '@/lib/mapbox';
import { GAMEPLAY } from '@/config/gameplay';
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

  /**
   * A 100 méteres küszöb alatt NEM írunk ki területet.
   *
   * Egy helyben állva is keletkezik egy-két cella (a GPS pár métert vándorol,
   * és 30 másodpercenként úgyis rögzítünk egy pontot), amiből „307 m² érintett"
   * lenne — nulla megtett táv mellett. Ez azt ígérné a felhasználónak, hogy
   * szerzett valamit, holott az aktivitás a szabály szerint nem is számít.
   */
  const countsAsActivity = state.distanceM >= GAMEPLAY.MIN_DISTANCE_M;

  /**
   * A térkép jelölője a legutolsó elfogadott ponton áll.
   *
   * Nem a nyers GPS-fixen: azt a szűrő elutasíthatta pontatlanság miatt, és
   * akkor a jelölő olyan helyre ugrana, ahol a felhasználó nem járt.
   */
  const lastPoint = state.points.length > 0 ? state.points[state.points.length - 1]! : null;

  // Rögzítés közben nincs dokk: az elnavigálás leállítaná a mérést.
  const { setLocked } = useRecordingLock();
  useEffect(() => {
    setLocked(running || paused);
    return () => setLocked(false);
  }, [running, paused, setLocked]);

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
                <span className="track__stat-value">
                  {countsAsActivity ? formatArea(cellsToM2(cells.length)) : '—'}
                </span>
                <span className="track__stat-label">érintett</span>
              </div>
            </div>

            {/*
              Utcatérkép, ha van Mapbox-token; egyébként a token nélkül is
              működő hexagon-nézet. Így egy hiányzó beállítás nem üres
              képernyőt okoz, csak szegényesebbet.
            */}
            {mapboxConfigured ? (
              <Suspense
                fallback={<div className="track__note">Térkép betöltése…</div>}
              >
                <MapView
                  layers={[{ role: 'trail', cells }]}
                  track={state.points}
                  position={lastPoint}
                  follow={running}
                  height={280}
                />
              </Suspense>
            ) : state.points.length > 1 ? (
              <HexMap layers={[{ role: 'trail', cells }]} track={state.points} height={260} />
            ) : (
              <p className="track__note">
                A nyomvonalad itt jelenik meg, amint elindulsz. Ez a hexagon-nézet — utcatérkép
                csak beállított Mapbox-tokennel jelenik meg.
              </p>
            )}

            {done && !countsAsActivity ? (
              <div className="track__note track__note--warn">
                <strong>Ez a rögzítés túl rövid.</strong> Legalább{' '}
                {GAMEPLAY.MIN_DISTANCE_M} méter kell ahhoz, hogy az aktivitás számítson —
                terület és pont nem jár érte.
              </div>
            ) : null}

            {done && countsAsActivity ? (
              <p className="track__note">
                {/* TODO(F1): POST /api/activities — a motor szerveroldalon fut,
                    mert a foglalás hiteles eredménye nem jöhet a klienstől. */}
                A terület kiszámítása és a pontok jóváírása a feltöltéskor történik. A feltöltés
                még nincs bekötve.
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
