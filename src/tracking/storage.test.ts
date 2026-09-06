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
  indexedDbStore,
  isPendingUpload,
  isResumable,
  memoryStore,
  prepareForRestore,
  recoverExpiredRun,
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
// Szándékosan PARAMÉTER, nem `GAMEPLAY` import — lásd autoUpload.test.ts fejléce.
const MIN_DISTANCE_M = 100;

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
    await expect(persister.flush()).resolves.toBe(false);
  });
});

/** A valódi IDBRequest minimál-hamisítványa: csak on{success,error} kell. */
interface FakeRequest {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  result: unknown;
  error: Error | null;
}

function makeRequest(): FakeRequest {
  return { onsuccess: null, onerror: null, onupgradeneeded: null, result: undefined, error: null };
}

/**
 * Egy `indexedDB.open()` hamisítvány, ami az első N hívást elbuktatja, utána
 * sikeres — GRUNDO #42 regressziója: az `open()` hibája ne ragadjon be örökre.
 */
function fakeIndexedDbFailingOpens(failCount: number) {
  let attempts = 0;
  const data = new Map<string, unknown>();

  function fakeStore() {
    return {
      get(key: string) {
        const request = makeRequest();
        queueMicrotask(() => {
          request.result = data.get(key);
          request.onsuccess?.();
        });
        return request;
      },
      put(value: unknown, key: string) {
        const request = makeRequest();
        queueMicrotask(() => {
          data.set(key, value);
          request.onsuccess?.();
        });
        return request;
      },
      delete(key: string) {
        const request = makeRequest();
        queueMicrotask(() => {
          data.delete(key);
          request.onsuccess?.();
        });
        return request;
      },
    };
  }

  return {
    open() {
      attempts += 1;
      const request = makeRequest();
      const shouldFail = attempts <= failCount;
      queueMicrotask(() => {
        if (shouldFail) {
          request.error = new Error('átmeneti IndexedDB-nyitási hiba');
          request.onerror?.();
          return;
        }
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => ({ objectStore: fakeStore }),
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

describe('IndexedDB nyitási hiba (GRUNDO #42)', () => {
  it('egy sikertelen open() után a KÖVETKEZŐ írás újrapróbálja, nem ismétli örökre a hibát', async () => {
    const original = globalThis.indexedDB;
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = fakeIndexedDbFailingOpens(1);

    try {
      const store = indexedDbStore();
      const run: PersistedRun = { version: 1, state: runWithPoints(), savedAt: T0 };

      // Az első írás elhasal — ez a #42-ben a néma adatvesztés forrása volt.
      await expect(store.write(run)).rejects.toThrow();

      // A KÖVETKEZŐ írásnak sikerülnie kell — a hibát nem szabad örökre cache-elni.
      await expect(store.write(run)).resolves.toBeUndefined();
      expect(await store.read()).toEqual(run);
    } finally {
      (globalThis as unknown as { indexedDB: unknown }).indexedDB = original;
    }
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

  it('natív WebView-újrainduláskor (rövid kihagyás) automatikusan folytat, weben kérdez', () => {
    const saved = fresh(runWithPoints(), T0);
    expect(restoreStrategy(saved, T0 + 1_000, true)).toBe('automatic');
    expect(restoreStrategy(saved, T0 + 1_000, false)).toBe('prompt');
  });

  describe('natív, HOSSZABB kihagyás után is megkérdez (GRUNDO #42)', () => {
    it('a 2 perces csendes ablakon belül még automatikus', () => {
      const saved = fresh(runWithPoints(), T0);
      expect(restoreStrategy(saved, T0 + 2 * 60 * 1000, true)).toBe('automatic');
    });

    it('a 2 perces ablakon túl natívon is megkérdez, nem folytat csendben', () => {
      const saved = fresh(runWithPoints(), T0);
      expect(restoreStrategy(saved, T0 + 2 * 60 * 1000 + 1, true)).toBe('prompt');
    });

    it('egy valódi, órákkal későbbi force-quit utáni visszatérés is kérdez, nem discard', () => {
      // Az 1 órás ablakon belül vagyunk, csak a natív csendes puffert lépi túl.
      const saved = fresh(runWithPoints(), T0);
      expect(restoreStrategy(saved, T0 + 45 * 60 * 1000, true)).toBe('prompt');
    });
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

  it('a befejezett futást feltöltésre korlátlan ideig megőrzi', () => {
    const done = finish(runWithPoints(), T0 + 30_000);
    expect(isPendingUpload(fresh(done, T0))).toBe(true);
    expect(isPendingUpload(fresh(done, T0 - 30 * 24 * 60 * 60 * 1000))).toBe(true);
    expect(isPendingUpload(fresh(runWithPoints(), T0))).toBe(false);
  });

  it('a pont nélküli rögzítést nem ajánljuk fel', () => {
    expect(isResumable(fresh(start(createRecorder('run'), T0), T0), T0 + 1000)).toBe(false);
  });

  describe('lejárt mentés — mégis menthető feltöltésre (GRUNDO #42)', () => {
    it('elég hosszú, lejárt mentésből lezárt, feltöltésre kész állapotot ad', () => {
      const long = applySample(applySample(start(createRecorder('ride'), T0), sample(0, 0)), sample(200, 40));
      const recovered = recoverExpiredRun(fresh(long, T0 + 40_000), MIN_DISTANCE_M);

      expect(recovered).not.toBeNull();
      expect(recovered?.status).toBe('finished');
      expect(recovered?.endedAt).toBe(T0 + 40_000);
      expect(recovered?.distanceM).toBeGreaterThanOrEqual(MIN_DISTANCE_M);
    });

    it('túl rövid, lejárt mentést nem ment meg — nincs mit feltölteni', () => {
      const short = applySample(applySample(start(createRecorder('run'), T0), sample(0, 0)), sample(10, 5));
      expect(recoverExpiredRun(fresh(short, T0 + 5_000), MIN_DISTANCE_M)).toBeNull();
    });

    it('a lezárás az utolsó ismert mentési időponttal történik, nem a jelennel', () => {
      const long = applySample(applySample(start(createRecorder('ride'), T0), sample(0, 0)), sample(200, 40));
      const savedAt = T0 + 40_000;
      const recovered = recoverExpiredRun(fresh(long, savedAt), MIN_DISTANCE_M);
      // Ha a jelennel zárnánk le, a mozgásidő tévesen tartalmazná a felfedezésig eltelt (akár órás) szünetet is.
      expect(recovered?.endedAt).not.toBe(Date.now());
      expect(recovered?.endedAt).toBe(savedAt);
    });
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
