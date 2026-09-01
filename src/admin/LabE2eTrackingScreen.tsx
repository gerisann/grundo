import { useEffect, useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
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
import { LabE2eSandbox } from './labE2eSandbox';
import { activateLabTileBridge, releaseLabTileBridge } from './labE2eTileBridge';
import { labPlaybackRate, loadLabE2eSession, type LabE2eSession } from './labE2eSession';

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

function LabE2eTrackingRuntime({
  session,
  profileUid,
  myColor,
}: {
  session: LabE2eSession;
  profileUid: string;
  myColor: string;
}) {
  const generated = useMemo(
    () => generateGpsActivity(session.route, { ...session.config, startAt: Date.now() }),
    [session],
  );
  const source = useMemo(
    () => new SimulationPositionSource(generated.samples, labPlaybackRate(session.playbackRate)),
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
    detail: `${session.scenarioName} · ${session.phaseName} · ${session.playerName} · ${session.playbackRate.toUpperCase()}×`,
    initialPosition: session.route[0] ? { lat: session.route[0].lat, lng: session.route[0].lng } : null,
    sharedPositionEnabled: false,
  }), [session]);

  return (
    <TrackingEnvironmentProvider value={environment}>
      <RecorderProvider
        source={source}
        options={{
          store,
          uploader: (input) => sandbox.upload(input),
          restoreSavedRun: false,
        }}
        cloudSync={false}
      >
        <LabE2eTrackingBody session={session} sandbox={sandbox} />
      </RecorderProvider>
    </TrackingEnvironmentProvider>
  );
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

  return (
    <div style={{ minHeight: '100dvh' }}>
      <TrackingScreen />

      <div
        style={{
          position: 'fixed',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10020,
          display: 'grid',
          gap: 2,
          maxWidth: 'calc(100vw - 24px)',
          padding: '9px 14px',
          borderRadius: 14,
          background: 'rgba(15, 10, 28, .92)',
          color: '#fff',
          boxShadow: '0 8px 28px rgba(0,0,0,.28)',
          pointerEvents: 'none',
          textAlign: 'center',
        }}
      >
        <strong style={{ fontSize: 12, letterSpacing: '.12em' }}>LAB / SANDBOX</strong>
        <span style={{ fontSize: 11, opacity: .78 }}>
          {session.scenarioName} · {session.phaseName} · {session.playerName} · {session.playbackRate === 'max' ? 'MAX' : `${session.playbackRate}×`}
        </span>
      </div>

      {upload.status === 'done' ? (
        <div
          style={{
            position: 'fixed',
            inset: 'auto 12px 92px',
            zIndex: 10030,
            margin: '0 auto',
            maxWidth: 520,
            padding: 18,
            borderRadius: 18,
            background: 'var(--bg-elevated, #17141d)',
            color: 'var(--text-primary, #fff)',
            boxShadow: '0 18px 60px rgba(0,0,0,.38)',
            display: 'grid',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.1em', opacity: .7 }}>LAB RESULT</div>
            <strong style={{ fontSize: 18 }}>Sandbox commit kész</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 13 }}>
            <ResultStat label="Táv" value={`${(upload.summary.distanceM / 1000).toFixed(2)} km`} />
            <ResultStat label="Hurkok" value={String(upload.summary.loops)} />
            <ResultStat label="Claim" value={`${upload.summary.claimedCells} cella`} />
            <ResultStat label="Terület" value={`${Math.round(upload.summary.areaGainedM2)} m²`} />
            <ResultStat label="GP" value={String(upload.summary.gp)} />
            <ResultStat label="World" value="sandbox" />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
