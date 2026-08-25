import type { GpsSimulationConfig, SimulationWaypoint } from '@/tracking/simulationSource';

const STORAGE_PREFIX = 'grundo.lab.e2e.';
const VERSION = 1;

export type LabE2ePlaybackRate = '1' | '10' | '100' | 'max';

export interface LabE2eSession {
  version: 1;
  id: string;
  createdAt: number;
  scenarioName: string;
  phaseId: string;
  phaseName: string;
  playerId: string;
  playerName: string;
  route: SimulationWaypoint[];
  config: GpsSimulationConfig;
  playbackRate: LabE2ePlaybackRate;
}

export interface CreateLabE2eSessionInput {
  scenarioName: string;
  phaseId: string;
  phaseName: string;
  playerId: string;
  playerName: string;
  route: readonly SimulationWaypoint[];
  config: GpsSimulationConfig;
  playbackRate: LabE2ePlaybackRate;
}

/**
 * Az E2E tracking session kizárólag a BÖNGÉSZŐBEN él.
 *
 * Nem kerül URL-be több száz waypoint, és nem kerül Firestore-ba sem csak
 * azért, hogy két admin képernyő között átadjuk. A szerverre majd maga a
 * recorder küldi a NYERS, recorder által elfogadott pontokat a LAB sandbox
 * activity endpointnak — ugyanúgy, ahogy productionben az aktivitásfeltöltés.
 */
export function createLabE2eSession(input: CreateLabE2eSessionInput): LabE2eSession {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `lab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const session: LabE2eSession = {
    version: VERSION,
    id,
    createdAt: Date.now(),
    scenarioName: input.scenarioName,
    phaseId: input.phaseId,
    phaseName: input.phaseName,
    playerId: input.playerId,
    playerName: input.playerName,
    route: input.route.map((point) => ({ ...point })),
    config: { ...input.config },
    playbackRate: input.playbackRate,
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
      || !Array.isArray(value.route)
      || value.route.length < 2
      || !value.config
      || (value.playbackRate !== '1'
        && value.playbackRate !== '10'
        && value.playbackRate !== '100'
        && value.playbackRate !== 'max')
    ) {
      return null;
    }
    return value as LabE2eSession;
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

export function labPlaybackRate(rate: LabE2ePlaybackRate): number {
  return rate === 'max' ? 0 : Number(rate);
}
