import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_GPS_SIMULATION_CONFIG } from '@/tracking/simulationSource';

/**
 * A `labE2eSession.ts` a `sessionStorage`-t böngészőkörnyezetnek feltételezi
 * (nincs try/catch köré, mert ez amúgy is csak admin/LAB kódúton fut). A
 * vitest alapból Node-környezetben fut, ahol ez nincs definiálva — ezért egy
 * minimális, memóriabeli mock kell csak ehhez a teszthez.
 */
beforeAll(() => {
  if (typeof sessionStorage !== 'undefined') return;
  const store = new Map<string, string>();
  (globalThis as { sessionStorage?: Storage }).sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
});
import {
  createLabE2eSession,
  describePlaybackRate,
  labPlaybackRate,
  labPlaybackRateSchedule,
  loadLabE2eSession,
} from './labE2eSession';

const BASE_INPUT = {
  sandboxId: 'sandbox-1',
  scenarioName: 'Teszt',
  phaseId: 'phase-1',
  phaseName: 'Fázis 1',
  playerId: 'player-1',
  playerName: 'Player 1',
  players: [{ id: 'player-1', name: 'Player 1' }],
  route: [
    { lat: 47.5, lng: 19.0 },
    { lat: 47.51, lng: 19.01 },
  ],
  config: { ...DEFAULT_GPS_SIMULATION_CONFIG, activityType: 'run' as const },
};

describe('playbackRate — fix szám és „max”', () => {
  it('fix szám érvényes marad, és számként adja vissza', () => {
    expect(labPlaybackRate('100')).toBe(100);
    expect(labPlaybackRateSchedule('100')).toBe(100);
  });

  it('„max” 0-t ad — a lejátszó ezt kezeli korlátlan sebességként', () => {
    expect(labPlaybackRate('max')).toBe(0);
    expect(labPlaybackRateSchedule('max')).toBe(0);
    expect(describePlaybackRate('max')).toBe('MAX');
  });

  it('érvénytelen szám mentéskor „1”-re esik vissza', () => {
    const session = createLabE2eSession({ ...BASE_INPUT, playbackRate: 'nem-szám' });
    expect(session.playbackRate).toBe('1');
  });
});

describe('playbackRate — RAMP séma („gyors>lassú@arány”)', () => {
  it('a séma a kezdeti (gyors) szorzót adja `labPlaybackRate()`-nél', () => {
    expect(labPlaybackRate('1000>1@0.9')).toBe(1000);
  });

  it('`labPlaybackRateSchedule()` egy függvényt ad, ami a váltásnál vált', () => {
    const schedule = labPlaybackRateSchedule('1000>1@0.9');
    expect(typeof schedule).toBe('function');
    if (typeof schedule !== 'function') throw new Error('unreachable');
    expect(schedule(0)).toBe(1000);
    expect(schedule(0.89)).toBe(1000);
    expect(schedule(0.9)).toBe(1);
    expect(schedule(1)).toBe(1);
  });

  it('emberi feliratot ad', () => {
    expect(describePlaybackRate('1000>1@0.9')).toBe('1000×→1× (90%-nál)');
  });

  it('mentés/betöltés után a RAMP-string változatlan marad', () => {
    const session = createLabE2eSession({ ...BASE_INPUT, playbackRate: '1000>1@0.9' });
    expect(session.playbackRate).toBe('1000>1@0.9');
    const loaded = loadLabE2eSession(session.id);
    expect(loaded?.playbackRate).toBe('1000>1@0.9');
  });
});
