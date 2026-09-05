import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createLabE2eSession } from './labE2eSession';
import { LabE2eTrackingRuntime, type LabAutopilot } from './LabE2eTrackingScreen';
import { findGameLoopScenario } from './gameLoopScenarios';
import { buildGameLoopReport, deliverGameLoopReport } from './gameLoopBridge';
import {
  readPerfSnapshot,
  resetPerfMeter,
  setPerfMeterEnabled,
} from '@/lib/perfMeter';
import { DEFAULT_CELL_COLOR } from '@/lib/cellColors';

/**
 * A FIREBASE TEST LAB GAME LOOP BELÉPŐJE.
 *
 * A Test Lab a `com.google.intent.action.TEST_LOOP` intenttel indítja az
 * appot, egyetlen `scenario` számot ad át, és a futás végét onnan ismeri fel,
 * hogy az activity bezárul. Ez a képernyő a JS oldali megfelelője: számot kap
 * az URL-ben, lefuttatja a hozzá tartozó menetet, és leadja az eredményt.
 *
 * ⚠️ EZ A KÉPERNYŐ A HITELESÍTÉSI KAPU ELŐTT VAN BEKÖTVE (`App.tsx`). A Test
 * Lab készülékén nincs bejelentkezett felhasználó és nincs admin szerep, tehát
 * az `AdminAccessGate` mögül sosem futna le. Cserébe a belépő csak a
 * `GRUNDO_GAMELOOP=1`-gyel készült buildben létezik.
 *
 * ⚠️ NEM HÍV PRODUCTION VÉGPONTOT. A `LabE2eSandbox` kizárólag a böngésző
 * memóriájába commitol, tehát a mérőfutás sem területet, sem GP-t nem tud
 * szerezni — a szimulált GPS itt nem csalás, mert nincs hova.
 */

type Phase = 'starting' | 'running' | 'done' | 'failed';

export function LabGameLoopScreen() {
  const [params] = useSearchParams();
  const scenarioNumber = Number(params.get('scenario') ?? '1');
  const entry = useMemo(() => findGameLoopScenario(scenarioNumber), [scenarioNumber]);

  const [phase, setPhase] = useState<Phase>('starting');
  const [message, setMessage] = useState('');
  const startedAt = useRef(Date.now());
  const delivered = useRef(false);

  /**
   * A MÉRŐ BEKAPCSOLÁSA A FUTÁS ELŐTT, NULLÁZVA.
   *
   * A `perfMeter` alapból ki van kapcsolva, és a bekapcsolt állapota a
   * `localStorage`-ban él. A Test Lab készüléke minden futás előtt tiszta, de
   * a böngészős próbánál egy korábbi menet adata benne maradna — a nullázás
   * ezt zárja ki. Enélkül a mért p95 két futás keveréke lenne.
   */
  useEffect(() => {
    setPerfMeterEnabled(true);
    resetPerfMeter();
  }, []);

  const report = useCallback(
    (outcome: { summary: Parameters<LabAutopilot['onFinished']>[0]['summary']; error: string | null }) => {
      if (delivered.current || !entry) return;
      delivered.current = true;

      const built = buildGameLoopReport({
        scenarioNumber: entry.number,
        scenarioKey: entry.key,
        scenarioName: entry.scenario.name,
        phaseName: entry.phaseId,
        playbackRate: entry.playbackRate,
        purpose: entry.purpose,
        startedAt: startedAt.current,
        finishedAt: Date.now(),
        summary: outcome.summary
          ? {
            distanceM: outcome.summary.distanceM,
            loops: outcome.summary.loops,
            claimedCells: outcome.summary.claimedCells,
            areaGainedM2: outcome.summary.areaGainedM2,
            gp: outcome.summary.gp,
          }
          : null,
        perf: readPerfSnapshot(),
        error: outcome.error,
      });

      deliverGameLoopReport(built);
      setPhase(outcome.error ? 'failed' : 'done');
      setMessage(outcome.error ?? '');
    },
    [entry],
  );

  const autopilot = useMemo<LabAutopilot>(() => ({ onFinished: report }), [report]);

  const session = useMemo(() => {
    if (!entry) return null;
    const phaseDef = entry.scenario.phases.find((item) => item.id === entry.phaseId)
      ?? entry.scenario.phases[0];
    const run = phaseDef?.runs[0];
    const player = entry.scenario.players.find((item) => item.id === run?.playerId)
      ?? entry.scenario.players[0];
    if (!phaseDef || !run || !player || run.route.length < 2) return null;

    return createLabE2eSession({
      sandboxId: `gameloop-${entry.key}`,
      scenarioName: entry.scenario.name,
      phaseId: phaseDef.id,
      phaseName: phaseDef.name,
      playerId: player.id,
      playerName: player.name,
      players: entry.scenario.players,
      route: run.route,
      config: run.config,
      playbackRate: entry.playbackRate,
    });
  }, [entry]);

  useEffect(() => {
    if (!entry) {
      setPhase('failed');
      setMessage(`Nincs ilyen scenario: ${scenarioNumber}`);
      return;
    }
    if (!session) {
      setPhase('failed');
      setMessage(`A(z) ${entry.key} scenario nyomvonala hiányos.`);
      return;
    }
    setPhase('running');
  }, [entry, scenarioNumber, session]);

  /**
   * A HIBÁS INDULÁS IS EREDMÉNY. Ha nincs scenario vagy nincs nyomvonal, a
   * natív oldalt akkor is értesíteni kell — különben a Test Lab a teljes
   * időkeretet kivárja, majd időtúllépéssel zár, és a naplóból nem derül ki,
   * hogy valójában egy elgépelt sorszám volt a baj.
   */
  useEffect(() => {
    if (phase !== 'failed' || delivered.current || (entry && session)) return;
    delivered.current = true;
    deliverGameLoopReport(buildGameLoopReport({
      scenarioNumber,
      scenarioKey: entry?.key ?? 'unknown',
      scenarioName: entry?.scenario.name ?? 'unknown',
      phaseName: entry?.phaseId ?? '',
      playbackRate: entry?.playbackRate ?? '1',
      purpose: entry?.purpose ?? '',
      startedAt: startedAt.current,
      finishedAt: Date.now(),
      summary: null,
      perf: readPerfSnapshot(),
      error: message || 'A futás el sem indult.',
    }));
  }, [entry, message, phase, scenarioNumber, session]);

  if (!entry || !session) {
    return <GameLoopNotice phase={phase} message={message} />;
  }

  return (
    <>
      <LabE2eTrackingRuntime
        key={session.id}
        session={session}
        profileUid="gameloop"
        myColor={DEFAULT_CELL_COLOR}
        autopilot={autopilot}
      />
      <GameLoopBadge scenarioKey={entry.key} phase={phase} message={message} />
    </>
  );
}

/**
 * A JELVÉNY A VIDEÓ MIATT VAN, NEM AZ EMBER MIATT.
 *
 * A Test Lab minden futásról videót készít. Ha a képernyőn ott a scenario
 * kulcsa és az állapot, akkor egy elszállt futás felvételéről ránézésre
 * eldönthető, hol tartott — anélkül, hogy a `logcat`-ot kellene átfésülni.
 */
function GameLoopBadge({
  scenarioKey,
  phase,
  message,
}: {
  scenarioKey: string;
  phase: Phase;
  message: string;
}) {
  return (
    <div
      data-testid="gameloop-badge"
      data-phase={phase}
      style={{
        position: 'fixed',
        bottom: 'calc(var(--safe-bottom, 0px) + 8px)',
        left: 8,
        zIndex: 10030,
        padding: '6px 10px',
        borderRadius: 10,
        background: 'rgba(15, 10, 28, .92)',
        color: '#fff',
        fontSize: 10,
        letterSpacing: '.08em',
        pointerEvents: 'none',
      }}
    >
      GAME LOOP · {scenarioKey} · {phase.toUpperCase()}
      {message ? ` · ${message}` : ''}
    </div>
  );
}

function GameLoopNotice({ phase, message }: { phase: Phase; message: string }) {
  return (
    <main style={{ padding: 24, display: 'grid', gap: 8 }} data-testid="gameloop-notice">
      <strong>GAME LOOP · {phase.toUpperCase()}</strong>
      <span style={{ opacity: .75 }}>{message}</span>
    </main>
  );
}
