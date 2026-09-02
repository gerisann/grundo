/**
 * A rögzítés állapotgépe — tiszta redukció, mellékhatás nélkül.
 *
 * Minden művelet új állapotot ad vissza, és semmit nem tud a böngészőről,
 * a térképről vagy a hálózatról. Ennek két oka van, és egyik sem esztétikai:
 *
 *   1. TESZTELHETŐSÉG. A rögzítés hibái (jelvesztés, ugrás, szünet, ébredés
 *      utáni kötegelt szállítás) valós terepen nehezen reprodukálhatók.
 *      Tiszta függvényként viszont pontosan előállíthatók.
 *
 *   2. PERZISZTÁLHATÓSÁG. Böngészőben a lap újratöltése elvinné a futást, ha
 *      az állapot csak a memóriában élne. Sorosítható állapotból viszont
 *      minden elfogadott minta után lementhető, és onnan folytatható.
 *
 * SORRENDEN KÍVÜLI MINTÁK. A natív háttérszolgáltatások ébredés után
 * kötegelve szállítanak, és a köteg tartalmazhat a legutóbbinál korábbi
 * időbélyeget. Ezért a minták beszúrása időrendben történik, nem egyszerű
 * hozzáfűzéssel. A gyakori eset (a minta a végére kerül) így is O(1);
 * beszúrásnál a távolságot újraszámoljuk, mert a szakaszhatárok elmozdulnak.
 */

import type { ActivityType, TracePoint } from '@/types';
import { distanceM } from '@/game/geo';
import { evaluate, FILTER, type FilterVerdict } from './filter';
import type { PositionSample } from './types';

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'finished';

/** Egy kör kezdete. */
export interface LapMark {
  /** Mikor kezdődött, epoch ms. */
  at: number;
  /** Mennyi volt az összes megtett táv ekkor, méterben. */
  distanceM: number;
}

export interface RecorderState {
  /**
   * A rögzítés azonosítója, MÁR AZ INDULÁSKOR.
   *
   * Ez teszi a feltöltést idempotenssé: ha a hálózat elszáll és újrapróbáljuk,
   * a szerver felismeri, hogy ugyanarról az aktivitásról van szó, és nem írja
   * be kétszer. Ha csak a feltöltéskor kapna azonosítót, két próbálkozás két
   * különböző aktivitás lenne — duplán foglalt területtel.
   */
  id: string;
  status: RecorderStatus;
  /**
   * Az aktivitás típusa, NEM a réteg.
   *
   * A réteg (`foot`/`bike`) ebből következik — fordítva nem: a `foot` rétegből
   * nem derül ki, futás volt-e vagy séta, márpedig a GP-számítás és az
   * összegzés különbözőképp kezeli őket. A leképezést a `layerOf()` végzi;
   * itt szándékosan nem hívjuk, hogy ez a modul ne rántsa be a h3-js-t.
   */
  type: ActivityType;
  /** Az elfogadott pontok, MINDIG időrendben. Ezt kapja a játékmotor. */
  points: TracePoint[];
  /** Megtett távolság méterben. */
  distanceM: number;
  /**
   * A jelenlegi HORGONY — az a pont, amihez a legutóbbi tényleges elmozdulást
   * mértük. Amíg az új minták ennek `FILTER.STATIONARY_RADIUS_M` körén belül
   * maradnak, nem számítanak elmozdulásnak (lásd `filter.ts`
   * `STATIONARY_RADIUS_M` és `anchoredTotal`). `null`, amíg az első pont be
   * nem érkezett.
   */
  anchor: TracePoint | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Szüneteltetéssel töltött idő összesen, ms. */
  pausedMs: number;
  /** Mikor kezdődött a jelenlegi szünet (null, ha nincs szünet). */
  pausedAt: number | null;
  /**
   * A körhatárok — minden elem egy kör KEZDETE.
   *
   * Miért nem a pontok indexe? Mert sorrenden kívüli minta beszúrásakor az
   * indexek elcsúsznának, és a körök visszamenőleg átrendeződnének. Az
   * időbélyeg és a hozzá tartozó távolság viszont rögzített tény.
   */
  laps: LapMark[];
  /** Diagnosztika: elutasított minták száma okonként. */
  rejected: Record<string, number>;
}

export function createRecorder(type: ActivityType, id = newActivityId()): RecorderState {
  return {
    id,
    status: 'idle',
    type,
    points: [],
    distanceM: 0,
    anchor: null,
    startedAt: null,
    endedAt: null,
    pausedMs: 0,
    pausedAt: null,
    laps: [],
    rejected: {},
  };
}

export function start(state: RecorderState, now: number): RecorderState {
  if (state.status !== 'idle') return state;
  // Az első kör a rögzítés indulásakor kezdődik — így nincs olyan szakasz,
  // ami egyik körhöz sem tartozik.
  return { ...state, status: 'recording', startedAt: now, laps: [{ at: now, distanceM: 0 }] };
}

/**
 * Új kör kezdése.
 *
 * Szünet alatt is megengedett: a felhasználó megállhat, körözhet, majd
 * folytathat. A kör kezdete ilyenkor a szünet pillanata.
 */
export function markLap(state: RecorderState, now: number): RecorderState {
  if (state.status !== 'recording' && state.status !== 'paused') return state;
  const last = state.laps[state.laps.length - 1];
  // Ugyanabban a pillanatban két kört nyitni értelmetlen — üres kör lenne.
  if (last !== undefined && last.at === now && last.distanceM === state.distanceM) return state;
  return { ...state, laps: [...state.laps, { at: now, distanceM: state.distanceM }] };
}

/** A körök hossza méterben, a legutolsó a folyamatban lévő. */
export function lapDistances(state: RecorderState): number[] {
  return state.laps.map((lap, index) => {
    const next = state.laps[index + 1];
    return (next?.distanceM ?? state.distanceM) - lap.distanceM;
  });
}

export function pause(state: RecorderState, now: number): RecorderState {
  if (state.status !== 'recording') return state;
  return { ...state, status: 'paused', pausedAt: now };
}

export function resume(state: RecorderState, now: number): RecorderState {
  if (state.status !== 'paused') return state;
  const pausedMs = state.pausedMs + (state.pausedAt === null ? 0 : now - state.pausedAt);
  return { ...state, status: 'recording', pausedAt: null, pausedMs };
}

export function finish(state: RecorderState, now: number): RecorderState {
  if (state.status !== 'recording' && state.status !== 'paused') return state;
  // Ha szünet közben állunk le, a folyamatban lévő szünetet is le kell zárni,
  // különben a szünet ideje beleszámítana a mozgásidőbe.
  const pausedMs =
    state.status === 'paused' && state.pausedAt !== null
      ? state.pausedMs + (now - state.pausedAt)
      : state.pausedMs;
  return { ...state, status: 'finished', endedAt: now, pausedAt: null, pausedMs };
}

/**
 * El kell-e indítani MAGÁTÓL a befejezett rögzítés feltöltését?
 *
 * ⚠️ KÜLÖN, TISZTA FÜGGVÉNY, mert ez egy éles adatvesztés javítása
 * (2026-08-26). A feltétel korábban a `TrackingScreen` egyik hatásában élt, a
 * Befejezés gomb viszont a `Dock`-ban van, ami MINDEN képernyőn ott van. Aki
 * rögzítés közben elhagyta a rögzítés képernyőjét és onnan fejezte be a
 * mérést, annál a feltöltés soha nem indult el — a futása némán elveszett.
 *
 * A döntés innentől a rögzítő rétegé (`useRecorder`), ami a router FÖLÖTT ül,
 * tehát nem tud kikerülni a komponensfa alól. Ha valaki visszaköltöztetné egy
 * képernyőbe, a hiba visszajön — ezért rögzíti teszt is.
 *
 * @param uploadStatus a feltöltés állapota; csak `idle`-ből indulhat, hogy a
 *   lassú mentés alatt ne induljon el másodszor is.
 */
export function shouldAutoUpload(
  state: Pick<RecorderState, 'status' | 'distanceM'>,
  uploadStatus: 'idle' | 'sending' | 'processing' | 'done' | 'error',
  minDistanceM: number,
): boolean {
  if (state.status !== 'finished') return false;
  if (uploadStatus !== 'idle') return false;
  // A küszöb alatti mozgás nem aktivitás — a szerver is elutasítaná, tehát a
  // felhasználó csak egy fölösleges hibaüzenetet kapna tőle.
  return state.distanceM >= minDistanceM;
}

/**
 * Egy beérkezett minta feldolgozása.
 *
 * Szünet alatt és leállás után eldobjuk: a natív forrás ilyenkor is küldhet,
 * mert a leiratkozás nem pillanatszerű.
 */
export function applySample(state: RecorderState, sample: PositionSample): RecorderState {
  if (state.status !== 'recording') return state;

  const index = insertionIndex(state.points, sample.t);
  const previous = index > 0 ? (state.points[index - 1] as TracePoint) : null;

  /**
   * A szűrés az időben ELŐTTE álló ponthoz mér, nem a nyomvonal végéhez.
   *
   * Sorrenden kívüli mintánál ez a különbség dönt: egy utólag érkező, időben
   * középre való pont a nyomvonal végéhez hasonlítva ugrásnak látszana, és
   * kidobnánk — pedig a saját szomszédjához képest teljesen szabályos.
   *
   * Amit ez NEM old meg: a beszúrt pont után álló pontot már nem értékeljük
   * újra, tehát egy rossz beszúrás egy szakaszon meghagyhat egy irreális
   * ugrást. Elfogadott korlát — már elfogadott pontot visszamenőleg nem
   * dobunk ki, mert azzal a nyomvonal a felhasználó szeme előtt változna meg.
   */
  const verdict = evaluate(sample, previous);
  if (!verdict.accept) return withRejection(state, verdict);

  const point: TracePoint = {
    lat: sample.lat,
    lng: sample.lng,
    t: sample.t,
    ...(Number.isFinite(sample.accuracy) ? { accuracy: sample.accuracy } : {}),
    ...(sample.elevation !== undefined ? { elevation: sample.elevation } : {}),
  };

  // A gyakori eset: a minta a nyomvonal végére kerül. Ilyenkor elég a
  // horgonyhoz mérni. Beszúrásnál viszont két szakasz alakul át eggyé-kettővé,
  // ezért a teljes horgony-alapú összeget újraszámoljuk — ritka, és így nem
  // kell a részleges frissítés hibalehetőségeivel bajlódni.
  const appended = index === state.points.length;
  const points = appended
    ? [...state.points, point]
    : [...state.points.slice(0, index), point, ...state.points.slice(index)];

  if (!appended) {
    const { distanceM: nextDistance, anchor } = anchoredTotal(points);
    return { ...state, points, distanceM: nextDistance, anchor };
  }

  // Az első pont maga lesz a horgony — nulla távval, hiszen nincs mihez
  // mérni. `== null`, nem `=== null`: egy korábbi verzióból visszaállított,
  // `anchor` mező nélküli mentés `undefined`-ot adna, azt is új horgonynak
  // kell tekinteni, nem hibának.
  if (state.anchor == null) {
    return { ...state, points, anchor: point };
  }

  const delta = distanceM(state.anchor, point);
  if (delta < FILTER.STATIONARY_RADIUS_M) {
    // Álló helyzeti zaj: a minta bekerül a nyomvonalba (a térkép/kör-hossz
    // folytonos marad), de a horgony nem mozdul, és a táv nem nő.
    return { ...state, points };
  }
  return { ...state, points, distanceM: state.distanceM + delta, anchor: point };
}

/* ═══════════════════════════════════════════════════════════════════
   Származtatott értékek — nem tároljuk őket, mert egymásból következnek
   ═══════════════════════════════════════════════════════════════════ */

/** Eltelt idő a szünetek nélkül, ms. */
export function movingMs(state: RecorderState, now: number): number {
  if (state.startedAt === null) return 0;
  const until = state.endedAt ?? now;
  const openPause = state.pausedAt === null ? 0 : until - state.pausedAt;
  return Math.max(0, until - state.startedAt - state.pausedMs - openPause);
}

/**
 * Tempó másodperc/kilométerben — a futók így gondolkodnak, nem km/h-ban.
 * Null, amíg nincs értelmes távolság: nulla közeli távolságnál a tempó a
 * végtelenbe szalad, és a felületen villódzó szemét lenne belőle.
 */
export function paceSecPerKm(state: RecorderState, now: number): number | null {
  if (state.distanceM < 20) return null;
  const seconds = movingMs(state, now) / 1000;
  if (seconds <= 0) return null;
  return seconds / (state.distanceM / 1000);
}

/**
 * Az AKTUÁLIS sebesség m/s-ban — az utolsó néhány másodperc alapján.
 *
 * Nem a teljes átlag: a felhasználót az érdekli, most milyen gyorsan halad,
 * nem az, hogy egy órája mennyi volt. Viszont nem is két pontból számoljuk —
 * az a GPS zajától másodpercenként ugrálna, és olvashatatlan lenne.
 *
 * Tíz másodperces ablak a kompromisszum: elég hosszú a simításhoz, elég rövid
 * ahhoz, hogy egy megállás pár másodperc alatt látszódjon.
 */
const SPEED_WINDOW_MS = 10_000;

export function currentSpeedMps(state: RecorderState): number | null {
  const points = state.points;
  if (points.length < 2 || state.status !== 'recording') return null;

  const last = points[points.length - 1]!;
  let index = points.length - 1;
  while (index > 0 && last.t - points[index - 1]!.t < SPEED_WINDOW_MS) index -= 1;

  const first = points[index]!;
  const seconds = (last.t - first.t) / 1000;
  if (seconds <= 0) return null;

  // Horgony-alapú összeg, NE pontpáronkénti lánc-összeg: utóbbi a beltéri
  // GPS-zajt is sebességnek olvasná (mért eset — lásd `filter.ts`
  // `STATIONARY_RADIUS_M`), hiszen minden egyes ugrás önmagában elfogadható
  // méretű, csak az iránya véletlenszerű.
  const meters = anchoredTotal(points.slice(index)).distanceM;
  return meters / seconds;
}

/* ═══════════════════════════════════════════════════════════════════
   Belső segédek
   ═══════════════════════════════════════════════════════════════════ */

/** Hányadik helyre kerül az adott időbélyeg? Bináris keresés a végéről. */
function insertionIndex(points: TracePoint[], t: number): number {
  if (points.length === 0) return 0;
  // A leggyakoribb eset: az új minta a legutolsó után jön.
  if (t >= (points[points.length - 1] as TracePoint).t) return points.length;

  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((points[mid] as TracePoint).t <= t) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * A megtett táv horgony-alapú (anchor) számítása egy pontsorozaton.
 *
 * Nem pontpáronkénti lánc-összeg: az egymást követő pontok között akkor is
 * összeadódna a táv, ha azok valójában egy helyben vándorló GPS-zaj részei.
 * Ehelyett egy horgonyhoz mérünk — amíg a következő pont ezen a körön
 * (`FILTER.STATIONARY_RADIUS_M`) belül marad, a horgony nem mozdul és a táv
 * nem nő; csak tartós, a körön kívülre vivő elmozdulásnál „ébred fel".
 *
 * Ugyanezt a logikát futtatja `applySample` a gyakori (append) esetben
 * O(1)-ben — ez a függvény a ritka újraszámolási esetekhez kell (sorrenden
 * kívüli beszúrás, `currentSpeedMps` ablaka), ahol a teljes sorozatot úgyis
 * végig kell nézni.
 */
function anchoredTotal(points: TracePoint[]): { distanceM: number; anchor: TracePoint | null } {
  if (points.length === 0) return { distanceM: 0, anchor: null };
  let anchor = points[0] as TracePoint;
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i] as TracePoint;
    const delta = distanceM(anchor, p);
    if (delta >= FILTER.STATIONARY_RADIUS_M) {
      sum += delta;
      anchor = p;
    }
  }
  return { distanceM: sum, anchor };
}

function withRejection(state: RecorderState, verdict: FilterVerdict): RecorderState {
  if (verdict.accept) return state;
  const reason = verdict.reason;
  return {
    ...state,
    rejected: { ...state.rejected, [reason]: (state.rejected[reason] ?? 0) + 1 },
  };
}

/**
 * Új aktivitás-azonosító.
 *
 * A `randomUUID` csak biztonságos eredeten (https vagy localhost) létezik.
 * A tartalék nem kriptográfiai minőségű, de az ütközés esélye itt nem
 * biztonsági kérdés: az azonosító a saját feltöltésünk kulcsa, és a szerver
 * a felhasználóhoz köti — máséhoz nem lehet hozzáírni vele.
 */
export function newActivityId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
