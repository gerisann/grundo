import { describe, expect, it } from 'vitest';
import { DEFAULT_GPS_SIMULATION_CONFIG } from '@/tracking/simulationSource';
import { ORIGIN, squareWaypoints } from '@/game/fixtures';
import type { GpsSimulationConfig, SimulationWaypoint } from '@/tracking/simulationSource';
import {
  countPlayerCells,
  runLabScenario,
  type LabPhaseRun,
  type LabScenarioDefinition,
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
