/**
 * A futó rögzítés megőrzése — hogy egy lapújratöltés ne vigye el a futást.
 *
 * Ez nem kényelmi funkció. A webes rögzítés törékeny: elég egy memóriaszűke
 * miatti lapeldobás, egy véletlen frissítés, vagy hogy a felhasználó
 * visszalép a böngészőben — és az addigi nyomvonal nyomtalanul eltűnne.
 * Natív appnál ugyanez a helyzet az app kilövésekor.
 *
 * MIÉRT INDEXEDDB, ÉS NEM localStorage? A localStorage szinkron: minden írás
 * megállítja a fő szálat. Rögzítés közben másodpercenként írunk, egy órás
 * futás után már 100+ kB-ot — ez akadozó térképet és késleltetett gombokat
 * jelentene. Az IndexedDB aszinkron.
 *
 * MIÉRT INTERFÉSZ MÖGÖTT? Mert az IndexedDB nem létezik a tesztkörnyezetben,
 * és a tesztelendő logika nem is az: az írások összevonása és a visszaállítás
 * a lényeg. Ezek memóriatárral pontosan vizsgálhatók.
 */

import type { RecorderState } from './recorder';

/** A tárolt alak. A `version` a későbbi sémaváltáshoz kell. */
export interface PersistedRun {
  version: 1;
  state: RecorderState;
  /** Mikor mentettük utoljára — a visszaállítás ez alapján dönt frissességről. */
  savedAt: number;
}

export interface RunStore {
  read(): Promise<PersistedRun | null>;
  write(run: PersistedRun): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Ennél régebbi mentést nem ajánlunk fel folytatásra.
 *
 * Egy tegnapi félbehagyott futás folytatása értelmetlen: a köztes idő
 * beleszámítana a mozgásidőbe, és a nyomvonal két távoli pontja egyetlen
 * egyenessel kötődne össze. 12 óra bőven elég egy megszakadt futáshoz való
 * visszatéréshez, és rövid ahhoz, hogy másnap ne zavarjon.
 */
export const MAX_RESUME_AGE_MS = 12 * 60 * 60 * 1000;

export function isResumable(run: PersistedRun, now: number): boolean {
  if (run.version !== 1) return false;
  if (run.state.status === 'finished' || run.state.status === 'idle') return false;
  if (run.state.points.length === 0) return false;
  return now - run.savedAt <= MAX_RESUME_AGE_MS;
}

/* ═══════════════════════════════════════════════════════════════════
   Írás-összevonás
   ═══════════════════════════════════════════════════════════════════ */

export interface RunPersister {
  /** Jelzi, hogy az állapot változott. Az írás összevontan történik. */
  save(state: RecorderState): void;
  /** Azonnali kiírás, a következő írás bevárásával. Leállításkor ez kell. */
  flush(): Promise<void>;
  clear(): Promise<void>;
}

export interface PersisterOptions {
  /** Két írás között eltelő minimális idő. */
  minIntervalMs?: number;
  now?: () => number;
}

/**
 * Miért nem írunk minden mintánál?
 *
 * Mert a teljes állapot kiírása a pontok számával arányos: egy órás futás
 * végén minden minta ~100 kB újraszerializálását jelentené, másodpercenként.
 * Ehelyett legfeljebb kétmásodpercenként írunk, és a közben érkezett
 * változásokat egyetlen írásba vonjuk össze.
 *
 * Az ára pontosan körülhatárolt: összeomláskor legfeljebb az utolsó két
 * másodperc mozgása vész el. Ez néhány méter — a futás nem.
 *
 * Egyszerre CSAK EGY írás lehet folyamatban. Ha közben újabb változás jön,
 * megjegyezzük, és az aktuális írás befejeztével még egyszer kiírjuk. Enélkül
 * párhuzamos írások versenyeznének, és a régebbi felülírhatná az újabbat.
 */
export function createRunPersister(store: RunStore, options: PersisterOptions = {}): RunPersister {
  const minIntervalMs = options.minIntervalMs ?? 2000;
  const now = options.now ?? (() => Date.now());

  let pending: RecorderState | null = null;
  let writing: Promise<void> | null = null;
  let lastWriteAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function writeNow(): Promise<void> {
    const state = pending;
    if (state === null) return;
    pending = null;
    lastWriteAt = now();
    await store.write({ version: 1, state, savedAt: lastWriteAt });
  }

  /** Sorbaállított írás: a folyamatban lévő után fut, nem vele párhuzamosan. */
  function enqueue(): Promise<void> {
    writing = (writing ?? Promise.resolve())
      .then(writeNow)
      .catch(() => {
        // A tárolás elutasíthat: privát böngészés, betelt kvóta, letiltott
        // tárhely. A rögzítés ettől nem állhat meg — a memóriabeli állapot ép,
        // csak az összeomlás utáni visszaállítás nem lesz meg.
      });
    return writing;
  }

  return {
    save(state) {
      pending = state;
      if (timer !== null) return;

      const elapsed = now() - lastWriteAt;
      if (elapsed >= minIntervalMs) {
        void enqueue();
        return;
      }

      timer = setTimeout(() => {
        timer = null;
        void enqueue();
      }, minIntervalMs - elapsed);
    },

    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await enqueue();
    },

    async clear() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      await (writing ?? Promise.resolve());
      await store.clear();
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════
   Tárolók
   ═══════════════════════════════════════════════════════════════════ */

/** Memóriatár — teszthez és olyan környezethez, ahol nincs IndexedDB. */
export function memoryStore(): RunStore {
  let value: PersistedRun | null = null;
  return {
    async read() {
      return value;
    },
    async write(run) {
      value = run;
    },
    async clear() {
      value = null;
    },
  };
}

const DB_NAME = 'grundo';
const DB_VERSION = 1;
const STORE = 'activeRun';
const KEY = 'current';

export function indexedDbSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function indexedDbStore(): RunStore {
  let handle: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    handle ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB megnyitása sikertelen'));
    });
    return handle;
  }

  async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = body(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB művelet sikertelen'));
    });
  }

  return {
    read: () => run<PersistedRun | null>('readonly', (s) => s.get(KEY)).then((v) => v ?? null),
    write: (value) => run<void>('readwrite', (s) => s.put(value, KEY)).then(() => undefined),
    clear: () => run<void>('readwrite', (s) => s.delete(KEY)).then(() => undefined),
  };
}

/** A környezethez illő tár. */
export function defaultRunStore(): RunStore {
  return indexedDbSupported() ? indexedDbStore() : memoryStore();
}
