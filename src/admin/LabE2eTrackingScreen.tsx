import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui';
import { Dock } from '@/components/Dock';
import { RecorderProvider, useRecorderContext } from '@/hooks/RecorderProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { TrackingScreen } from '@/screens/TrackingScreen';
import { memoryStore } from '@/tracking/storage';
import {
  generateGpsActivity,
  SimulationPositionSource,
} from '@/tracking/simulationSource';
import { TrackingEnvironmentProvider } from '@/tracking/environment';
import { LabE2eSandbox } from './labE2eSandbox';
import { activateLabTileBridge } from './labE2eTileBridge';
import { labPlaybackRate, loadLabE2eSession, type LabE2eSession } from './labE2eSession';

export function LabE2eTrackingScreen() {
  const { sessionId = '' } = useParams();
  const session = useMemo(() => loadLabE2eSession(sessionId), [sessionId]);
  const profileUid = useProfile().profile?.uid ?? 'lab-admin';

  if (!session) return <Navigate to="/admin/lab/e2e" replace />;

  return <LabE2eTrackingRuntime key={session.id} session={session} profileUid={profileUid} />;
}

function LabE2eTrackingRuntime({ session, profileUid }: { session: LabE2eSession; profileUid: string }) {
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
  const sandbox = useMemo(
    () => new LabE2eSandbox({
      id: session.sandboxId,
      actorId: session.playerId,
      displayActorUid: profileUid,
      ownerNames,
    }),
    [ownerNames, profileUid, session.playerId, session.sandboxId],
  );

  /**
   * A bridge már a GYEREK renderje előtt aktív, ezért a TrackingScreen első
   * tile effectje sem tud production worldöt olvasni. A tokenes bridge a
   * StrictMode próbamountját is helyesen kezeli.
   */
  const [releaseTiles] = useState(() => activateLabTileBridge((layer, view) => sandbox.tiles(layer, view)));
  useEffect(() => releaseTiles, [releaseTiles]);

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
