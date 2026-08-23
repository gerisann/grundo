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
 * ⚠️ AMIT MEGMÉRTEM ÉS ELVETETTEM (2026-08-22, 3 kiindulás × 8 irány, éles
 * Directions-hívásokkal):
 *
 *   - `continue_straight=true` (a #7 menet gyanúja): a U-fordulók 65-ről 38-ra
 *     esnek, DE a bezárt BELSŐ terület 1,900 km²-ről 1,425-re — a negyede
 *     elveszik. Rossz csere, nem vezettük be.
 *   - `radiuses=150` és `300` a köztes pontokon: SEMMI hatás, bitre ugyanazok
 *     az útvonalak. A paraméter csak felső korlát a rákapcsolásra, nem
 *     preferencia.
 *   - 3 köztes pont 5 helyett: kevesebb kitérő, de a terület 2,015-ről
 *     1,147 km²-re esik. A háromszög-alakú kör egyszerűen kevesebbet zár be.
 *
 * AMI MŰKÖDÖTT: nem a hívást állítjuk át, hanem VÁLOGATUNK. Nyolc jelöltből
 * három kerül a felhasználó elé — ha a közel egyformák közül a tisztábbat
 * választjuk, a kitérők nagy része eltűnik, és ez mérve ~1% területbe kerül,
 * nem 25-be. Ez a függvény adja hozzá a mértéket.
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
 * ⚠️ A NULLA NEM CÉL. Egy városi kör természetes velejárója néhány
 * visszafordulás; a mérőszám arra való, hogy KÉT jelölt közül a tisztábbat
 * lehessen választani, nem arra, hogy abszolút küszöböt húzzunk.
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
export function countShortDetours(points: readonly LatLng[]): number {
  const sampled = resample(points, SAMPLE_STEP_M);
  const minSpan = Math.max(2, Math.ceil(LOCAL_DETOUR_MIN_M / SAMPLE_STEP_M));
  const maxSpan = Math.max(minSpan, Math.floor(LOCAL_DETOUR_MAX_M / SAMPLE_STEP_M));
  let count = 0;

  for (let start = 0; start + minSpan < sampled.length; start += 1) {
    let defectEnd = -1;
    const last = Math.min(sampled.length - 1, start + maxSpan);
    for (let end = start + minSpan; end <= last; end += 1) {
      const alongM = (end - start) * SAMPLE_STEP_M;
      const directM = distanceM(sampled[start]!, sampled[end]!);
      if (directM / alongM <= LOCAL_DETOUR_DIRECT_RATIO) defectEnd = end;
    }
    if (defectEnd < 0) continue;

    count += 1;
    // Ugyanazt a hurkot a következő néhány kezdőpontból is látnánk. A teljes
    // hibás rész után folytatjuk, így egy kitérő pontosan egyszer számít.
    start = defectEnd;
  }

  return count;
}

/** A küldetésválogatás egyetlen minőségi pontszáma. */
export function countRouteDefects(points: readonly LatLng[]): number {
  return countUTurns(points) + countShortDetours(points);
}

/**
 * A mellékutcai „lábakat” már a birtokviszony szerinti pontozás ELŐTT szűri.
 *
 * Nem húzunk abszolút plafont: ha egy környék úthálózata minden irányban
 * kényszerít visszafordulást, akkor is kell ajánlatot adnunk. A helyi legjobb
 * alakhoz képest legfeljebb egy extra fordulást engedünk; ha ettől háromnál
 * kevesebb jelölt maradna, a három legtisztábbat tartjuk meg. Így a játéktét
 * továbbra is tud három különböző küldetést adni, a látványosan rossz
 * fésű-alakú útvonalak viszont nem nyerhetnek pusztán több cellával.
 */
export function preferCleanRoutes<T extends { uTurns: number }>(routes: readonly T[]): T[] {
  if (routes.length <= 3) return [...routes];
  const ordered = [...routes].sort((a, b) => a.uTurns - b.uTurns);
  const best = ordered[0]!.uTurns;
  const clean = ordered.filter((route) => route.uTurns <= best + 1);
  return clean.length >= 3 ? clean : ordered.slice(0, 3);
}

/**
 * Csak valóban tiszta, oda-vissza mellékutcai nyúlvány nélküli útvonalak.
 *
 * A `preferCleanRoutes` egymáshoz képest rangsorol: akkor is visszaad jelöltet,
 * ha a környéken mindegyik rossz. A felhasználói ajánlásnál ez már nem elég:
 * egyetlen fölösleges visszafordulás is olyan útvonalat ígér, amit senki nem
 * akarna követni. Itt ezért abszolút minőségi kapu van. Kevesebb ajánlat jobb,
 * mint egy térképen láthatóan hibás ajánlat.
 */
export function withoutOutAndBackSpurs<T extends { uTurns: number }>(
  routes: readonly T[],
): T[] {
  return routes.filter((route) => route.uTurns === 0);
}
