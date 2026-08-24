import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ScreenHeader, SegmentedControl } from '@/components/ui';
import { IncrementalActivityGeometry, processActivityGeometry, type ProcessResult } from '@/game';
import { formatArea, formatGp } from '@/lib/format';
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
  countPlayerCells,
  countPlayerDefense,
  runLabScenario,
  type LabPhase,
  type LabPhaseOutcome,
  type LabPhaseRun,
  type LabPlayer,
  type LabScenarioOutcome,
} from './labScenarioEngine';
import { ScenarioSimulationMap, type LabMapTrack } from './ScenarioSimulationMap';
import './simulation-lab.css';
import './simulation-lab-scenario.css';

const STORAGE_KEY = 'grundo.lab.scenarios.v2';
const MAX_LIVE_ENGINE_FRAMES = 160;
const MAX_LIVE_TRACK_FRAMES = 480;
const PLAYER_COLORS = ['#8b5cf6', '#22c55e', '#f97316', '#38bdf8', '#ef4444', '#eab308', '#ec4899', '#14b8a6', '#a3e635', '#f43f5e'];

type PlaybackRate = '1' | '10' | '100' | 'max';

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
  const [phaseRunning, setPhaseRunning] = useState(false);
  const phaseTimer = useRef<number | null>(null);
  const phaseWallStart = useRef(0);

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

  const soloVisibleRaw = useMemo(
    () => generated.samples.slice(0, Math.min(deliveredRawCount, generated.samples.length)),
    [generated.samples, deliveredRawCount],
  );

  const soloResult = useMemo<ProcessResult | null>(() => {
    if (soloEngineRecorder.points.length < 2) return null;
    try {
      const geometry = soloGeometry.current.update(soloEngineRecorder.points);
      return processActivityGeometry({
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
  }, [soloEngineRecorder.points, soloEngineRecorder.distanceM, config.activityType, activePlayerId, world]);

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

  const visibleTracks = phasePlayback
    ? phaseTracks
    : [{ playerId: activePlayerId, color: activeColor, raw: soloVisibleRaw, accepted: soloRecorder.points }];

  const mapRoutes = activePhase.runs.map((run) => ({
    playerId: run.playerId,
    color: playerColor(players, run.playerId),
    route: run.route,
  }));
  const ownerColors = useMemo(() => new Map(players.map((player, index) => [player.id, PLAYER_COLORS[index % PLAYER_COLORS.length]!])), [players]);

  useEffect(() => () => {
    void soloSource.current?.stop();
    if (phaseTimer.current !== null) window.clearInterval(phaseTimer.current);
  }, []);

  function updateActiveRun(mutator: (run: LabPhaseRun) => LabPhaseRun) {
    setPhases((current) => current.map((phase) => phase.id !== activePhaseId ? phase : {
      ...phase,
      runs: phase.runs.map((run) => run.playerId === activePlayerId ? mutator(run) : run),
    }));
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
    setActivePlayerId(player.id);
    resetSoloRun();
  }

  function removeActivePlayer() {
    if (players.length <= 1) return;
    const remaining = players.filter((player) => player.id !== activePlayerId);
    setPlayers(remaining);
    setPhases((current) => current.map((phase) => ({
      ...phase,
      runs: phase.runs.filter((run) => run.playerId !== activePlayerId),
    })));
    setActivePlayerId(remaining[0]!.id);
    resetWorld();
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
    setActivePhaseId(id);
    resetSoloRun();
  }

  function renameActivePhase(name: string) {
    setPhases((current) => current.map((phase) => phase.id === activePhaseId ? { ...phase, name } : phase));
  }

  async function runSolo() {
    await soloSource.current?.stop();
    if (generated.samples.length < 2 || phaseRunning) return;
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
    stopPhasePlayback();
    const runs = activePhase.runs.filter((run) => run.route.length >= 2);
    if (runs.length === 0) return;
    const phase: LabPhase = { ...activePhase, runs };
    let outcome: LabScenarioOutcome;
    try {
      outcome = runLabScenario({ players, phases: [phase], tieBreakSeed }, world);
    } catch (error) {
      console.error('[GRUNDO LAB] Phase failed', error);
      return;
    }
    const phaseOutcome = outcome.phases[0]!;
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
    setRunResetToken((value) => value + 1);
    setPhasePlayback(playback);
    if (playbackRate === 'max' || simEnd <= simStart) {
      setWorld(new Map(outcome.ownership));
      setPhasePlayback({ ...playback, simNow: simEnd });
      setPhaseHistory((history) => [...history, phaseOutcome]);
      return;
    }
    setPhaseRunning(true);
    phaseWallStart.current = performance.now();
    const rate = Number(playbackRate);
    phaseTimer.current = window.setInterval(() => {
      const simNow = Math.min(simEnd, simStart + (performance.now() - phaseWallStart.current) * rate);
      const nextWorld = new Map(playback.baseWorld);
      for (const run of phaseOutcome.runs
        .filter((item) => item.finishedAt <= simNow)
        .sort((a, b) => a.commitOrder - b.commitOrder)) {
        applyClaimToWorld(nextWorld, run.result);
      }
      setWorld(nextWorld);
      setPhasePlayback((current) => current ? { ...current, simNow } : current);
      if (simNow >= simEnd) {
        stopPhaseTimer();
        setWorld(new Map(outcome.ownership));
        setPhaseRunning(false);
        setPhaseHistory((history) => [...history, phaseOutcome]);
      }
    }, 50);
  }

  function stopPhaseTimer() {
    if (phaseTimer.current !== null) window.clearInterval(phaseTimer.current);
    phaseTimer.current = null;
  }

  function stopPhasePlayback() {
    stopPhaseTimer();
    setPhaseRunning(false);
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
    stopPhasePlayback();
    setWorld(new Map());
    setPhasePlayback(null);
    setPhaseHistory([]);
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
  const ownedCells = countPlayerCells(world, activePlayerId);
  const defenseCounts = [1, 2, 3, 4, 5].map((defense) => countPlayerDefense(world, activePlayerId, defense));
  const loopDiagnostics = gameResult?.diagnostics.loops;
  const shellClassName = ['lab-shell', !leftPanelOpen ? 'lab-shell--left-hidden' : '', !rightPanelOpen ? 'lab-shell--right-hidden' : ''].filter(Boolean).join(' ');
  const busy = soloRunning || phaseRunning;

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
            <div className="lab-actions"><Button variant="secondary" size="sm" onClick={addPlayer} disabled={players.length >= 10}>+ Player</Button><Button variant="ghost" size="sm" onClick={removeActivePlayer} disabled={players.length <= 1}>Player törlése</Button></div>
            <input className="lab-input" value={activePlayer.name} onChange={(event) => renameActivePlayer(event.target.value)} aria-label="Player neve" />
            <NumberField label="Start offset" value={(activeRun.startOffsetMs ?? 0) / 1000} min={0} max={86_400} step={1} suffix="s" onChange={setStartOffset} />
          </section>

          <section className="lab-section">
            <SegmentedControl label="Mozgásforma" options={[{ value: 'walk', label: 'Séta' }, { value: 'run', label: 'Futás' }, { value: 'ride', label: 'Bringázás' }]} value={config.activityType} onChange={(value) => setConfig('activityType', value as ActivityType)} size="sm" block columns={3} />
            <NumberField label="Átlagsebesség" value={config.speedKmh} min={0.5} max={200} step={0.5} suffix="km/h" onChange={(value) => setConfig('speedKmh', value)} />
            <NumberField label="Mintavétel" value={config.sampleIntervalS} min={0.1} max={60} step={0.1} suffix="s" onChange={(value) => setConfig('sampleIntervalS', value)} />
          </section>

          <section className="lab-section"><div className="lab-section__title">GPS modell</div>
            <NumberField label="Jelentett pontosság" value={config.accuracyM} min={1} max={250} step={0.5} suffix="m" onChange={(value) => setConfig('accuracyM', value)} />
            <NumberField label="Pillanatnyi zaj" value={config.noiseM} min={0} max={250} step={0.5} suffix="m" onChange={(value) => setConfig('noiseM', value)} />
            <NumberField label="Lassú drift" value={config.driftM} min={0} max={50} step={0.1} suffix="m/minta" onChange={(value) => setConfig('driftM', value)} />
            <NumberField label="Jelkimaradás" value={config.dropoutProbability * 100} min={0} max={95} step={0.1} suffix="%" onChange={(value) => setConfig('dropoutProbability', value / 100)} />
            <NumberField label="GPS spike" value={config.spikeProbability * 100} min={0} max={50} step={0.1} suffix="%" onChange={(value) => setConfig('spikeProbability', value / 100)} />
            <NumberField label="Seed" value={config.seed} min={1} max={2_147_483_647} step={1} onChange={(value) => setConfig('seed', Math.trunc(value))} />
          </section>

          <section className="lab-section"><div className="lab-section__title">Lejátszás</div>
            <SegmentedControl label="Sebesség" options={[{ value: '1', label: '1×' }, { value: '10', label: '10×' }, { value: '100', label: '100×' }, { value: 'max', label: 'MAX' }]} value={playbackRate} onChange={setPlaybackRate} size="sm" block columns={4} />
            <div className="lab-actions"><Button onClick={() => void runSolo()} disabled={busy || generated.samples.length < 2}>Aktív player</Button><Button onClick={() => void runPhase()} disabled={busy || !activePhase.runs.some((run) => run.route.length >= 2)}>Phase indítása</Button><Button variant="secondary" onClick={resetSoloRun}>Run reset</Button><Button variant="secondary" onClick={resetWorld}>World nullázása</Button></div>
          </section>

          <section className="lab-section"><div className="lab-section__title">Scenario mentés</div><input className="lab-input" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} /><Button variant="secondary" onClick={saveScenario}>Scenario mentése</Button>
            {savedScenarios.slice(0, 6).map((scenario) => <button key={scenario.id} type="button" className="lab-scenario" onClick={() => loadScenario(scenario)}><strong>{scenario.name}</strong><span>{scenario.players.length} player · {scenario.phases.length} phase</span></button>)}
          </section>
        </aside>

        <main className="lab-workspace">
          <div className="lab-mapbar"><div><strong>{activePhase.name} · {activePlayer.name}</strong><span>Az aktív player pontjai húzhatók; a többi route referencia.</span></div><div className="lab-mapbar__actions">
            {!leftPanelOpen ? <Button variant="secondary" size="sm" onClick={() => setLeftPanelOpen(true)}>Beállítások ›</Button> : null}
            {!rightPanelOpen ? <Button variant="secondary" size="sm" onClick={() => setRightPanelOpen(true)}>‹ Debug</Button> : null}
            <div className="lab-layer-controls"><LayerToggle label="H3 háló" checked={showGrid} onChange={setShowGrid} /><LayerToggle label="Hurkok" checked={showLoops} onChange={setShowLoops} /><LayerToggle label="Foglalás" checked={showClaims} onChange={setShowClaims} /></div>
            <Button variant="secondary" size="sm" disabled={busy || route.length === 0} onClick={() => setRoute((points) => points.slice(0, -1))}>Utolsó törlése</Button><Button variant="secondary" size="sm" disabled={busy || route.length === 0} onClick={() => setRoute([])}>Útvonal törlése</Button>
          </div></div>
          <ScenarioSimulationMap activeRoute={route} activeColor={activeColor} routes={mapRoutes} tracks={visibleTracks} world={world} ownerColors={ownerColors} result={gameResult} showGrid={showGrid} showLoops={showLoops} showClaims={showClaims} resetToken={runResetToken} editable={!busy} onAppendWaypoint={(point) => setRoute((points) => [...points, point])} onMoveWaypoint={(index, point) => setRoute((points) => points.map((item, i) => i === index ? point : item))} />
        </main>

        <aside className="lab-panel lab-panel--debug" aria-hidden={!rightPanelOpen}>
          <section className="lab-side-header"><div><div className="lab-kicker">LIVE DEBUG</div><h2>World / Phase</h2></div><button type="button" className="lab-panel-collapse" onClick={() => setRightPanelOpen(false)}>›</button></section>
          <section className="lab-side-section"><div className="lab-section__title">World</div><div className="lab-world-list">{players.map((player, index) => <div key={player.id}><i style={{ background: PLAYER_COLORS[index % PLAYER_COLORS.length] }} /><strong>{player.name}</strong><span>{countPlayerCells(world, player.id)} cella</span></div>)}</div></section>
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
  let low = 0; let high = items.length;
  while (low < high) { const mid = (low + high) >>> 1; if (items[mid]!.t <= time) low = mid + 1; else high = mid; }
  return items.slice(0, low);
}
function clonePlayers(players: readonly LabPlayer[]): LabPlayer[] { return players.map((player) => ({ ...player })); }
function clonePhases(phases: readonly LabPhase[]): LabPhase[] { return phases.map((phase) => ({ ...phase, runs: phase.runs.map((run) => ({ ...run, route: run.route.map((point) => ({ ...point })), config: { ...run.config } })) })); }
function loadScenarios(): SavedScenario[] { try { const raw = localStorage.getItem(STORAGE_KEY); const parsed = raw ? JSON.parse(raw) as SavedScenario[] : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function persistScenarios(items: SavedScenario[]) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* local-only convenience */ } }

function LayerToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) { return <label className={`lab-layer-toggle${checked ? ' lab-layer-toggle--on' : ''}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>; }
function NumberField({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange(value: number): void }) { return <label className="lab-number"><span>{label}</span><span className="lab-number__control"><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} />{suffix ? <small>{suffix}</small> : null}</span></label>; }
function Stat({ label, value }: { label: string; value: string }) { return <div className="lab-stat"><span>{label}</span><strong>{value}</strong></div>; }

void formatArea;
