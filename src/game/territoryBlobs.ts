/**
 * ÖSSZEFÜGGŐ TERÜLETFOLTOK — a térkép távoli nézetének alapegysége.
 *
 * MIÉRT KELL EZ? Mert a térkép korábban a BETÖLTÖTT CELLÁKBÓL vonta össze a
 * foltokat menet közben. Ennek két következménye volt, mindkettőt jelezte a
 * felhasználó:
 *
 *   1. A folt széle ott tört el, ahol a betöltési ablak véget ért — a
 *      terület hiányosan látszott.
 *   2. Pásztázáskor az ablak elmozdult, tehát UGYANARRA a területre más-más
 *      folt rajzolódott ki. A foltok "ugráltak".
 *
 * A megoldás: a folt legyen VILÁG-SZINTŰ, ÁLLANDÓ egység, amit egyszer
 * kiszámolunk és eltárolunk — nem a nézet mellékterméke. Egy folt = a
 * felhasználó celláinak egy összefüggő komponense, saját körvonallal és
 * PONTOS területtel. Így akárhonnan nézzük, ugyanaz a folt ugyanakkora.
 *
 * Ez a modul a TISZTA logika: se Firestore, se hálózat. A tárolást és a
 * lekérdezést lásd `server/src/lib/territoryBlobStore.ts`.
 */

import { cellsToMultiPolygon, gridDisk } from 'h3-js';
import { cellsToM2 } from './cells';
import type { CellId } from '@/types';

/** GeoJSON gyűrűk: [gyűrű][pont][lng, lat]. Az első a külső, a többi lyuk. */
export type BlobRings = [number, number][][];

export interface TerritoryBlob {
  /**
   * Determinisztikus azonosító: a komponens legkisebb cellaindexe.
   *
   * Miért nem véletlen? Mert a felhasználó foltjait minden újraszámoláskor
   * teljesen újraírjuk. Determinisztikus azonosítóval a változatlan folt
   * ugyanabba a dokumentumba íródik vissza — nem keletkezik törlés+létrehozás
   * párokból álló felesleges írási hullám minden aktivitás után.
   */
  id: string;
  cellCount: number;
  areaM2: number;
  rings: BlobRings;
  bbox: { south: number; west: number; north: number; east: number };
}

/**
 * Cellahalmaz → ÖSSZEFÜGGŐ komponensek.
 *
 * Szélességi bejárás a hatszögrács élszomszédain. A hatszögrácsnak mind a 6
 * szomszédja élszomszéd — nincs átlós eset, mint négyzetrácson —, ezért az
 * "összefüggő" fogalma itt egyértelmű, és nem kell külön szabály arra, hogy
 * két sarkánál érintkező folt egynek számít-e.
 */
export function splitIntoBlobs(cells: Iterable<CellId>): CellId[][] {
  const remaining = new Set<CellId>(cells);
  const components: CellId[][] = [];

  while (remaining.size > 0) {
    // A `values().next()` az első elem — a Set bejárási sorrendje stabil.
    const seed = remaining.values().next().value as CellId;
    remaining.delete(seed);

    const component: CellId[] = [seed];
    const queue: CellId[] = [seed];

    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const neighbour of gridDisk(current, 1)) {
        if (!remaining.has(neighbour as CellId)) continue;
        remaining.delete(neighbour as CellId);
        component.push(neighbour as CellId);
        queue.push(neighbour as CellId);
      }
    }

    components.push(component);
  }

  return components;
}

/**
 * A körvonal EGYSZERŰSÍTÉSE — a hatszög-fűrészfog levágása.
 *
 * A nyers körvonal minden hatszög minden élét tartalmazza: egy 10 km²-es
 * folt kerülete így több tízezer pont lenne, ami sem eltárolni, sem
 * átküldeni, sem kirajzolni nem értelmes. A res 12 hatszög éle ~9 méter,
 * tehát a fűrészfog amplitúdója is ennyi — a 15 méteres tűrés ezt elsimítja,
 * a folt valódi alakját viszont megtartja.
 *
 * MIÉRT NEM ZAVAR EZ KÖZELRŐL? Mert közeli nézetben nem ez a réteg látszik,
 * hanem a cellánkénti hatszögek a `/api/tiles`-ból. Az átadás zoomján a 15
 * méter már néhány képpont.
 */
const SIMPLIFY_TOLERANCE_M = 15;

/** Egy fok szélesség méterben — a hosszúsági fok ennek a koszinusszal szűkített része. */
const M_PER_DEGREE_LAT = 111_320;

/**
 * Ramer–Douglas–Peucker.
 *
 * A pontok fokban érkeznek, a tűrés méterben van megadva. A hosszúsági fokot
 * a referencia-szélesség koszinuszával skálázzuk, különben a szűrés
 * észak-déli irányban jóval erősebb lenne, mint kelet-nyugatiban.
 */
function simplifyRing(ring: [number, number][], toleranceM: number, refLat: number): [number, number][] {
  // A gyűrű zárt: az utolsó pont azonos az elsővel. A tömörítés az OSZTATLAN
  // sorozaton fut, a zárást a végén állítjuk vissza.
  const open = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]
    ? ring.slice(0, -1)
    : ring.slice();

  if (open.length <= 4) return ring;

  const lngScale = Math.max(0.05, Math.cos((refLat * Math.PI) / 180));
  const tolerance = toleranceM / M_PER_DEGREE_LAT;

  // Egységesített térbe visszük: a hosszúságot a koszinusszal szorozzuk, így
  // a két tengely azonos léptékű, és a merőleges távolság értelmes.
  const scaled = open.map(([lng, lat]) => [lng * lngScale, lat] as [number, number]);

  const keep = new Uint8Array(scaled.length);
  keep[0] = 1;
  keep[scaled.length - 1] = 1;

  const stack: [number, number][] = [[0, scaled.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;

    const [ax, ay] = scaled[first]!;
    const [bx, by] = scaled[last]!;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;

    let worst = -1;
    let worstDistance = tolerance;

    for (let i = first + 1; i < last; i++) {
      const [px, py] = scaled[i]!;
      let distance: number;
      if (lengthSq === 0) {
        distance = Math.hypot(px - ax, py - ay);
      } else {
        // Merőleges távolság a szakasztól, a szakaszon kívülre eső vetület
        // levágásával — enélkül az erősen visszaforduló körvonal pontjait
        // tévesen elhagyhatnánk.
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
        distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (distance > worstDistance) {
        worst = i;
        worstDistance = distance;
      }
    }

    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }

  const simplified: [number, number][] = [];
  for (let i = 0; i < open.length; i++) {
    if (keep[i]) simplified.push(open[i]!);
  }

  // A poligon zárása kötelező, és legalább három különböző pont kell hozzá.
  if (simplified.length < 3) return ring;
  simplified.push(simplified[0]!);
  return simplified;
}

/**
 * Egy összefüggő komponens → tárolható folt.
 *
 * A `cellsToMultiPolygon` összefüggő halmazra EGY poligont ad (a belső
 * lyukakkal együtt). Ha mégis többet adna — elméletileg pentagon környékén
 * elképzelhető —, a legtöbb pontból állót vesszük külsőnek, hogy sose
 * rajzoljunk félig üres foltot.
 */
export function blobFromCells(cells: readonly CellId[]): TerritoryBlob | null {
  if (cells.length === 0) return null;

  let polygons: [number, number][][][];
  try {
    polygons = cellsToMultiPolygon(cells as string[], true) as [number, number][][][];
  } catch {
    return null;
  }

  const largest = polygons.sort((a, b) => (b[0]?.length ?? 0) - (a[0]?.length ?? 0))[0];
  if (!largest || largest.length === 0) return null;

  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lng, lat] of largest[0]!) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }

  const refLat = (south + north) / 2;
  const rings = largest
    .map((ring) => simplifyRing(ring, SIMPLIFY_TOLERANCE_M, refLat))
    .filter((ring) => ring.length >= 4);

  if (rings.length === 0) return null;

  let id = cells[0]!;
  for (const cell of cells) if (cell < id) id = cell;

  return {
    id,
    cellCount: cells.length,
    areaM2: cellsToM2(cells.length),
    rings,
    bbox: { south, west, north, east },
  };
}

/** A teljes út: cellahalmaz → kész foltok. */
export function blobsFromCells(cells: Iterable<CellId>): TerritoryBlob[] {
  const blobs: TerritoryBlob[] = [];
  for (const component of splitIntoBlobs(cells)) {
    const blob = blobFromCells(component);
    if (blob) blobs.push(blob);
  }
  return blobs;
}
