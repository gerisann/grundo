/**
 * Szellemvonal — a kiválasztott küldetés útvonala a rögzítés térképén.
 *
 * A Küldetések képernyő generál egy ajánlatot, de a rögzítés eddig nem tudott
 * róla: „Indítás most" a rögzítésre dobott, ott viszont a vonalnak nyoma sem
 * volt. Ez a modul köti össze a kettőt — ugyanúgy, ahogy a `dailyMission` a
 * Home kártyáját köti a Küldetésekhez.
 *
 * LOKÁLIS tár, nem Firestore: eszközfüggő megjelenítési segédlet, nem
 * játékadat. A `kind`-ot is eltesszük, hogy a rögzítés a küldetés jellegéhez
 * illő szöveget mutathasson, ha egyszer arra is szükség lesz.
 */

import type { Mission } from './api';
import type { RouteManeuver } from '@/types';

const KEY = 'grundo.ghostRoute';

export interface GhostRoute {
  schemaVersion: 2;
  polyline: string;
  kind: Mission['kind'];
  plannedDistanceM?: number;
  maneuvers: RouteManeuver[];
}

/**
 * A TERVEZETT útvonal eltétele — ugyanabba a tárba, ugyanabban az alakban.
 *
 * A rögzítés nem tesz különbséget küldetés és saját terv között: mindkettő
 * egy vonal, amin végig kell menni. Ezért nem új mechanizmus, csak egy másik
 * bemenet ugyanahhoz.
 *
 * A `kind` a zsákmány összetételéből következik: ha többet veszünk el, mint
 * amennyi szabad mezőt foglalunk, az rajtaütés — különben hódítás. Ez ma csak
 * a szöveges színezésre szolgál, játékszabályt nem érint.
 */
export function rememberPlannedRoute(plan: {
  polyline: string;
  totalDistanceM: number;
  maneuvers: RouteManeuver[];
  stolenCells?: number;
  newCells?: number;
}): GhostRoute {
  const raid = (plan.stolenCells ?? 0) > (plan.newCells ?? 0);
  const route: GhostRoute = {
    schemaVersion: 2,
    polyline: plan.polyline,
    kind: raid ? 'raid' : 'conquest',
    plannedDistanceM: Math.max(0, plan.totalDistanceM),
    maneuvers: plan.maneuvers,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(route));
  } catch {
    /* privát böngészés — a rögzítés útvonal-segédlet nélkül indul */
  }
  return route;
}

/** A kiválasztott küldetés útvonalának eltétele a rögzítés számára. */
export function rememberGhostRoute(mission: Mission): GhostRoute {
  const route: GhostRoute = {
    schemaVersion: 2,
    polyline: mission.polyline,
    kind: mission.kind,
    plannedDistanceM: Math.max(0, mission.distanceKm * 1000),
    maneuvers: mission.maneuvers ?? [],
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(route));
  } catch {
    /* privát böngészés — a rögzítés útvonal-segédlet nélkül indul */
  }
  return route;
}

/** A jelenleg eltett szellemvonal, vagy `null`, ha nincs. */
export function readGhostRoute(): GhostRoute | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    const polyline = typeof stored.polyline === 'string' ? stored.polyline : '';
    const kind = parseMissionKind(stored.kind);
    if (!polyline || !kind) return null;

    const plannedDistanceM = Number(stored.plannedDistanceM);
    return {
      schemaVersion: 2,
      polyline,
      kind,
      ...(Number.isFinite(plannedDistanceM) && plannedDistanceM >= 0 ? { plannedDistanceM } : {}),
      maneuvers: parseManeuvers(stored.maneuvers),
    };
  } catch {
    return null;
  }
}

const MISSION_KINDS = new Set<Mission['kind']>(['conquest', 'raid', 'fortify', 'explore']);

function parseMissionKind(value: unknown): Mission['kind'] | null {
  const kind = String(value ?? '') as Mission['kind'];
  return MISSION_KINDS.has(kind) ? kind : null;
}

const MANEUVER_TYPES = new Set<RouteManeuver['type']>([
  'depart',
  'continue',
  'turn',
  'fork',
  'roundabout',
  'arrive',
]);

const MANEUVER_MODIFIERS = new Set<NonNullable<RouteManeuver['modifier']>>([
  'left',
  'slight_left',
  'right',
  'slight_right',
  'straight',
  'uturn',
]);

function parseManeuvers(value: unknown): RouteManeuver[] {
  if (!Array.isArray(value)) return [];

  const maneuvers: RouteManeuver[] = [];
  for (const entry of value) {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const type = String(raw.type ?? '') as RouteManeuver['type'];
    const position = raw.position;
    if (
      !MANEUVER_TYPES.has(type) ||
      typeof raw.routeOffsetM !== 'number' ||
      !Number.isFinite(raw.routeOffsetM) ||
      raw.routeOffsetM < 0 ||
      !Array.isArray(position) ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1])
    ) {
      continue;
    }

    const modifier = String(raw.modifier ?? '') as NonNullable<RouteManeuver['modifier']>;
    const streetName = typeof raw.streetName === 'string' ? raw.streetName.trim() : '';
    const exitNumber = Number(raw.exitNumber);
    maneuvers.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : `stored:${maneuvers.length}`,
      routeOffsetM: raw.routeOffsetM,
      type,
      ...(MANEUVER_MODIFIERS.has(modifier) ? { modifier } : {}),
      ...(streetName ? { streetName } : {}),
      ...(Number.isInteger(exitNumber) && exitNumber > 0 ? { exitNumber } : {}),
      position: [Number(position[0]), Number(position[1])],
    });
  }

  return maneuvers.sort((a, b) => a.routeOffsetM - b.routeOffsetM);
}

/**
 * A szellemvonal eldobása.
 *
 * A rögzítés végén (mentve VAGY eldobva) hívjuk — egy lezárt aktivitás
 * térképén a következő rögzítéskor már nincs helye a régi ajánlatnak.
 */
export function clearGhostRoute(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nem baj */
  }
}
