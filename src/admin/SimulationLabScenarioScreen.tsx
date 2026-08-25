import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ScreenHeader, SegmentedControl } from '@/components/ui';
import { DEFAULT_GAMEPLAY } from '@/config/gameplay';
import { IncrementalActivityGeometry, type ProcessResult } from '@/game';
import { formatGp } from '@/lib/format';
import {
  applySample,
  createRecorder,
  finish,
  start,
  type RecorderState,
} from '@/tracking/recorder';
import {
  DEFAULT_GPS_SIMULATION_CONFIG,
  generateGpsActivity,
  routeDistanceM,
  SimulationPositionSource,
  type GpsSimulationConfig,
  type SimulationWaypoint,
} from '@/tracking/simulationSource';
import type { ActivityType, OwnershipMap } from '@/types';
import {
  applyClaimToWorld,
  runLabScenarioAsync,
  type LabPhase,
  type LabPhaseOutcome,
  type LabPhaseRun,
  type LabPlayer,
  type LabScenarioOutcome,
  type LabScenarioProgress,
} from './labScenarioEngine';
import {
  processLabActivity,
  summarizeLabWorld,
  type LabWorldPlayerTotals,
} from './labHierarchicalWorld';
import { ScenarioSimulationMap, type LabMapTrack } from './ScenarioSimulationMap';
import './simulation-lab.css';
import './simulation-lab-scenario.css';

const STORAGE_KEY = 'grundo.lab.scenarios.v2';
const MAX_LIVE_ENGINE_FRAMES = 160;
const MAX_LIVE_TRACK_FRAMES = 480;
/** Ennél sűrűbben nem frissítjük az előkészítés haladásjelzőjét. */
const PREPARE_PROGRESS_INTERVAL_MS = 100;
const PLAYER_COLORS = ['#8b5cf6', '#22c55e', '#f97316', '#38bdf8', '#ef4444', '#eab308', '#ec4899', '#14b8a6', '#a3e635', '#f43f5e'];

type PlaybackRate = '1' | '10' | '100' | 'max';
type PhaseStatus = 'idle' | 'preparing' | 'running' | 'done' | 'error';

interface SavedScenario {
  id: string;
  name: string;
  savedAt: number;
  players: LabPlayer[];
  phases: LabPhase[];
  tieBreakSeed: number;
}

interface PhasePlayback {
  outcome: LabScenarioOutcome;
  phase: LabPhaseOutcome;
  baseWorld: OwnershipMap;
  simNow: number;
  simStart: number;
  simEnd: number;
}

export function SimulationLabScenarioScreen() {
  const initial = useMemo(() => createInitialScenario(), []);
  const [players, setPlayers] = useState<LabPlayer[]>(initial.players);
  const [phases, setPhases] = useState<LabPhase[]>(initial.phases);
  const [activePhaseId, setActivePhaseId] = useState(initial.phases[0]!.id);
  const [activePlayerId, setActivePlayerId] = useState(initial.players[0]!.id);
  const [tieBreakSeed, setTieBreakSeed] = useState(738291);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>('100');
  const [world, setWorld] = useState<OwnershipMap>(() => new Map());
  const [phasePlayback, setPhasePlayback] = useState<PhasePlayback | null>(null);
  const [phaseHistory, setPhaseHistory] = useState<LabPhaseOutcome[]>([]);
  const [phaseStatus, setPhaseStatus] = useState<PhaseStatus>('idle');
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [phaseComputeMs, setPhaseComputeMs] = useState<number | null>(null);
  const [phasePrepare, setPhasePrepare] = useState<LabScenarioProgress | null>(null);
  const phaseTimer = useRef<number | null>(null);
  const phaseWallStart = useRef(0);
  const phaseRunToken = useRef(0);

  const [soloRecorder, setSoloRecorder] = useState<RecorderState>(() => createRecorder('ride', 'lab-solo'));
  const [soloEngineRecorder, setSoloEngineRecorder] = useState<RecorderState>(() => createRecorder('ride', 'lab-solo-engine'));
  const [soloRunning, setSoloRunning] = useState(false);
  const [deliveredRawCount, setDeliveredRawCount] = useState(0);
  const [runResetToken, setRunResetToken] = useState(0);
  const soloSource = useRef<SimulationPositionSource | null>(null);
  const soloGeometry = useRef(new IncrementalActivityGeometry());

  const [showGrid, setShowGrid] = useState(false);
  const [showLoops, setShowLoops] = useState(true);
  const [showClaims, setShowClaims] = useState(true);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [scenarioName, setScenarioName] = useState('Scenario');
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>(() => loadScenarios());

  const activePhase = phases.find((phase) => phase.id === activePhaseId) ?? phases[0]!;
  const activeRun = activePhase.runs.find((run) => run.playerId === activePlayerId)
    ?? activePhase.runs[0]!;
  const activePlayer = players.find((player) => player.id === activePlayerId) ?? players[0]!;
  const activeColor = playerColor(players, activePlayerId);
  const config = activeRun.config;
  const route = activeRun.route;
  const generated = useMemo(() => generateGpsActivity(route, config), [route, config]);
  const engineStride = Math.max(1, Math.ceil(generated.samples.length / MAX_LIVE_ENGINE_FRAMES));
  const trackStride = Math.max(1, Math.ceil(generated.samples.length / MAX_LIVE_TRACK_FRAMES));

  // A `phasePlayback` objektum minden lejátszási frame-nél új példány. Ahol csak
  // az érdekes, hogy fut-e phase, ezt a boolean-t használjuk — így a rá épülő
  // memók nem értékelődnek újra frame-enként.
  const phaseActive = phasePlayback !== null;

  const soloVisibleRaw = useMemo(
    () => generated.samples.slice(0, Math.min(deliveredRawCount, generated.samples.length)),
    [generated.samples, deliveredRawCount],
  );

  /**
   * Solo („Player teszt") előnézet.
   *
   * A `processLabActivity` kell ide, nem a core `processActivityGeometry`: a
   * sandbox world vegyes felbontású, és a core csak exact res12 Mapet ért. Core
   * hívással egy res10 parentben álló birtok szabadnak látszana, nagy hurkot
   * pedig a compact guard eldobna — a preview némán eltűnne.
   *
   * Futó phase alatt az eredményt úgyis a commitolt run adja, ezért ilyenkor
   * hozzá sem kezdünk: a world a lejátszás alatt többször frissül, és ez a memo
   * különben minden frissítésre újraszámolná a teljes solo aktivitást.
   */
  const soloResult = useMemo<ProcessResult | null>(() => {
    if (phaseActive) return null;
    if (soloEngineRecorder.points.length < 2) return null;
    try {
      const geometry = soloGeometry.current.update(soloEngineRecorder.points);
      return processLabActivity({
        points: soloEngineRecorder.points,
        type: config.activityType,
        distanceKm: soloEngineRecorder.distanceM / 1000,
        actorId: activePlayerId,
        ownership: world,
        streakDays: 1,
        gpEarnedToday: 0,
      }, geometry);
    } catch (error) {
      console.warn('[GRUNDO LAB] Solo preview failed', error);
      return null;
    }
  }, [phaseActive, soloEngineRecorder.points, soloEngineRecorder.distanceM, config.activityType, activePlayerId, world]);

  const phaseTracks = useMemo<LabMapTrack[]>(() => {
    if (!phasePlayback) return [];
    return phasePlayback.phase.runs.map((run) => ({
      playerId: run.playerId,
      color: playerColor(players, run.playerId),
      raw: prefixByTime(run.generated.samples, phasePlayback.simNow),
      accepted: prefixByTime(run.recorder.points, phasePlayback.simNow),
    }));
  }, [phasePlayback, players]);

  const activeCommittedResult = useMemo<ProcessResult | null>(() => {
    if (!phasePlayback) return soloResult;
    const committed = phasePlayback.phase.runs
      .filter((run) => run.playerId === activePlayerId && run.finishedAt <= phasePlayback.simNow)
      .sort((a, b) => b.commitOrder - a.commitOrder)[0];
    return committed?.result ?? null;
  }, [phasePlayback, activePlayerId, soloResult]);

  /**
   * A térkép propjai memoizálva.
   *
   * A `ScenarioSimulationMap` forrásonként külön effektben frissít, de az
   * effektek referencia szerint hasonlítanak. Új tömb minden rendernél azt
   * jelentené, hogy egy billentyűleütés a GPS-mezőkben is újraépíti a teljes
   * world GeoJSON-t.
   */
  const soloTracks = useMemo<LabMapTrack[]>(
    () => [{ playerId: activePlayerId, color: activeColor, raw: soloVisibleRaw, accepted: soloRecorder.points }],
    [activePlayerId, activeColor, soloVisibleRaw, soloRecorder.points],
  );
  const visibleTracks = phaseActive ? phaseTracks : soloTracks;

  const mapRoutes = useMemo(
    () => activePhase.runs.map((run) => ({
      playerId: run.playerId,
      color: playerColor(players, run.playerId),
      route: run.route,
    })),
    [activePhase, players],
  );
  const ownerColors = useMemo(
    () => new Map(players.map((player, index) => [player.id, PLAYER_COLORS[index % PLAYER_COLORS.length]!])),
    [players],
  );

  // Minden player cellaszáma és védelmi bontása EGY world-bejárásból. Korábban
  // playerenként és védelmi szintenként külön futott, rendernként újra.
  const worldTotals = useMemo(() => summarizeLabWorld(world), [world]);
  // Birtok nélküli playernél is ki kell rajzolni mind a MAX_DEFENSE sort, nullával.
  const emptyTotals = useMemo<LabWorldPlayerTotals>(
    () => ({ cells: 0, byDefense: Array.from({ length: DEFAULT_GAMEPLAY.MAX_DEFENSE }, () => 0) }),
    [],
  );
  const activeTotals = worldTotals.get(activePlayerId) ?? emptyTotals;

  const phaseProgress = phasePlayback
    ? phasePlayback.simEnd <= phasePlayback.simStart
      ? 100
      : Math.max(0, Math.min(100, Math.round(
          ((phasePlayback.simNow - phasePlayback.simStart) / (phasePlayback.simEnd - phasePlayback.simStart)) * 100,
        )))
    : 0;
  const phaseBusy = phaseStatus === 'preparing' || phaseStatus === 'running';
  const busy = soloRunning || phaseBusy;
  const preparePlayerName = phasePrepare
    ? players.find((player) => player.id === phasePrepare.playerId)?.name ?? phasePrepare.playerId
    : null;

  useEffect(() => () => {
    void soloSource.current?.stop();
    if (phaseTimer.current !== null) window.clearInterval(phaseTimer.current);
  }, []);

  /**
   * Futó lejátszás lezárása a VÉGÁLLAPOTRA.
   *
   * A lejátszás vizuális: a timer a commitoknak csak azt a részét alkalmazta a
   * worldre, ami az addigi szimulált időben befejeződött. Ha megszakításkor
   * egyszerűen megállnánk, a sandbox world félig commitolt állapotban maradna,
   * és a következő phase már abból indulna — csendben, jelzés nélkül. Ezért a
   * megszakítás is a teljes `outcome.ownership`-et írja ki.
   *
   * @returns igaz, ha volt futó lejátszás, amit le kellett zárni.
   */
  function settleRunningPhase(): boolean {
    const playback = phasePlayback;
    if (phaseTimer.current === null || !playback) return false;
    stopPhaseTimer();
    setWorld(new Map(playback.outcome.ownership));
    setPhasePlayback({ ...playback, simNow: playback.simEnd });
    setPhaseHistory((history) => [...history, playback.phase]);
    setPhaseStatus('done');
    return true;
  }

  function invalidatePhasePreview() {
    settleRunningPhase();
    stopPhaseTimer();
    // Egy még futó, darabolt előkészítés eredménye ne kerüljön ki utólag.
    phaseRunToken.current += 1;
    setPhasePlayback(null);
    setPhaseStatus('idle');
    setPhaseError(null);
    setPhaseComputeMs(null);
    setPhasePrepare(null);
  }

  function updateActiveRun(mutator: (run: LabPhaseRun) => LabPhaseRun) {
    setPhases((current) => current.map((phase) => phase.id !== activePhaseId ? phase : {
      ...phase,
      runs: phase.runs.map((run) => run.playerId === activePlayerId ? mutator(run) : run),
    }));
    invalidatePhasePreview();
    resetSoloRun();
  }

  function setRoute(next: SimulationWaypoint[] | ((route: SimulationWaypoint[]) => SimulationWaypoint[])) {
    updateActiveRun((run) => ({
      ...run,
      route: typeof next === 'function' ? next(run.route) : next,
    }));
  }

  function setConfig<K extends keyof GpsSimulationConfig>(key: K, value: GpsSimulationConfig[K]) {
    updateActiveRun((run) => ({ ...run, config: { ...run.config, [key]: value } }));
  }

  function setStartOffset(seconds: number) {
    updateActiveRun((run) => ({ ...run, startOffsetMs: Math.max(0, seconds * 1000) }));
  }

  function switchPlayer(playerId: string) {
    stopPhasePlayback();
    resetSoloRun();
    setActivePlayerId(playerId);
  }

  function switchPhase(phaseId: string) {
    stopPhasePlayback();
    resetSoloRun();
    setActivePhaseId(phaseId);
    const phase = phases.find((item) => item.id === phaseId);
    if (phase && !phase.runs.some((run) => run.playerId === activePlayerId)) {
      setActivePlayerId(phase.runs[0]?.playerId ?? players[0]!.id);
    }
  }

  function addPlayer() {
    if (players.length >= 10) return;
    const index = players.length + 1;
    const player: LabPlayer = { id: `player-${Date.now()}`, name: `Player ${index}` };
    setPlayers((current) => [...current, player]);
    setPhases((current) => current.map((phase) => ({
      ...phase,
      runs: [...phase.runs, createRun(phase.id, player.id, index)],
    })));
    invalidatePhasePreview();
    setActivePlayerId(player.id);
    resetSoloRun();
  }

  function removeActivePlayer() {
    if (players.length <= 1) return;
    const removedId = activePlayerId;
    const remaining = players.filter((player) => player.id !== removedId);
    setPlayers(remaining);
    setPhases((current) => current.map((phase) => ({
      ...phase,
      runs: phase.runs.filter((run) => run.playerId !== removedId),
    })));

    /*
      Korábban ez `resetWorld()`-öt hívott, vagyis egy player törlése az EGÉSZ
      sandbox worldöt eldobta — figyelmeztetés nélkül, a többiek birtokával
      együtt. Elég a törölt player celláit felszabadítani; a többi player
      területe és védelme érintetlen marad.
    */
    setWorld((current) => {
      const next = new Map(current);
      for (const [cell, ownership] of current) {
        if (ownership.owner === removedId) next.delete(cell);
      }
      return next;
    });

    setActivePlayerId(remaining[0]!.id);
    invalidatePhasePreview();
    resetSoloRun();
  }

  function renameActivePlayer(name: string) {
    setPlayers((current) => current.map((player) => player.id === activePlayerId ? { ...player, name } : player));
  }

  function addPhase() {
    const id = `phase-${Date.now()}`;
    const previous = activePhase;
    const phase: LabPhase = {
      id,
      name: `Phase ${phases.length + 1}`,
      runs: players.map((player, index) => {
        const prev = previous.runs.find((run) => run.playerId === player.id);
        return {
          ...createRun(id, player.id, index + 1),
          config: prev ? { ...prev.config } : createConfig(index + 1),
        };
      }),
    };
    setPhases((current) => [...current, phase]);
    invalidatePhasePreview();
    setActivePhaseId(id);
    resetSoloRun();
  }

  function renameActivePhase(name: string) {
    setPhases((current) => current.map((phase) => phase.id === activePhaseId ? { ...phase, name } : phase));
  }

  async function runSolo() {
    await soloSource.current?.stop();
    if (generated.samples.length < 2 || phaseBusy) return;
    invalidatePhasePreview();
    soloGeometry.current.reset();
    setDeliveredRawCount(0);
    setRunResetToken((value) => value + 1);
    let current = start(createRecorder(config.activityType, `lab-${activePlayerId}-${Date.now()}`), generated.samples[0]!.t);
    setSoloRecorder(current);
    setSoloEngineRecorder(current);
    setSoloRunning(true);
    let delivered = 0;
    let lastEngine = 0;
    let lastTrack = 0;
    const rate = playbackRate === 'max' ? 0 : Number(playbackRate);
    const source = new SimulationPositionSource(generated.samples, rate, () => {
      current = finish(current, generated.samples.at(-1)?.t ?? Date.now());
      setDeliveredRawCount(generated.samples.length);
      setSoloRecorder(current);
      setSoloEngineRecorder(current);
      setSoloRunning(false);
    });
    soloSource.current = source;
    await source.start({
      onSample(sample) {
        delivered += 1;
        const before = current.points.length;
        current = applySample(current, sample);
        if (delivered - lastTrack >= trackStride) {
          lastTrack = delivered;
          setDeliveredRawCount(delivered);
          setSoloRecorder(current);
        }
        if (current.points.length > before && current.points.length - lastEngine >= engineStride) {
          lastEngine = current.points.length;
          setSoloEngineRecorder(current);
        }
      },
      onError(error) { console.error('[GRUNDO LAB] Simulation error', error); },
    }, config.activityType);
  }

  async function runPhase() {
    await soloSource.current?.stop();
    soloSource.current = null;
    setSoloRunning(false);
    stopPhaseTimer();

    const runs = activePhase.runs.filter((run) => run.route.length >= 2);
    if (runs.length === 0) {
      setPhaseStatus('error');
      setPhaseError('Ebben a phase-ben egyik playernek sincs legalább 2 pontos útvonala.');
      return;
    }

    const phase: LabPhase = { ...activePhase, runs };
    /*
      A phase-számítás mostantól darabolt és `await`-el, ezért közben a
      felhasználó tud kattintani (player-váltás, world nullázás, szerkesztés).
      A token azt biztosítja, hogy egy közben érvénytelenített futás eredménye
      már ne kerüljön ki a felületre.
    */
    const token = phaseRunToken.current + 1;
    phaseRunToken.current = token;
    const isStale = () => phaseRunToken.current !== token;

    setPhasePlayback(null);
    setPhaseError(null);
    setPhaseComputeMs(null);
    setPhasePrepare(null);
    setPhaseStatus('preparing');
    setRunResetToken((value) => value + 1);

    // Egy frame-et direkt visszaadunk a böngészőnek, hogy a „Phase
    // előkészítése…” állapot még a nehéz számítás előtt kirajzolódjon.
    await nextPaint();
    if (isStale()) return;

    let outcome: LabScenarioOutcome;
    const computeStarted = performance.now();
    try {
      let lastProgressAt = 0;
      outcome = await runLabScenarioAsync(
        { players, phases: [phase], tieBreakSeed },
        world,
        (progress) => {
          // A generátor sűrűn jelez. Minden jelzésből React render lenne,
          // percre pontos haladásra viszont itt semmi szükség.
          const now = performance.now();
          if (now - lastProgressAt < PREPARE_PROGRESS_INTERVAL_MS) return;
          lastProgressAt = now;
          if (!isStale()) setPhasePrepare(progress);
        },
      );
    } catch (error) {
      if (isStale()) return;
      const message = errorMessage(error);
      console.error('[GRUNDO LAB] Phase failed', error);
      setPhaseComputeMs(performance.now() - computeStarted);
      setPhasePrepare(null);
      setPhaseStatus('error');
      setPhaseError(message);
      return;
    }
    if (isStale()) return;
    setPhaseComputeMs(performance.now() - computeStarted);
    setPhasePrepare(null);

    const phaseOutcome = outcome.phases[0];
    if (!phaseOutcome) {
      setPhaseStatus('error');
      setPhaseError('A phase engine nem adott vissza phase eredményt.');
      return;
    }

    const simStart = phaseOutcome.startedAt;
    const simEnd = phaseOutcome.finishedAt;
    const playback: PhasePlayback = {
      outcome,
      phase: phaseOutcome,
      baseWorld: new Map(world),
      simNow: simStart,
      simStart,
      simEnd,
    };
    setPhasePlayback(playback);

    if (playbackRate === 'max' || simEnd <= simStart) {
      setWorld(new Map(outcome.ownership));
      setPhasePlayback({ ...playback, simNow: simEnd });
      setPhaseHistory((history) => [...history, phaseOutcome]);
      setPhaseStatus('done');
      return;
    }

    setPhaseStatus('running');
    phaseWallStart.current = performance.now();
    const rate = Number(playbackRate);
    let appliedCommits = 0;
    phaseTimer.current = window.setInterval(() => {
      const simNow = Math.min(simEnd, simStart + (performance.now() - phaseWallStart.current) * rate);

      /**
       * A world csak akkor változik, amikor egy újabb run BEFEJEZŐDÖTT.
       *
       * Korábban minden 50 ms-os frame újraépítette a teljes ownership Mapet, a
       * térkép pedig vele együtt a teljes world GeoJSON-t — akkor is, ha közben
       * egyetlen commit sem történt. Több tízezer cellás worldnél ez volt a
       * lejátszás alatti akadás fő oka.
       */
      const finished = phaseOutcome.runs.filter((item) => item.finishedAt <= simNow);
      if (finished.length !== appliedCommits) {
        appliedCommits = finished.length;
        const nextWorld = new Map(playback.baseWorld);
        for (const run of [...finished].sort((a, b) => a.commitOrder - b.commitOrder)) {
          applyClaimToWorld(nextWorld, run.result);
        }
        setWorld(nextWorld);
      }

      setPhasePlayback((current) => current ? { ...current, simNow } : current);
      if (simNow >= simEnd) {
        stopPhaseTimer();
        setWorld(new Map(outcome.ownership));
        setPhaseStatus('done');
        setPhaseHistory((history) => [...history, phaseOutcome]);
      }
    }, 50);
  }

  function stopPhaseTimer() {
    if (phaseTimer.current !== null) window.clearInterval(phaseTimer.current);
    phaseTimer.current = null;
  }

  function stopPhasePlayback() {
    if (settleRunningPhase()) return;
    stopPhaseTimer();
    setPhaseStatus((current) => current === 'preparing' ? 'idle' : current);
  }

  function resetSoloRun() {
    void soloSource.current?.stop();
    soloSource.current = null;
    soloGeometry.current.reset();
    setDeliveredRawCount(0);
    setRunResetToken((value) => value + 1);
    const clean = createRecorder(activeRun?.config.activityType ?? 'ride', 'lab-solo');
    setSoloRecorder(clean);
    setSoloEngineRecorder(clean);
    setSoloRunning(false);
  }

  function resetWorld() {
    stopPhaseTimer();
    phaseRunToken.current += 1;
    setWorld(new Map());
    setPhasePlayback(null);
    setPhaseHistory([]);
    setPhaseStatus('idle');
    setPhaseError(null);
    setPhaseComputeMs(null);
    setPhasePrepare(null);
    resetSoloRun();
  }

  function saveScenario() {
    const saved: SavedScenario = {
      id: `scenario-${Date.now()}`,
      name: scenarioName.trim() || `Scenario ${savedScenarios.length + 1}`,
      savedAt: Date.now(),
      players: clonePlayers(players),
      phases: clonePhases(phases),
      tieBreakSeed,
    };
    const next = [saved, ...savedScenarios].slice(0, 30);
    setSavedScenarios(next);
    persistScenarios(next);
  }

  function loadScenario(scenario: SavedScenario) {
    resetWorld();
    setScenarioName(scenario.name);
    setPlayers(clonePlayers(scenario.players));
    setPhases(clonePhases(scenario.phases));
    setTieBreakSeed(scenario.tieBreakSeed);
    setActivePhaseId(scenario.phases[0]!.id);
    setActivePlayerId(scenario.players[0]!.id);
  }

  const rejectedCount = Object.values(soloRecorder.rejected).reduce((sum, value) => sum + value, 0);
  const gameResult = activeCommittedResult;
  const claim = gameResult?.claim;
  const routeKm = routeDistanceM(route) / 1000;
  const newCells = (claim?.counts.free ?? 0) + (claim?.counts.stolen ?? 0);
  const ownedCells = activeTotals.cells;
  const defenseCounts = activeTotals.byDefense;
  const loopDiagnostics = gameResult?.diagnostics.loops;
  const shellClassName = ['lab-shell', !leftPanelOpen ? 'lab-shell--left-hidden' : '', !rightPanelOpen ? 'lab-shell--right-hidden' : ''].filter(Boolean).join(' ');

  return (
    <>
      <ScreenHeader title="Simulation LAB" backTo="/admin" />
      <div className={shellClassName}>
        <aside className="lab-panel lab-panel--controls" aria-hidden={!leftPanelOpen}>
          <section className="lab-section">
            <div className="lab-section__heading">
              <div><div className="lab-kicker">SANDBOX WORLD</div><h2>Scenario LAB</h2></div>
              <div className="lab-panel-head-actions"><span className="lab-badge">LOCAL ONLY</span><button type="button" className="lab-panel-collapse" onClick={() => setLeftPanelOpen(false)}>‹</button></div>
            </div>
            <p className="field__hint">A phase-ek közös sandbox worldben futnak. Normál activity API / production Firestore írás nincs.</p>
          </section>

          <section className="lab-section">
            <div className="lab-section__title">Phase-ek</div>
            <div className="lab-phase-tabs">
              {phases.map((phase, index) => <button key={phase.id} type="button" className={`lab-phase-tab${phase.id === activePhaseId ? ' lab-phase-tab--active' : ''}`} onClick={() => switchPhase(phase.id)}>{index + 1}</button>)}
              <button type="button" className="lab-phase-tab lab-phase-tab--add" onClick={addPhase}>+</button>
            </div>
            <input className="lab-input" value={activePhase.name} onChange={(event) => renameActivePhase(event.target.value)} aria-label="Phase neve" />
          </section>

          <section className="lab-section">
            <div className="lab-debug-card__head"><strong>Playerek</strong><span>{players.length}/10</span></div>
            <div className="lab-player-list">
              {players.map((player, index) => {
                const run = activePhase.runs.find((item) => item.playerId === player.id);
                return <button key={player.id} type="button" className={`lab-player${player.id === activePlayerId ? ' lab-player--active' : ''}`} onClick={() => switchPlayer(player.id)}>
                  <i style={{ background: PLAYER_COLORS[index % PLAYER_COLORS.length] }} />
                  <span><strong>{player.name}</strong><small>{run && run.route.length >= 2 ? `${(routeDistanceM(run.route) / 1000).toFixed(2)} km` : 'nincs útvonal'}</small></span>
                </button>;
              })}
            </div>
            <div className="lab-actions"><Button variant="secondary" size="sm" onClick={addPlayer} disabled={players.length >= 10 || busy}>+ Player</Button><Button variant="ghost" size="sm" onClick={removeActivePlayer} disabled={players.length <= 1 || busy}>Player törlése</Button></div>
            <input className="lab-input" value={activePlayer.name} onChange={(event) => renameActivePlayer(event.target.value)} aria-label="Player neve" disabled={busy} />
            <NumberField label="Start offset" value={(activeRun.startOffsetMs ?? 0) / 1000} min={0} max={86_400} step={1} suffix="s" onChange={setStartOffset} disabled={busy} />
          </section>

          <section className="lab-section">
            <SegmentedControl label="Mozgásforma" options={[{ value: 'walk', label: 'Séta' }, { value: 'run', label: 'Futás' }, { value: 'ride', label: 'Bringázás' }]} value={config.activityType} onChange={(value) => setConfig('activityType', value as ActivityType)} size="sm" block columns={3} />
            <NumberField label="Átlagsebesség" value={config.speedKmh} min={0.5} max={200} step={0.5} suffix="km/h" onChange={(value) => setConfig('speedKmh', value)} disabled={busy} />
            <NumberField label="Mintavétel" value={config.sampleIntervalS} min={0.1} max={60} step={0.1} suffix="s" onChange={(value) => setConfig('sampleIntervalS', value)} disabled={busy} />
          </section>

          <section className="lab-section"><div className="lab-section__title">GPS modell</div>
            <NumberField label="Jelentett pontosság" value={config.accuracyM} min={1} max={250} step={0.5} suffix="m" onChange={(value) => setConfig('accuracyM', value)} disabled={busy} />
            <NumberField label="Pillanatnyi zaj" value={config.noiseM} min={0} max={250} step={0.5} suffix="m" onChange={(value) => setConfig('noiseM', value)} disabled={busy} />
            <NumberField label="Lassú drift" value={config.driftM} min={0} max={50} step={0.1} suffix="m/minta" onChange={(value) => setConfig('driftM', value)} disabled={busy} />
            <NumberField label="Jelkimaradás" value={config.dropoutProbability * 100} min={0} max={95} step={0.1} suffix="%" onChange={(value) => setConfig('dropoutProbability', value / 100)} disabled={busy} />
            <NumberField label="GPS spike" value={config.spikeProbability * 100} min={0} max={50} step={0.1} suffix="%" onChange={(value) => setConfig('spikeProbability', value / 100)} disabled={busy} />
            <NumberField label="Seed" value={config.seed} min={1} max={2_147_483_647} step={1} onChange={(value) => setConfig('seed', Math.trunc(value))} disabled={busy} />
          </section>

          <section className="lab-section"><div className="lab-section__title">Lejátszás</div>
            <SegmentedControl label="Sebesség" options={[{ value: '1', label: '1×' }, { value: '10', label: '10×' }, { value: '100', label: '100×' }, { value: 'max', label: 'MAX' }]} value={playbackRate} onChange={setPlaybackRate} size="sm" block columns={4} />
            <div className="lab-actions">
              <Button onClick={() => void runSolo()} disabled={busy || generated.samples.length < 2}>Player teszt</Button>
              <Button onClick={() => void runPhase()} disabled={busy || !activePhase.runs.some((run) => run.route.length >= 2)}>{phaseButtonLabel(phaseStatus, phaseProgress)}</Button>
              <Button variant="secondary" onClick={resetSoloRun} disabled={phaseBusy}>Run reset</Button>
              <Button variant="secondary" onClick={resetWorld} disabled={phaseBusy}>World nullázása</Button>
            </div>
            <PhaseStatusPanel status={phaseStatus} progress={phaseProgress} error={phaseError} computeMs={phaseComputeMs} playback={phasePlayback} prepare={phasePrepare} playerName={preparePlayerName} />
          </section>

          <section className="lab-section"><div className="lab-section__title">Scenario mentés</div><input className="lab-input" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} /><Button variant="secondary" onClick={saveScenario} disabled={busy}>Scenario mentése</Button>
            {savedScenarios.slice(0, 6).map((scenario) => <button key={scenario.id} type="button" className="lab-scenario" onClick={() => loadScenario(scenario)} disabled={busy}><strong>{scenario.name}</strong><span>{scenario.players.length} player · {scenario.phases.length} phase</span></button>)}
          </section>
        </aside>

        <main className="lab-workspace">
          <div className="lab-mapbar"><div><strong>{activePhase.name} · {activePlayer.name}</strong><span>{phaseBusy ? `Phase ${phaseStatus === 'preparing' ? 'előkészítése' : `fut · ${phaseProgress}%`}` : 'Az aktív player pontjai húzhatók; a többi route referencia.'}</span></div><div className="lab-mapbar__actions">
            {!leftPanelOpen ? <Button variant="secondary" size="sm" onClick={() => setLeftPanelOpen(true)}>Beállítások ›</Button> : null}
            {!rightPanelOpen ? <Button variant="secondary" size="sm" onClick={() => setRightPanelOpen(true)}>‹ Debug</Button> : null}
            <div className="lab-layer-controls"><LayerToggle label="H3 háló" checked={showGrid} onChange={setShowGrid} /><LayerToggle label="Hurkok" checked={showLoops} onChange={setShowLoops} /><LayerToggle label="Foglalás" checked={showClaims} onChange={setShowClaims} /></div>
            <Button variant="secondary" size="sm" disabled={busy || route.length === 0} onClick={() => setRoute((points) => points.slice(0, -1))}>Utolsó törlése</Button><Button variant="secondary" size="sm" disabled={busy || route.length === 0} onClick={() => setRoute([])}>Útvonal törlése</Button>
          </div></div>
          <ScenarioSimulationMap activeRoute={route} activeColor={activeColor} routes={mapRoutes} tracks={visibleTracks} world={world} ownerColors={ownerColors} result={gameResult} showGrid={showGrid} showLoops={showLoops} showClaims={showClaims} resetToken={runResetToken} editable={!busy} onAppendWaypoint={(point) => setRoute((points) => [...points, point])} onMoveWaypoint={(index, point) => setRoute((points) => points.map((item, i) => i === index ? point : item))} />
        </main>

        <aside className="lab-panel lab-panel--debug" aria-hidden={!rightPanelOpen}>
          <section className="lab-side-header"><div><div className="lab-kicker">LIVE DEBUG</div><h2>World / Phase</h2></div><button type="button" className="lab-panel-collapse" onClick={() => setRightPanelOpen(false)}>›</button></section>
          <section className="lab-side-section"><div className="lab-section__title">Phase állapot</div><PhaseStatusPanel status={phaseStatus} progress={phaseProgress} error={phaseError} computeMs={phaseComputeMs} playback={phasePlayback} prepare={phasePrepare} playerName={preparePlayerName} compact />{phasePlayback ? <div className="lab-phase-runs">{phasePlayback.phase.runs.map((run) => { const player = players.find((item) => item.id === run.playerId); const state = phaseRunState(run, phasePlayback.simNow); return <div key={run.runId} className={`lab-phase-run lab-phase-run--${state}`}><i style={{ background: playerColor(players, run.playerId) }} /><strong>{player?.name ?? run.playerId}</strong><span>{phaseRunStateLabel(state)}</span></div>; })}</div> : null}</section>
          <section className="lab-side-section"><div className="lab-section__title">World</div><div className="lab-world-list">{players.map((player, index) => <div key={player.id}><i style={{ background: PLAYER_COLORS[index % PLAYER_COLORS.length] }} /><strong>{player.name}</strong><span>{worldTotals.get(player.id)?.cells ?? 0} cella</span></div>)}</div></section>
          <section className="lab-side-section"><div className="lab-section__title">Aktív player</div><div className="lab-stats"><Stat label="Útvonal" value={`${routeKm.toFixed(2)} km`} /><Stat label="GPS minták" value={String(generated.samples.length)} /><Stat label="Recorder táv" value={`${(soloRecorder.distanceM / 1000).toFixed(2)} km`} /><Stat label="Bezárások" value={String(gameResult?.loops.length ?? 0)} /><Stat label="Új / lopott" value={String(newCells)} /><Stat label="Lopott" value={String(claim?.counts.stolen ?? 0)} /><Stat label="Áttörés" value={String(claim?.counts.breakthrough ?? 0)} /><Stat label="GP" value={formatGp(gameResult?.gp.total ?? 0)} /></div></section>
          <section className="lab-side-section"><div className="lab-debug-card__head"><strong>Védelmi szint</strong><span>{ownedCells} saját cella</span></div><div className="lab-defense-counts">{defenseCounts.map((count, index) => <div key={index}><i className={`lab-defense lab-defense--${index + 1}`}>{index + 1}</i><span>{count} cella</span></div>)}</div></section>
          <section className="lab-side-section lab-side-section--loops"><div className="lab-debug-card__head"><strong>Hurokdiagnosztika</strong><span>{loopDiagnostics?.successful.length ?? 0} / {loopDiagnostics?.rejected.length ?? 0}</span></div><div className="lab-loop-list">{loopDiagnostics?.successful.map((item, index) => <div key={`ok-${index}`} className="lab-loop-row lab-loop-row--ok"><strong>#{index + 1} ELFOGADVA</strong><span>{item.fromIndex}→{item.toIndex}</span><span>fal {item.wallCells}</span><span>belső {item.interiorCells}</span></div>)}{loopDiagnostics?.rejected.map((item, index) => <div key={`bad-${index}`} className="lab-loop-row lab-loop-row--bad"><strong>ELUTASÍTVA</strong><span>{item.reason}</span><span>{item.fromIndex}→{item.toIndex}</span></div>)}</div></section>
          <section className="lab-side-section"><div className="lab-debug-card__head"><strong>Phase commitok</strong><span>{phaseHistory.length} lefutott</span></div><div className="lab-event-list">{[...phaseHistory].reverse().flatMap((phase) => phase.runs.map((run) => { const player = players.find((item) => item.id === run.playerId); return <div key={`${phase.phaseId}-${run.runId}-${run.commitOrder}`} className="lab-event"><strong>{phase.name} · {player?.name ?? run.playerId}</strong><span>commit #{run.commitOrder + 1} · {run.result.loops.length} hurok</span><span>+{run.result.claim?.counts.free ?? 0} free · {run.result.claim?.counts.stolen ?? 0} stolen · {run.result.claim?.counts.breakthrough ?? 0} breakthrough</span></div>; }))}</div></section>
          {rejectedCount > 0 ? <section className="lab-side-section lab-diagnostics"><strong>GPS filter:</strong>{Object.entries(soloRecorder.rejected).map(([reason, count]) => <span key={reason}>{reason}: <strong>{count}</strong></span>)}</section> : null}
        </aside>
      </div>
    </>
  );
}

function createInitialScenario(): { players: LabPlayer[]; phases: LabPhase[] } {
  const player: LabPlayer = { id: 'player-1', name: 'Player 1' };
  const phase: LabPhase = { id: 'phase-1', name: 'Phase 1', runs: [createRun('phase-1', player.id, 1)] };
  return { players: [player], phases: [phase] };
}

function createRun(phaseId: string, playerId: string, index: number): LabPhaseRun {
  return { id: `${phaseId}-${playerId}`, playerId, route: [], config: createConfig(index), startOffsetMs: 0 };
}

function createConfig(index: number): GpsSimulationConfig {
  return { ...DEFAULT_GPS_SIMULATION_CONFIG, seed: DEFAULT_GPS_SIMULATION_CONFIG.seed + index - 1 };
}

function playerColor(players: readonly LabPlayer[], playerId: string): string {
  const index = Math.max(0, players.findIndex((player) => player.id === playerId));
  return PLAYER_COLORS[index % PLAYER_COLORS.length]!;
}

function prefixByTime<T extends { t: number }>(items: readonly T[], time: number): T[] {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid]!.t <= time) low = mid + 1;
    else high = mid;
  }
  return items.slice(0, low);
}

function clonePlayers(players: readonly LabPlayer[]): LabPlayer[] {
  return players.map((player) => ({ ...player }));
}

function clonePhases(phases: readonly LabPhase[]): LabPhase[] {
  return phases.map((phase) => ({
    ...phase,
    runs: phase.runs.map((run) => ({
      ...run,
      route: run.route.map((point) => ({ ...point })),
      config: { ...run.config },
    })),
  }));
}

function loadScenarios(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as SavedScenario[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistScenarios(items: SavedScenario[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* local-only convenience */
  }
}

/**
 * Egy kirajzolásnyi szünet, hogy a „Phase előkészítése…" állapot még a nehéz
 * szinkron számítás előtt látszódjon.
 *
 * ⚠️ A `requestAnimationFrame` HÁTTÉRBE TETT LAPON NEM TÜZEL. Önmagában
 * használva a phase sosem indult el, ha a felhasználó indítás után átváltott
 * másik böngészőlapra — a gomb örökre „Phase előkészítése…" maradt. A timeout
 * ezért nem kényelmi tartalék, hanem kilépési út.
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => window.setTimeout(done, 0));
    window.setTimeout(done, 250);
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Ismeretlen phase feldolgozási hiba.';
}

function phaseButtonLabel(status: PhaseStatus, progress: number): string {
  if (status === 'preparing') return 'Phase előkészítése…';
  if (status === 'running') return `Phase fut · ${progress}%`;
  if (status === 'error') return 'Phase újrapróbálása';
  if (status === 'done') return 'Phase újraindítása';
  return 'Phase indítása';
}

function phaseStatusLabel(status: PhaseStatus): string {
  if (status === 'preparing') return 'Előkészítés';
  if (status === 'running') return 'Fut';
  if (status === 'done') return 'Kész';
  if (status === 'error') return 'Hiba';
  return 'Készen áll';
}

function phaseRunState(run: LabPhaseOutcome['runs'][number], simNow: number): 'waiting' | 'recording' | 'committed' {
  if (simNow < run.startedAt) return 'waiting';
  if (simNow < run.finishedAt) return 'recording';
  return 'committed';
}

function phaseRunStateLabel(state: 'waiting' | 'recording' | 'committed'): string {
  if (state === 'waiting') return 'vár indulásra';
  if (state === 'recording') return 'rögzít';
  return 'commit kész';
}

function formatMs(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Az előkészítés durva haladása: playerenként két szakasz, rögzítés és commit. */
function preparePercent(prepare: LabScenarioProgress | null): number {
  if (!prepare || prepare.runCount === 0) return 12;
  const done = prepare.stage === 'recording'
    ? prepare.runIndex
    : prepare.runCount + prepare.runIndex;
  return Math.max(6, Math.min(96, Math.round((done / (prepare.runCount * 2)) * 100)));
}

function PhaseStatusPanel({
  status,
  progress,
  error,
  computeMs,
  playback,
  prepare,
  playerName,
  compact = false,
}: {
  status: PhaseStatus;
  progress: number;
  error: string | null;
  computeMs: number | null;
  playback: PhasePlayback | null;
  prepare: LabScenarioProgress | null;
  playerName: string | null;
  compact?: boolean;
}) {
  if (status === 'idle' && !playback && !error) return null;
  const preparing = status === 'preparing';
  const barWidth = preparing ? preparePercent(prepare) : progress;
  return (
    <div className={`lab-phase-status lab-phase-status--${status}${compact ? ' lab-phase-status--compact' : ''}`} role="status" aria-live="polite">
      <div className="lab-phase-status__head">
        <strong>{phaseStatusLabel(status)}</strong>
        <span>{preparing ? `${barWidth}%` : `${progress}%`}</span>
      </div>
      <div className="lab-phase-progress" aria-hidden="true"><i style={{ width: `${barWidth}%` }} /></div>
      {preparing ? (
        <small>
          {prepare
            ? `${playerName ?? prepare.playerId} · ${prepare.stage === 'recording' ? 'GPS rögzítés' : 'terület elszámolás'} (${prepare.runIndex + 1}/${prepare.runCount})`
            : 'engine számítás…'}
        </small>
      ) : null}
      {error ? <p className="lab-phase-error">{error}</p> : null}
      {!error && computeMs !== null ? <small>Engine előkészítés: {formatMs(computeMs)}</small> : null}
      {!error && playback ? <small>Szimulált idő: {formatMs(Math.max(0, playback.simNow - playback.simStart))} / {formatMs(Math.max(0, playback.simEnd - playback.simStart))}</small> : null}
    </div>
  );
}

function LayerToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className={`lab-layer-toggle${checked ? ' lab-layer-toggle--on' : ''}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

/**
 * Számmező helyi vázlatállapottal.
 *
 * Két hibát old meg egyszerre:
 *
 * 1. Vezérelt mezőként a kiürítés `Number('') === 0`-ra fordult, tehát a mezőt
 *    nem lehetett letörölni, hogy új értéket írjunk bele — a 0 azonnal
 *    visszaugrott.
 * 2. Minden billentyűleütés azonnal a scenario-állapotba ment, ami
 *    érvényteleníti a phase previewt és nullázza a futást. Gépelés közben
 *    elszállt az eredmény, és minden leütés újragenerálta a teljes GPS-sort.
 *
 * Ezért a gépelés csak a vázlatot írja; az érték elhagyáskor vagy Enterre
 * kerül be, `min`/`max` közé klampolva. Escape eldobja a vázlatot. Klampolni
 * azért kell itt is, mert eddig csak a generátor `normalizeConfig`-ja vágta le
 * a tartományon kívüli értéket — a mező mást mutatott, mint amivel a
 * szimuláció ténylegesen számolt.
 */
function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange(value: number): void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(raw: string) {
    setDraft(null);
    const parsed = Number(raw);
    // Üres vagy értelmezhetetlen bevitel: marad a korábbi érték.
    if (raw.trim() === '' || !Number.isFinite(parsed)) return;
    const clamped = Math.min(max, Math.max(min, parsed));
    if (clamped !== value) onChange(clamped);
  }

  return (
    <label className="lab-number">
      <span>{label}</span>
      <span className="lab-number__control">
        <input
          type="number"
          value={draft ?? String(value)}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
        {suffix ? <small>{suffix}</small> : null}
      </span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="lab-stat"><span>{label}</span><strong>{value}</strong></div>;
}
