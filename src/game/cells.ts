/**
 * Nyomvonal → cellalánc.
 *
 * Tiszta függvények, se I/O, se platformfüggés — ez a modul azonos módon fut
 * a telefonon (élő előnézet) és a szerveren (hiteles számítás).
 */

import { latLngToCell, gridPathCells, gridDistance } from 'h3-js';
import { GAMEPLAY } from '@/config/gameplay';
import { distanceM } from '@/game/geo';
import type { ActivityType, CellId, Layer, TracePoint } from '@/types';

/**
 * Ekkora sebesség fölött egy hézag AKKOR IS lehetetlen, ha egy autó tenné meg
 * — tehát semmilyen mozgásformánál nem lehet valós. Ennél lazább, mint a
 * Trust Score aktivitás-specifikus sebességplafonjai (`score.ts`
 * `teleportSignal`), mert ez a modul nem ismeri a mozgásformát: itt csak a
 * "biztosan kitalált" eseteket szűrjük, a pacereálitást a Trust Score nézi.
 */
const PHYSICALLY_IMPOSSIBLE_MPS = 250 / 3.6; // 250 km/h

export function layerOf(type: ActivityType): Layer {
  return type === 'ride' ? 'bike' : 'foot';
}

export interface CellPathResult {
  /** összefüggő cellalánc — szomszédos elemek mindig élszomszédok */
  path: CellId[];
  /** eldobott pontok száma (pontatlanság miatt) */
  droppedPoints: number;
  /** hány helyen kellett a megengedettnél nagyobb hézagot kitölteni */
  largeGaps: number;
}

/**
 * A GPS-mintákból összefüggő cellaláncot képez.
 *
 * A hézagkitöltés kritikus: ha a jel kihagy, két minta között 50 m is lehet,
 * és egy lyukas "fal" mellett a flood fill kiszivárogna. A hatszögrácsnak
 * mind a 6 szomszédja élszomszéd (nincs átlós szivárgás, mint négyzetrácson),
 * ezért egy összefüggő lánc mindig vízhatlan.
 */
export function traceToCellPath(points: readonly TracePoint[]): CellPathResult {
  const path: CellId[] = [];
  const { droppedPoints, largeGaps } = extendCellPath(path, points, undefined);
  return { path, droppedPoints, largeGaps };
}

/**
 * A `traceToCellPath` belső ciklusa, kiszakítva — ez teszi lehetővé, hogy egy
 * MÁR MEGLÉVŐ láncot bővítsünk csak az ÚJ pontokkal, ahelyett hogy a teljes
 * nyomvonalat újra végigjárnánk. Az algoritmus egyébként is csak az utolsó
 * cellát nézi (`path[path.length - 1]`), tehát a korábbi pontokra soha nem
 * volt szüksége — csak a hívó fél mindig a teljestől indult.
 */
function extendCellPath(
  path: CellId[],
  newPoints: readonly TracePoint[],
  lastPoint: TracePoint | undefined,
): { droppedPoints: number; largeGaps: number; lastPoint: TracePoint | undefined } {
  const res = GAMEPLAY.H3_RESOLUTION;
  let droppedPoints = 0;
  let largeGaps = 0;
  let prevPoint = lastPoint;

  for (const p of newPoints) {
    if (p.accuracy !== undefined && p.accuracy > GAMEPLAY.MAX_GPS_ACCURACY_M) {
      droppedPoints++;
      continue;
    }

    const cell = latLngToCell(p.lat, p.lng, res);
    const last = path[path.length - 1];

    if (last === undefined) {
      path.push(cell);
      prevPoint = p;
      continue;
    }
    if (last === cell) {
      prevPoint = p;
      continue; // ugyanabban a cellában maradtunk
    }

    const steps = gridDistance(last, cell);
    if (steps > GAMEPLAY.MAX_GRID_PATH_CELLS) {
      // Térben nagy hézag — de ez ÖNMAGÁBAN nem gyanús: háttérbe kerüléskor
      // (képernyőzár) az OS percekig szüneteltetheti/ritkíthatja a GPS-t
      // (iOS CoreLocation energiagazdálkodás, Android Doze), és a hézaghoz
      // tartozó VALÓS eltelt idő alatt simán megtehető ekkora táv gyaloglva
      // is. Csak akkor számít teleportnak, ha az eltelt időhöz képest is
      // lehetetlen sebességet jelentene — GRUNDO #34.
      const gapS = prevPoint ? (p.t - prevPoint.t) / 1000 : 0;
      const impliedMps = prevPoint && gapS > 0 ? distanceM(prevPoint, p) / gapS : Infinity;
      if (impliedMps > PHYSICALLY_IMPOSSIBLE_MPS) largeGaps++;
    }

    if (steps > 1) {
      // gridPathCells az első elemként a kiindulót adja vissza — azt kihagyjuk
      const bridge = gridPathCells(last, cell);
      for (let i = 1; i < bridge.length; i++) path.push(bridge[i]!);
    } else {
      path.push(cell);
    }
    prevPoint = p;
  }

  return { droppedPoints, largeGaps, lastPoint: prevPoint };
}

/**
 * A `traceToCellPath` FOLYTATHATÓ (inkrementális) változata.
 *
 * ⚠️ MIÉRT KELL EZ? Élő rögzítés közben a `TrackingScreen` minden ÚJ
 * GPS-mintánál újrahívta a `traceToCellPath`-t a TELJES eddigi nyomvonalra —
 * egy kétórás aktivitás végén ez percenként több ezer `latLngToCell`/
 * `gridDistance` hívást jelentett egyetlen új pontért, azaz a munka a
 * pontszám NÉGYZETÉVEL nőtt (GRUNDO #21 energiaelemzés, B2).
 *
 * Ez az osztály csak az ÚJ pontokat dolgozza fel, és a meglévő láncra fűzi —
 * a `IncrementalActivityGeometry` (`game/index.ts`) mintáját követve, csak
 * eggyel lejjebb, magán a cellaláncon.
 *
 * A FOLYTATÁS FELISMERÉSE szándékosan O(1): a `RecorderState.points` a
 * gyakori (append) esetben `[...régi, új]` — a régi pontobjektumok
 * REFERENCIÁJA nem változik. Ezért elég az utolsó, korábban látott pont
 * pozícióját összehasonlítani; ha ott más objektum áll, a nyomvonal
 * időközben módosult (sorrenden kívüli beszúrás, vagy más aktivitás), és
 * teljes újraépítés indul. Ugyanez a séma véd a rögzítés-váltás ellen is,
 * amennyiben a hívó `reset()`-tel jelzi az új munkamenetet — lásd
 * `TrackingScreen.tsx` `geometrySessionKey`.
 */
export class IncrementalCellPath {
  private seenPoints: readonly TracePoint[] = [];
  private path: CellId[] = [];
  private droppedPoints = 0;
  private largeGaps = 0;
  private lastPoint: TracePoint | undefined;

  reset(): void {
    this.seenPoints = [];
    this.path = [];
    this.droppedPoints = 0;
    this.largeGaps = 0;
    this.lastPoint = undefined;
  }

  update(points: readonly TracePoint[]): CellPathResult {
    const previousCount = this.seenPoints.length;
    const isExtension = points[previousCount - 1] === this.seenPoints[previousCount - 1];

    if (!isExtension) {
      const path: CellId[] = [];
      const { droppedPoints, largeGaps, lastPoint } = extendCellPath(path, points, undefined);
      this.path = path;
      this.droppedPoints = droppedPoints;
      this.largeGaps = largeGaps;
      this.lastPoint = lastPoint;
    } else if (points.length > previousCount) {
      // MÁSOLAT, nem helyben módosítás: a visszaadott tömb referenciájának
      // változnia kell, különben a hívó `useMemo`-i nem veszik észre a
      // bővülést (a függőségtömb `Object.is` szerint hasonlít).
      const path = [...this.path];
      const { droppedPoints, largeGaps, lastPoint } = extendCellPath(
        path,
        points.slice(previousCount),
        this.lastPoint,
      );
      this.path = path;
      this.droppedPoints += droppedPoints;
      this.largeGaps += largeGaps;
      this.lastPoint = lastPoint;
    }

    this.seenPoints = points;
    return { path: this.path, droppedPoints: this.droppedPoints, largeGaps: this.largeGaps };
  }
}

/** Cellaszám → m² a névleges cellaértékkel. */
export function cellsToM2(cellCount: number): number {
  return Math.round(cellCount * GAMEPLAY.CELL_AREA_M2);
}

/** m² → cellaszám (felfelé kerekítve), pl. kihívás-célok átváltásához. */
export function m2ToCells(m2: number): number {
  return Math.ceil(m2 / GAMEPLAY.CELL_AREA_M2);
}
