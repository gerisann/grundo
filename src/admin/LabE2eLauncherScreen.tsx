import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ScreenHeader, SegmentedControl } from '@/components/ui';
import type { LabPhase, LabPlayer } from './labScenarioEngine';
import { createLabE2eSession, type LabE2ePlaybackRate } from './labE2eSession';

const SCENARIO_STORAGE_KEY = 'grundo.lab.scenarios.v2';

type SavedScenario = {
  id: string;
  name: string;
  savedAt: number;
  players: LabPlayer[];
  phases: LabPhase[];
  tieBreakSeed: number;
};

export function LabE2eLauncherScreen() {
  const navigate = useNavigate();
  const scenarios = useMemo(loadScenarios, []);
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? '');
  const scenario = scenarios.find((item) => item.id === scenarioId) ?? scenarios[0] ?? null;
  const [phaseId, setPhaseId] = useState(scenario?.phases[0]?.id ?? '');
  const phase = scenario?.phases.find((item) => item.id === phaseId) ?? scenario?.phases[0] ?? null;
  const [playerId, setPlayerId] = useState(phase?.runs[0]?.playerId ?? '');
  const run = phase?.runs.find((item) => item.playerId === playerId) ?? phase?.runs[0] ?? null;
  const player = scenario?.players.find((item) => item.id === run?.playerId) ?? null;
  const [playbackRate, setPlaybackRate] = useState<LabE2ePlaybackRate>('100');

  function selectScenario(id: string) {
    setScenarioId(id);
    const next = scenarios.find((item) => item.id === id);
    const firstPhase = next?.phases[0] ?? null;
    setPhaseId(firstPhase?.id ?? '');
    setPlayerId(firstPhase?.runs[0]?.playerId ?? '');
  }

  function selectPhase(id: string) {
    setPhaseId(id);
    const next = scenario?.phases.find((item) => item.id === id);
    setPlayerId(next?.runs[0]?.playerId ?? '');
  }

  function launch() {
    if (!scenario || !phase || !run || !player || run.route.length < 2) return;
    const session = createLabE2eSession({
      sandboxId: scenario.id,
      scenarioName: scenario.name,
      phaseId: phase.id,
      phaseName: phase.name,
      playerId: player.id,
      playerName: player.name,
      players: scenario.players,
      route: run.route,
      config: run.config,
      playbackRate,
    });
    navigate(`/admin/lab/e2e/${encodeURIComponent(session.id)}`);
  }

  return (
    <main style={{ paddingBottom: 40 }}>
      <ScreenHeader title="LAB · Éles UI" backTo="/admin/lab" />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: 16, display: 'grid', gap: 18 }}>
        <section className="admin-card" style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.1em', opacity: .6 }}>E2E TRACKING</div>
            <h2 style={{ margin: '4px 0 8px' }}>Production UI · sandbox world</h2>
            <p style={{ margin: 0, lineHeight: 1.5, opacity: .72 }}>
              Ugyanaz a TrackingScreen, Recorder és Dock fut, mint élesben. A GPS szimulált,
              a terület pedig kizárólag a böngésző LAB sandboxába commitolódik.
            </p>
          </div>
        </section>

        {scenarios.length === 0 ? (
          <section className="admin-card">
            <strong>Nincs mentett LAB scenario.</strong>
            <p>Menj vissza a Scenario LAB-ba, állítsd össze a route-ot, majd használd a „Scenario mentése” gombot.</p>
            <Button onClick={() => navigate('/admin/lab')}>Vissza a LAB-ba</Button>
          </section>
        ) : (
          <>
            <Field label="Scenario">
              <select value={scenario?.id ?? ''} onChange={(event) => selectScenario(event.target.value)}>
                {scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>

            <Field label="Phase">
              <select value={phase?.id ?? ''} onChange={(event) => selectPhase(event.target.value)}>
                {(scenario?.phases ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>

            <Field label="Player">
              <select value={run?.playerId ?? ''} onChange={(event) => setPlayerId(event.target.value)}>
                {(phase?.runs ?? []).map((item) => {
                  const name = scenario?.players.find((p) => p.id === item.playerId)?.name ?? item.playerId;
                  const suffix = item.route.length >= 2 ? `${item.route.length} waypoint` : 'nincs route';
                  return <option key={item.id} value={item.playerId}>{name} · {suffix}</option>;
                })}
              </select>
            </Field>

            <SegmentedControl
              label="Lejátszás"
              value={playbackRate}
              onChange={(value) => setPlaybackRate(value as LabE2ePlaybackRate)}
              options={[
                { value: '1', label: '1×' },
                { value: '10', label: '10×' },
                { value: '100', label: '100×' },
                { value: 'max', label: 'MAX' },
              ]}
              columns={4}
              block
            />

            <section className="admin-card" style={{ display: 'grid', gap: 8 }}>
              <strong>{player?.name ?? '—'}</strong>
              <span>{run?.config.activityType ?? '—'} · {run?.route.length ?? 0} waypoint</span>
              <span>Sandbox: {scenario?.name ?? '—'}</span>
            </section>

            <Button block disabled={!run || run.route.length < 2} onClick={launch}>
              Indítás éles UI-ban
            </Button>
          </>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700, opacity: .65 }}>{label}</span>
      {children}
    </label>
  );
}

function loadScenarios(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(SCENARIO_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as SavedScenario[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
