import {
  buildActivityGeometry,
  processActivityGeometry,
  type ProcessResult,
} from '@/game';
import {
  applySample,
  createRecorder,
  finish,
  start,
  type RecorderState,
} from '@/tracking/recorder';
import {
  generateGpsActivity,
  type GeneratedGpsActivity,
  type GpsSimulationConfig,
  type SimulationWaypoint,
} from '@/tracking/simulationSource';
import type { ActivityType, CellId, OwnershipMap } from '@/types';

export interface LabPlayer {
  id: string;
  name: string;
}

export interface LabPhaseRun {
  id: string;
  playerId: string;
  route: SimulationWaypoint[];
  config: GpsSimulationConfig;
  /** A phase kezdetéhez képest ennyivel később indul a rögzítés. */
  startOffsetMs?: number;
}

export interface LabPhase {
  id: string;
  name: string;
  runs: LabPhaseRun[];
  /** A következő phase előtt ennyi szimulált idő telik el. */
  gapAfterMs?: number;
}

export interface LabScenarioDefinition {
  players: LabPlayer[];
  phases: LabPhase[];
  /** Azonos finish időnél determinisztikus tie-break. */
  tieBreakSeed?: number;
}

export interface LabRunOutcome {
  phaseId: string;
  runId: string;
  playerId: string;
  startedAt: number;
  finishedAt: number;
  commitOrder: number;
  generated: GeneratedGpsActivity;
  recorder: RecorderState;
  result: ProcessResult;
  /** Hány ownership cella volt a worldben közvetlenül a commit előtt/után. */
  worldCellsBefore: number;
  worldCellsAfter: number;
}

export interface LabPhaseOutcome {
  phaseId: string;
  name: string;
  startedAt: number;
  finishedAt: number;
  runs: LabRunOutcome[];
}

export interface LabScenarioOutcome {
  phases: LabPhaseOutcome[];
  ownership: OwnershipMap;
}

interface PreparedRun {
  definition: LabPhaseRun;
  generated: GeneratedGpsActivity;
  recorder: RecorderState;
  startedAt: number;
  finishedAt: number;
  tieBreak: number;
}

/**
 * Több-playeres LAB scenario determinisztikus, headless végrehajtása.
 *
 * A GPS-rögzítések egy phase-en belül időben átfedhetnek. A birtoklás azonban
 * az éles rendszerhez hasonlóan csak az aktivitás BEFEJEZÉSEKOR változik.
 * Minden commit az akkor aktuális közös world ownershipből számol újra.
 *
 * Ez a Firestore tranzakciók sorosítható JÁTÉKLOGIKAI eredményét modellezi.
 * A valódi lock/retry contention külön emulator mód feladata lesz.
 */
export function runLabScenario(
  scenario: LabScenarioDefinition,
  initialOwnership: OwnershipMap = new Map(),
): LabScenarioOutcome {
  validateScenario(scenario);

  const ownership: OwnershipMap = new Map(initialOwnership);
  const phases: LabPhaseOutcome[] = [];
  const rng = mulberry32((scenario.tieBreakSeed ?? 738291) >>> 0);
  let phaseClock = Date.UTC(2026, 7, 24, 18, 0, 0);

  for (const phase of scenario.phases) {
    const prepared = phase.runs.map((run) => prepareRun(run, phaseClock, rng()));
    const phaseStartedAt = prepared.length > 0
      ? Math.min(...prepared.map((run) => run.startedAt))
      : phaseClock;

    /**
     * Először minden recorder elkészül a saját idővonalán, ownership-változás
     * nélkül. Ez felel meg annak, hogy több telefon egyszerre rögzít.
     *
     * A commitok finish idő szerint követik egymást. Azonos finish timestampnél
     * a seedelt tie-break reprodukálható sorrendet ad.
     */
    const commitQueue = [...prepared].sort((a, b) =>
      a.finishedAt - b.finishedAt || a.tieBreak - b.tieBreak,
    );

    const outcomes: LabRunOutcome[] = [];
    for (let order = 0; order < commitQueue.length; order += 1) {
      const run = commitQueue[order]!;
      const worldCellsBefore = ownership.size;
      const geometry = buildActivityGeometry(run.recorder.points);
      const result = processActivityGeometry(
        {
          points: run.recorder.points,
          type: run.definition.config.activityType,
          distanceKm: run.recorder.distanceM / 1000,
          actorId: run.definition.playerId,
          ownership,
          streakDays: 1,
          gpEarnedToday: 0,
        },
        geometry,
      );

      applyClaimToWorld(ownership, result);
      outcomes.push({
        phaseId: phase.id,
        runId: run.definition.id,
        playerId: run.definition.playerId,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        commitOrder: order,
        generated: run.generated,
        recorder: run.recorder,
        result,
        worldCellsBefore,
        worldCellsAfter: ownership.size,
      });
    }

    const phaseFinishedAt = prepared.length > 0
      ? Math.max(...prepared.map((run) => run.finishedAt))
      : phaseStartedAt;
    phases.push({
      phaseId: phase.id,
      name: phase.name,
      startedAt: phaseStartedAt,
      finishedAt: phaseFinishedAt,
      runs: outcomes,
    });
    phaseClock = phaseFinishedAt + Math.max(0, phase.gapAfterMs ?? 1_000);
  }

  return { phases, ownership };
}

/** Egy kész claim végső ownership frissítése a sandbox worldre. */
export function applyClaimToWorld(world: OwnershipMap, result: ProcessResult): void {
  for (const [cell, next] of result.claim?.updates ?? []) {
    world.set(cell, next);
  }
}

/** Egy player végső tulajdonában lévő cellák száma. */
export function countPlayerCells(world: OwnershipMap, playerId: string): number {
  let count = 0;
  for (const ownership of world.values()) {
    if (ownership.owner === playerId) count += 1;
  }
  return count;
}

/** Egy adott player/defense kombináció cellaszáma. */
export function countPlayerDefense(
  world: OwnershipMap,
  playerId: string,
  defense: number,
): number {
  let count = 0;
  for (const ownership of world.values()) {
    if (ownership.owner === playerId && ownership.defense === defense) count += 1;
  }
  return count;
}

/** A world celláit tulajdonos szerint csoportosítja Mapbox/debug célra. */
export function worldCellsByOwner(world: OwnershipMap): Map<string, CellId[]> {
  const grouped = new Map<string, CellId[]>();
  for (const [cell, ownership] of world) {
    const list = grouped.get(ownership.owner);
    if (list) list.push(cell);
    else grouped.set(ownership.owner, [cell]);
  }
  return grouped;
}

function prepareRun(run: LabPhaseRun, phaseClock: number, tieBreak: number): PreparedRun {
  const startAt = phaseClock + Math.max(0, run.startOffsetMs ?? 0);
  const config: GpsSimulationConfig = {
    ...run.config,
    startAt,
  };
  const generated = generateGpsActivity(run.route, config);

  let recorder = createRecorder(config.activityType, `lab-${run.playerId}-${run.id}`);
  const firstAt = generated.samples[0]?.t ?? startAt;
  recorder = start(recorder, firstAt);
  for (const sample of generated.samples) recorder = applySample(recorder, sample);
  const finishedAt = generated.samples.at(-1)?.t ?? (startAt + generated.durationMs);
  recorder = finish(recorder, finishedAt);

  return {
    definition: { ...run, config },
    generated,
    recorder,
    startedAt: startAt,
    finishedAt,
    tieBreak,
  };
}

function validateScenario(scenario: LabScenarioDefinition): void {
  const playerIds = new Set<string>();
  for (const player of scenario.players) {
    if (!player.id) throw new Error('LAB player id nem lehet üres.');
    if (playerIds.has(player.id)) throw new Error(`Duplikált LAB player: ${player.id}`);
    playerIds.add(player.id);
  }

  for (const phase of scenario.phases) {
    if (phase.runs.length > 10) {
      throw new Error('Egy LAB phase legfeljebb 10 párhuzamos playert tartalmazhat.');
    }
    for (const run of phase.runs) {
      if (!playerIds.has(run.playerId)) {
        throw new Error(`Ismeretlen LAB player a phase-ben: ${run.playerId}`);
      }
      if (run.route.length < 2) {
        throw new Error(`A(z) ${run.id} run útvonala túl rövid.`);
      }
    }
  }
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Csak a type import dokumentálásához: a run config hordozza a tényleges típust. */
void (null as ActivityType | null);
