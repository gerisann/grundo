/**
 * Mérőóra a rögzítés közbeni főszál-terheléshez.
 *
 * MIÉRT VAN RÁ SZÜKSÉG: a preview-lánc költsége csak VALÓDI eszközön dönthető
 * el. Az asztali mérés (GRUNDO #32, `tmp/perf/`) megmutatta, hogy a
 * `processActivityGeometry()` a hurok bezárása után minden GPS-mintánál
 * újraszámol — de hogy ez egy telefonon 5 ms vagy 200 ms, azt csak ott lehet
 * leolvasni. Enélkül a terepteszt csak annyit mond, hogy „akadozik".
 *
 * MIÉRT NEM DRÁGA: kikapcsolt állapotban a `measure()` egyetlen boolean
 * vizsgálat, és a `performance.now()` hívások is elmaradnak. Bekapcsolva
 * mintánként két időbélyeg és egy tömbindex-írás — a mérendő művelet
 * nagyságrendekkel drágább ennél.
 *
 * A kijelzést a `components/PerfOverlay.tsx` végzi, másodpercenként egyszer
 * olvasva — a rögzítés hurka sosem rajzol újra emiatt.
 */

/** Ennyi legutóbbi mintából számoljuk az átlagot és a p95-öt. */
const WINDOW_SIZE = 120;

const ENABLED_KEY = 'grundo.perf.meter.v1';

interface Ring {
  /** Körkörös puffer; `count` alatt csak az első `count` elem érvényes. */
  values: number[];
  next: number;
  count: number;
  total: number;
  last: number;
  max: number;
}

const rings = new Map<string, Ring>();
const notes = new Map<string, number>();

/**
 * Az első mérés időpontja a nullázás óta.
 *
 * A gyakoriság ugyanolyan fontos, mint az időtartam: a preview NEM minden
 * GPS-mintánál fut újra, hanem új H3 cellánál vagy 25 méterenként
 * (`TrackingScreen` `useMemo` függőségei). 20 ms újraszámolás
 * másodpercenként egészen mást jelent, mint tízmásodpercenként.
 */
let since = 0;

let enabled = readEnabledFlag();

function readEnabledFlag(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    // Privát mód vagy letiltott tárhely: a mérő ilyenkor egyszerűen kikapcsolt.
    return false;
  }
}

export function perfMeterEnabled(): boolean {
  return enabled;
}

export function setPerfMeterEnabled(value: boolean): void {
  enabled = value;
  if (!value) resetPerfMeter();
  try {
    localStorage.setItem(ENABLED_KEY, value ? '1' : '0');
  } catch {
    // A beállítás megőrzése kényelem, nem feltétel.
  }
}

function ringOf(key: string): Ring {
  const existing = rings.get(key);
  if (existing) return existing;
  const created: Ring = { values: [], next: 0, count: 0, total: 0, last: 0, max: 0 };
  rings.set(key, created);
  return created;
}

export function recordPerf(key: string, ms: number): void {
  if (!enabled) return;
  if (since === 0) since = Date.now();
  const ring = ringOf(key);
  if (ring.values.length < WINDOW_SIZE) {
    ring.values.push(ms);
  } else {
    const replaced = ring.values[ring.next] ?? 0;
    ring.total -= replaced;
    ring.values[ring.next] = ms;
  }
  ring.next = (ring.next + 1) % WINDOW_SIZE;
  ring.total += ms;
  ring.count += 1;
  ring.last = ms;
  if (ms > ring.max) ring.max = ms;
}

/** Megméri a hívást, és ugyanazt adja vissza, amit az. */
export function measurePerf<T>(key: string, run: () => T): T {
  if (!enabled) return run();
  const startedAt = performance.now();
  try {
    return run();
  } finally {
    recordPerf(key, performance.now() - startedAt);
  }
}

/**
 * Kísérő szám, nem időtartam — pl. hány hurok vagy hány cella van éppen.
 * Enélkül a leolvasott ezredmásodperc nem értelmezhető.
 */
export function notePerf(key: string, value: number): void {
  if (!enabled) return;
  notes.set(key, value);
}

export interface PerfStat {
  key: string;
  /** Hány mérés történt a bekapcsolás óta. */
  count: number;
  lastMs: number;
  avgMs: number;
  /** A teljes mérés legrosszabb értéke, nem csak az ablaké. */
  maxMs: number;
  /** Az ablak 95. percentilise — a ritka, de érezhető akadások mutatója. */
  p95Ms: number;
  /** Hányszor futott percenként. `null`, ha még túl rövid a mérés. */
  perMinute: number | null;
}

export interface PerfSnapshot {
  stats: PerfStat[];
  notes: [string, number][];
}

export function readPerfSnapshot(): PerfSnapshot {
  // 10 másodperc alatt a percre vetített gyakoriság még félrevezetően ugrál.
  const elapsedMs = since === 0 ? 0 : Date.now() - since;
  const rateReady = elapsedMs >= 10_000;

  const stats: PerfStat[] = [];
  for (const [key, ring] of rings) {
    const windowSize = ring.values.length;
    if (windowSize === 0) continue;
    const sorted = [...ring.values].sort((a, b) => a - b);
    const rank = Math.min(windowSize - 1, Math.floor(windowSize * 0.95));
    stats.push({
      key,
      count: ring.count,
      lastMs: ring.last,
      avgMs: ring.total / windowSize,
      maxMs: ring.max,
      p95Ms: sorted[rank] ?? 0,
      perMinute: rateReady ? (ring.count / elapsedMs) * 60_000 : null,
    });
  }
  return { stats, notes: [...notes] };
}

export function resetPerfMeter(): void {
  rings.clear();
  notes.clear();
  since = 0;
}
