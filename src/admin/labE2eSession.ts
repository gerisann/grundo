import {
  twoStagePlaybackRate,
  type GpsSimulationConfig,
  type PlaybackRateInput,
  type SimulationWaypoint,
} from '@/tracking/simulationSource';

const STORAGE_PREFIX = 'grundo.lab.e2e.';
const VERSION = 1;

/**
 * Vagy egy egyszerű szám ("100"), a "max", vagy egy RAMP: "gyors>lassú@arány"
 * — pl. "1000>1@0.9" annyit jelent, hogy 1000× az útvonal 90%-áig, utána 1×.
 * Session-ben (JSON-ban) ez is egyszerű string marad; a függvénnyé alakítás
 * a `labPlaybackRateSchedule()`-ban történik, felhasználáskor.
 */
export type LabE2ePlaybackRate = string;

const RAMP_PATTERN = /^(\d+(?:\.\d+)?)>(\d+(?:\.\d+)?)@(0(?:\.\d+)?|1(?:\.0+)?)$/;

export interface LabE2ePlayerRef {
  id: string;
  name: string;
}

export interface LabE2eSession {
  version: 1;
  id: string;
  /** Több E2E run ugyanebbe a scenarióba commitolhat. */
  sandboxId: string;
  createdAt: number;
  scenarioName: string;
  phaseId: string;
  phaseName: string;
  playerId: string;
  playerName: string;
  players: LabE2ePlayerRef[];
  route: SimulationWaypoint[];
  config: GpsSimulationConfig;
  playbackRate: LabE2ePlaybackRate;
}

export interface CreateLabE2eSessionInput {
  sandboxId: string;
  scenarioName: string;
  phaseId: string;
  phaseName: string;
  playerId: string;
  playerName: string;
  players: readonly LabE2ePlayerRef[];
  route: readonly SimulationWaypoint[];
  config: GpsSimulationConfig;
  playbackRate: LabE2ePlaybackRate;
}

/**
 * Az E2E tracking session kizárólag a BÖNGÉSZŐBEN él.
 *
 * Nem kerül URL-be több száz waypoint, és nem kerül Firestore-ba sem csak
 * azért, hogy két admin képernyő között átadjuk. Maga a recorder a kiválasztott
 * sandbox worldbe commitol; production activity endpointot nem hív.
 */
export function createLabE2eSession(input: CreateLabE2eSessionInput): LabE2eSession {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `lab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const session: LabE2eSession = {
    version: VERSION,
    id,
    sandboxId: input.sandboxId,
    createdAt: Date.now(),
    scenarioName: input.scenarioName,
    phaseId: input.phaseId,
    phaseName: input.phaseName,
    playerId: input.playerId,
    playerName: input.playerName,
    players: input.players.map((player) => ({ ...player })),
    route: input.route.map((point) => ({ ...point })),
    config: { ...input.config },
    playbackRate: normalizePlaybackRate(input.playbackRate),
  };
  sessionStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(session));
  return session;
}

export function loadLabE2eSession(id: string): LabE2eSession | null {
  if (!id) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LabE2eSession>;
    if (
      value.version !== VERSION
      || value.id !== id
      || typeof value.sandboxId !== 'string'
      || !Array.isArray(value.players)
      || !Array.isArray(value.route)
      || value.route.length < 2
      || !value.config
      || !isValidPlaybackRate(value.playbackRate)
    ) {
      return null;
    }
    return { ...value, playbackRate: normalizePlaybackRate(value.playbackRate) } as LabE2eSession;
  } catch {
    return null;
  }
}

export function deleteLabE2eSession(id: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + id);
  } catch {
    /* sessionStorage tiltása ne döntse el az admin felületet */
  }
}

/** Fix szorzóra fordítja — RAMP-nál a KEZDETI (gyors) szorzót adja vissza. */
export function labPlaybackRate(rate: LabE2ePlaybackRate): number {
  if (rate === 'max') return 0;
  const ramp = RAMP_PATTERN.exec(rate);
  if (ramp) return Number(ramp[1]);
  const numeric = Number(rate);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

/**
 * A `SimulationPositionSource`-nak átadható tényleges bemenet — fix szám,
 * vagy RAMP esetén a `twoStagePlaybackRate()` függvénye. Ezt hívja a
 * lejátszó, `labPlaybackRate()`-et pedig csak a megjelenítés (pl. induló
 * címke) használja, ahol egyetlen szám kell.
 */
export function labPlaybackRateSchedule(rate: LabE2ePlaybackRate): PlaybackRateInput {
  const ramp = RAMP_PATTERN.exec(rate);
  if (!ramp) return labPlaybackRate(rate);
  const [, fast, slow, at] = ramp;
  return twoStagePlaybackRate(Number(fast), Number(slow), Number(at));
}

/** Emberi olvasásra, pl. a LAB fejlécében: "1000>1@0.9" → "1000×→1× (90%-nál)". */
export function describePlaybackRate(rate: LabE2ePlaybackRate): string {
  if (rate === 'max') return 'MAX';
  const ramp = RAMP_PATTERN.exec(rate);
  if (!ramp) return `${rate}×`;
  const [, fast, slow, at] = ramp;
  return `${fast}×→${slow}× (${Math.round(Number(at) * 100)}%-nál)`;
}

function isValidPlaybackRate(rate: unknown): rate is LabE2ePlaybackRate {
  if (rate === 'max') return true;
  if (typeof rate !== 'string') return false;
  if (RAMP_PATTERN.test(rate)) return true;
  const numeric = Number(rate);
  return Number.isFinite(numeric) && numeric > 0;
}

function normalizePlaybackRate(rate: LabE2ePlaybackRate): LabE2ePlaybackRate {
  if (rate === 'max') return rate;
  if (RAMP_PATTERN.test(rate)) return rate;
  const numeric = Number(rate);
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : '1';
}
