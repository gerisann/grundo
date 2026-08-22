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

const KEY = 'grundo.ghostRoute';

export interface GhostRoute {
  polyline: string;
  kind: Mission['kind'];
}

/** A kiválasztott küldetés útvonalának eltétele a rögzítés számára. */
export function rememberGhostRoute(mission: Mission): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ polyline: mission.polyline, kind: mission.kind } satisfies GhostRoute),
    );
  } catch {
    /* privát böngészés — a rögzítés útvonal-segédlet nélkül indul */
  }
}

/** A jelenleg eltett szellemvonal, vagy `null`, ha nincs. */
export function readGhostRoute(): GhostRoute | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<GhostRoute>;
    if (!stored.polyline || !stored.kind) return null;
    return stored as GhostRoute;
  } catch {
    return null;
  }
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
