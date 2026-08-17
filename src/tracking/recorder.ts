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
import { distanceM } from '@/lib/geo';
import { evaluate, type FilterVerdict } from './filter';
import type { PositionSample } from './types';

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'finished';

export interface RecorderState {
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
  startedAt: number | null;
  endedAt: number | null;
  /** Szüneteltetéssel töltött idő összesen, ms. */
  pausedMs: number;
  /** Mikor kezdődött a jelenlegi szünet (null, ha nincs szünet). */
  pausedAt: number | null;
  /** Diagnosztika: elutasított minták száma okonként. */
  rejected: Record<string, number>;
}

export function createRecorder(type: ActivityType): RecorderState {
  return {
    status: 'idle',
    type,
    points: [],
    distanceM: 0,
    startedAt: null,
    endedAt: null,
    pausedMs: 0,
    pausedAt: null,
    rejected: {},
  };
}

export function start(state: RecorderState, now: number): RecorderState {
  if (state.status !== 'idle') return state;
  return { ...state, status: 'recording', startedAt: now };
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

  // A gyakori eset: a minta a nyomvonal végére kerül. Ilyenkor elég a legutolsó
  // szakasz hosszát hozzáadni. Beszúrásnál viszont két szakasz alakul át
  // eggyé-kettővé, ezért a teljes hosszt újraszámoljuk — ritka, és így nem
  // kell a részleges frissítés hibalehetőségeivel bajlódni.
  const appended = index === state.points.length;
  const points = appended
    ? [...state.points, point]
    : [...state.points.slice(0, index), point, ...state.points.slice(index)];

  const nextDistance = appended
    ? state.distanceM + (previous === null ? 0 : distanceM(previous, point))
    : totalDistance(points);

  return { ...state, points, distanceM: nextDistance };
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

function totalDistance(points: TracePoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += distanceM(points[i - 1] as TracePoint, points[i] as TracePoint);
  }
  return sum;
}

function withRejection(state: RecorderState, verdict: FilterVerdict): RecorderState {
  if (verdict.accept) return state;
  const reason = verdict.reason;
  return {
    ...state,
    rejected: { ...state.rejected, [reason]: (state.rejected[reason] ?? 0) + 1 },
  };
}
