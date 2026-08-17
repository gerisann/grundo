import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Button, SegmentedControl } from '@/components/ui';
import { HexMap } from '@/components/HexMap';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import type { RecorderApi } from '@/hooks/useRecorder';
import { mapboxConfigured } from '@/lib/mapbox';
import { GAMEPLAY } from '@/config/gameplay';
import { traceToCellPath } from '@/game/cells';
import {
  currentSpeedMps,
  lapDistances,
  movingMs,
  paceSecPerKm,
  type RecorderState,
} from '@/tracking/recorder';
import { formatArea, formatDistance, formatDuration, formatPace } from '@/lib/format';
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
   * A mozgásforma a RÖGZÍTŐBEN él, nem itt.
   *
   * Az indítógomb a dokkban van, tehát a választásnak oda kell eljutnia. Amíg
   * ez a képernyő saját állapota volt, a dokk nem látta — ezért indult minden
   * rögzítés futásként.
   *
   * A legutóbbi választást megjegyezzük: aki bringázik, jellemzően minden nap
   * bringázik, neki minden indításnál átállítani fölösleges lépés.
   */
  const { pendingType: type, setPendingType } = recorder;

  useEffect(() => {
    const saved = readFlag(LAST_TYPE_KEY);
    if (ACTIVITY_TYPES.includes(saved as ActivityType)) setPendingType(saved as ActivityType);
  }, [setPendingType]);

  function setType(next: ActivityType) {
    setPendingType(next);
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

  /**
   * A befejezés után magától indul a feltöltés.
   *
   * Külön „Mentés" gomb nélkül: a felhasználó befejezte a futást, nincs miért
   * még egyszer megerősítenie. Hiba esetén viszont KELL gomb — az újrapróbálás
   * az ő döntése, és a hálózat lehet, hogy csak egy perc múlva jön vissza.
   */
  const uploadStatus = recorder.upload.status;
  const uploadActivity = recorder.uploadActivity;
  useEffect(() => {
    if (!done || uploadStatus !== 'idle' || !countsAsActivity) return;
    void uploadActivity();
    // A `recorder` OBJEKTUM minden rendereléskor új, ezért ha attól függene, a
    // hatás minden rendereléskor újrafutna — és a lassú mentés alatt kétszer is
    // elindíthatta a feltöltést. Csak a ténylegesen használt két értéktől függ.
  }, [done, countsAsActivity, uploadStatus, uploadActivity]);

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
            <span className="track__paused-hint">A mérés áll. A PLAY gombbal folytathatod.</span>
          </div>
        </div>
      ) : null}

      <div className="track__overlay">
        {recorder.resumable !== null ? (
          <div className="track__note track__note--warn">
            <strong>Van egy félbehagyott rögzítésed.</strong>{' '}
            {recorder.resumable.points.length} pont,{' '}
            {formatDistance(recorder.resumable.distanceM)}.
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
            <StatsPanel
              distanceM={state.distanceM}
              elapsed={elapsed}
              pace={pace}
              /* A cellák SZÁMA, nem a területük: futás közben a „38 mező"
                 megfogható, a „11 666 m²" nem. A négyzetméter az összegzésben
                 és a profilon számít. */
              cells={countsAsActivity ? cells.length : null}
              points={state.points.length}
              speedMps={currentSpeedMps(state)}
              hasFix={recorder.hasFix}
            />

            {state.laps.length > 1 ? <LapList state={state} /> : null}

            {done && !countsAsActivity ? (
              <div className="track__note track__note--warn">
                <strong>Ez a rögzítés túl rövid.</strong> Legalább {GAMEPLAY.MIN_DISTANCE_M} méter
                kell ahhoz, hogy az aktivitás számítson — terület és pont nem jár érte.
              </div>
            ) : null}

            {done && countsAsActivity ? <UploadPanel recorder={recorder} /> : null}
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
      {/*
        A sorok KÜLÖN, görgethető dobozban élnek, nem a kártyában közvetlenül.
        Enélkül egy húszkörös futásnál a lista lelógott a képernyőről, és vele
        együtt az összecsukó gomb is — vagyis a lenyitást nem lehetett
        visszavonni.
      */}
      <div className={`track__lap-rows${expanded ? ' track__lap-rows--scroll' : ''}`}>
        {shown.map(({ meters, index }) => (
          <div className="track__lap" key={state.laps[index]!.at}>
            <span className="track__lap-index">
              {index + 1}. kör
              {index === distances.length - 1 && state.status !== 'finished' ? (
                <span className="track__lap-now">most</span>
              ) : null}
            </span>
            <span className="track__lap-value">{formatDistance(meters)}</span>
          </div>
        ))}
      </div>

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

/**
 * Az élő adatok panelje — koppintásra kinyílik.
 *
 * Összecsukva egy sor, négy értékkel: futás közben egy pillantásra ennyi
 * fogyasztható. Kinyitva 2×2-es rács, nagyobb számokkal és ikonokkal — ez az
 * a nézet, amit a felhasználó megáll megnézni, vagy amit kitesz a kormányra.
 *
 * TODO(F2): a kinyitott nézet lesz a helye a felhasználó által választott
 * mérőszámoknak (pulzus, emelkedés, szakasztempó).
 */
function StatsPanel({
  distanceM,
  elapsed,
  pace,
  cells,
  points,
  speedMps,
  hasFix,
}: {
  distanceM: number;
  elapsed: number;
  pace: number | null;
  cells: number | null;
  points: number;
  speedMps: number | null;
  hasFix: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const stats = [
    { key: 'time', label: 'idő', value: formatDuration(elapsed), icon: <ClockIcon /> },
    {
      key: 'pace',
      label: 'tempó',
      value: pace === null ? '—' : formatPace(pace),
      icon: <PaceIcon />,
    },
    {
      key: 'speed',
      label: 'sebesség',
      // km/h-ban, mert bringán a tempó (perc/km) használhatatlan, és a
      // sebességet mindenki ebben érzi.
      value: speedMps === null ? '—' : `${(speedMps * 3.6).toFixed(1)}`,
      icon: <SpeedIcon />,
    },
    { key: 'cells', label: 'mező', value: cells === null ? '—' : String(cells), icon: <HexIcon /> },
    {
      key: 'points',
      label: 'pont',
      value: String(points),
      icon: <SignalIcon />,
      // A jelállapot ide költözött a különálló chipről: ahol a pontszám van,
      // ott a legbeszédesebb, hogy nő-e egyáltalán.
      dot: hasFix ? 'live' : 'searching',
    },
  ] as const;

  return (
    <button
      type="button"
      className={`track__panel track__panel--tap${expanded ? ' track__panel--open' : ''}`}
      onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded}
      aria-label={expanded ? 'Adatok összecsukása' : 'Adatok kinyitása'}
    >
      <span className="track__distance">{formatDistance(distanceM)}</span>

      <div className="track__stats">
        {stats.map((stat) => (
          <div className="track__stat" key={stat.key}>
            {expanded ? <span className="track__stat-icon">{stat.icon}</span> : null}
            <span className="track__stat-value">{stat.value}</span>
            <span className="track__stat-label">
              {'dot' in stat ? <span className={`track__dot track__dot--${stat.dot}`} /> : null}
              {stat.label}
            </span>
          </div>
        ))}
      </div>

      <span className="track__panel-grip" aria-hidden="true" />
    </button>
  );
}

/* Ikonok — inline SVG, hogy ne kelljen ikonkészletet behúzni. */

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2M9 2h6" />
    </svg>
  );
}

function PaceIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 20a8 8 0 1 1 8-8" />
      <path d="M12 13l4.5-4.5" />
    </svg>
  );
}

function HexIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z" />
    </svg>
  );
}

function SignalIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7.5 7.5a6.5 6.5 0 0 0 0 9M16.5 7.5a6.5 6.5 0 0 1 0 9" />
    </svg>
  );
}

/**
 * A mentés állapota és a szerver által számolt eredmény.
 *
 * Fontos, hogy AMIT ITT MUTATUNK, az a szerveré, nem a klienstől jön. A
 * képernyőn futás közben látott táv és mezőszám előnézet; a hiteles értéket a
 * szerver számolja újra a nyers nyomvonalból, és eltérés esetén az számít.
 */
function UploadPanel({ recorder }: { recorder: RecorderApi }) {
  const { upload } = recorder;

  if (upload.status === 'sending') {
    return <p className="track__note">Mentés folyamatban…</p>;
  }

  if (upload.status === 'error') {
    return (
      <div className="track__note track__note--error" role="alert">
        <strong>A mentés nem sikerült.</strong> {upload.message}
        {upload.retryable ? (
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <Button size="sm" onClick={() => void recorder.uploadActivity()}>
              Újrapróbálom
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (upload.status === 'done') {
    const { summary, duplicate } = upload;
    return (
      <div className="track__panel">
        <p className="track__saved">
          {duplicate ? 'Ez a rögzítés már mentve volt.' : 'Mentve.'}
        </p>
        <div className="track__stats">
          <div className="track__stat">
            <span className="track__stat-value">{formatDistance(summary.distanceM)}</span>
            <span className="track__stat-label">táv</span>
          </div>
          <div className="track__stat">
            <span className="track__stat-value">{formatArea(summary.areaGainedM2)}</span>
            <span className="track__stat-label">terület</span>
          </div>
          <div className="track__stat">
            <span className="track__stat-value">{summary.gp}</span>
            <span className="track__stat-label">GP</span>
          </div>
          <div className="track__stat">
            <span className="track__stat-value">{summary.loops}</span>
            <span className="track__stat-label">bezárás</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function SpeedIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4-5" />
      <path d="M4 18h16" />
    </svg>
  );
}
