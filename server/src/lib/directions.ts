/**
 * Útvonalmotor a küldetés-ajánlóhoz — GraphHopper elsődlegesen, Mapbox tartalékban.
 *
 * MIÉRT KELL EGYÁLTALÁN? Mert a küldetés csak akkor ér valamit, ha VÉGIG IS
 * lehet menni rajta. Egy mértani kör átvágna kerteken, síneken és a Dunán —
 * a felhasználó pedig azt látná, hogy az app olyat kér, amit nem lehet
 * megcsinálni. A rács-logika (mit szerzel vele) a miénk, az úthálózat nem.
 *
 * KÉT MOTOR, KÉT MÁSFAJTA GEOMETRIA (döntés: 2026-08-29, HANDOFF #17→#18):
 *
 *   - A **GraphHopper** saját üzemeltetésű (lásd `graphhopper/README.md`),
 *     `algorithm=round_trip`-pel tud KÖRT generálni adott hosszra egyetlen
 *     kiindulópontból és iránytól — nincs szükség mértani köztes pontokra.
 *     Ez a fő út, `planMissionLoop` dönti el, hogy ez fut-e.
 *   - A **Mapbox Directions**nek nincs kör-generálása, ezért az eredeti
 *     megoldás mértani köztes pontokat (`loopWaypoints`) kényszerít rá
 *     kötelező, sorrendben bejárandó állomásként. Ez a `planLoop` függvény
 *     VÁLTOZATLAN — tartalék, ha a `GRAPHHOPPER_URL` nincs beállítva, vagy
 *     egy adott irányra a GraphHopper nem ad jelöltet.
 *
 * NEM ÚJ SZOLGÁLTATÓ (a Mapbox-ágra nézve). Ugyanaz a Mapbox-fiók és
 * ugyanaz a token-típus, ami a térkép megjelenítéséhez már megvan — csak
 * eddig kizárólag a kliens használta (`VITE_MAPBOX_TOKEN`, a bundle-be
 * sütve). A szervernek külön env-változó kell (`MAPBOX_TOKEN`), mert innen
 * nem látszik a kliensé.
 *
 * ⚠️ EGYIK TOKEN SEM TITOK, tehát nem Secret Manager, hanem sima
 * env-változó: a Mapbox publikus tokenje minden kliens-bundle-ben benne
 * van, a `GRAPHHOPPER_URL` pedig egy belső hálózati cím, nem hitelesítő
 * adat. (A `SMTP_PASSWORD` az egyetlen valódi titok a projektben.)
 */

import { GAMEPLAY, type GameplayConfig } from '../../../src/config/gameplay';
import { distanceM, type LatLng } from '../../../src/game/geo';
import { loopWaypoints } from '../../../src/game/missions';
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

/** A belső GraphHopper-cím, sorvégi `/`-ek nélkül. Nincs alapérték: ha üres, nem hívjuk. */
export function graphhopperUrl(): string {
  return (process.env.GRAPHHOPPER_URL ?? '').trim().replace(/\/+$/, '');
}

export function graphhopperConfigured(): boolean {
  return graphhopperUrl().length > 0;
}

/** Igaz, ha VALAMELYIK motor élesíthető — a hívó ez alapján dönt a 503-ról. */
export function directionsConfigured(): boolean {
  return graphhopperConfigured() || mapboxToken().length > 0;
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

/* ════════════════════════════════════════════════════════════════════════
   GraphHopper — a fő útvonalmotor (döntés: 2026-08-29, lásd graphhopper/README.md)
   ════════════════════════════════════════════════════════════════════════ */

/**
 * A „kanyargós ↔ hosszú egyenesek" felületi kapcsoló (döntés: 2026-08-29,
 * docs/02-funkcionalis-spec.md → Küldetés-ajánló). Ugyanaz a tervező futtatja
 * mindkettőt, csak a kérésbe ágyazott egyedi modell `turn_penalty` szakaszával
 * vagy anélkül — séta mozgásformánál a felület nem is kínálja fel, de a
 * szerver oldalon nincs rá külön ág: `twisty` a hatása.
 */
export type RouteCharacter = 'twisty' | 'straight';

/** Egy irányra hány magot (`round_trip.seed`) kérünk le — ebből válogat a saját pontozás. */
const GH_SEEDS_PER_BEARING = 3;

/**
 * ID-token cache szolgáltatások közötti hitelesítéshez (Cloud Run → Cloud Run).
 *
 * A GraphHopper-szolgáltatás `--no-allow-unauthenticated` (lásd
 * `graphhopper/README.md` → Élesítés): nem nyílik meg a világ felé, csak
 * Google-aláírt ID-tokennel hívható, aminek az `aud` mezője PONTOSAN a hívott
 * szolgáltatás URL-je. Cloud Runon ezt a metaadat-szervertől kapjuk, saját
 * kulcs vagy Secret Manager nélkül — a service account, amivel a `grundo-api`
 * fut, automatikusan jogosult tokent kérni saját magának.
 *
 * A token kb. egy órát él; a cache 5 perccel a lejárat előtt frissít, hogy
 * egy hosszan futó kérés közben se járjon le alatta.
 */
const idTokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Folyamatban lévő tokenkérés — hogy 48 párhuzamos jelölt (8 irány × 3 mag ×
 * 2 menet) NE indítson 48 külön metaadat-hívást az első, még üres cache-nél.
 * A második hívótól kezdve mindenki ugyanarra a promise-ra vár.
 */
let idTokenInFlight: Promise<string | null> | null = null;

/**
 * ID-token a GraphHopper-híváshoz — `null`, ha nincs rá szükség vagy nem
 * elérhető a metaadat-szerver.
 *
 * ⚠️ HELYI FEJLESZTÉSEN (`GRAPHHOPPER_URL=http://localhost:8989`) EZ MINDIG
 * `null`. A metaadat-szerver csak GCP-n belül létezik, és a helyi GraphHopper
 * nincs is hitelesítés mögé zárva — a `fetch` erre a címre helyben egyszerűen
 * elhasalna (DNS-hiba), ezért localhost/loopback címnél meg sem próbáljuk.
 */
async function graphhopperIdToken(): Promise<string | null> {
  const audience = graphhopperUrl();
  if (!audience || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(audience)) return null;

  const cached = idTokenCache.get(audience);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (idTokenInFlight) return idTokenInFlight;

  idTokenInFlight = fetchGraphhopperIdToken(audience).finally(() => {
    idTokenInFlight = null;
  });
  return idTokenInFlight;
}

async function fetchGraphhopperIdToken(audience: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
      { headers: { 'Metadata-Flavor': 'Google' }, signal: controller.signal },
    );
    if (!response.ok) return null;
    const token = (await response.text()).trim();
    // A Google ID-token kb. 1 órát él — 5 perccel korábban frissítünk.
    idTokenCache.set(audience, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
    return token;
  } catch {
    // Nem GCP-n futunk, vagy a metaadat-szerver átmenetileg nem elérhető.
    // A hívó ilyenkor token nélkül próbálja — ha a GraphHopper hitelesítést
    // követel, 403-at ad, ami a szokásos „ez a jelölt kimarad" ágba fut.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Az útsúlyozás és a kanyarbüntetés PONTOSAN a `graphhopper/custom_models/`
 * alatti fájlok tartalma, ide másolva.
 *
 * MIÉRT MÁSOLAT, NEM FÁJLBEOLVASÁS? A `graphhopper/` mappa a GraphHopper
 * KONTÉNERÉHEZ tartozik (lásd README → Élesítés), a `server/` egy másik
 * Cloud Run szolgáltatás — a kettő külön képre épül, a kettő között nincs
 * közös fájlrendszer élesben. Ha itt módosítasz egy súlyt, a
 * `graphhopper/custom_models/*.json`-t is frissítsd — ez a helyi
 * alapértelmezés (ha a kérés NEM ágyaz egyedi modellt), emitt pedig a
 * ténylegesen küldött modell.
 */
const GH_PRIORITY: Record<'foot' | 'bike', unknown[]> = {
  foot: [
    { if: 'road_class == PRIMARY || road_class == SECONDARY', multiply_by: '0.4' },
    { if: 'road_class == CYCLEWAY || road_class == FOOTWAY || road_class == PATH', multiply_by: '1.3' },
    { if: 'foot_network != MISSING', multiply_by: '1.2' },
    { if: 'road_environment == FERRY', multiply_by: '0' },
  ],
  bike: [
    { if: 'road_class == CYCLEWAY || bike_network != MISSING', multiply_by: '1.6' },
    { if: 'road_class == PRIMARY || road_class == SECONDARY', multiply_by: '0.35' },
    { if: 'surface == GRAVEL || surface == DIRT || surface == SAND || surface == GROUND', multiply_by: '0.5' },
    { if: 'road_environment == FERRY', multiply_by: '0' },
  ],
};

/** Csak a `straight` (hosszú egyenesek) állásnál kerül a kérésbe. */
const GH_TURN_PENALTY: Record<'foot' | 'bike', unknown[]> = {
  foot: [
    { if: 'change_angle >= 25 && change_angle < 80', add: '8' },
    { else_if: 'change_angle >= 80 && change_angle <= 180', add: '25' },
  ],
  bike: [
    { if: 'change_angle >= 25 && change_angle < 80', add: '10' },
    { else_if: 'change_angle >= 80 && change_angle <= 180', add: '30' },
  ],
};

/** Mapbox-profilnév → GraphHopper-profilnév (lásd `graphhopper/config-grundo.yml`). */
function graphhopperProfile(profile: 'walking' | 'cycling'): 'foot' | 'bike' {
  return profile === 'cycling' ? 'bike' : 'foot';
}

interface GraphHopperPath {
  distance?: number;
  time?: number;
  points?: string;
}

/**
 * Egy kör-jelölt lekérése `algorithm=round_trip`-pel.
 *
 * A HIBA ITT IS NEM DOBÁS, hanem `null` — ugyanaz az elv, mint a Mapbox-ágon:
 * egyetlen mag vagy irány elhasalása nem viheti el a többi jelöltet.
 */
async function requestGraphHopperRoundTrip(
  origin: LatLng,
  profile: 'foot' | 'bike',
  targetKm: number,
  headingDeg: number,
  seed: number,
  customModel: Record<string, unknown>,
): Promise<DirectionsRoute | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const idToken = await graphhopperIdToken();
    const response = await fetch(`${graphhopperUrl()}/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        points: [[origin.lng, origin.lat]],
        profile,
        'ch.disable': true,
        algorithm: 'round_trip',
        'round_trip.distance': Math.round(targetKm * 1000),
        'round_trip.seed': seed,
        headings: [headingDeg],
        custom_model: customModel,
        points_encoded: true,
        instructions: false,
        elevation: false,
      }),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { paths?: GraphHopperPath[] };
    const path = body.paths?.[0];
    if (!path || typeof path.points !== 'string') return null;

    return {
      distanceM: Number(path.distance ?? 0),
      // A GraphHopper `time` mezője MILLISZEKUNDUM, a `DirectionsRoute.durationS`
      // szerződése szerint másodperc kell — enélkül a küldetés tízszer olyan
      // gyorsnak tűnne, mint amennyi idő alatt valóban végigmenne rajta.
      durationS: Number(path.time ?? 0) / 1000,
      polyline: path.points,
    };
  } catch {
    // Időtúllépés vagy hálózati hiba — ez a jelölt egyszerűen kimarad.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Egy irányra több mag — a párhuzamos kérések mindegyike ingyenes és ~15 ms. */
async function planLoopGraphHopper(
  origin: LatLng,
  bearingDeg: number,
  targetKm: number,
  profile: 'walking' | 'cycling',
  character: RouteCharacter,
): Promise<DirectionsRoute[]> {
  const ghProfile = graphhopperProfile(profile);
  const customModel: Record<string, unknown> =
    character === 'straight'
      ? { priority: GH_PRIORITY[ghProfile], turn_penalty: GH_TURN_PENALTY[ghProfile] }
      : { priority: GH_PRIORITY[ghProfile] };

  const results = await Promise.all(
    Array.from({ length: GH_SEEDS_PER_BEARING }, (_unused, seed) =>
      requestGraphHopperRoundTrip(origin, ghProfile, targetKm, bearingDeg, seed, customModel),
    ),
  );

  const seen = new Set<string>();
  const routes: DirectionsRoute[] = [];
  for (const route of results) {
    if (!route || seen.has(route.polyline)) continue;
    seen.add(route.polyline);
    routes.push(route);
  }
  return routes;
}

/**
 * A küldetés-ajánló belépési pontja EGY irányra: GraphHopper elsőként, Mapbox
 * tartalékban.
 *
 * A `bearing` és a `targetKm` itt egyetlen kör leírása — a GraphHopper
 * `round_trip` algoritmusa nem vár mértani köztes pontokat, azokat csak a
 * Mapbox-ág számolja (lásd `loopWaypoints`), ott is BELÜL, hívó nélkül.
 * Ha a GraphHopper egy adott irányra nem ad jelöltet (ritka úthálózat,
 * időtúllépés), a Mapbox-ág — ha van tokene — még megpróbálja ugyanazt az
 * irányt a saját geometriájával.
 */
export async function planMissionLoop(
  origin: LatLng,
  bearingDeg: number,
  targetKm: number,
  profile: 'walking' | 'cycling',
  cfg: GameplayConfig,
  character: RouteCharacter,
): Promise<DirectionsRoute[]> {
  if (graphhopperConfigured()) {
    const routes = await planLoopGraphHopper(origin, bearingDeg, targetKm, profile, character);
    if (routes.length > 0) return routes;
  }
  if (!mapboxToken()) return [];
  const waypoints = loopWaypoints(origin, bearingDeg, targetKm, cfg);
  return planLoop(origin, waypoints, profile);
}
