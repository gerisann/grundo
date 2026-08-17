/**
 * Földrajzi távolság — éles méréshez.
 *
 * Miért nem a `src/game/fixtures.ts` hasonló függvényét használjuk? Az sík
 * közelítés, és szintetikus nyomvonalak ELŐÁLLÍTÁSÁRA való a tesztekben. Itt
 * valódi GPS-mintákat mérünk, amikből a felhasználó megtett távolsága lesz —
 * ehhez gömbi képlet kell.
 *
 * Haversine, nem a gömbi koszinusztétel: az utóbbi rövid szakaszokon
 * (néhány méter, márpedig két GPS-minta között ennyi van) lebegőpontos
 * kioltásba fut, és zajos vagy nulla eredményt ad.
 */

/** A Föld közepes sugara méterben (WGS-84 szerinti átlag). */
const EARTH_RADIUS_M = 6_371_008.8;

const RAD = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
