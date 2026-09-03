export interface MapPosition {
  lat: number;
  lng: number;
  /** A GPS-minta epoch ideje; a statikus képernyőkön elhagyható. */
  t?: number;
}

/** Csak valódi egér-, érintés-, görgő- vagy billentyűesemény szakítsa meg a követést. */
export function isUserCameraMove(event: { originalEvent?: unknown }): boolean {
  return event.originalEvent !== undefined && event.originalEvent !== null;
}

const DEFAULT_DURATION_MS = 850;
const MIN_DURATION_MS = 300;
const MAX_DURATION_MS = 1_200;
const STALE_GAP_MS = 10_000;
const STALE_CATCH_UP_MS = 450;

/**
 * A következő GPS-pontig tartó képernyőmozgás hossza.
 *
 * Normál, másodperces mintánál szinte kitölti a két minta közti időt, ezért
 * nincs „ugrás, várakozás, ugrás” ritmus. Hosszú háttérszünet után viszont
 * gyorsan felzárkózik: egy félperces kiesést nem szabad fél percig lejátszani.
 */
export function mapMotionDuration(previous: MapPosition, next: MapPosition): number {
  if (previous.t === undefined || next.t === undefined) return DEFAULT_DURATION_MS;
  const gap = next.t - previous.t;
  if (!Number.isFinite(gap) || gap <= 0) return MIN_DURATION_MS;
  if (gap >= STALE_GAP_MS) return STALE_CATCH_UP_MS;
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, gap));
}

/** Két koordináta közti megjelenítési pont, a dátumváltó meridiánt is kezelve. */
export function interpolateMapPosition(
  from: MapPosition,
  to: MapPosition,
  progress: number,
): MapPosition {
  const t = Math.min(1, Math.max(0, progress));
  const rawLngDelta = to.lng - from.lng;
  const lngDelta = rawLngDelta > 180
    ? rawLngDelta - 360
    : rawLngDelta < -180
      ? rawLngDelta + 360
      : rawLngDelta;
  const lng = from.lng + lngDelta * t;

  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: ((lng + 540) % 360) - 180,
    ...(to.t !== undefined ? { t: to.t } : {}),
  };
}
