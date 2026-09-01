/**
 * FOGLALÁS-ESEMÉNYEK a rögzítés közbeni élő előnézetből.
 *
 * ── MIÉRT KELL KÜLÖN MODUL ───────────────────────────────────────────────
 *
 * A GRUNDO-ban a cellák NEM egyesével, futás közben kerülnek a birtokodba: a
 * terület kizárólag HUROKBEZÁRÁSKOR cserél gazdát (`game/index.ts`
 * `resolveLoopClaims`). Egyetlen bezárás egyszerre hozhat több száz cellát,
 * és ezen belül több FAJTA eseményt is: szabad cellát, riválistól elvettet
 * és saját, megerősített cellát.
 *
 * A `TrackingScreen` élő előnézete viszont nem eseményeket ad, hanem a
 * MOSTANI, halmozott állapotot (`ProcessResult`) — minden újraszámolásnál az
 * egész aktivitásra. Az esemény tehát KÜLÖNBSÉG két pillanatkép között, és
 * ezt a különbséget itt, tiszta függvényben képezzük, hogy tesztelhető
 * legyen.
 *
 * ── MIÉRT A HUROKSZÁM A KAPU ─────────────────────────────────────────────
 *
 * Az előnézet nem csak új GPS-pontra fut le újra, hanem akkor is, amikor a
 * `/api/tiles` friss birtokviszonyt hoz. Ilyenkor egy cella sorsa
 * VISSZAMENŐLEG megváltozhat („szabad" → „elvett"), pedig a felhasználó nem
 * csinált semmit. Ha a puszta állapotkülönbségre riasztanánk, egy hálózati
 * válasz hangot és konfettit szórna a semmiért.
 *
 * Ezért a kapu a BEZÁRÁSOK SZÁMA: esemény csak akkor keletkezik, ha a
 * geometria új hurkot talált. Minden más esetben a pillanatképet csendben
 * frissítjük.
 *
 * ── MIÉRT KÉT FORRÁS EGY PILLANATKÉPBEN ──────────────────────────────────
 *
 * A `cells` térkép a cellánkénti SORSOT adja (ebből derül ki, MELYIK hang
 * szóljon), a `gainedCells`/`gainedAreaM2` viszont a motor összesítéséből
 * jön. A kettő nagy, tömör huroknál eltér: ott a `ClaimResult.fates` csak a
 * finom határsávot tartalmazza, a `counts`/`gainedM2` viszont a TELJES
 * területet (lásd `game/compactClaim.ts`). A felugró üzenet számainak az
 * összesítés a helyes forrás — egy Balaton-méretű kör nem mutathat
 * ezerötszáz cellát kétmillió helyett.
 */

import { GAMEPLAY } from '@/config/gameplay';
import type { CellFate, CellId } from '@/types';

/** Egy cella állapota az élő előnézet halmozott eredményében. */
export interface CaptureCell {
  fate: CellFate;
  defense: number;
}

export interface CaptureSnapshot {
  /** Hány hurkot ismert fel eddig a geometria ebben az aktivitásban. */
  loopCount: number;
  /** A halmozott claim cellái — sorssal és a MOSTANI védelmi szinttel. */
  cells: ReadonlyMap<CellId, CaptureCell>;
  /** Halmozottan megszerzett (szabad + elvett) cellák a motor összesítéséből. */
  gainedCells: number;
  /** Halmozottan megszerzett terület m²-ben, a motor összesítéséből. */
  gainedAreaM2: number;
}

export const EMPTY_CAPTURE_SNAPSHOT: CaptureSnapshot = {
  loopCount: 0,
  cells: new Map(),
  gainedCells: 0,
  gainedAreaM2: 0,
};

/** Mi történt EBBEN a bezárásban. */
export interface CaptureEvent {
  /** Szabad cella, ami most lett a tiéd. */
  captured: number;
  /** Másik játékostól elvett cella. */
  stolen: number;
  /** Már a tiéd volt, most nőtt a védelme. */
  reinforced: number;
  /** Ebben a bezárásban ért el cella a legmagasabb védelmi szintet. */
  maxed: number;
  /** Védett rivális cella, ami nem cserélt gazdát, csak gyengült. */
  breakthrough: number;
  /** A ténylegesen megszerzett cellák száma — a felugró üzenet száma. */
  gainedCells: number;
  /** A megszerzett cellák területe m²-ben — a felugró üzenet területe. */
  gainedAreaM2: number;
  /** Hány cellát érintett a bezárás a részletes térkép szerint. */
  touchedCells: number;
}

export type CaptureKind = 'claimed' | 'stolen' | 'reinforced';

/**
 * Melyik üzenetet érdemli ez az esemény?
 *
 * A LOPÁS ERŐSEBB HÍR, mint a szerzés: ha a bezárás bármit elvett valakitől,
 * az a történet, akkor is, ha mellette szabad cella is került bele.
 * Megerősítés csak akkor a fő üzenet, ha semmi nem került új kézbe.
 */
export function captureKind(event: CaptureEvent): CaptureKind | null {
  if (event.stolen > 0) return 'stolen';
  if (event.captured > 0 || event.gainedCells > 0) return 'claimed';
  if (event.reinforced > 0) return 'reinforced';
  return null;
}

/**
 * Két pillanatkép különbsége.
 *
 * `null`, ha nem történt bezárás (`loopCount` nem nőtt) — ilyenkor a hívónak
 * csak a pillanatképet kell eltárolnia, riasztás nélkül.
 */
export function diffCaptureSnapshots(
  previous: CaptureSnapshot,
  next: CaptureSnapshot,
): CaptureEvent | null {
  if (next.loopCount <= previous.loopCount) return null;

  let captured = 0;
  let stolen = 0;
  let reinforced = 0;
  let maxed = 0;
  let breakthrough = 0;
  let touchedCells = 0;

  for (const [cell, state] of next.cells) {
    const before = previous.cells.get(cell);

    if (before === undefined) {
      touchedCells += 1;
      if (state.fate === 'stolen') stolen += 1;
      else if (state.fate === 'breakthrough') breakthrough += 1;
      else if (state.fate === 'reclaimed') reinforced += 1;
      else captured += 1;
      if (state.fate !== 'breakthrough' && state.defense >= GAMEPLAY.MAX_DEFENSE) maxed += 1;
      continue;
    }

    /**
     * MÁR ISMERT CELLA. Csak a védelem növekedése új esemény.
     *
     * A `fate` megváltozása önmagában NEM: azt a friss birtokviszony is
     * okozhatja (lásd a fájl fejlécét), és ugyanazt a cellát nem akarjuk
     * kétszer megünnepelni.
     */
    if (state.defense > before.defense) {
      touchedCells += 1;
      reinforced += 1;
      if (state.defense >= GAMEPLAY.MAX_DEFENSE) maxed += 1;
    }
  }

  /**
   * A NÖVEKMÉNY, nem az abszolút érték — és sosem negatív.
   *
   * A halmozott összesítés a birtokviszony pontosodásától (friss `/api/tiles`)
   * lefelé is mozdulhat: egy „szabad"-nak hitt cella védett riválisé lehet,
   * és akkor áttörés lesz belőle, nem szerzés. Egy bezárás visszajelzése
   * ettől még nem mutathat negatív területet.
   */
  const gainedCells = Math.max(0, next.gainedCells - previous.gainedCells);
  const gainedAreaM2 = Math.max(0, next.gainedAreaM2 - previous.gainedAreaM2);

  if (touchedCells === 0 && gainedCells === 0) return null;

  return {
    captured,
    stolen,
    reinforced,
    maxed,
    breakthrough,
    gainedCells,
    gainedAreaM2,
    touchedCells,
  };
}
