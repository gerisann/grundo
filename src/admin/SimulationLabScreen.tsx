import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ScreenHeader, SegmentedControl } from '@/components/ui';
import { processActivity } from '@/game';
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
import type { ActivityType } from '@/types';
import { SimulationMap } from './SimulationMap';
import './simulation-lab.css';

const STORAGE_KEY = 'grundo.lab.scenarios.v1';

type PlaybackRate = 1 | 10 | 100 | 0;

interface SavedScenario {
  id: string;
  name: string;
  savedAt: number;
  route: SimulationWaypoint[];
  config: GpsSimulationConfig;
}

export function SimulationLabScreen() {
  const [route, setRoute] = useState<SimulationWaypoint[]>([]);
  const [activityType, setActivityType] = useState<ActivityType>('ride');
  const [speedKmh, setSpeedKmh] = useState(22);
  const [sampleIntervalS, setSampleIntervalS] = useState(1);
  const [accuracyM, setAccuracyM] = useState(6);
  const [noiseM, setNoiseM] = useState(2.5);
  const [driftM, setDriftM] = useState(0.2);
  const [dropoutPercent, setDropoutPercent] = useState(0.5);
  const [spikePercent, setSpikePercent] = useState(0);
  const [seed, setSeed] = useState(738291);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(100);
  const [recorder, setRecorder] = useState<RecorderState>(() => createRecorder('ride', 'lab-preview'));
  const [running, setRunning] = useState(false);
  const [scenarioName, setScenarioName] = useState('Tesztkör');
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>(() => loadScenarios());
  const sourceRef = useRef<SimulationPositionSource | null>(null);

  const config = useMemo<GpsSimulationConfig>(
    () => ({
      ...DEFAULT_GPS_SIMULATION_CONFIG,
      activityType,
      speedKmh,
      sampleIntervalS,
      accuracyM,
      noiseM,
      driftM,
      dropoutProbability: dropoutPercent / 100,
      spikeProbability: spikePercent / 100,
      seed,
      startAt: Date.UTC(2026, 7, 24, 18, 0, 0),
    }),
    [activityType, speedKmh, sampleIntervalS, accuracyM, noiseM, driftM, dropoutPercent, spikePercent, seed],
  );

  const generated = useMemo(() => generateGpsActivity(route, config), [route, config]);
  const gameResult = useMemo(() => {
    if (recorder.points.length < 2) return null;
    return processActivity({
      points: recorder.points,
      type: activityType,
      distanceKm: recorder.distanceM / 1000,
      actorId: 'lab-user',
      ownership: new Map(),
      streakDays: 1,
      gpEarnedToday: 0,
    });
  }, [recorder.points, recorder.distanceM, activityType]);

  useEffect(() => () => void sourceRef.current?.stop(), []);

  async function runSimulation() {
    await sourceRef.current?.stop();

    if (generated.samples.length < 2) return;

    const started = start(createRecorder(activityType, `lab-${Date.now()}`), generated.samples[0]!.t);
    setRecorder(started);
    setRunning(true);

    let current = started;
    const source = new SimulationPositionSource(generated.samples, playbackRate, () => {
      const endedAt = generated.samples[generated.samples.length - 1]?.t ?? Date.now();
      current = finish(current, endedAt);
      setRecorder(current);
      setRunning(false);
      persistLastRun({
        at: Date.now(),
        routeDistanceM: generated.routeDistanceM,
        recordedDistanceM: current.distanceM,
        rawSamples: generated.samples.length,
        acceptedSamples: current.points.length,
        rejected: current.rejected,
        seed: generated.seed,
      });
    });
    sourceRef.current = source;

    await source.start(
      {
        onSample(sample) {
          current = applySample(current, sample);
          setRecorder(current);
        },
        onError(error) {
          console.error('[GRUNDO LAB] Simulation source error', error);
        },
      },
      activityType,
    );
  }

  async function stopSimulation() {
    await sourceRef.current?.stop();
    sourceRef.current = null;
    setRunning(false);
  }

  function resetRun() {
    void stopSimulation();
    setRecorder(createRecorder(activityType, 'lab-preview'));
  }

  function saveScenario() {
    if (route.length < 2) return;
    const next: SavedScenario = {
      id: `scenario-${Date.now()}`,
      name: scenarioName.trim() || `Tesztkör ${savedScenarios.length + 1}`,
      savedAt: Date.now(),
      route: route.map((point) => ({ ...point })),
      config,
    };
    const all = [next, ...savedScenarios].slice(0, 30);
    setSavedScenarios(all);
    saveScenarios(all);
  }

  function loadScenario(scenario: SavedScenario) {
    void stopSimulation();
    setScenarioName(scenario.name);
    setRoute(scenario.route.map((point) => ({ ...point })));
    setActivityType(scenario.config.activityType);
    setSpeedKmh(scenario.config.speedKmh);
    setSampleIntervalS(scenario.config.sampleIntervalS);
    setAccuracyM(scenario.config.accuracyM);
    setNoiseM(scenario.config.noiseM);
    setDriftM(scenario.config.driftM);
    setDropoutPercent(scenario.config.dropoutProbability * 100);
    setSpikePercent(scenario.config.spikeProbability * 100);
    setSeed(scenario.config.seed);
    setRecorder(createRecorder(scenario.config.activityType, 'lab-preview'));
  }

  const rejectedCount = Object.values(recorder.rejected).reduce((sum, value) => sum + value, 0);
  const claim = gameResult?.claim;
  const routeKm = routeDistanceM(route) / 1000;

  return (
    <>
      <ScreenHeader title="Simulation LAB" backTo="/admin" />
      <div className="lab-shell">
        <aside className="lab-panel lab-panel--controls">
          <section className="lab-section">
            <div className="lab-section__heading">
              <div>
                <div className="lab-kicker">SANDBOX</div>
                <h2>GPS aktivitás</h2>
              </div>
              <span className="lab-badge">LOCAL ONLY</span>
            </div>
            <p className="field__hint">
              A futás nem hív activity API-t és nem ír normál Firestore adatot. A mentett scenario a böngésző helyi LAB tárában marad.
            </p>
          </section>

          <section className="lab-section">
            <SegmentedControl
              label="Mozgásforma"
              options={[
                { value: 'walk', label: 'Séta' },
                { value: 'run', label: 'Futás' },
                { value: 'ride', label: 'Bringázás' },
              ]}
              value={activityType}
              onChange={setActivityType}
              size="sm"
              block
              columns={3}
            />
            <NumberField label="Átlagsebesség" value={speedKmh} min={0.5} max={200} step={0.5} suffix="km/h" onChange={setSpeedKmh} />
            <NumberField label="Mintavétel" value={sampleIntervalS} min={0.1} max={60} step={0.1} suffix="s" onChange={setSampleIntervalS} />
          </section>

          <section className="lab-section">
            <div className="lab-section__title">GPS modell</div>
            <NumberField label="Jelentett pontosság" value={accuracyM} min={1} max={250} step={0.5} suffix="m" onChange={setAccuracyM} />
            <NumberField label="Pillanatnyi zaj" value={noiseM} min={0} max={250} step={0.5} suffix="m" onChange={setNoiseM} />
            <NumberField label="Lassú drift" value={driftM} min={0} max={50} step={0.1} suffix="m/minta" onChange={setDriftM} />
            <NumberField label="Jelkimaradás" value={dropoutPercent} min={0} max={95} step={0.1} suffix="%" onChange={setDropoutPercent} />
            <NumberField label="GPS spike" value={spikePercent} min={0} max={50} step={0.1} suffix="%" onChange={setSpikePercent} />
            <NumberField label="Seed" value={seed} min={1} max={2_147_483_647} step={1} onChange={(value) => setSeed(Math.trunc(value))} />
          </section>

          <section className="lab-section">
            <div className="lab-section__title">Lejátszás</div>
            <SegmentedControl
              label="Sebesség"
              options={[
                { value: 1, label: '1×' },
                { value: 10, label: '10×' },
                { value: 100, label: '100×' },
                { value: 0, label: 'MAX' },
              ]}
              value={playbackRate}
              onChange={setPlaybackRate}
              size="sm"
              block
              columns={4}
            />
            <div className="lab-actions">
              <Button onClick={() => void runSimulation()} disabled={running || generated.samples.length < 2}>
                {running ? 'Fut…' : 'Teszt indítása'}
              </Button>
              <Button variant="secondary" onClick={() => void stopSimulation()} disabled={!running}>
                Stop
              </Button>
              <Button variant="secondary" onClick={resetRun}>Reset</Button>
            </div>
          </section>

          <section className="lab-section">
            <div className="lab-section__title">Scenario mentés</div>
            <input className="lab-input" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} aria-label="Scenario neve" />
            <Button variant="secondary" onClick={saveScenario} disabled={route.length < 2}>Scenario mentése</Button>
            {savedScenarios.length > 0 ? (
              <div className="lab-scenarios">
                {savedScenarios.slice(0, 6).map((scenario) => (
                  <button key={scenario.id} type="button" className="lab-scenario" onClick={() => loadScenario(scenario)}>
                    <strong>{scenario.name}</strong>
                    <span>{(routeDistanceM(scenario.route) / 1000).toFixed(2)} km · seed {scenario.config.seed}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        </aside>

        <main className="lab-workspace">
          <div className="lab-mapbar">
            <div>
              <strong>Útvonal szerkesztő</strong>
              <span>Kattints a térképre új ponthoz, a számozott pontokat húzhatod.</span>
            </div>
            <div className="lab-mapbar__actions">
              <Button variant="secondary" size="sm" onClick={() => setRoute((points) => points.slice(0, -1))} disabled={route.length === 0}>Utolsó törlése</Button>
              <Button variant="secondary" size="sm" onClick={() => { resetRun(); setRoute([]); }} disabled={route.length === 0}>Útvonal törlése</Button>
            </div>
          </div>

          <SimulationMap
            route={route}
            rawTrack={generated.samples}
            acceptedTrack={recorder.points}
            onAppendWaypoint={(point) => { resetRun(); setRoute((points) => [...points, point]); }}
            onMoveWaypoint={(index, point) => {
              resetRun();
              setRoute((points) => points.map((item, itemIndex) => itemIndex === index ? point : item));
            }}
          />

          <div className="lab-legend">
            <span><i className="lab-dot lab-dot--route" /> Ideális útvonal</span>
            <span><i className="lab-dot lab-dot--raw" /> Nyers GPS</span>
            <span><i className="lab-dot lab-dot--accepted" /> Recorder által elfogadott</span>
          </div>

          <div className="lab-stats">
            <Stat label="Útvonal" value={`${routeKm.toFixed(2)} km`} />
            <Stat label="GPS minták" value={String(generated.samples.length)} />
            <Stat label="Generált idő" value={formatDuration(generated.durationMs)} />
            <Stat label="Dropout" value={String(generated.droppedSamples)} />
            <Stat label="Spike" value={String(generated.spikeSamples)} />
            <Stat label="Elfogadott" value={String(recorder.points.length)} />
            <Stat label="Recorder táv" value={`${(recorder.distanceM / 1000).toFixed(2)} km`} />
            <Stat label="Elutasított" value={String(rejectedCount)} />
            <Stat label="Bezárások" value={String(gameResult?.loops.length ?? 0)} />
            <Stat label="Foglalás" value={formatArea(gameResult?.areaGainedM2 ?? 0)} />
            <Stat label="Szabad cella" value={String(claim?.counts.free ?? 0)} />
            <Stat label="GP" value={formatGp(gameResult?.gp.total ?? 0)} />
          </div>

          {rejectedCount > 0 ? (
            <div className="lab-diagnostics">
              {Object.entries(recorder.rejected).map(([reason, count]) => (
                <span key={reason}>{reason}: <strong>{count}</strong></span>
              ))}
            </div>
          ) : null}
        </main>
      </div>
    </>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange(value: number): void;
}) {
  return (
    <label className="lab-number">
      <span>{label}</span>
      <span className="lab-number__control">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        {suffix ? <small>{suffix}</small> : null}
      </span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lab-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function loadScenarios(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedScenario[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveScenarios(scenarios: SavedScenario[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
  } catch {
    // A LAB tovább működik, csak a scenario nem marad meg privát böngészésben.
  }
}

function persistLastRun(run: unknown) {
  try {
    localStorage.setItem('grundo.lab.lastRun.v1', JSON.stringify(run));
  } catch {
    // Diagnosztikai kényelmi adat, nem kritikus.
  }
}
