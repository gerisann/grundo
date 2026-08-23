/**
 * Mapbox Directions — a küldetés-ajánló úthálózata.
 *
 * MIÉRT KELL EGYÁLTALÁN? Mert a küldetés csak akkor ér valamit, ha VÉGIG IS
 * lehet menni rajta. Egy mértani kör átvágna kerteken, síneken és a Dunán —
 * a felhasználó pedig azt látná, hogy az app olyat kér, amit nem lehet
 * megcsinálni. A rács-logika (mit szerzel vele) a miénk, az úthálózat nem.
 *
 * NEM ÚJ SZOLGÁLTATÓ. Ugyanaz a Mapbox-fiók és ugyanaz a token-típus, ami a
 * térkép megjelenítéséhez már megvan — csak eddig kizárólag a kliens
 * használta (`VITE_MAPBOX_TOKEN`, a bundle-be sütve). A szervernek külön
 * env-változó kell (`MAPBOX_TOKEN`), mert innen nem látszik a kliensé.
 *
 * ⚠️ EZ NEM TITOK, tehát nem Secret Manager, hanem sima env-változó: a
 * Mapbox publikus tokenje minden kliens-bundle-ben benne van. (A
 * `SMTP_PASSWORD` az egyetlen valódi titok a projektben.)
 */

import { GAMEPLAY } from '../../../src/config/gameplay';
import { distanceM, type LatLng } from '../../../src/game/geo';
import { decodePolyline } from '../../../src/game/polyline';
import {
  countShortDetours,
  countUTurns,
  findShortDetours,
} from '../../../src/game/routeShape';

/** A Directions-hívás legfeljebb ennyi ideig futhat. */
const REQUEST_TIMEOUT_MS = 8_000;

/** Egy rosszul ráillesztett köztes pont legfeljebb ilyen messze lehet a hibától. */
const WAYPOINT_DEFECT_RADIUS_M = 150;

/** Egyetlen javító körben legfeljebb ennyi köztes pontot igazítunk útra. */
const MAX_RELOCATED_WAYPOINTS = 2;

/** A második javító menet csak akkor fut, ha az első valóban javított. */
const MAX_REPAIR_PASSES = 2;

export interface DirectionsRoute {
  /** A megtett táv méterben, az ÚTHÁLÓZAT szerint. */
  distanceM: number;
  /** A tervező becslése másodpercben — tájékoztató, nem ez a küldetés ideje. */
  durationS: number;
  /** Kódolt vonallánc, 5 tizedes pontossággal (`decodePolyline` érti). */
  polyline: string;
}

interface MapboxRoute {
  distance?: number;
  duration?: number;
  geometry?: string;
}

export function mapboxToken(): string {
  return (process.env.MAPBOX_TOKEN ?? '').trim();
}

export function directionsConfigured(): boolean {
  return mapboxToken().length > 0;
}

/**
 * Egy kör megtervezése a megadott pontokon át, vissza a kiindulóhoz.
 *
 * A HIBA NEM DOBÁS, hanem üres lista. Nyolc irányt kérünk le párhuzamosan, és
 * teljesen normális, hogy némelyikre nincs járható út (tó, zsákutca, katonai
 * terület). Ha egy jelölt elhasal, a többi még bőven elég egy ajánlathoz —
 * egyetlen kivétel nem viheti el az egész generálást.
 */
export async function planLoop(
  origin: LatLng,
  waypoints: readonly LatLng[],
  profile: 'walking' | 'cycling',
): Promise<DirectionsRoute[]> {
  const token = mapboxToken();
  if (!token) return [];

  // A kör: kiinduló → köztes pontok → vissza a kiindulóhoz.
  const path = [origin, ...waypoints, origin];
  const coordinates = path.map((point) => `${round6(point.lng)},${round6(point.lat)}`).join(';');

  /*
    A mértani köztes pont nem biztos, hogy úton fekszik. A Mapbox ezért egy
    közeli útszakaszra illeszti, és a pontokat kötelezően, sorrendben járja be.
    Ha a kiválasztott szakasz egy zsákutca, a korábbi
    `continue_straight=false` kérés pontosan a képernyőképeken látható
    oda-vissza „lábat" engedte meg.

    A javítás két, egymást kiegészítő Directions-funkció:

      1. `continue_straight=true`: köztes pontnál nem indulhatunk vissza azon
         az úton, amelyiken érkeztünk;
      2. `bearings`: a köztes pont csak olyan útszakaszra pattanhat, amelynek
         iránya nagyjából a következő körpont felé mutat. A Mapbox által is
         ajánlott 45°-os tűrés egy városi derékszögű hálóban mindig hagy
         legalább egy fő irányt, a körre merőleges zsákutcát viszont kizárja.

    Az `alternatives=true` ugyanabban az API-hívásban további, érdemben eltérő
    útvonalakat is kér. Ezeket nem a Mapbox sorrendje alapján dobjuk el: a
    küldetésmotor mindet megméri, és a tiszta, valóban kört záró változatokból
    választ. Ha az iránykorlát mellett nincs útvonal, egyszer visszaesünk a
    régi, laza kérésre — így ritka úthálózatban sem lesz üres az ajánló.
  */
  const directional = await requestRoutes(
    profile,
    coordinates,
    token,
    `&continue_straight=true&bearings=${encodeURIComponent(loopBearings(path))}`,
  );
  if (directional.length > 0) {
    let currentRoutes = directional;
    let currentWaypoints = [...waypoints];
    let currentDefects = bestDefectCount(currentRoutes);
    let allRoutes = [...directional];

    for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
      const relocated = relocateDefectiveWaypoints(currentRoutes, currentWaypoints);
      if (!relocated) break;

      const repairedPath = [origin, ...relocated, origin];
      const repairedCoordinates = repairedPath
        .map((point) => `${round6(point.lng)},${round6(point.lat)}`)
        .join(';');
      const repaired = await requestRoutes(
        profile,
        repairedCoordinates,
        token,
        `&continue_straight=true&bearings=${encodeURIComponent(loopBearings(repairedPath))}`,
      );
      if (repaired.length === 0) break;

      allRoutes = uniqueRoutes([...repaired, ...allRoutes]);
      const repairedDefects = bestDefectCount(repaired);
      if (repairedDefects >= currentDefects) break;
      currentRoutes = repaired;
      currentWaypoints = relocated;
      currentDefects = repairedDefects;
      if (currentDefects === 0) break;
    }

    return allRoutes;
  }

  return requestRoutes(profile, coordinates, token, '&continue_straight=false');
}

function bestDefectCount(routes: readonly DirectionsRoute[]): number {
  return Math.min(
    ...routes.map((route) => {
      const points = decodePolyline(route.polyline);
      // A tényleges visszafordulás erősebb hiba a lazább, rövidkerülő
      // heurisztikánál; ezért a javító menet előbb ezt csökkenti.
      return countUTurns(points) * 1_000 + countShortDetours(points);
    }),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * A legjobb első útvonalon megkeresi a leginkább önmagába visszatérő helyi
 * részeket, és az ezekhez tartozó mértani köztes pontot a kitérő bejáratához
 * igazítja. Nem rajzolunk légvonalas „javítást": az új koordinátával ismét a
 * Mapbox tervezi meg a teljes, járható útvonalat.
 */
function relocateDefectiveWaypoints(
  routes: readonly DirectionsRoute[],
  waypoints: readonly LatLng[],
): LatLng[] | null {
  const measured = routes
    .map((route) => {
      const points = decodePolyline(route.polyline);
      return {
        points,
        defects: countUTurns(points) * 1_000 + countShortDetours(points),
      };
    })
    .filter((entry) => entry.points.length >= 2)
    .sort((a, b) => a.defects - b.defects)[0];
  if (!measured || measured.defects === 0) return null;

  // A legkisebb direkt/úthossz arány a legerősebb bizonyíték arra, hogy nem
  // szükséges utcakerülőről, hanem ugyanoda visszatérő nyúlványról van szó.
  const defects = findShortDetours(measured.points).sort(
    (a, b) => a.directM / a.alongM - b.directM / b.alongM,
  );
  const replacements = new Map<number, LatLng>();

  for (const defect of defects) {
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < waypoints.length; index += 1) {
      if (replacements.has(index)) continue;
      for (const point of defect.path) {
        const distance = distanceM(waypoints[index]!, point);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }
    }
    if (nearestIndex < 0 || nearestDistance > WAYPOINT_DEFECT_RADIUS_M) continue;

    // Mindkét végpont úthálózaton van; azt választjuk, amelyik kisebb
    // alakváltozással jár az eredeti mértani pont helyett.
    const waypoint = waypoints[nearestIndex]!;
    const replacement = distanceM(waypoint, defect.start) <= distanceM(waypoint, defect.end)
      ? defect.start
      : defect.end;
    replacements.set(nearestIndex, replacement);
    if (replacements.size >= MAX_RELOCATED_WAYPOINTS) break;
  }

  if (replacements.size === 0) return null;
  return waypoints.map((waypoint, index) => replacements.get(index) ?? waypoint);
}

/**
 * A kezdő- és végpont szabad, csak a mértani köztes pontok ráillesztését
 * korlátozzuk. Minden köztes pontnál a következő körpont iránya az elvárt
 * továbbhaladás; a lista hossza kötelezően megegyezik a koordinátákéval.
 */
export function loopBearings(path: readonly LatLng[], toleranceDeg = 45): string {
  return path
    .map((point, index) => {
      if (index === 0 || index === path.length - 1) return '';
      const next = path[index + 1];
      if (!next) return '';
      return `${Math.round(bearingDeg(point, next))},${toleranceDeg}`;
    })
    .join(';');
}

async function requestRoutes(
  profile: 'walking' | 'cycling',
  coordinates: string,
  token: string,
  constraintQuery: string,
): Promise<DirectionsRoute[]> {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}` +
    `?geometries=polyline&overview=full&alternatives=true${constraintQuery}` +
    `&access_token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];

    const body = (await response.json()) as { code?: string; routes?: MapboxRoute[] };
    if (body.code !== 'Ok') return [];

    const seen = new Set<string>();
    const routes: DirectionsRoute[] = [];
    for (const route of body.routes ?? []) {
      if (typeof route.geometry !== 'string' || seen.has(route.geometry)) continue;
      seen.add(route.geometry);
      routes.push({
        distanceM: Number(route.distance ?? 0),
        durationS: Number(route.duration ?? 0),
        polyline: route.geometry,
      });
    }
    return routes;
  } catch {
    // Időtúllépés vagy hálózati hiba — ez a jelölt egyszerűen kimarad.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function uniqueRoutes(routes: readonly DirectionsRoute[]): DirectionsRoute[] {
  const seen = new Set<string>();
  return routes.filter((route) => {
    if (seen.has(route.polyline)) return false;
    seen.add(route.polyline);
    return true;
  });
}

/** Irányszög két földrajzi pont között (0° = észak). */
function bearingDeg(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * A vonallánc pontjai TracePoint alakban, hogy a valódi motor feldolgozhassa.
 *
 * Az időbélyeg SZINTETIKUS: egyenletes ütemben szétosztjuk a becsült
 * menetidőt. A cellalánc-építés nem használja (csak a koordinátákat), de a
 * `TracePoint` megköveteli, és így a jelölt ugyanolyan alakú, mint egy valódi
 * rögzítés — ugyanaz a kód futhat rajta.
 */
export function routeToTracePoints(
  route: DirectionsRoute,
  points: readonly LatLng[],
  startedAt = Date.now(),
): { lat: number; lng: number; t: number }[] {
  const stepMs = points.length > 1 ? (route.durationS * 1000) / (points.length - 1) : 0;
  return points.map((point, index) => ({
    lat: point.lat,
    lng: point.lng,
    t: startedAt + Math.round(index * stepMs),
  }));
}

/**
 * A Mapbox hat tizedesnél többet nem értékel, és a hosszú tizedes csak
 * hízlalja az URL-t — nyolc pontnál ez már számít a kérés hosszában.
 */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Hány irányban keresünk kört — az API-költség ennek a többszöröse. */
export const BEARING_COUNT = GAMEPLAY.MISSION_BEARINGS;
