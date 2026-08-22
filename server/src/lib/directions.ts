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
import type { LatLng } from '../../../src/game/geo';

/** A Directions-hívás legfeljebb ennyi ideig futhat. */
const REQUEST_TIMEOUT_MS = 8_000;

export interface DirectionsRoute {
  /** A megtett táv méterben, az ÚTHÁLÓZAT szerint. */
  distanceM: number;
  /** A tervező becslése másodpercben — tájékoztató, nem ez a küldetés ideje. */
  durationS: number;
  /** Kódolt vonallánc, 5 tizedes pontossággal (`decodePolyline` érti). */
  polyline: string;
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
 * A HIBA NEM DOBÁS, hanem `null`. Nyolc irányt kérünk le párhuzamosan, és
 * teljesen normális, hogy némelyikre nincs járható út (tó, zsákutca, katonai
 * terület). Ha egy jelölt elhasal, a többi még bőven elég egy ajánlathoz —
 * egyetlen kivétel nem viheti el az egész generálást.
 */
export async function planLoop(
  origin: LatLng,
  waypoints: readonly LatLng[],
  profile: 'walking' | 'cycling',
): Promise<DirectionsRoute | null> {
  const token = mapboxToken();
  if (!token) return null;

  // A kör: kiinduló → köztes pontok → vissza a kiindulóhoz.
  const path = [origin, ...waypoints, origin];
  const coordinates = path.map((point) => `${round6(point.lng)},${round6(point.lat)}`).join(';');

  /*
    ⚠️ A `continue_straight=false` SZÁNDÉKOS, ÉS MÉRVE VAN.

    Ez engedi meg, hogy az útvonal egy köztes pontnál visszaforduljon. Ettől
    kerül néha egy-egy fölösleges „láb" a tervbe (beszalad egy mellékutcába,
    megfordul, visszajön) — Geri jelentette 2026-08-22-én, screenshottal.

    A kézenfekvő javítás a `true` lenne, és tényleg segít is a látványon:
    3 kiindulás × 8 irányon a visszafordulások 65-ről 38-ra estek. DE ugyanez
    a bezárt BELSŐ területet 1,900 km²-ről 1,425-re vitte — a negyede elveszik,
    márpedig a játék arról szól. Ezért maradt a `false`.

    A lábakat máshol kezeljük: a válogatás (`pickMissions`) döntetlennél a
    kevesebb visszafordulású jelöltet választja, ami mérve ~1% területbe kerül.
    Lásd `src/game/routeShape.ts` — ott van a teljes mérés és az is, mi bukott
    el rajta (a `radiuses` paraméternek például SEMMI hatása nem volt).
  */
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordinates}` +
    `?geometries=polyline&overview=full&continue_straight=false` +
    `&access_token=${encodeURIComponent(token)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      code?: string;
      routes?: { distance?: number; duration?: number; geometry?: string }[];
    };
    if (body.code !== 'Ok') return null;

    const route = body.routes?.[0];
    if (!route || typeof route.geometry !== 'string') return null;

    return {
      distanceM: Number(route.distance ?? 0),
      durationS: Number(route.duration ?? 0),
      polyline: route.geometry,
    };
  } catch {
    // Időtúllépés vagy hálózati hiba — ez a jelölt egyszerűen kimarad.
    return null;
  } finally {
    clearTimeout(timer);
  }
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
