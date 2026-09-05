import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { ActivityType } from '@/types';
import type { ActivitySummary } from '@/lib/api';
import { Button } from '@/components/ui';
import { Dock } from '@/components/Dock';
import { RecorderProvider, useRecorderContext } from '@/hooks/RecorderProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { DEFAULT_CELL_COLOR, FREE_CELL_COLOR_KEYS, isCellColor } from '@/lib/cellColors';
import { TrackingScreen } from '@/screens/TrackingScreen';
import { memoryStore } from '@/tracking/storage';
import {
  generateGpsActivity,
  SimulationPositionSource,
} from '@/tracking/simulationSource';
import { TrackingEnvironmentProvider } from '@/tracking/environment';
import {
  DEFAULT_LAB_SAVE_SIMULATION,
  LabE2eSandbox,
  type LabSaveMode,
  type LabSaveSimulation,
} from './labE2eSandbox';
import { activateLabTileBridge, releaseLabTileBridge } from './labE2eTileBridge';
import {
  describePlaybackRate,
  labPlaybackRateSchedule,
  loadLabE2eSession,
  type LabE2eSession,
} from './labE2eSession';
import './lab-e2e-tracking.css';

export function LabE2eTrackingScreen() {
  const { sessionId = '' } = useParams();
  const session = useMemo(() => loadLabE2eSession(sessionId), [sessionId]);
  const profile = useProfile().profile;
  const profileUid = profile?.uid ?? 'lab-admin';
  /**
   * A SAJÁT, VALÓDI cellaszín a LAB-ban is — így a sandbox pontosan azt a
   * színt mutatja, amit az éles térkép mutatna ugyanennek a felhasználónak.
   */
  const myColor = isCellColor(profile?.cellColor) ? profile.cellColor : DEFAULT_CELL_COLOR;

  if (!session) return <Navigate to="/admin/lab/e2e" replace />;

  return (
    <LabE2eTrackingRuntime
      key={session.id}
      session={session}
      profileUid={profileUid}
      myColor={myColor}
    />
  );
}

/**
 * AZ AUTOPILÓTA — a Game Loop futtató kapaszkodója.
 *
 * A LAB E2E-t rendes esetben ember indítja a Dockról és ember menti el. A
 * Firebase Test Lab készülékén viszont NINCS ember: a futásnak magától kell
 * elindulnia, végigmennie és lezárulnia. Ez a szerződés írja le, mit vár a
 * hívó — a mérendő lánc maga változatlan.
 *
 * ⚠️ Az `onFinished` AKKOR IS lefut, ha a mentés hibára fut. Enélkül egy
 * elszállt mentés úgy fagyasztaná be a futást, hogy a Test Lab időtúllépéssel,
 * mérés nélkül zárna — pedig a hiba pont az az információ, amiért mérünk.
 */
export interface LabAutopilot {
  onFinished: (outcome: { summary: ActivitySummary | null; error: string | null }) => void;
}

export function LabE2eTrackingRuntime({
  session,
  profileUid,
  myColor,
  autopilot,
}: {
  session: LabE2eSession;
  profileUid: string;
  myColor: string;
  autopilot?: LabAutopilot;
}) {
  const generated = useMemo(
    () => generateGpsActivity(session.route, { ...session.config, startAt: Date.now() }),
    [session],
  );
  /**
   * A NYOMVONAL VÉGE — csak az autopilótának számít.
   *
   * A `SimulationPositionSource` harmadik paramétere pontosan erre való, és
   * eddig senki nem használta: kézi futásnál a felhasználó látja, hogy megállt
   * a pötty. A gépi futásnak viszont ez az EGYETLEN jelzése arról, hogy a menet
   * lejátszódott és jöhet a lezárás.
   */
  const [routeComplete, setRouteComplete] = useState(false);
  const source = useMemo(
    () => new SimulationPositionSource(
      generated.samples,
      labPlaybackRateSchedule(session.playbackRate),
      () => setRouteComplete(true),
    ),
    [generated.samples, session.playbackRate],
  );
  const store = useMemo(() => memoryStore(), []);
  const ownerNames = useMemo(
    () => new Map(session.players.map((player) => [player.id, player.name])),
    [session.players],
  );
  /**
   * A LAB játékosainak színe: a SAJÁT a profilból, a többieké a szabad
   * palettából, determinisztikusan szétosztva. Determinisztikus, hogy két
   * futás között ne cserélődjenek meg a színek — akkor a képernyőfotós
   * összehasonlítás értelmét vesztené.
   */
  const ownerColors = useMemo(() => {
    const colors = new Map<string, string>([[profileUid, myColor]]);
    let index = 0;
    for (const player of session.players) {
      if (player.id === session.playerId) continue;
      const key = FREE_CELL_COLOR_KEYS[index % FREE_CELL_COLOR_KEYS.length]!;
      colors.set(player.id, key === myColor ? FREE_CELL_COLOR_KEYS[(index + 1) % FREE_CELL_COLOR_KEYS.length]! : key);
      index += 1;
    }
    return colors;
  }, [myColor, profileUid, session.playerId, session.players]);

  const sandbox = useMemo(
    () => new LabE2eSandbox({
      id: session.sandboxId,
      actorId: session.playerId,
      displayActorUid: profileUid,
      ownerNames,
      ownerColors,
    }),
    [ownerColors, ownerNames, profileUid, session.playerId, session.sandboxId],
  );

  const loaders = useMemo(() => ({
    tiles: (layer: 'foot' | 'bike', view: { south: number; west: number; north: number; east: number }) =>
      sandbox.tiles(layer, view),
    blobs: (layer: 'foot' | 'bike', view: { south: number; west: number; north: number; east: number }) =>
      sandbox.blobs(layer, view),
  }), [sandbox]);

  /**
   * ⚠️ AKTIVÁLÁS RENDER KÖZBEN — szándékosan, és ezért idempotens a híd.
   *
   * A gyerek `TrackingScreen` első csempe-lekérésének MÁR a sandboxba kell
   * futnia, a szülő `useEffect`-je viszont ehhez késő: a React a gyerekek
   * hatásait futtatja előbb. Ezért az aktiválás a renderben történik.
   *
   * A `useEffect` KÉT dolgot csinál: leválasztáskor visszaadja a production
   * olvasást, ÉS `StrictMode` alatt vissza is kapcsolja a hidat — ott a
   * React a hatásokat mount → cleanup → mount sorrendben futtatja, tehát a
   * köztes cleanup a még ÉLŐ képernyő alól venné ki a sandboxot.
   */
  activateLabTileBridge(loaders);
  useEffect(() => {
    activateLabTileBridge(loaders);
    return releaseLabTileBridge;
  }, [loaders]);

  const environment = useMemo(() => ({
    mode: 'lab' as const,
    label: 'LAB / SANDBOX',
    detail: `${session.scenarioName} · ${session.phaseName} · ${session.playerName} · ${describePlaybackRate(session.playbackRate)}`,
    initialPosition: session.route[0] ? { lat: session.route[0].lat, lng: session.route[0].lng } : null,
    sharedPositionEnabled: false,
    // A mentőlap is a sandboxba ír, különben a production végpont „Nincs
    // ilyen aktivitás." hibával szállna el. Kép nincs: az valódi Storage.
    saveActivity: (activityId: string, patch: { title: string; description: string }) =>
      sandbox.saveActivity(activityId, patch),
    photosEnabled: false,
  }), [sandbox, session]);

  return (
    <TrackingEnvironmentProvider value={environment}>
      <RecorderProvider
        source={source}
        options={{
          store,
          uploader: (input) => sandbox.upload(input),
          // A hosszú mentés `processing` állapotából csak ez vezet ki — lásd
          // `RecorderOptions.uploadStatus`.
          uploadStatus: (activityId) => sandbox.uploadStatus(activityId),
          restoreSavedRun: false,
        }}
        cloudSync={false}
      >
        <LabE2eTrackingBody session={session} sandbox={sandbox} />
        {autopilot ? (
          <LabAutopilotDriver
            activityType={session.config.activityType}
            routeComplete={routeComplete}
            onFinished={autopilot.onFinished}
          />
        ) : null}
      </RecorderProvider>
    </TrackingEnvironmentProvider>
  );
}

/**
 * AZ AUTOPILÓTA VEZÉRLŐJE — nem rajzol semmit, csak nyomja a gombokat.
 *
 * MIÉRT KÜLÖN KOMPONENS, ÉS MIÉRT A `RecorderProvider` ALATT: a rögzítőhöz
 * csak innen lehet hozzáférni, és így a kézi LAB-futás kódja egyetlen sorral
 * sem változik — a vezérlő egyszerűen nincs ott.
 *
 * A menet három lépés, mindegyik pontosan egyszer:
 *   1. indítás, amint a rögzítő üresjáratban van;
 *   2. lezárás, amint a szimulált nyomvonal elfogyott;
 *   3. mentés, majd a kimenetel leadása — sikeré és hibáé egyaránt.
 *
 * ⚠️ MINDEN LÉPÉS ŐRIZVE VAN egy `ref`-fel. A rögzítő állapota másodpercenként
 * sokszor változik; őr nélkül a `begin()` és az `uploadActivity()` minden
 * rendernél újraindulna.
 */
function LabAutopilotDriver({
  activityType,
  routeComplete,
  onFinished,
}: {
  activityType: ActivityType;
  routeComplete: boolean;
  onFinished: LabAutopilot['onFinished'];
}) {
  const recorder = useRecorderContext();
  const started = useRef(false);
  const finished = useRef(false);
  const uploaded = useRef(false);
  const reported = useRef(false);

  const { status } = recorder.state;
  const { begin, finish, uploadActivity, upload } = recorder;

  useEffect(() => {
    if (started.current || status !== 'idle') return;
    started.current = true;
    void begin(activityType);
  }, [activityType, begin, status]);

  useEffect(() => {
    if (!routeComplete || finished.current) return;
    if (status !== 'recording' && status !== 'paused') return;
    finished.current = true;
    void finish();
  }, [finish, routeComplete, status]);

  useEffect(() => {
    if (uploaded.current || status !== 'finished') return;
    uploaded.current = true;
    void uploadActivity();
  }, [status, uploadActivity]);

  useEffect(() => {
    if (reported.current) return;
    if (upload.status === 'done') {
      reported.current = true;
      onFinished({ summary: upload.summary, error: null });
    } else if (upload.status === 'error') {
      reported.current = true;
      onFinished({ summary: null, error: upload.message });
    }
  }, [onFinished, upload]);

  return null;
}

function LabE2eTrackingBody({ session, sandbox }: { session: LabE2eSession; sandbox: LabE2eSandbox }) {
  const recorder = useRecorderContext();
  const navigate = useNavigate();

  // A production TrackingScreen ugyanazt a `pendingType` állapotot használja,
  // mint a valódi Dock. Az E2E run a Scenario LAB-ban megadott típussal indul.
  useEffect(() => {
    if (recorder.state.status === 'idle') recorder.setPendingType(session.config.activityType);
  }, [recorder.setPendingType, recorder.state.status, session.config.activityType]);

  const upload = recorder.upload;

  /**
   * Az eredménypanel BEZÁRHATÓ — mert takarja a mentőlapot.
   *
   * A LAB-ban ugyanaz a mentés-űrlap fut, mint élesben, és azt is ki kell
   * tudni próbálni ugyanabban a futásban (Geri kérése, 2026-09-03). A számok
   * nem vesznek el: a bezárt panel helyén egy pirula marad, ami visszanyitja.
   * Új mentésnél magától megint kinyílik.
   */
  const [resultOpen, setResultOpen] = useState(true);
  useEffect(() => {
    if (upload.status === 'done') setResultOpen(true);
  }, [upload.status]);

  /**
   * A MENTÉS KIMENETELE ELŐRE BEÁLLÍTHATÓ.
   *
   * A rögzítés legkockázatosabb lépése a mentés, és pont azt volt eddig a
   * legnehezebb kipróbálni: a hosszú feldolgozáshoz több órás valódi
   * aktivitás kellett volna, a hibaághoz szerverhiba. A választó a NÖVEKVŐ
   * futás közben is átállítható, mert csak a mentés pillanatában olvassuk.
   */
  const [saveSim, setSaveSim] = useState<LabSaveSimulation>(DEFAULT_LAB_SAVE_SIMULATION);
  useEffect(() => {
    sandbox.setSaveSimulation(saveSim);
  }, [sandbox, saveSim]);

  return (
    <div className="lab-e2e" style={{ minHeight: '100dvh' }}>
      <TrackingScreen />

      {/*
        A JELVÉNY A BAL FELSŐ SAROKBAN — Geri kérése (2026-09-03).

        Középen a stat panel legfelső sorát takarta, és mivel ezeket a
        teszteket teljes képernyőn nézzük, pont a sebességet és a megtett
        távot fedte. A sarokban ugyanúgy látszik, hogy sandboxban vagyunk, de
        nem takar mérőszámot. A `--safe-top` a bevágásos készülékek miatt kell.
      */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(var(--safe-top, 0px) + 8px)',
          left: 8,
          zIndex: 10020,
          display: 'grid',
          gap: 1,
          maxWidth: 'calc(100vw - 16px)',
          padding: '6px 10px',
          borderRadius: 10,
          background: 'rgba(15, 10, 28, .92)',
          color: '#fff',
          boxShadow: '0 8px 28px rgba(0,0,0,.28)',
          pointerEvents: 'none',
          textAlign: 'left',
        }}
      >
        <strong style={{ fontSize: 10, letterSpacing: '.12em' }}>LAB / SANDBOX</strong>
        <span style={{ fontSize: 10, opacity: .78 }}>
          {session.scenarioName} · {session.phaseName} · {session.playerName} · {describePlaybackRate(session.playbackRate)}
        </span>
      </div>

      {/* A mentés-szimuláció választója a jelvény alatt — csak a rögzítés
          alatt és a mentés előtt van értelme, utána már lefutott. */}
      {upload.status === 'idle' || upload.status === 'sending' ? (
        <div className="lab-save-sim">
          <label className="lab-save-sim__label" htmlFor="lab-save-sim">Mentés</label>
          <select
            id="lab-save-sim"
            className="lab-save-sim__select"
            value={saveSim.mode}
            onChange={(event) => setSaveSim((current) => ({
              ...current,
              mode: event.target.value as LabSaveMode,
            }))}
          >
            <option value="instant">azonnali siker</option>
            <option value="slow">lassú siker</option>
            <option value="retryable_error">újrapróbálható hiba</option>
            <option value="final_error">végleges hiba</option>
            <option value="network_error">nincs kapcsolat</option>
          </select>
          {saveSim.mode === 'slow' || saveSim.mode === 'retryable_error' ? (
            <select
              className="lab-save-sim__select"
              value={saveSim.delayS}
              aria-label="A feldolgozás hossza"
              onChange={(event) => setSaveSim((current) => ({
                ...current,
                delayS: Number(event.target.value),
              }))}
            >
              <option value={5}>5 mp</option>
              <option value={12}>12 mp</option>
              <option value={30}>30 mp</option>
              <option value={90}>90 mp</option>
            </select>
          ) : null}
        </div>
      ) : null}

      {upload.status === 'done' && resultOpen ? (
        <div className="lab-result">
          <div className="lab-result__head">
            <div>
              <div className="lab-result__eyebrow">LAB RESULT</div>
              <strong style={{ fontSize: 18 }}>Sandbox commit kész</strong>
            </div>
            <button
              type="button"
              className="lab-result__close"
              onClick={() => setResultOpen(false)}
              aria-label="Eredmény bezárása, a mentőlap megnyitása"
            >
              ×
            </button>
          </div>
          <div className="lab-result__grid">
            <ResultStat label="Táv" value={`${(upload.summary.distanceM / 1000).toFixed(2)} km`} />
            <ResultStat label="Hurkok" value={String(upload.summary.loops)} />
            <ResultStat label="Claim" value={`${upload.summary.claimedCells} cella`} />
            <ResultStat label="Terület" value={`${Math.round(upload.summary.areaGainedM2)} m²`} />
            <ResultStat label="GP" value={String(upload.summary.gp)} />
            <ResultStat label="World" value="sandbox" />
          </div>
          <div className="lab-result__actions">
            <Button size="sm" onClick={() => navigate('/admin/lab/e2e')}>Másik teszt</Button>
            <Button size="sm" variant="secondary" onClick={() => void recorder.discard()}>Újra ezen a worldön</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                sandbox.reset();
                void recorder.discard();
              }}
            >
              Sandbox nullázása
            </Button>
          </div>
        </div>
      ) : null}

      {upload.status === 'done' && !resultOpen ? (
        <button
          type="button"
          className="lab-result-reopen"
          onClick={() => setResultOpen(true)}
        >
          LAB RESULT ↑
        </button>
      ) : null}

      {/* Az App az /admin útvonalon szándékosan nem rendereli a globális Dockot.
          Itt ugyanazt a production komponenst tesszük vissza a LAB recorder alá. */}
      <Dock />
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '9px 10px', borderRadius: 10, background: 'rgba(255,255,255,.06)' }}>
      <span style={{ display: 'block', fontSize: 10, opacity: .6 }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
