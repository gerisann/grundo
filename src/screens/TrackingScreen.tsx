import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { cellToChildren } from 'h3-js';
import { Button, SegmentedControl } from '@/components/ui';
import { HexMap } from '@/components/HexMap';
import { SaveActivityForm } from '@/components/SaveActivityForm';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import type { RecorderApi } from '@/hooks/useRecorder';
import { mapboxConfigured } from '@/lib/mapbox';
import { GAMEPLAY } from '@/config/gameplay';
import { layerOf, traceToCellPath } from '@/game/cells';
import { processActivity } from '@/game';
import { api, apiConfigured, type TilesResult } from '@/lib/api';
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
  const profileUid = useProfile().profile?.uid ?? '';
  const { state } = recorder;
  const { pendingType: type, setPendingType } = recorder;
  const remoteState = state.status === 'idle' ? recorder.remoteState : null;
  const displayPoints = remoteState?.points ?? state.points;
  /**
   * Indítás előtt a kiválasztott típust kell megjeleníteni, nem a még el sem
   * indult rögzítő előző/alapértelmezett típusát. Enélkül a Bringa gomb aktív
   * lehetett úgy, hogy a térkép továbbra is a gyalogos réteget kérte le.
   */
  const displayType = remoteState?.type ?? (state.status === 'idle' ? type : state.type);
  const displayDistanceM = remoteState?.distanceM ?? state.distanceM;
  const distanceBucket = Math.floor(displayDistanceM / 25);
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
    if (state.status !== 'recording' && remoteState?.status !== 'recording') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.status, remoteState?.status]);

  /**
   * A cellák újraszámolása a nyomvonal hosszával arányos munka, ezért NEM
   * futtatjuk minden mintánál: ötösével frissítünk.
   */
  const cellBucket = Math.floor(displayPoints.length / 5);

  /**
   * Élő előnézet: mi lenne, ha MOST fejezném be?
   *
   * A motort futtatjuk le a jelenlegi nyomvonalra, üres birtokviszonnyal. Ez
   * nem a hiteles eredmény — azt a szerver számolja, a valódi tulajdonosokkal —,
   * de megmutatja, mit zártál be, és nagyjából mennyit ér.
   *
   * Ötösével frissítünk: a teljes futás 11 km-es nyomvonalon ~230 ms, ami
   * mintánként megismételve akadozó felületet adna.
   */
  const preview = useMemo(() => {
    if (displayPoints.length < 2) {
      return { path: [] as string[], claimable: [] as string[], gp: 0 };
    }
    const { path } = traceToCellPath(displayPoints);
    try {
      const result = processActivity({
        points: displayPoints,
        type: displayType,
        distanceKm: displayDistanceM / 1000,
        actorId: 'preview',
        ownership: new Map(),
        streakDays: 0,
        gpEarnedToday: 0,
      });
      return { path, claimable: [...result.claimedCells], gp: result.gp.total };
    } catch {
      // A motor túl nagy hurokra kivételt dob (GPS-ugrás). A nyom attól még
      // rajzolható — az előnézet hiánya nem indok arra, hogy a térkép is
      // kiessen.
      return { path, claimable: [] as string[], gp: 0 };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellBucket, distanceBucket, state.status, remoteState?.activityId, displayType]);

  const cells = preview.path;

  /**
   * A KÖRNYÉK birtokviszonya rögzítés közben.
   *
   * Futás közben az az érdekes kérdés, hogy „hova érdemes mennem" — arra pedig
   * csak akkor lehet válaszolni, ha látod, mi van már elfoglalva körülötted.
   */
  const [nearby, setNearby] = useState<TilesResult | null>(null);
  const [nearbyView, setNearbyView] = useState<{
    south: number;
    west: number;
    north: number;
    east: number;
    zoom: number;
  } | null>(null);
  const nearbyCache = useRef(new Map<string, TilesResult>());
  const nearbyLayer = useRef(layerOf(displayType));

  useEffect(() => {
    if (!apiConfigured || nearbyView === null) return;

    let alive = true;
    const layer = layerOf(displayType);
    const key = `${layer}:${nearbyView.south.toFixed(4)}:${nearbyView.west.toFixed(4)}:` +
      `${nearbyView.north.toFixed(4)}:${nearbyView.east.toFixed(4)}`;
    const cached = nearbyCache.current.get(key);

    // Mozgás közben a régi, azonos rétegű adat marad a térképen a válaszig:
    // ettől szűnik meg a piros mezők eltűnés-visszajövés villogása. Valódi
    // rétegváltáskor viszont nem mutathatunk foot adatot bike-ként.
    if (nearbyLayer.current !== layer) {
      nearbyLayer.current = layer;
      setNearby(cached ?? null);
    } else if (cached) {
      setNearby(cached);
    }
    void api
      .tiles(layer, nearbyView)
      .then((result) => {
        if (!alive) return;
        nearbyCache.current.set(key, result);
        setNearby(result);
      })
      // Hálózati hiba alatt a legutolsó ismert pillanatkép marad látható.
      .catch(() => undefined);

    // Gyors oda-vissza váltásnál a lassabban visszaérő régi kérés nem írhatja
    // felül az új mozgásformához tartozó cellákat.
    return () => {
      alive = false;
    };
  }, [displayType, nearbyView]);

  const running = state.status === 'recording';
  const paused = state.status === 'paused';
  const done = state.status === 'finished';
  const idle = state.status === 'idle';

  const remoteElapsedMs = remoteState === null
    ? 0
    : remoteState.movingMs
      + (remoteState.status === 'recording' && remoteState.updatedAt > 0
        ? Math.max(0, now - remoteState.updatedAt)
        : 0);
  const elapsed = Math.floor(
    remoteState === null ? movingMs(state, now) / 1000 : remoteElapsedMs / 1000,
  );
  const pace = remoteState === null
    ? paceSecPerKm(state, now)
    : displayDistanceM > 0
      ? elapsed / (displayDistanceM / 1000)
      : null;

  /** A 100 méteres küszöb alatt nincs terület — lásd a befejezés utáni jelzést. */
  const countsAsActivity = displayDistanceM >= GAMEPLAY.MIN_DISTANCE_M;

  /** A környék teljes birtokképe ugyanazzal a szintadattal, mint a Grundon. */
  const nearbyOthers = useMemo(
    () => (nearby?.cells ?? [])
      .filter((c) => c.owner !== profileUid)
      .map((c) => ({ cell: c.cell, defense: c.defense })),
    [nearby, profileUid],
  );
  const nearbyMine = useMemo(
    () => (nearby?.cells ?? [])
      .filter((c) => c.owner === profileUid)
      .map((c) => ({ cell: c.cell, defense: c.defense })),
    [nearby, profileUid],
  );
  const nearbyFree = useMemo(() => {
    if ((nearbyView?.zoom ?? 0) < 15) return [];
    const taken = new Set((nearby?.cells ?? []).map((cell) => cell.cell));
    const free: string[] = [];
    for (const block of nearby?.blocks ?? []) {
      for (const cell of cellToChildren(block, GAMEPLAY.H3_RESOLUTION)) {
        if (!taken.has(cell)) free.push(cell);
      }
    }
    return free;
  }, [nearby, nearbyView?.zoom]);

  const lastPoint = displayPoints.length > 0 ? displayPoints[displayPoints.length - 1]! : null;

  /**
   * Indítás előtt is oda kell állítani a térképet, ahol a felhasználó van.
   *
   * A rögzítő csak indítás után kap pozíciót, addig a térkép egy alapértelmezett
   * ponton állna — ami mindenkinek rossz, aki nem Budapest belvárosában van.
   * Ezért egyszer, olcsón elkérjük a helyet: kis pontossággal, akár
   * gyorsítótárból. Nem mérünk vele, csak a nézetet igazítjuk.
   */
  const [homeFix, setHomeFix] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (lastPoint !== null || homeFix !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setHomeFix({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [lastPoint, homeFix]);

  const mapPosition = lastPoint ?? homeFix;

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
    <div className={`track${done ? ' track--finished' : ''}`}>
      <div className={`track__map${mapboxConfigured ? '' : ' track__map--plain'}`}>
        {mapboxConfigured ? (
          <Suspense fallback={null}>
            <MapView
              layers={[
                // Sorrend = rajzolási sorrend: alul az idegen, fölötte a
                // bezárt terület, legfelül a friss nyom.
                { role: 'free', cells: nearbyFree },
                { role: 'rival', cells: nearbyOthers },
                { role: 'interior', cells: nearbyMine },
                {
                  role: 'interior',
                  cells: preview.claimable.map((cell) => ({ cell, preview: true })),
                },
                { role: 'trail', cells },
              ]}
              track={displayPoints}
              position={mapPosition}
              follow={running || remoteState?.status === 'recording'}
              onViewport={setNearbyView}
              fill
            />
          </Suspense>
        ) : displayPoints.length > 1 ? (
          <HexMap layers={[{ role: 'trail', cells }]} track={displayPoints} height={420} />
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
        {remoteState !== null ? (
          <div className="track__note track__note--sync">
            <strong>Mobilos aktivitásod legutóbbi állapota</strong>
            <span>
              {remoteState.status === 'recording'
                ? ' folyamatban'
                : remoteState.status === 'paused'
                  ? ' szünetel'
                  : ' befejezve'}
              {remoteState.updatedAt > 0 ? ` · ${relativeSyncTime(remoteState.updatedAt, now)}` : ''}
            </span>
          </div>
        ) : null}
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

        {idle && remoteState === null ? (
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
              distanceM={displayDistanceM}
              elapsed={elapsed}
              pace={pace}
              claimableCells={preview.claimable.length}
              expectedGp={preview.gp}
              /* A cellák SZÁMA, nem a területük: futás közben a „38 mező"
                 megfogható, a „11 666 m²" nem. A négyzetméter az összegzésben
                 és a profilon számít. */
              cells={countsAsActivity ? cells.length : null}
              points={displayPoints.length}
              speedMps={remoteState?.speedMps ?? currentSpeedMps(state)}
              hasFix={remoteState !== null ? displayPoints.length > 0 : recorder.hasFix}
            />

            {remoteState === null && state.laps.length > 1 ? <LapList state={state} /> : null}

            {done && !countsAsActivity ? (
              <div className="track__note track__note--warn">
                <strong>Ez a rögzítés túl rövid.</strong> Legalább {GAMEPLAY.MIN_DISTANCE_M} méter
                kell ahhoz, hogy az aktivitás számítson — terület és pont nem jár érte.
              </div>
            ) : null}

            {done && countsAsActivity ? (
              <UploadPanel recorder={recorder} uid={profileUid} />
            ) : null}
          </>
        )}
      </div>

      {idle && remoteState === null && showStartHint ? (
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

function relativeSyncTime(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 10) return 'éppen most frissült';
  if (seconds < 60) return `${seconds} mp-e frissült`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} perce frissült`;
  return `${Math.floor(minutes / 60)} órája frissült`;
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
  claimableCells,
  expectedGp,
  points,
  speedMps,
  hasFix,
}: {
  distanceM: number;
  elapsed: number;
  pace: number | null;
  cells: number | null;
  /** Amit MOST megkapnál, ha befejeznéd — a bezárt területtel együtt. */
  claimableCells: number;
  expectedGp: number;
  points: number;
  speedMps: number | null;
  hasFix: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  /**
   * Zárójelben a VÁRHATÓ érték.
   *
   * A fő szám az, amin már áthaladtál; a zárójeles az, amit a bezárásokkal
   * együtt megszerzel, ha most fejezed be. A kettő közti különbség épp az a
   * motiváció, amiért a játék létezik — de a fő szám marad a biztos tény.
   *
   * Csak akkor mutatjuk, ha van különbség: „356 (356)" zaj lenne.
   */
  const withExpected = (main: number, expected: number) =>
    expected > main ? `${main} (${expected})` : String(main);

  const stats = [
    { key: 'time', label: 'idő', value: formatDuration(elapsed), icon: <ClockIcon /> },
    {
      key: 'pace',
      label: 'tempó',
      value: pace === null ? '—' : formatPace(pace),
      icon: <PaceIcon />,
    },
    {
      key: 'cells',
      label: 'mező',
      value: cells === null ? '—' : withExpected(cells, claimableCells),
      icon: <HexIcon />,
    },
    {
      key: 'gp',
      label: 'GP',
      value: String(expectedGp),
      icon: <SignalIcon />,
    },
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
      {/* Első sor: sebesség balra, megtett táv jobbra — azonos mérettel.
          Futás közben ez a két szám az, amit egy pillantással leolvasol. */}
      <div className="track__primary">
        <span className="track__primary-cell">
          <span className="track__primary-value">
            {speedMps === null ? '—' : (speedMps * 3.6).toFixed(1)}
          </span>
          <span className="track__primary-label">km/h</span>
        </span>
        <span className="track__primary-cell">
          <span className="track__primary-value">{formatDistance(distanceM)}</span>
          <span className="track__primary-label">megtett táv</span>
        </span>
      </div>

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
function UploadPanel({ recorder, uid }: { recorder: RecorderApi; uid: string }) {
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

        {/*
          A név, a leírás és a képek a feltöltés UTÁN jönnek.

          A területfoglalás nem várhat arra, hogy a felhasználó címet
          találjon ki: a nyomvonal a befejezéskor felmegy, a terület azonnal
          a tiéd. Ez az űrlap már csak kiegészít, és nyugodtan kihagyható.

          Ismételt mentésnél (`duplicate`) nem mutatjuk: olyankor az
          aktivitásnak már lehet neve és fotója, és az üres űrlap mentése
          felülcsapná őket.
        */}
        {!duplicate && uid && recorder.state.id ? (
          <SaveActivityForm activityId={recorder.state.id} uid={uid} />
        ) : null}
        <div className="track__new-recording">
          <Button block variant="secondary" onClick={() => void recorder.discard()}>
            Új rögzítés
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

