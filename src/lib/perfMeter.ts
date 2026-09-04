import { Capacitor } from '@capacitor/core';

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
 * mintánként két időbélyeg és néhány számláló — a mérendő művelet
 * nagyságrendekkel drágább ennél.
 *
 * A kijelzést a `components/PerfOverlay.tsx` végzi, másodpercenként egyszer
 * olvasva — a rögzítés hurka sosem rajzol újra emiatt.
 *
 * ── MIÉRT TÖBB EZ, MINT EGY ÁTLAG (GRUNDO #37, 2026-09-04) ───────────────
 *
 * Az első terepi mérés (`docs/ai/meres-2026-09-04-terepi-fosszal.md`) egy
 * **859 ms**-os blokkot talált a Samsungon. Hogy ez a háttérből visszatéréskor
 * keletkezett, azt CSAK KÖVETKEZTETNI lehetett — abból, hogy a `lastMs` és a
 * `maxMs` egybeesett. A mérő ugyanis kizárólag összesítést tartott: nem tudta,
 * MIKOR és MILYEN ÁLLAPOTBAN futott le egy-egy mérés.
 *
 * Egy megismételt terepmérés Gerinek idő és kilométer, ezért a mérő azóta
 * NÉGY dolgot rögzít az átlag mellett:
 *
 *   1. **Láthatóság szerinti bontás** — mennyi futott előtérben és háttérben;
 *   2. **A háttérből VISSZATÉRŐ futások külön** (indulás rejtve, befejezés
 *      láthatóan) — pontosan ez volt a 859 ms;
 *   3. **A legdrágább futások teljes körülménnyel** — időbélyeg, láthatóság
 *      indulásnál és a végén, és a kísérőszámok abban a pillanatban;
 *   4. **Percenkénti bontás** — így a költség NÖVEKEDÉSE is látszik, amit
 *      eddig csak asztali újrajátszásból lehetett kikövetkeztetni (×5,6 volt
 *      8,6 km alatt).
 */

/** Ennyi legutóbbi mintából számoljuk az átlagot és a p95-öt. */
const WINDOW_SIZE = 120;

const ENABLED_KEY = 'grundo.perf.meter.v1';
const HISTORY_KEY = 'grundo.perf.meter.history.v1';

/** Ennyi mentett mérést őrzünk meg — a régebbi lekerül, ha betelik. */
const HISTORY_LIMIT = 30;

/** Kulcsonként ennyi legdrágább futást őrzünk meg, körülménnyel együtt. */
const WORST_PER_KEY = 8;

/**
 * Ennyi láthatóság-váltást jegyzünk fel.
 *
 * Egy valódi menetben tíz-húsz váltás van; a plafon a beragadt kapcsolgatás
 * ellen véd (pl. egy értesítés-sorozat), hogy a mentett dokumentum ne
 * hízzon el.
 */
const MAX_VISIBILITY_MARKS = 240;

/** Ennyi perc-sort tartunk meg összesen (kulcsonként külön sorokkal együtt). */
const MAX_BUCKETS = 480;

export type PerfVisibility = 'visible' | 'hidden';

/**
 * Egy futás kísérő körülménye, amit CSAK A HÍVÓ tud.
 *
 * A `startedVisibility` azért nem olvasható itt, mert a mérendő munka a
 * workerben fut: mire az eredmény a főszálra ér, a láthatóság már más lehet —
 * és éppen ez a különbség az érdekes.
 */
export interface PerfContext {
  startedVisibility?: PerfVisibility;
}

/** Egy nevezetes (drága) futás, teljes körülménnyel. */
export interface PerfEvent {
  key: string;
  ms: number;
  /** `Date.now()` a futás végén. */
  at: number;
  /** Ennyi ezredmásodperccel a mérés indulása után. */
  sinceStartMs: number;
  startedVisibility: PerfVisibility;
  endedVisibility: PerfVisibility;
  /** A kísérőszámok (`notePerf`) abban a pillanatban. */
  notes: Record<string, number>;
}

/** Egy láthatóság-váltás. */
export interface PerfVisibilityMark {
  state: PerfVisibility;
  at: number;
  sinceStartMs: number;
}

/** Percenkénti összesítés kulcsonként — ebből látszik a NÖVEKEDÉS. */
export interface PerfBucket {
  key: string;
  /** Hányadik perc a mérés indulása óta. */
  minute: number;
  runs: number;
  totalMs: number;
  maxMs: number;
  /** Ebből hány futott úgy, hogy a felület rejtve volt. */
  hiddenRuns: number;
}

interface VisibilityTally {
  count: number;
  total: number;
  max: number;
}

interface Ring {
  /** Körkörös puffer; `count` alatt csak az első `count` elem érvényes. */
  values: number[];
  next: number;
  count: number;
  total: number;
  last: number;
  max: number;
  /** A TELJES mérés összege — az ablakos átlag mellé. */
  lifetimeTotal: number;
  visible: VisibilityTally;
  hidden: VisibilityTally;
  /** Háttérből visszatérve lezajlott futások: indulás rejtve, vég láthatóan. */
  resumed: VisibilityTally;
  worst: PerfEvent[];
}

const rings = new Map<string, Ring>();
const notes = new Map<string, number>();
const visibilityMarks: PerfVisibilityMark[] = [];
const buckets = new Map<string, PerfBucket>();

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

/**
 * A JELENLEGI láthatóság, eseményből karbantartva.
 *
 * Nem hívásonként olvassuk a `document`-et: a mérő a mérendő munka mellett fut,
 * és fölösleges property-olvasás lenne a legrosszabb helyen.
 */
let visibility: PerfVisibility = 'visible';
let listening = false;

function readEnabledFlag(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    // Privát mód vagy letiltott tárhely: a mérő ilyenkor egyszerűen kikapcsolt.
    return false;
  }
}

function currentVisibility(): PerfVisibility {
  try {
    return document.visibilityState === 'hidden' ? 'hidden' : 'visible';
  } catch {
    // Worker vagy teszt: ott nincs `document`, és nincs is mit rejteni.
    return 'visible';
  }
}

function onVisibilityChange(): void {
  const next = currentVisibility();
  if (next === visibility) return;
  visibility = next;
  if (visibilityMarks.length >= MAX_VISIBILITY_MARKS) return;
  const at = Date.now();
  visibilityMarks.push({ state: next, at, sinceStartMs: since === 0 ? 0 : at - since });
}

function startListening(): void {
  if (listening) return;
  try {
    document.addEventListener('visibilitychange', onVisibilityChange);
    listening = true;
    visibility = currentVisibility();
  } catch {
    // Nincs DOM — a mérő ettől még működik, csak láthatóság-bontás nélkül.
  }
}

function stopListening(): void {
  if (!listening) return;
  try {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  } catch {
    // Ha nem lehetett felvenni, leszedni sem kell.
  }
  listening = false;
}

if (enabled) startListening();

export function perfMeterEnabled(): boolean {
  return enabled;
}

export function setPerfMeterEnabled(value: boolean): void {
  enabled = value;
  if (value) startListening();
  else {
    stopListening();
    resetPerfMeter();
  }
  try {
    localStorage.setItem(ENABLED_KEY, value ? '1' : '0');
  } catch {
    // A beállítás megőrzése kényelem, nem feltétel.
  }
}

function emptyTally(): VisibilityTally {
  return { count: 0, total: 0, max: 0 };
}

function ringOf(key: string): Ring {
  const existing = rings.get(key);
  if (existing) return existing;
  const created: Ring = {
    values: [],
    next: 0,
    count: 0,
    total: 0,
    last: 0,
    max: 0,
    lifetimeTotal: 0,
    visible: emptyTally(),
    hidden: emptyTally(),
    resumed: emptyTally(),
    worst: [],
  };
  rings.set(key, created);
  return created;
}

function addToTally(tally: VisibilityTally, ms: number): void {
  tally.count += 1;
  tally.total += ms;
  if (ms > tally.max) tally.max = ms;
}

/** A legdrágább futások listája — rendezve tartva, fix hosszon. */
function rememberWorst(ring: Ring, event: PerfEvent): void {
  if (ring.worst.length >= WORST_PER_KEY) {
    const weakest = ring.worst[ring.worst.length - 1]!;
    if (event.ms <= weakest.ms) return;
    ring.worst.pop();
  }
  let index = ring.worst.length;
  while (index > 0 && ring.worst[index - 1]!.ms < event.ms) index -= 1;
  ring.worst.splice(index, 0, event);
}

function bucketFor(key: string, minute: number): PerfBucket | null {
  const id = `${key}@${minute}`;
  const existing = buckets.get(id);
  if (existing) return existing;
  if (buckets.size >= MAX_BUCKETS) return null;
  const created: PerfBucket = { key, minute, runs: 0, totalMs: 0, maxMs: 0, hiddenRuns: 0 };
  buckets.set(id, created);
  return created;
}

export function recordPerf(key: string, ms: number, context?: PerfContext): void {
  if (!enabled) return;
  const at = Date.now();
  if (since === 0) since = at;
  const sinceStartMs = at - since;

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
  ring.lifetimeTotal += ms;
  if (ms > ring.max) ring.max = ms;

  const endedVisibility = visibility;
  const startedVisibility = context?.startedVisibility ?? endedVisibility;
  addToTally(endedVisibility === 'hidden' ? ring.hidden : ring.visible, ms);
  /**
   * A HÁTTÉRBŐL VISSZATÉRŐ futás külön számláló. Ez az a fajta, ami a
   * 2026-09-04-i mérésen 859 ms-ot tett a főszálra: a rejtve töltött idő alatt
   * felgyűlt minták egyetlen kötegben kerülnek feldolgozásra.
   */
  if (startedVisibility === 'hidden' && endedVisibility === 'visible') {
    addToTally(ring.resumed, ms);
  }

  rememberWorst(ring, {
    key,
    ms,
    at,
    sinceStartMs,
    startedVisibility,
    endedVisibility,
    notes: Object.fromEntries(notes),
  });

  const bucket = bucketFor(key, Math.floor(sinceStartMs / 60_000));
  if (bucket !== null) {
    bucket.runs += 1;
    bucket.totalMs += ms;
    if (ms > bucket.maxMs) bucket.maxMs = ms;
    if (endedVisibility === 'hidden') bucket.hiddenRuns += 1;
  }
}

/** Megméri a hívást, és ugyanazt adja vissza, amit az. */
export function measurePerf<T>(key: string, run: () => T): T {
  if (!enabled) return run();
  const startedVisibility = visibility;
  const startedAt = performance.now();
  try {
    return run();
  } finally {
    recordPerf(key, performance.now() - startedAt, { startedVisibility });
  }
}

/**
 * A jelenlegi láthatóság — a hívó ezzel jelöli meg, milyen állapotban INDULT
 * egy hosszabb, aszinkron munka (pl. a worker felé küldött előnézet).
 */
export function perfVisibility(): PerfVisibility {
  return visibility;
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
  /**
   * A TELJES mérés összege. Ebből jön a kitöltési tényező (mennyi ideig volt
   * egyáltalán foglalt a szál), amit az ablakos átlagból nem lehet
   * visszaszámolni — a 2026-09-04-i mérésnél ezt asztali újrajátszásból
   * kellett pótolni.
   */
  totalMs: number;
  /** Előtérben mért futások: darab, összeg, maximum. */
  visibleCount: number;
  visibleTotalMs: number;
  visibleMaxMs: number;
  /** Háttérben mért futások. */
  hiddenCount: number;
  hiddenTotalMs: number;
  hiddenMaxMs: number;
  /** Háttérből visszatérve lezajlott futások — a torlódás mutatója. */
  resumedCount: number;
  resumedTotalMs: number;
  resumedMaxMs: number;
}

export interface PerfSnapshot {
  stats: PerfStat[];
  notes: [string, number][];
  /** A legdrágább futások kulcsonként, teljes körülménnyel. */
  events: PerfEvent[];
  /** Láthatóság-váltások a mérés alatt. */
  visibility: PerfVisibilityMark[];
  /** Percenkénti bontás kulcsonként. */
  buckets: PerfBucket[];
  /** A mérés indulása (`Date.now()`), 0 ha még nem indult. */
  startedAt: number;
  /** Eltelt idő a mérés indulása óta. */
  elapsedMs: number;
  /** A pillanatnyi láthatóság. */
  visibleNow: boolean;
}

export function readPerfSnapshot(): PerfSnapshot {
  // 10 másodperc alatt a percre vetített gyakoriság még félrevezetően ugrál.
  const elapsedMs = since === 0 ? 0 : Date.now() - since;
  const rateReady = elapsedMs >= 10_000;

  const stats: PerfStat[] = [];
  const events: PerfEvent[] = [];
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
      totalMs: ring.lifetimeTotal,
      visibleCount: ring.visible.count,
      visibleTotalMs: ring.visible.total,
      visibleMaxMs: ring.visible.max,
      hiddenCount: ring.hidden.count,
      hiddenTotalMs: ring.hidden.total,
      hiddenMaxMs: ring.hidden.max,
      resumedCount: ring.resumed.count,
      resumedTotalMs: ring.resumed.total,
      resumedMaxMs: ring.resumed.max,
    });
    for (const event of ring.worst) events.push(event);
  }

  events.sort((a, b) => b.ms - a.ms);

  return {
    stats,
    notes: [...notes],
    events,
    visibility: [...visibilityMarks],
    buckets: [...buckets.values()].sort((a, b) => a.minute - b.minute || a.key.localeCompare(b.key)),
    startedAt: since,
    elapsedMs,
    visibleNow: visibility === 'visible',
  };
}

export function resetPerfMeter(): void {
  rings.clear();
  notes.clear();
  visibilityMarks.length = 0;
  buckets.clear();
  since = 0;
}

/**
 * Egy mentett mérés — a `readPerfSnapshot()` eredménye, kiegészítve azzal,
 * HOL és MIKOR készült.
 *
 * MIÉRT KELL: az élő kijelzés (`PerfOverlay`) eltűnik a képernyő bezárásával,
 * tehát terepteszt után semmi sem marad belőle — Geri jelezte, hogy csak a
 * pillanatnyi számot látja, elemzésre nem tudja visszakeresni. A `platform`
 * azért kell, mert asztali és telefonos mérés között nagyságrendi a
 * különbség (lásd `docs/ai/CURRENT_STATE.md` #33 táblázata) — mentés nélkül
 * ez összekeveredne.
 */
export interface PerfHistoryEntry {
  id: string;
  /** `Date.now()` a mentés pillanatában. */
  at: number;
  /**
   * A mérő által adott rövid jelölés, pl. „háttér" / „előtér".
   *
   * MIÉRT: két azonos típusú készülék mérése azonos `platform`-mal és szinte
   * azonos user agenttel érkezik, tehát a listában csak az időbélyeg
   * különböztetné meg őket — épp az összehasonlító mérésnél veszne el, melyik
   * melyik.
   */
  label?: string;
  /** Capacitor platform (`ios`/`android`/`web`) — natív buildben pontos. */
  platform: string;
  userAgent: string;
  stats: PerfStat[];
  notes: [string, number][];
  /**
   * A legdrágább futások körülménnyel — lásd `PerfEvent`.
   *
   * ⚠️ A MENTÉS GOMBJÁT CSAK ELŐTÉRBEN lehet megnyomni. Ha a menet háttérben
   * ért véget, az utolsó láthatóság-váltás épp a mentés miatt történt — az
   * utolsó, jellemzően legdrágább futás körülménye enélkül értelmezhetetlen
   * lenne. A `visibility` lista ezt is tartalmazza, időbélyeggel.
   */
  events: PerfEvent[];
  /** Láthatóság-váltások a mérés alatt. */
  visibility: PerfVisibilityMark[];
  /** Percenkénti bontás. */
  buckets: PerfBucket[];
  /** A mérés indulása és hossza — az események ehhez képest értendők. */
  startedAt: number;
  elapsedMs: number;
  /**
   * Feljutott-e már a szerverre. A mentés a hálózattól FÜGGETLENÜL sikerül —
   * futás közben a telefonon gyakran nincs kapcsolat, és a mérés akkor sem
   * veszhet el —, a feltöltés pedig később pótolható az admin felületről.
   */
  synced?: boolean;
}

function readHistoryRaw(): PerfHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PerfHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeHistoryRaw(entries: PerfHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // Tele a tárhely vagy privát mód — a mentés elmarad, a mérés attól még megy.
  }
}

function newHistoryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Elmenti a JELENLEGI mérést a helyi előzménybe. `null`, ha nincs mit menteni
 * (kikapcsolt mérő, vagy még egyetlen minta sem gyűlt össze).
 */
export function savePerfSnapshot(label = ''): PerfHistoryEntry | null {
  const snapshot = readPerfSnapshot();
  if (snapshot.stats.length === 0) return null;
  const entry: PerfHistoryEntry = {
    id: newHistoryId(),
    at: Date.now(),
    label: label.trim().slice(0, 60),
    platform: Capacitor.getPlatform(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    stats: snapshot.stats,
    notes: snapshot.notes,
    events: snapshot.events,
    visibility: snapshot.visibility,
    buckets: snapshot.buckets,
    startedAt: snapshot.startedAt,
    elapsedMs: snapshot.elapsedMs,
  };
  const next = [entry, ...readHistoryRaw()].slice(0, HISTORY_LIMIT);
  writeHistoryRaw(next);
  return entry;
}

/** A mentett mérések, legújabb elöl. */
export function readPerfHistory(): PerfHistoryEntry[] {
  return readHistoryRaw();
}

/** Sikeres feltöltés után jelöli a helyi bejegyzést, hogy ne kelljen újraküldeni. */
export function markPerfSnapshotSynced(id: string): void {
  const entries = readHistoryRaw();
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.id !== id || entry.synced === true) return entry;
    changed = true;
    return { ...entry, synced: true };
  });
  if (changed) writeHistoryRaw(next);
}

export function clearPerfHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // Nincs mit tenni — lásd `writeHistoryRaw`.
  }
}
