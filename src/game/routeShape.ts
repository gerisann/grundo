/**
 * A tervezett útvonal ALAKJA — mennyire kellemes végigmenni rajta.
 *
 * Ez NEM játékérték. Két kör ugyanannyi területet adhat, miközben az egyiken
 * végig lehet futni, a másik meg háromszor beszalad egy mellékutcába, megfordul
 * és visszajön. A rács-logika a kettőt egyformának látja; a felhasználó nem.
 *
 * MIÉRT VAN EGYÁLTALÁN KITÉRŐ AZ ÚTVONALON? A kör köztes pontjai (`loopWaypoints`)
 * tisztán mértani helyek, és a Directions mindegyiket rákapcsolja a legközelebbi
 * útra. Ha egy pont egy zsákutca vagy mellékutca mellé esik, az útvonalnak oda
 * KELL mennie, meg kell fordulnia és vissza kell jönnie — a Mapboxnak nincs
 * választása, mert a pontot megadtuk.
 *
 * A 2026-08-22-i első mérés megmutatta, hogy egyetlen kapcsoló nem elég:
 *
 *   - a puszta `continue_straight=true` csökkentette a U-fordulást, de a
 *     bezárt terület negyedét elvesztette;
 *   - `radiuses=150` és `300` a köztes pontokon: SEMMI hatás, bitre ugyanazok
 *     az útvonalak. A paraméter csak felső korlát a rákapcsolásra, nem
 *     preferencia.
 *   - 3 köztes pont 5 helyett: kevesebb kitérő, de a terület 2,015-ről
 *     1,147 km²-re esik. A háromszög-alakú kör egyszerűen kevesebbet zár be.
 *
 * A 2026-08-23-i megoldás ezért háromrétegű: irányhelyes ráillesztés
 * (`bearings` + `continue_straight`), a hibát okozó köztes pont úthálózati
 * bejárathoz igazítása és újratervezése, végül külön U-fordulás/helyi kerülő
 * szerinti válogatás. Élő mérésen (3 budapesti kiindulás × 8 irány, 7,5 km)
 * a nyers U-fordulás 61-ről 14-re, a ténylegesen felajánlott útvonalaké
 * 16-ról nullára csökkent. A Map Matching nem vált be: a szintetikus kör
 * pontjai az 50 méteres illesztési korláton kívül széteső részutakat adtak.
 *
 * A modul TISZTA: közös a klienssel és a szerverrel, nincs benne I/O
 * (AGENTS.md 4. szabály).
 */

import { distanceM, type LatLng } from './geo';

/**
 * A be- és kimenő irányt ekkora bázison nézzük, nem szomszédos pontpárokból.
 *
 * MÉRT ÉRTÉKEK: a Directions sűrű pontsorában egyetlen pontpárból egy sima
 * kanyar is nagy szögváltozást adhat. A 6, 12 és 20 méteres bázis együtt a
 * néhány méteres lábat és a hosszabb visszafordulást is látja.
 */
const TURN_BASELINES_M = [6, 12, 20] as const;

/** Ennél nagyobb irányváltás számít visszafordulásnak. */
const U_TURN_DEGREES = 150;

/** A mintavétel lépése — hogy a mérőszám ne a pontsűrűségtől függjön. */
const SAMPLE_STEP_M = 5;

/**
 * Egy helyi kerülő legfeljebb ekkora lehet, hogy útvonalhibának tekintsük.
 * A teljes küldetéskört természetesen nem akarjuk „kiegyenesíteni”.
 */
const LOCAL_DETOUR_MAX_M = 350;

/** Legalább ekkora kitérőt érdemes a térképen is hibának venni. */
const LOCAL_DETOUR_MIN_M = 25;

/**
 * Ha a két végpont légvonala az odavezető útnak legfeljebb ekkora része,
 * akkor a rövid rész egy fölösleges visszatérés vagy doboz alakú kitérő.
 */
const LOCAL_DETOUR_DIRECT_RATIO = 0.5;

/** Irányszög két pont között, fokban (0 = észak). */
function bearingDeg(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** A nyomvonal újramintázása egyenletes lépésközzel. */
function resample(points: readonly LatLng[], stepM: number): LatLng[] {
  if (points.length < 2) return [...points];
  const out: LatLng[] = [points[0]!];
  let carry = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const segment = distanceM(from, to);
    if (segment <= 0) continue;
    let travelled = stepM - carry;
    while (travelled <= segment) {
      const ratio = travelled / segment;
      out.push({
        lat: from.lat + (to.lat - from.lat) * ratio,
        lng: from.lng + (to.lng - from.lng) * ratio,
      });
      travelled += stepM;
    }
    carry = (carry + segment) % stepM;
  }
  return out;
}

/**
 * Hány visszafordulás van az útvonalon?
 *
 * Ez a „lábak" mérőszáma: egy mellékutcába beszaladó és onnan visszatérő
 * kitérő csúcsán pontosan egy közel-180 fokos fordulat van (a be- és kilépés
 * derékszög). Szintetikus próbán hitelesítve: tiszta körre 0, három beszúrt
 * lábra 3, hatra 6.
 *
 * A felajánlásnál a nulla a cél. Ha ritka úthálózatban egyetlen ilyen jelölt
 * sincs, a generálást nem tesszük használhatatlanná: a helyi legjobbat adjuk.
 */
export function countUTurns(points: readonly LatLng[]): number {
  const sampled = resample(points, SAMPLE_STEP_M);
  const spans = TURN_BASELINES_M.map((baseline) =>
    Math.max(1, Math.round(baseline / SAMPLE_STEP_M)),
  );
  const largestSpan = Math.max(...spans);
  const smallestSpan = Math.min(...spans);

  let count = 0;
  let cooldown = 0;
  for (let index = smallestSpan; index + smallestSpan < sampled.length; index += 1) {
    if (cooldown > 0) {
      cooldown -= 1;
      continue;
    }
    const isUTurn = spans
      .filter((span) => index >= span && index + span < sampled.length)
      .some((span) => {
      const incoming = bearingDeg(sampled[index - span]!, sampled[index]!);
      const outgoing = bearingDeg(sampled[index]!, sampled[index + span]!);
      const turn = Math.abs(((outgoing - incoming + 540) % 360) - 180);
      return turn > U_TURN_DEGREES;
      });
    if (isUTurn) {
      count += 1;
      // Egy fordulatot ne számoljunk többször: a bázison belül minden
      // mintapont ugyanazt a visszafordulást látná.
      cooldown = largestSpan;
    }
  }
  return count;
}

/**
 * Rövid, aránytalan helyi kerülők száma.
 *
 * Ez fogja meg azt, amit egyetlen szög nem tud: a kis körforgásszerű hurkot,
 * illetve a három 90°-os kanyarból álló „dobozt”. Egy rendes L-kanyar
 * végpontjai az út hosszának kb. 71%-ára vannak egymástól; a képernyőképeken
 * látható kitérők 50% alatt visszaérnek ugyanahhoz az útszakaszhoz.
 */
export interface ShortDetour {
  /** A visszatérő rész úthálózaton fekvő kezdő- és végpontja. */
  start: LatLng;
  end: LatLng;
  /** A teljes hibás rész — ezzel kapcsoljuk vissza a kiváltó köztes ponthoz. */
  path: readonly LatLng[];
  alongM: number;
  directM: number;
}

/**
 * A rövid visszatérő részek helye és geometriája.
 *
 * A részletes eredmény nemcsak diagnosztika: a küldetéstervező ebből tudja,
 * melyik mértani köztes pont pattant rossz mellékutcára. Az ilyen pontot a
 * kitérő úthálózaton fekvő bejáratához igazítva újratervezi a Mapboxszal.
 */
export function findShortDetours(points: readonly LatLng[]): ShortDetour[] {
  const sampled = resample(points, SAMPLE_STEP_M);
  const minSpan = Math.max(2, Math.ceil(LOCAL_DETOUR_MIN_M / SAMPLE_STEP_M));
  const maxSpan = Math.max(minSpan, Math.floor(LOCAL_DETOUR_MAX_M / SAMPLE_STEP_M));
  const defects: ShortDetour[] = [];

  for (let start = 0; start + minSpan < sampled.length; start += 1) {
    let defectEnd = -1;
    const last = Math.min(sampled.length - 1, start + maxSpan);
    for (let end = start + minSpan; end <= last; end += 1) {
      const alongM = (end - start) * SAMPLE_STEP_M;
      const directM = distanceM(sampled[start]!, sampled[end]!);
      if (directM / alongM <= LOCAL_DETOUR_DIRECT_RATIO) defectEnd = end;
    }
    if (defectEnd < 0) continue;

    const alongM = (defectEnd - start) * SAMPLE_STEP_M;
    defects.push({
      start: sampled[start]!,
      end: sampled[defectEnd]!,
      path: sampled.slice(start, defectEnd + 1),
      alongM,
      directM: distanceM(sampled[start]!, sampled[defectEnd]!),
    });
    // Ugyanazt a hurkot a következő néhány kezdőpontból is látnánk. A teljes
    // hibás rész után folytatjuk, így egy kitérő pontosan egyszer számít.
    start = defectEnd;
  }

  return defects;
}

export function countShortDetours(points: readonly LatLng[]): number {
  return findShortDetours(points).length;
}

/** A küldetésválogatás egyetlen minőségi pontszáma. */
export function countRouteDefects(points: readonly LatLng[]): number {
  return countUTurns(points) + countShortDetours(points);
}

/**
 * 30 méteres léptékben mért kanyarszám és átlagos egyenes szakasz.
 *
 * MIÉRT MÁS LÉPTÉK, MINT A `countUTurns`? Az a valódi visszafordulást keresi
 * (6–20 m), ez itt a „mennyire tempózható" érzetet: a GraphHopper
 * `turn_penalty`-kapcsoló (docs/02 → „kanyargós ↔ hosszú egyenesek") ezen a
 * durvább léptéken hoz mérhető különbséget (2026-08-29-i mérés:
 * `tmp/probe-final.ts`) — 30 m alatt szinte minden útvonal „kanyargósnak"
 * látszana a járdaszegélyek miatt.
 *
 * NEM kizáró kapu, csak pontszám: `routeDefectScore` az U-fordulás és a
 * helyi kerülő UTÁN, gyenge súllyal nézi — a „hosszú egyenesek" választás
 * elsősorban a GraphHopper KÉRÉSÉBE ágyazva hat (`turn_penalty`), ez a
 * mérőszám csak a döntetlent bontja tovább.
 */
const STRAIGHTNESS_SAMPLE_STEP_M = 30;
const STRAIGHTNESS_TURN_DEGREES = 35;

export interface RouteStraightness {
  turnCount: number;
  averageStraightM: number;
}

export function measureStraightness(points: readonly LatLng[]): RouteStraightness {
  const sampled = resample(points, STRAIGHTNESS_SAMPLE_STEP_M);
  let totalM = 0;
  for (let index = 1; index < points.length; index += 1) {
    totalM += distanceM(points[index - 1]!, points[index]!);
  }

  let turnCount = 0;
  for (let index = 2; index < sampled.length; index += 1) {
    const delta = Math.abs(
      ((bearingDeg(sampled[index - 1]!, sampled[index]!) - bearingDeg(sampled[index - 2]!, sampled[index - 1]!) + 540) % 360) - 180,
    );
    if (delta >= STRAIGHTNESS_TURN_DEGREES) turnCount += 1;
  }

  return { turnCount, averageStraightM: totalM / (turnCount + 1) };
}

export interface RouteQuality {
  uTurns: number;
  shortDetours?: number;
  /** Lásd `measureStraightness` — csak gyenge súllyal bontja a döntetlent. */
  turnCount?: number;
}

/**
 * Rendezési pontszám: egy valódi megfordulás mindig rosszabb bármennyi
 * enyhébb helyi kerülőnél, az pedig rosszabb bármennyi 30 méteres kanyarnál.
 * A mezőnevek külön maradnak, mert a korábbi közös szám miatt U-fordulásmentes
 * útvonalak is „hibásnak" látszottak.
 */
export function routeDefectScore(route: RouteQuality): number {
  return route.uTurns * 1_000 + (route.shortDetours ?? 0) + (route.turnCount ?? 0) * 0.01;
}

/**
 * A mellékutcai „lábakat” már a birtokviszony szerinti pontozás ELŐTT szűri.
 *
 * Nem húzunk abszolút plafont: ha egy környék úthálózata minden irányban
 * kényszerít hibát, akkor is kell ajánlatot adnunk. A valódi U-fordulás
 * ezerszeres súlya biztosítja, hogy előbb a nyúlványok tűnjenek el, és csak
 * azon belül rangsoroljuk a rövid helyi kerülőket. Ha háromnál kevesebb
 * közeli minőségű jelölt maradna, a három legtisztábbat tartjuk meg.
 */
export function preferCleanRoutes<T extends RouteQuality>(routes: readonly T[]): T[] {
  if (routes.length <= 3) return [...routes];
  const ordered = [...routes].sort((a, b) => routeDefectScore(a) - routeDefectScore(b));
  const best = routeDefectScore(ordered[0]!);
  const clean = ordered.filter((route) => routeDefectScore(route) <= best + 1);
  return clean.length >= 3 ? clean : ordered.slice(0, 3);
}

/**
 * A valóban tiszta, oda-vissza mellékutcai nyúlvány nélküli útvonalak.
 *
 * A `preferCleanRoutes` egymáshoz képest rangsorol: akkor is visszaad jelöltet,
 * ha a környéken mindegyik rossz. A felhasználói ajánlásnál ez már nem elég:
 * egyetlen fölösleges visszafordulás is rosszabb ajánlat. Ez azonban NEM
 * kizáró kapu: ritka úthálózatban minden egyes kör tartalmazhat egy kényszerű
 * visszafordulást. Ilyenkor a „nincs küldetés" rosszabb élmény, mint a helyi
 * legjobb, őszintén megjelenített útvonal.
 */
export function withoutOutAndBackSpurs<T extends RouteQuality>(
  routes: readonly T[],
): T[] {
  return routes.filter((route) => route.uTurns === 0);
}

/**
 * A küldetéslistába kerülő útvonalak.
 *
 * Van tiszta jelölt → csak azokból válogatunk. Nincs tiszta jelölt → a teljes
 * mezőnyt a már kipróbált relatív minőségi sorrendbe tesszük. Így a látványos
 * zsákutcák nem nyernek, de az ajánló soha nem válik használhatatlanná attól,
 * hogy az adott környék minden köre kényszerűen tartalmaz egy visszafordulást.
 */
export function selectMissionRoutes<T extends RouteQuality>(routes: readonly T[]): T[] {
  const clean = withoutOutAndBackSpurs(routes);
  return preferCleanRoutes(clean.length > 0 ? clean : routes);
}
