import type { DocumentReference } from 'firebase-admin/firestore';
import { encodePolyline, simplifyTrace } from '../../../src/game/polyline';
import {
  DEFAULT_PRIVACY,
  trimPrivateEnds,
  type PrivacySettings,
} from '../../../src/game/privacy';
import type { TracePoint } from '../../../src/types';
import { COLLECTIONS, db } from './firebase';

/** A 2-es verzió javítja a zárt útvonalak privátzóna-vágását. */
export const PUBLIC_ROUTE_VERSION = 2;

/** Ennyi pontnál többnek telefonképernyőn nincs látható haszna. */
const MAX_ROUTE_POINTS = 600;

export type PrivacyRadius = 50 | 100 | 200;

export interface StoredPrivacy extends PrivacySettings {
  /** Minden beállításmódosításkor nő; az aktivitások ehhez igazodnak. */
  routeRevision: number;
}

export function normalizePrivacy(raw: unknown): StoredPrivacy {
  const value = (raw ?? {}) as Partial<StoredPrivacy>;
  return {
    ...DEFAULT_PRIVACY,
    hideStart: typeof value.hideStart === 'boolean' ? value.hideStart : DEFAULT_PRIVACY.hideStart,
    startRadiusM: validRadius(value.startRadiusM) ? value.startRadiusM : DEFAULT_PRIVACY.startRadiusM,
    hideEnd: typeof value.hideEnd === 'boolean' ? value.hideEnd : DEFAULT_PRIVACY.hideEnd,
    endRadiusM: validRadius(value.endRadiusM) ? value.endRadiusM : DEFAULT_PRIVACY.endRadiusM,
    routeRevision: Math.max(0, Math.floor(Number(value.routeRevision) || 0)),
  };
}

export function validRadius(value: unknown): value is PrivacyRadius {
  return value === 50 || value === 100 || value === 200;
}

export function publicRouteNeedsRebuild(
  activity: Record<string, unknown>,
  privacy: StoredPrivacy,
): boolean {
  return activity.deletedAt == null && (
    Number(activity.routeVersion ?? 0) < PUBLIC_ROUTE_VERSION
    || Number(activity.routePrivacyRevision ?? 0) !== privacy.routeRevision
    || activity.routePending === true
  );
}

/**
 * A privát teljes nyomvonalból előállítja a minden nézőnek biztonságosan
 * kiadható változatot. A teljes pontsor soha nem kerül a fő dokumentumba.
 */
export async function buildPublicRoutePatch(
  ref: DocumentReference,
  uid: string,
  privacyOverride?: StoredPrivacy,
): Promise<Record<string, unknown>> {
  const reads: Promise<FirebaseFirestore.DocumentSnapshot>[] = [
    ref.collection('private').doc('track').get(),
  ];
  if (!privacyOverride) reads.push(db.collection(COLLECTIONS.users).doc(uid).get());
  const [trackSnapshot, userSnapshot] = await Promise.all(reads);
  const privacy = privacyOverride
    ?? normalizePrivacy((userSnapshot?.data() as { privacy?: unknown } | undefined)?.privacy);
  const rawPoints = (trackSnapshot?.data() as { points?: unknown } | undefined)?.points;

  if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
    return hiddenRoutePatch(privacy.routeRevision);
  }

  const publicPoints = trimPrivateEnds(rawPoints as TracePoint[], privacy).points;
  const route = encodeRoute(publicPoints);
  return {
    route,
    routeHidden: route.length === 0,
    routeVersion: PUBLIC_ROUTE_VERSION,
    routePrivacyRevision: privacy.routeRevision,
    routePending: false,
    bounds: publicPoints.length > 0 ? boundsOf(publicPoints) : null,
    mapPreviewGeneratedAt: new Date(),
  };
}

export function hiddenRoutePatch(routeRevision: number): Record<string, unknown> {
  return {
    route: '',
    routeHidden: true,
    routeVersion: PUBLIC_ROUTE_VERSION,
    routePrivacyRevision: routeRevision,
    routePending: false,
    bounds: null,
    mapPreviewGeneratedAt: new Date(),
  };
}

export function encodePublicRoute(points: readonly TracePoint[]): string {
  return encodeRoute(points);
}

export function publicBounds(points: readonly TracePoint[]) {
  return points.length > 0 ? boundsOf(points) : null;
}

function encodeRoute(points: readonly TracePoint[]): string {
  if (points.length < 2) return '';
  let simplified = simplifyTrace(points, 6);
  for (let epsilon = 12; simplified.length > MAX_ROUTE_POINTS && epsilon <= 200; epsilon *= 2) {
    simplified = simplifyTrace(points, epsilon);
  }
  return encodePolyline(simplified);
}

function boundsOf(points: readonly TracePoint[]) {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const point of points) {
    north = Math.max(north, point.lat);
    south = Math.min(south, point.lat);
    east = Math.max(east, point.lng);
    west = Math.min(west, point.lng);
  }
  return { north, south, east, west };
}
