const METERS_PER_DEGREE_LATITUDE = 111_320;

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
