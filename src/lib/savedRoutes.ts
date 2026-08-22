/**
 * Mentett útvonalak — a Küldetések képernyőn tetszés szerint eltehető
 * ajánlatok listája.
 *
 * docs/02-funkcionalis-spec.md → Útvonalak fül: „Mentett útvonalak listája
 * megmarad, indítás közvetlenül trackingből."
 *
 * LOKÁLIS tár, nem Firestore (döntés: 2026-08-22) — a `dailyMission` és a
 * `ghostRoute` mintájára: eszközfüggő könyvjelző, nem játékadat. Ha egyszer
 * több eszköz közti szinkron kell, ez a modul cserélhető szerveres
 * változatra anélkül, hogy a hívók (`MissionsScreen`, a rögzítés „Mentett
 * útvonalak" listája) módosulnának.
 *
 * ⚠️ A MENTETT MISSION ADATAI PILLANATKÉPEK. A `mission.areaM2`,
 * `victimName` stb. a generáláskor érvényes birtokviszonyt tükrözi — mire a
 * felhasználó napokkal később elindítja, a valós terület gazdát cserélhetett.
 * Ez nem hiba: a hiteles eredményt úgyis a szerver számolja újra a tényleges
 * nyomvonalból (AGENTS.md 5. szabály). A mentett szám csak tájékoztat, hogy
 * „kb. erről volt szó", nem ígéret.
 */

import type { Mission } from './api';

const KEY = 'grundo.savedRoutes';

/** Ennyi fér el — a lista könyvjelző, nem archívum. Betelve a legrégebbi esik ki. */
const MAX_SAVED = 20;

export interface SavedRoute {
  id: string;
  savedAt: number;
  mission: Mission;
}

function readAll(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedRoute[]) : [];
  } catch {
    return [];
  }
}

function writeAll(routes: SavedRoute[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(routes));
  } catch {
    /* privát böngészés — a mentés nem marad meg, de nem dob hibát */
  }
}

/** A mentett útvonalak, legfrissebb elöl. */
export function listSavedRoutes(): SavedRoute[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Ugyanaz az útvonal már mentve van-e?
 *
 * A vonalat magát (`polyline`) hasonlítjuk, nem az azonosítót — egy
 * újragenerált ajánlatnak nincs stabil id-je, a vonal viszont ugyanaz marad,
 * ha a felhasználó kétszer menti el ugyanazt a kört.
 */
export function isRouteSaved(mission: Mission): boolean {
  return readAll().some((route) => route.mission.polyline === mission.polyline);
}

/** Egy küldetés elmentése. Néma no-op, ha már mentve van. */
export function saveRoute(mission: Mission): void {
  const routes = readAll();
  if (routes.some((route) => route.mission.polyline === mission.polyline)) return;
  routes.push({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
    mission,
  });
  writeAll(routes.slice(-MAX_SAVED));
}

export function removeSavedRoute(id: string): void {
  writeAll(readAll().filter((route) => route.id !== id));
}
