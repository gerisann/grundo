import {
  IncrementalLoopDetector,
  traceToCellPath,
  type ActivityGeometry,
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
import type { CellId, OwnershipMap, TracePoint } from '@/types';
import {
  countLabPlayerCells,
  countLabPlayerDefense,
  processLabActivity,
} from './labHierarchicalWorld';

/**
 * Milyen sűrűn KÍNÁLJON fel a generátor megszakítási pontot.
 *
 * ⚠️ Ez nem az a szám, ami eldönti, mikor adjuk vissza a vezérlést — azt a
 * `FRAME_BUDGET_MS` időkeret dönti el. Ezek csak elég sűrűek ahhoz, hogy egy
 * szelet ne nyúljon túl a kereten. Fix blokkmérettel az első kísérlet
 * elhasalt: 400 cella / 1500 minta mellett egy 5,6 km-es futás bele sem ért
 * egyetlen blokkhatárba, tehát a felület ugyanúgy egyben fagyott be.
 */
const GEOMETRY_CHUNK_CELLS = 32;
const RECORDER_CHUNK_SAMPLES = 128;

/**
 * Ennyi ideig dolgozhat a motor egyhuzamban, mielőtt visszaadja a vezérlést.
 *
 * Nagyjából másfél képkocka 60 Hz-en: elég rövid, hogy a haladásjelző mozogjon
 * és a kattintás beérkezzen, elég hosszú, hogy a megszakítások fix költsége
 * ne dominálja a futást.
 */
const FRAME_BUDGET_MS = 24;

export interface LabPlayer {
  id: string;
  name: string;
}

/** Hol tart a scenario feldolgozása — kizárólag haladásjelzéshez. */
export interface LabScenarioProgress {
  phaseIndex: number;
  phaseCount: number;
  runIndex: number;
  runCount: number;
  stage: 'recording' | 'committing';
  playerId: string;
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
  /** Mixed H3 world bejegyzésszám közvetlenül a commit előtt/után. */
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
  /** LAB-only mixed-resolution H3 world: compact parent + res12 override. */
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
 * A sandbox world vegyes felbontású lehet: nagy homogén terület compact parent,
 * részleges lopás/áttörés pedig finom res12 override. Ez kizárólag LAB-state;
 * production Firestore továbbra is a saját blokkos commit útját használja.
 */
export function runLabScenario(
  scenario: LabScenarioDefinition,
  initialOwnership: OwnershipMap = new Map(),
): LabScenarioOutcome {
  const steps = labScenarioSteps(scenario, initialOwnership);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * Ugyanaz a scenario-futtatás, csak a lépések között visszaadja a vezérlést.
 *
 * ⚠️ Ez NEM párhuzamosítás és NEM más eredmény: a generátor pontosan ugyanazt a
 * sorrendet járja be, mint a szinkron változat, tehát a világ bitre azonos.
 * Amit megold: a szinkron futás egyetlen, több másodperces blokkoló taskként
 * fagyasztotta be a felületet — sok playernél és hosszú útvonalnál a LAB úgy
 * nézett ki, mintha lefagyott volna, és a haladásjelző sem tudott mozogni.
 */
export async function runLabScenarioAsync(
  scenario: LabScenarioDefinition,
  initialOwnership: OwnershipMap = new Map(),
  onProgress?: (progress: LabScenarioProgress) => void,
): Promise<LabScenarioOutcome> {
  const steps = labScenarioSteps(scenario, initialOwnership);
  let step = steps.next();
  let sliceStartedAt = performance.now();
  while (!step.done) {
    // A progress callback logikai checkpointot jelent, ezért minden generátor-
    // yieldnél továbbítjuk. Az event-loop yield ettől függetlenül időkeretes:
    // így a progress tartalma nem függ attól, milyen gyors gépen fut a LAB.
    onProgress?.(step.value);

    if (performance.now() - sliceStartedAt >= FRAME_BUDGET_MS) {
      await yieldToEventLoop();
      sliceStartedAt = performance.now();
    }
    step = steps.next();
  }
  return step.value;
}

/**
 * A tényleges algoritmus, egyetlen példányban.
 *
 * A `yield` pontok a mérhetően drága szakaszok között vannak: a GPS-rögzítés
 * visszajátszása, a hurokdetektálás cellablokkonként, és a commit. A szinkron
 * és az aszinkron API ugyanezt a generátort hajtja végig — így nem lehet
 * kettéfejlődő logika a kettő között.
 */
function* labScenarioSteps(
  scenario: LabScenarioDefinition,
  initialOwnership: OwnershipMap,
): Generator<LabScenarioProgress, LabScenarioOutcome> {
  validateScenario(scenario);

  const ownership: OwnershipMap = new Map(initialOwnership);
  const phases: LabPhaseOutcome[] = [];
  const rng = mulberry32((scenario.tieBreakSeed ?? 738291) >>> 0);
  let phaseClock = Date.UTC(2026, 7, 24, 18, 0, 0);
  const phaseCount = scenario.phases.length;

  for (let phaseIndex = 0; phaseIndex < phaseCount; phaseIndex += 1) {
    const phase = scenario.phases[phaseIndex]!;
    const runCount = phase.runs.length;

    const prepared: PreparedRun[] = [];
    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const run = phase.runs[runIndex]!;
      prepared.push(yield* prepareRun(run, phaseClock, rng(), {
        phaseIndex, phaseCount, runIndex, runCount, stage: 'recording', playerId: run.playerId,
      }));
    }

    const phaseStartedAt = prepared.length > 0
      ? Math.min(...prepared.map((run) => run.startedAt))
      : phaseClock;

    /**
     * Először minden recorder elkészül a saját idővonalán, ownership-változás
     * nélkül. A commitok finish idő szerint követik egymást; azonos finishnél
     * a seedelt tie-break reprodukálható sorrendet ad.
     */
    const commitQueue = [...prepared].sort((a, b) =>
      a.finishedAt - b.finishedAt || a.tieBreak - b.tieBreak,
    );

    const outcomes: LabRunOutcome[] = [];
    for (let order = 0; order < commitQueue.length; order += 1) {
      const run = commitQueue[order]!;
      const worldCellsBefore = ownership.size;
      const geometry = yield* buildChunkedGeometry(run.recorder.points, {
        phaseIndex, phaseCount, runIndex: order, runCount, stage: 'committing',
        playerId: run.definition.playerId,
      });
      const result = processLabActivity(
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

/**
 * Hurokgeometria darabokban.
 *
 * Ez pontosan azt csinálja, amit a `buildActivityGeometry`: `traceToCellPath`,
 * majd egy friss `IncrementalLoopDetector`-ba az egész cellalánc. Csak épp
 * blokkonként, `yield`-del a blokkok között. A detektor állapotgépe
 * inkrementális, ezért a darabolás nem változtat az eredményen.
 */
function* buildChunkedGeometry(
  points: readonly TracePoint[],
  progress: LabScenarioProgress,
): Generator<LabScenarioProgress, ActivityGeometry> {
  const { path, droppedPoints, largeGaps } = traceToCellPath(points);
  const detector = new IncrementalLoopDetector();

  for (let index = 0; index < path.length; index += GEOMETRY_CHUNK_CELLS) {
    detector.appendMany(path.slice(index, index + GEOMETRY_CHUNK_CELLS));
    if (index + GEOMETRY_CHUNK_CELLS < path.length) yield progress;
  }

  const detected = detector.snapshot();
  return {
    cellPath: path,
    loops: detected.loops,
    loopDiagnostics: detected.diagnostics,
    droppedPoints,
    largeGaps,
  };
}

/**
 * Egy event-loop forduló, hogy a böngésző ki tudjon rajzolni.
 *
 * ⚠️ `setTimeout(0)` itt csak legvégső tartalék: a böngészők ötödik egymásba
 * ágyazott időzítőtől 4 ms-ra srófolják fel a késleltetést, ami sok
 * megszakításnál önmagában másodperceket adna a futáshoz. A `MessageChannel`
 * makrotask nincs ilyen korláthoz kötve.
 */
function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();

  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }

  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

/**
 * Egy kész claim végső ownership frissítése a sandbox worldre.
 * A LAB compact result parent H3 indexeket is tartalmazhat; exact res12 update
 * ugyanabban a Mapben override-ként él a parent fölött.
 */
export function applyClaimToWorld(world: OwnershipMap, result: ProcessResult): void {
  for (const [cell, next] of result.claim?.updates ?? []) {
    world.set(cell, next);
  }
}

/** Egy player végső tulajdonában lévő res12-egyenértékű cellák száma. */
export function countPlayerCells(world: OwnershipMap, playerId: string): number {
  return countLabPlayerCells(world, playerId);
}

/** Egy player/defense kombináció res12-egyenértékű cellaszáma. */
export function countPlayerDefense(
  world: OwnershipMap,
  playerId: string,
  defense: number,
): number {
  return countLabPlayerDefense(world, playerId, defense);
}

/** A world H3 bejegyzéseit tulajdonos szerint csoportosítja Mapbox/debug célra. */
export function worldCellsByOwner(world: OwnershipMap): Map<string, CellId[]> {
  const grouped = new Map<string, CellId[]>();
  for (const [cell, ownership] of world) {
    const list = grouped.get(ownership.owner);
    if (list) list.push(cell);
    else grouped.set(ownership.owner, [cell]);
  }
  return grouped;
}

function* prepareRun(
  run: LabPhaseRun,
  phaseClock: number,
  tieBreak: number,
  progress: LabScenarioProgress,
): Generator<LabScenarioProgress, PreparedRun> {
  const startAt = phaseClock + Math.max(0, run.startOffsetMs ?? 0);
  const config: GpsSimulationConfig = {
    ...run.config,
    startAt,
  };
  const generated = generateGpsActivity(run.route, config);

  let recorder = createRecorder(config.activityType, `lab-${run.playerId}-${run.id}`);
  const firstAt = generated.samples[0]?.t ?? startAt;
  recorder = start(recorder, firstAt);

  // A visszajátszás mintánként fut; hosszú aktivitásnál ez tízezres nagyságrend.
  for (let index = 0; index < generated.samples.length; index += 1) {
    recorder = applySample(recorder, generated.samples[index]!);
    if (index > 0 && index % RECORDER_CHUNK_SAMPLES === 0) yield progress;
  }

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
