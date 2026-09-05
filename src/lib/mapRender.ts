import { cellToLatLng, cellToParent } from 'h3-js';
import type { CellId } from '@/types';

const METERS_PER_DEGREE_LATITUDE = 111_320;
const REFERENCE_LATITUDE = 47.4979;
const REFERENCE_VIEWING_DISTANCE_M = 1_000;
const REFERENCE_TILTED_ZOOM = 17.6;
const MIN_TILTED_ZOOM = 13.5;
const MAX_TILTED_ZOOM = 20;

export interface RenderBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface RenderPoint {
  lat: number;
  lng: number;
}

/**
 * A Web Mercator skálán egy zoomlépés kétszerezi/felezi a fizikai nézetet.
 * A szélességi korrekció miatt ugyanaz a méterérték Budapesten és északabbra
 * is közel azonos terepi látótávolságot ad.
 */
export function tiltedZoomForViewingDistance(distanceM: number, latitude: number): number {
  const safeDistance = Math.max(1, distanceM);
  const latitudeScale = Math.max(0.1, Math.cos(latitude * Math.PI / 180));
  const referenceScale = Math.cos(REFERENCE_LATITUDE * Math.PI / 180);
  const zoom = REFERENCE_TILTED_ZOOM
    - Math.log2(safeDistance / REFERENCE_VIEWING_DISTANCE_M)
    + Math.log2(latitudeScale / referenceScale);
  return Math.min(MAX_TILTED_ZOOM, Math.max(MIN_TILTED_ZOOM, zoom));
}

export function containsBounds(outer: RenderBounds | null, inner: RenderBounds): boolean {
  return outer !== null
    && outer.south <= inner.south
    && outer.west <= inner.west
    && outer.north >= inner.north
    && outer.east >= inner.east;
}

/**
 * Kamera-FOV + ráhagyás, a felhasználó pozíciója körüli maximális sugárral.
 * A sugár nem nagyítja fel a viewportot: csak felső korlátot tesz rá.
 */
export function renderBounds(
  viewport: RenderBounds,
  bufferRatio: number,
  center: RenderPoint | null,
  radiusM: number | null,
): RenderBounds {
  const latPadding = (viewport.north - viewport.south) * bufferRatio;
  const lngPadding = (viewport.east - viewport.west) * bufferRatio;
  const padded = {
    south: viewport.south - latPadding,
    west: viewport.west - lngPadding,
    north: viewport.north + latPadding,
    east: viewport.east + lngPadding,
  };
  if (center === null || radiusM === null) return padded;

  const latRadius = radiusM / METERS_PER_DEGREE_LATITUDE;
  const longitudeScale = Math.max(0.1, Math.cos(center.lat * Math.PI / 180));
  const lngRadius = radiusM / (METERS_PER_DEGREE_LATITUDE * longitudeScale);
  return {
    south: Math.max(padded.south, center.lat - latRadius),
    west: Math.max(padded.west, center.lng - lngRadius),
    north: Math.min(padded.north, center.lat + latRadius),
    east: Math.min(padded.east, center.lng + lngRadius),
  };
}

export function pointInBounds(point: RenderPoint, bounds: RenderBounds | null): boolean {
  return bounds === null
    || (point.lat >= bounds.south
      && point.lat <= bounds.north
      && point.lng >= bounds.west
      && point.lng <= bounds.east);
}

/**
 * A látható nyomvonalszakaszok. A határon kívüli szomszéd pontokat is
 * megtartjuk, így a vonal nem szakad le pontosan a képernyő szélén.
 */
export function visibleTrackSegments<T extends RenderPoint>(
  track: readonly T[],
  bounds: RenderBounds | null,
  stride: number,
): T[][] {
  if (track.length < 2) return [];
  if (bounds === null) return [decimate(track, stride)];

  const included = new Set<number>();
  for (let index = 0; index < track.length; index += 1) {
    const point = track[index];
    if (!point || !pointInBounds(point, bounds)) continue;
    included.add(Math.max(0, index - 1));
    included.add(index);
    included.add(Math.min(track.length - 1, index + 1));
  }

  const indices = [...included].sort((a, b) => a - b);
  const segments: T[][] = [];
  let segment: T[] = [];
  let previous = -2;
  for (const index of indices) {
    if (index !== previous + 1 && segment.length > 1) segments.push(decimate(segment, stride));
    if (index !== previous + 1) segment = [];
    const point = track[index];
    if (point) segment.push(point);
    previous = index;
  }
  if (segment.length > 1) segments.push(decimate(segment, stride));
  return segments;
}

/** Egy cellareferencia — vagy csupasz H3-index, vagy egy `{cell, ...}` alakú rekord. */
export type CellLike = CellId | { cell: CellId };

function cellIdOf(entry: CellLike): CellId {
  return typeof entry === 'string' ? entry : entry.cell;
}

/**
 * A Mapbox csak a forráson belül tud viewport szerint csempézni. Ezért a
 * drága GeoJSON-építés ELŐTT vágjuk ki a kamerán kívüli cellákat.
 */
const CELL_CENTER_CACHE = new Map<CellId, RenderPoint>();
const CELL_CENTER_CACHE_LIMIT = 50_000;

export function cellInBounds(cell: CellId, bounds: RenderBounds | null): boolean {
  if (bounds === null) return true;
  let center = CELL_CENTER_CACHE.get(cell);
  if (!center) {
    const [lat, lng] = cellToLatLng(cell);
    center = { lat, lng };
    if (CELL_CENTER_CACHE.size >= CELL_CENTER_CACHE_LIMIT) CELL_CENTER_CACHE.clear();
    CELL_CENTER_CACHE.set(cell, center);
  }
  return pointInBounds(center, bounds);
}

/**
 * DURVA ELŐSZŰRÉS a nagy (10 000+ cellás) rétegekhez.
 *
 * Egyetlen nagy aktivitás (jamal köre, 148 717 cella) minden `moveend`-nél
 * végigfuttatta a pontos `cellInBounds`-t (H3 `cellToLatLng`, natív hívás)
 * AZ ÖSSZES celláján — a `CELL_CENTER_CACHE` 50 000-es korlátja emiatt
 * folyamatosan kiürült, tehát a gyorsítótár ennél a méretnél éppen nem
 * segített. Ez a szinkron főszál-blokkolás volt az aktivitás-térkép
 * mélyzoomos összeomlásának oka (2026-09-05).
 *
 * A javítás UGYANAZT AZ ELVET alkalmazza, mint a `territoryBlobStore.ts`
 * szintjei a világtérképen: előbb egy sokkal ritkább (durvább felbontású)
 * rácson dől el, hova érdemes egyáltalán belenézni, és csak az odaeső
 * cellákon fut le a pontos, cellánkénti vizsgálat.
 */
const COARSE_FILTER_RESOLUTION = 8;
const COARSE_FILTER_THRESHOLD = 5_000;
/**
 * Fokban mért ráhagyás a durva vödör középpontja körül a pontos szűrés
 * előtt — bőven fedi egy res8 cella átmérőjét (~0,7 km ≈ 0,006 fok), hogy a
 * vödör szélén álló cella se maradjon ki tévesen.
 */
const COARSE_FILTER_MARGIN_DEG = 0.02;

/**
 * `cells` referenciánként gyorsítótárazott vödrözés — csak akkor hasznos,
 * ha a hívó ugyanazt a (memoizált) tömböt adja át render között, mint az
 * `ActivityScreen` teszi. Ha nem, egyszerűen újraépül.
 */
const COARSE_BUCKET_CACHE = new WeakMap<object, Map<CellId, CellLike[]>>();

function coarseBucketsOf(cells: readonly CellLike[]): Map<CellId, CellLike[]> {
  const cached = COARSE_BUCKET_CACHE.get(cells);
  if (cached) return cached;
  const buckets = new Map<CellId, CellLike[]>();
  for (const entry of cells) {
    const parent = cellToParent(cellIdOf(entry), COARSE_FILTER_RESOLUTION) as CellId;
    const bucket = buckets.get(parent);
    if (bucket) bucket.push(entry);
    else buckets.set(parent, [entry]);
  }
  COARSE_BUCKET_CACHE.set(cells, buckets);
  return buckets;
}

/**
 * Viewportra szűri a cellákat — kis rétegnél egyenes, nagy rétegnél a fenti
 * durva vödrözésen át. A visszaadott halmaz mindkét úton AZONOS azzal, amit
 * egy egyszerű `cells.filter(cellInBounds)` adna, csak kevesebb natív
 * H3-hívással.
 */
export function filterCellsToBounds(
  cellsIterable: Iterable<CellLike>,
  bounds: RenderBounds,
): CellLike[] {
  const cells = Array.isArray(cellsIterable) ? cellsIterable : [...cellsIterable];
  if (cells.length <= COARSE_FILTER_THRESHOLD) {
    return cells.filter((entry) => cellInBounds(cellIdOf(entry), bounds));
  }

  const margin: RenderBounds = {
    south: bounds.south - COARSE_FILTER_MARGIN_DEG,
    north: bounds.north + COARSE_FILTER_MARGIN_DEG,
    west: bounds.west - COARSE_FILTER_MARGIN_DEG,
    east: bounds.east + COARSE_FILTER_MARGIN_DEG,
  };
  const out: CellLike[] = [];
  for (const [parent, bucket] of coarseBucketsOf(cells)) {
    if (!cellInBounds(parent, margin)) continue;
    for (const entry of bucket) {
      if (cellInBounds(cellIdOf(entry), bounds)) out.push(entry);
    }
  }
  return out;
}

function decimate<T>(points: readonly T[], stride: number): T[] {
  if (stride <= 1 || points.length <= 2) return [...points];
  const result: T[] = [];
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    if (point) result.push(point);
  }
  const last = points[points.length - 1];
  if (last && result[result.length - 1] !== last) result.push(last);
  return result;
}
