import { describe, expect, it } from 'vitest';
import { DEFAULT_GPS_SIMULATION_CONFIG } from '@/tracking/simulationSource';
import { ORIGIN, squareWaypoints } from '@/game/fixtures';
import type { GpsSimulationConfig, SimulationWaypoint } from '@/tracking/simulationSource';
import {
  countPlayerCells,
  runLabScenario,
  runLabScenarioAsync,
  type LabPhaseRun,
  type LabScenarioDefinition,
  type LabScenarioProgress,
} from './labScenarioEngine';

function perfectConfig(seed: number): GpsSimulationConfig {
  return {
    ...DEFAULT_GPS_SIMULATION_CONFIG,
    activityType: 'ride',
    speedKmh: 22,
    sampleIntervalS: 1,
    intervalJitter: 0,
    speedVariation: 0,
    accuracyM: 1,
    noiseM: 0,
    driftM: 0,
    dropoutProbability: 0,
    spikeProbability: 0,
    seed,
  };
}

function route(sideM = 220): SimulationWaypoint[] {
  return squareWaypoints(ORIGIN, sideM).map((point) => ({ ...point }));
}

/** 2400 m oldalú négyzet: ~1570 GPS minta és ~510 H3 cella, tehát darabolódik. */
function bigRun(id: string, playerId: string, seed = 11): LabPhaseRun {
  return { id, playerId, route: route(2_400), config: perfectConfig(seed), startOffsetMs: 0 };
}

function run(id: string, playerId: string, startOffsetMs = 0, seed = 1): LabPhaseRun {
  return {
    id,
    playerId,
    route: route(),
    config: perfectConfig(seed),
    startOffsetMs,
  };
}

describe('multi-player LAB phase engine', () => {
  it('egy későbbi phase playere el tudja lopni az előző phase-ben megszerzett területet', () => {
    const scenario: LabScenarioDefinition = {
      players: [
        { id: 'A', name: 'Player A' },
        { id: 'B', name: 'Player B' },
      ],
      phases: [
        { id: 'p1', name: 'Foglalás', runs: [run('a-1', 'A')] },
        { id: 'p2', name: 'Lopás', runs: [run('b-1', 'B')] },
      ],
    };

    const outcome = runLabScenario(scenario);
    const first = outcome.phases[0]!.runs[0]!.result;
    const second = outcome.phases[1]!.runs[0]!.result;

    expect(first.claim?.counts.free ?? 0).toBeGreaterThan(0);
    expect(second.claim?.counts.stolen ?? 0).toBeGreaterThan(0);
    expect(countPlayerCells(outcome.ownership, 'B')).toBeGreaterThan(0);
    expect(countPlayerCells(outcome.ownership, 'A')).toBe(0);
  });

  it('egy phase-en belül a később befejező player az addigra friss world ellen commitol', () => {
    const scenario: LabScenarioDefinition = {
      players: [
        { id: 'A', name: 'Player A' },
        { id: 'B', name: 'Player B' },
      ],
      phases: [
        {
          id: 'race',
          name: 'Parallel overlap',
          runs: [
            run('a', 'A', 0, 11),
            run('b', 'B', 3_000, 22),
          ],
        },
      ],
    };

    const outcome = runLabScenario(scenario);
    const commits = outcome.phases[0]!.runs;

    expect(commits).toHaveLength(2);
    expect(commits[0]!.playerId).toBe('A');
    expect(commits[1]!.playerId).toBe('B');
    expect(commits[1]!.result.claim?.counts.stolen ?? 0).toBeGreaterThan(0);
    expect(countPlayerCells(outcome.ownership, 'B')).toBeGreaterThan(0);
    expect(countPlayerCells(outcome.ownership, 'A')).toBe(0);
  });

  it('10 párhuzamos, teljesen átfedő player determinisztikusan végigkönyvelhető', () => {
    const players = Array.from({ length: 10 }, (_, index) => ({
      id: `P${index + 1}`,
      name: `Player ${index + 1}`,
    }));
    const runs = players.map((player, index) =>
      run(`run-${index + 1}`, player.id, index * 1_000, 100 + index),
    );

    const outcome = runLabScenario({
      players,
      phases: [{ id: 'stress', name: '10 player overlap', runs }],
      tieBreakSeed: 123,
    });

    const commits = outcome.phases[0]!.runs;
    expect(commits).toHaveLength(10);
    expect(commits[0]!.result.claim?.counts.free ?? 0).toBeGreaterThan(0);
    for (let index = 1; index < commits.length; index += 1) {
      expect(commits[index]!.result.claim?.counts.stolen ?? 0).toBeGreaterThan(0);
    }

    const winner = commits.at(-1)!.playerId;
    expect(countPlayerCells(outcome.ownership, winner)).toBeGreaterThan(0);
    for (const player of players) {
      if (player.id === winner) continue;
      expect(countPlayerCells(outcome.ownership, player.id)).toBe(0);
    }
  });
});

describe('darabolt scenario-futtatás', () => {
  it('az aszinkron futtatás pontosan ugyanazt a világot adja, mint a szinkron', async () => {
    const scenario: LabScenarioDefinition = {
      players: [
        { id: 'A', name: 'Player A' },
        { id: 'B', name: 'Player B' },
      ],
      phases: [
        // Az első run szándékosan hosszú: csak ekkora útvonalon lép működésbe a
        // mintavétel- és a cella-darabolás is, tehát ez teszteli a `yield`
        // pontokat. A rövidebbek a phase-ek közti állapotátadást fedik.
        { id: 'p1', name: 'Foglalás', runs: [bigRun('a-1', 'A'), run('b-1', 'B', 30_000, 2)] },
        { id: 'p2', name: 'Második kör', runs: [run('a-2', 'A', 0, 3)] },
      ],
    };

    const sync = runLabScenario(scenario);

    const progress: LabScenarioProgress[] = [];
    const async = await runLabScenarioAsync(scenario, new Map(), (item) => progress.push(item));

    // A világ minden cellája egyezik — a darabolás nem befolyásolja az eredményt.
    expect([...async.ownership.entries()].sort()).toEqual([...sync.ownership.entries()].sort());

    // A hurok- és claim-számok is futásonként egyeznek.
    const summarize = (outcome: typeof sync) => outcome.phases.flatMap((phase) => phase.runs.map((item) => ({
      playerId: item.playerId,
      commitOrder: item.commitOrder,
      loops: item.result.loops.length,
      free: item.result.claim?.counts.free ?? 0,
      stolen: item.result.claim?.counts.stolen ?? 0,
      cells: item.result.claimedCellCount,
    })));
    expect(summarize(async)).toEqual(summarize(sync));

    // És tényleg darabokban futott, nem egyetlen blokkban.
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some((item) => item.stage === 'committing')).toBe(true);
  });
});
