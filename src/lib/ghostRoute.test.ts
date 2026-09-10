import { beforeEach, describe, expect, it } from 'vitest';
import { readGhostRoute, rememberGhostRoute } from './ghostRoute';
import type { Mission } from './api';

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});

describe('guided route storage', () => {
  it('stores the full guidance package for a newly selected mission', () => {
    const mission = {
      kind: 'conquest',
      distanceKm: 4.2,
      polyline: 'encoded-route',
      maneuvers: [{
        id: 'graphhopper:0',
        routeOffsetM: 0,
        type: 'depart',
        position: [19.04, 47.5],
      }],
    } as Mission;

    const route = rememberGhostRoute(mission);

    expect(route).toEqual(expect.objectContaining({
      schemaVersion: 2,
      plannedDistanceM: 4200,
      maneuvers: mission.maneuvers,
    }));
    expect(readGhostRoute()).toEqual(route);
  });

  it('migrates the legacy polyline-only record in memory', () => {
    values.set('grundo.ghostRoute', JSON.stringify({
      polyline: 'legacy-route',
      kind: 'explore',
    }));

    expect(readGhostRoute()).toEqual({
      schemaVersion: 2,
      polyline: 'legacy-route',
      kind: 'explore',
      maneuvers: [],
    });
  });

  it('drops invalid stored maneuvers without losing the route', () => {
    values.set('grundo.ghostRoute', JSON.stringify({
      schemaVersion: 2,
      polyline: 'route',
      kind: 'raid',
      maneuvers: [
        { type: 'turn', routeOffsetM: -1, position: [19, 47] },
        { type: 'turn', routeOffsetM: 120, position: [19.1, 47.1], modifier: 'right' },
      ],
    }));

    expect(readGhostRoute()?.maneuvers).toEqual([
      expect.objectContaining({
        id: 'stored:0',
        type: 'turn',
        modifier: 'right',
        routeOffsetM: 120,
      }),
    ]);
  });
});
