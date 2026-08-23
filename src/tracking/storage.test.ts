/**
 * A rögzítés megőrzése és visszaállítása.
 *
 * Nem az IndexedDB-t teszteljük — azt a böngésző adja. A tesztelendő rész az
 * írások összevonása (hogy ne fojtsuk meg a fő szálat), a versenyhelyzet
 * kizárása (hogy régebbi írás ne írjon felül újabbat), és a döntés arról,
 * mikor ajánlható fel egy félbehagyott futás folytatásra.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createRunPersister,
  isResumable,
  memoryStore,
  prepareForRestore,
  restoreStrategy,
  type PersistedRun,
  type RunStore,
} from './storage';
import {
  applySample,
  createRecorder,
  finish,
  movingMs,
  resume,
  start,
  type RecorderState,
} from './recorder';
import type { PositionSample } from './types';

const T0 = 1_800_000_000_000;
const BASE = { lat: 47.4979, lng: 19.0402 };

function sample(offsetM: number, seconds: number): PositionSample {
  return {
    lat: BASE.lat + offsetM / 111_320,
    lng: BASE.lng,
    t: T0 + seconds * 1000,
    accuracy: 8,
  };
}

function runWithPoints(): RecorderState {
  let state = start(createRecorder('run'), T0);
  state = applySample(state, sample(0, 0));
  state = applySample(state, sample(100, 20));
  return state;
}

/**
 * Tár, amiben az írás addig függőben marad, amíg el nem engedjük.
 *
 * A `release()` a már várakozókat is elengedi, ÉS kikapcsolja a további
 * blokkolást — enélkül a feloldás után sorra kerülő írás megint megállna, és
 * a `flush()` sosem térne vissza.
 */
function controlledStore(): RunStore & { writes: PersistedRun[]; release: () => void } {
  const writes: PersistedRun[] = [];
  const waiting: Array<() => void> = [];
  let blocking = true;
  let value: PersistedRun | null = null;

  return {
    writes,
    release() {
      blocking = false;
      while (waiting.length > 0) waiting.pop()?.();
    },
    async read() {
      return value;
    },
    async write(run) {
      writes.push(run);
      value = run;
      if (!blocking) return;
      await new Promise<void>((resolve) => waiting.push(resolve));
    },
    async clear() {
      value = null;
    },
  };
}

describe('összevont írás', () => {
  it('az első mentés azonnal kimegy', async () => {
    const store = memoryStore();
    const persister = createRunPersister(store, { minIntervalMs: 2000 });

    persister.save(runWithPoints());
    await persister.flush();

    const saved = await store.read();
    expect(saved?.state.points).toHaveLength(2);
  });

  it('a gyors egymásutáni mentéseket egyetlen írásba vonja össze', async () => {
    vi.useFakeTimers();
    try {
      const writes: PersistedRun[] = [];
      const store: RunStore = {
        async read() {
          return null;
        },
        async write(run) {
          writes.push(run);
        },
        async clear() {},
      };

      let clock = T0;
      const persister = createRunPersister(store, { minIntervalMs: 2000, now: () => clock });

      persister.save(runWithPoints()); // azonnal ír
      await Promise.resolve();
      expect(writes).toHaveLength(1);

      // Öt további változás két másodpercen belül → EGY írás.
      for (let i = 0; i < 5; i += 1) {
        clock += 100;
        persister.save(runWithPoints());
      }
      expect(writes).toHaveLength(1);

      clock += 2000;
      await vi.advanceTimersByTimeAsync(2000);
      expect(writes).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a flush a legutolsó állapotot írja ki, nem a legelsőt', async () => {
    const store = memoryStore();
    const persister = createRunPersister(store, { minIntervalMs: 60_000 });

    const early = runWithPoints();
    const late = applySample(early, sample(200, 40));

    persister.save(early);
    persister.save(late);
    await persister.flush();

    expect((await store.read())?.state.points).toHaveLength(3);
  });

  it('nem indít párhuzamos írást — a régebbi nem előzheti meg az újabbat', async () => {
    const store = controlledStore();
    const persister = createRunPersister(store, { minIntervalMs: 0 });

    persister.save(runWithPoints());
    await Promise.resolve();
    expect(store.writes).toHaveLength(1);

    // Amíg az első írás függőben van, a másodiknak várnia kell.
    persister.save(applySample(runWithPoints(), sample(200, 40)));
    await Promise.resolve();
    expect(store.writes).toHaveLength(1);

    store.release();
    await persister.flush();
    expect(store.writes.length).toBeGreaterThanOrEqual(2);
  });

  it('a tároló hibája nem szakítja meg a rögzítést', async () => {
    // Privát böngészés vagy betelt kvóta esetén az írás elutasításra kerül.
    const store: RunStore = {
      async read() {
        return null;
      },
      async write() {
        throw new Error('QuotaExceededError');
      },
      async clear() {},
    };

    const persister = createRunPersister(store, { minIntervalMs: 0 });
    persister.save(runWithPoints());
    await expect(persister.flush()).resolves.toBeUndefined();
  });
});

describe('visszaállíthatóság', () => {
  const fresh = (state: RecorderState, savedAt: number): PersistedRun => ({
    version: 1,
    state,
    savedAt,
  });

  it('friss, félbehagyott futás folytatható', () => {
    expect(isResumable(fresh(runWithPoints(), T0), T0 + 60_000)).toBe(true);
  });

  it('natív WebView-újrainduláskor automatikusan folytat, weben kérdez', () => {
    const saved = fresh(runWithPoints(), T0);
    expect(restoreStrategy(saved, T0 + 1_000, true)).toBe('automatic');
    expect(restoreStrategy(saved, T0 + 1_000, false)).toBe('prompt');
  });

  it('lejárt vagy befejezett mentést natívban sem állít helyre', () => {
    expect(restoreStrategy(fresh(runWithPoints(), T0), T0 + 60 * 60 * 1000 + 1, true)).toBe('discard');
    expect(restoreStrategy(fresh(finish(runWithPoints(), T0 + 30_000), T0), T0 + 31_000, true))
      .toBe('discard');
  });

  it('a befejezett futást nem ajánljuk fel', () => {
    const done = finish(runWithPoints(), T0 + 30_000);
    expect(isResumable(fresh(done, T0), T0 + 60_000)).toBe(false);
  });

  it('a pont nélküli rögzítést nem ajánljuk fel', () => {
    expect(isResumable(fresh(start(createRecorder('run'), T0), T0), T0 + 1000)).toBe(false);
  });

  it('az egy óránál régebbi mentést nem ajánljuk fel', () => {
    // A köztes idő beleszámítana a mozgásidőbe, és a nyomvonal két távoli
    // pontja egyetlen egyenessel kötődne össze.
    expect(isResumable(fresh(runWithPoints(), T0), T0 + 60 * 60 * 1000)).toBe(true);
    expect(isResumable(fresh(runWithPoints(), T0), T0 + 60 * 60 * 1000 + 1)).toBe(false);
  });

  it('a visszaállított állapot folytatható, és a távolság megmarad', async () => {
    const store = memoryStore();
    const persister = createRunPersister(store, { minIntervalMs: 0 });

    const before = runWithPoints();
    persister.save(before);
    await persister.flush();

    const restored = (await store.read())!.state;
    expect(restored.distanceM).toBeCloseTo(before.distanceM, 6);

    // …és a folytatás ugyanúgy viselkedik, mint megszakítás nélkül.
    const continued = applySample(restored, sample(200, 40));
    const uninterrupted = applySample(before, sample(200, 40));
    expect(continued.distanceM).toBeCloseTo(uninterrupted.distanceM, 6);
    expect(continued.points).toHaveLength(3);
  });

  it('a megszakítás óta eltelt időt szünetként kezeli', () => {
    const before = runWithPoints();
    const savedAt = T0 + 10_000;
    const reopenedAt = savedAt + 30 * 60 * 1000;
    const restored = prepareForRestore(fresh(before, savedAt));
    const continued = resume(restored, reopenedAt);

    expect(restored.status).toBe('paused');
    expect(restored.pausedAt).toBe(savedAt);
    expect(movingMs(continued, reopenedAt)).toBe(savedAt - T0);
  });
});
