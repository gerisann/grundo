import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Button, SegmentedControl } from '@/components/ui';
import { HexMap } from '@/components/HexMap';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import { mapboxConfigured } from '@/lib/mapbox';
import { GAMEPLAY } from '@/config/gameplay';
import { traceToCellPath } from '@/game/cells';
import {
  lapDistances,
  movingMs,
  paceSecPerKm,
  type RecorderState,
} from '@/tracking/recorder';
import { formatDistance, formatDuration, formatPace } from '@/lib/format';
import type { ActivityType } from '@/types';
import './tracking.css';

/**
 * A Mapbox lustán töltődik: saját csomagja 521 kB tömörítve — hatszorosa a
 * belépő csomagnak (88 kB) —, és csak ezen a képernyőn kell.
 */
const MapView = lazy(() => import('@/components/MapView').then((m) => ({ default: m.MapView })));

const WAKE_NOTE_KEY = 'grundo.hint.wakelock';
const LAST_TYPE_KEY = 'grundo.lastActivityType';

const ACTIVITY_TYPES: ActivityType[] = ['run', 'walk', 'ride'];

/**
 * Rögzítés.
 *
 * A térkép a HÁTTÉR, minden más fölötte lebeg — rögzítés közben a felhasználó
 * azt nézi, merre jár, az adatok csak ráolvasás.
 *
 * A KORLÁT, amit nem hallgatunk el: böngészőben a mérés csak addig megy, amíg
 * az oldal látható. Ha a felhasználó lezárja a telefont vagy másik appra vált,
 * a rögzítés megszakad — sem az iOS, sem az Android nem ad webes API-t
 * háttér-helymeghatározásra.
 */
export function TrackingScreen() {
  const recorder = useRecorderContext();
  const { state } = recorder;
  /**
   * A legutóbbi mozgásformát megjegyezzük.
   *
   * Aki bringázik, az jellemzően minden nap bringázik — neki minden indításnál
   * átállítani a futásról fölösleges lépés, és könnyű elfelejteni.
   */
  const [type, setTypeState] = useState<ActivityType>(() => {
    const saved = readFlag(LAST_TYPE_KEY);
    return ACTIVITY_TYPES.includes(saved as ActivityType) ? (saved as ActivityType) : 'run';
  });

  function setType(next: ActivityType) {
    setTypeState(next);
    writeFlag(LAST_TYPE_KEY, next);
  }

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
   * futtatjuk minden mintánál: ötösével frissítünk.
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

  /** A 100 méteres küszöb alatt nincs terület — lásd a befejezés utáni jelzést. */
  const countsAsActivity = state.distanceM >= GAMEPLAY.MIN_DISTANCE_M;

  const lastPoint = state.points.length > 0 ? state.points[state.points.length - 1]! : null;

  /**
   * Indítás előtt is oda kell állítani a térképet, ahol a felhasználó van.
   *
   * A rögzítő csak indítás után kap pozíciót, addig a térkép egy alapértelmezett
   * ponton állna — ami mindenkinek rossz, aki nem Budapest belvárosában van.
   * Ezért egyszer, olcsón elkérjük a helyet: kis pontossággal, akár
   * gyorsítótárból. Nem mérünk vele, csak a nézetet igazítjuk.
   */
  const [preview, setPreview] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (lastPoint !== null || preview !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setPreview({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [lastPoint, preview]);

  const mapPosition = lastPoint ?? preview;

  /**
   * TODO(F1, tesztelés után): a jelzés csak az ELSŐ indításig látszódjon.
   *
   * Amíg a felületet teszteljük, minden indításnál megjelenik, mert így
   * ítélhető meg, elég feltűnő-e. Élesben elég lesz az elsőnél: a jelzést a
   * `localStorage`-ba írt jelölővel lehet kioltani, ahogy a képernyő-
   * figyelmeztetésnél is tesszük.
   */
  const showStartHint = true;

  // A képernyő-figyelmeztetés bezárható: aki egyszer elolvasta, tudja.
  const [showWakeNote, setShowWakeNote] = useState(() => readFlag(WAKE_NOTE_KEY) === null);

  return (
    <div className="track">
      <div className={`track__map${mapboxConfigured ? '' : ' track__map--plain'}`}>
        {mapboxConfigured ? (
          <Suspense fallback={null}>
            <MapView
              layers={[{ role: 'trail', cells }]}
              track={state.points}
              position={mapPosition}
              follow={running}
              fill
            />
          </Suspense>
        ) : state.points.length > 1 ? (
          <HexMap layers={[{ role: 'trail', cells }]} track={state.points} height={420} />
        ) : (
          <p className="track__note">
            A nyomvonalad itt jelenik meg, amint elindulsz. Utcatérkép csak beállított
            Mapbox-tokennel látszik.
          </p>
        )}
      </div>

      {paused ? (
        <div className="track__paused">
          <div className="track__paused-label">
            Szünet
            <span className="track__paused-hint">A mérés áll. A lila gombbal folytathatod.</span>
          </div>
        </div>
      ) : null}

      <div className="track__overlay">
        {recorder.resumable !== null ? (
          <div className="track__note track__note--warn">
            <strong>Van egy félbehagyott rögzítésed.</strong>{' '}
            {recorder.resumable.points.length} pont,{' '}
            {formatDistance(recorder.resumable.distanceM / 1000)}.
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

        {(running || paused) && !recorder.supportsBackground && showWakeNote ? (
          <div className="track__note track__note--warn track__note--closable">
            <button
              type="button"
              className="track__note-close"
              aria-label="Üzenet bezárása"
              onClick={() => {
                setShowWakeNote(false);
                writeFlag(WAKE_NOTE_KEY);
              }}
            >
              ✕
            </button>
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
            {recorder.hasFix ? `${state.points.length} pont` : 'Jelet keresünk…'}
          </div>
        ) : null}

        {idle ? (
          <div className="track__panel">
            <p
              style={{
                fontSize: 14,
                color: 'var(--text-secondary)',
                marginBottom: 'var(--sp-3)',
                lineHeight: 1.45,
              }}
            >
              Válaszd ki a mozgásformát, aztán indíts. Legalább {GAMEPLAY.MIN_DISTANCE_M} méter
              kell ahhoz, hogy az aktivitás számítson.
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
          </div>
        ) : (
          <>
            <div className="track__panel">
              <span className="track__distance">{formatDistance(state.distanceM / 1000)}</span>
              <div className="track__stats">
                <div className="track__stat">
                  <span className="track__stat-value">{formatDuration(elapsed)}</span>
                  <span className="track__stat-label">idő</span>
                </div>
                <div className="track__stat">
                  <span className="track__stat-value">
                    {pace === null ? '—' : formatPace(pace)}
                  </span>
                  <span className="track__stat-label">tempó</span>
                </div>
                <div className="track__stat">
                  {/* A cellák SZÁMA, nem a területük: futás közben a „38 mező"
                      megfogható, a „11 666 m²" nem. A négyzetméter az
                      összegzésben és a profilon számít. */}
                  <span className="track__stat-value">
                    {countsAsActivity ? cells.length : '—'}
                  </span>
                  <span className="track__stat-label">mező</span>
                </div>
              </div>
            </div>

            {state.laps.length > 1 ? <LapList state={state} /> : null}

            {done && !countsAsActivity ? (
              <div className="track__note track__note--warn">
                <strong>Ez a rögzítés túl rövid.</strong> Legalább {GAMEPLAY.MIN_DISTANCE_M} méter
                kell ahhoz, hogy az aktivitás számítson — terület és pont nem jár érte.
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

      {idle && showStartHint ? (
        <div className="track__hint" aria-hidden="true">
          <span className="track__hint-text">Indítás</span>
          <svg className="track__hint-arrow" viewBox="0 0 28 40" fill="none">
            <path
              d="M14 2v24"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="5 6"
            />
            <path d="M14 38l-9-13h18z" fill="currentColor" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}

/* A jelzések megjegyzése. Privát böngészésben a tárolás dobhat — ilyenkor úgy
   vesszük, hogy a jelzést már látta: jobb egyszer kihagyni, mint minden
   megnyitásnál újra az arcába tolni. */

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return '1';
  }
}

function writeFlag(key: string, value = '1'): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nem baj */
  }
}

/**
 * Körök: alapból csak az AKTUÁLIS és az ELŐZŐ.
 *
 * Egy órás futásnál húsz kör is lehet — kilistázva ellepné a képernyőt, és
 * pont azt takarná el, amiért a felhasználó odanéz: a térképet és az élő
 * adatokat. Futás közben az érdekes kérdés az, hogy „az előzőhöz képest
 * hogy állok", nem az, hogy mi volt a negyedik körben. A teljes lista egy
 * koppintással előhozható.
 */
function LapList({ state }: { state: RecorderState }) {
  const [expanded, setExpanded] = useState(false);
  const distances = lapDistances(state);

  // Fordított sorrend: a legfrissebb kör legyen elöl.
  const rows = distances
    .map((meters, index) => ({ meters, index }))
    .reverse();
  const shown = expanded ? rows : rows.slice(0, 2);
  const hidden = rows.length - shown.length;

  return (
    <div className="track__laps">
      {shown.map(({ meters, index }) => (
        <div className="track__lap" key={state.laps[index]!.at}>
          <span className="track__lap-index">
            {index + 1}. kör
            {index === distances.length - 1 && state.status !== 'finished' ? (
              <span className="track__lap-now">most</span>
            ) : null}
          </span>
          <span className="track__lap-value">{formatDistance(meters / 1000)}</span>
        </div>
      ))}

      {hidden > 0 || expanded ? (
        <button
          type="button"
          className="track__lap-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Kevesebb' : `Mind a ${rows.length} kör`}
        </button>
      ) : null}
    </div>
  );
}
