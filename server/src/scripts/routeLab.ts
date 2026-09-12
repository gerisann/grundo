/**
 * Útvonal-labor — kézi próbapad az A→B tervezőhöz.
 *
 * MIÉRT VAN? Az útvonalak minőségét számokból nem lehet megítélni: a
 * visszafordulás-szám javulhat úgy, hogy közben a térképen új hiba keletkezik
 * (mérve, 2026-09-12). Ez a lap teszi kézzel próbálhatóvá a tervezőt, mielőtt
 * API-végpont és felhasználói felület készülne hozzá.
 *
 * NEM része az éles kiszolgálónak: külön folyamat, nincs hitelesítés, nincs
 * kvóta, nem ír semmit. A `server/` Cloud Run szolgáltatás ettől független.
 *
 * Futtatás a `server/` mappából:
 *
 *   1. GraphHopper (külön ablakban, a `graphhopper/` mappából):
 *      java -Xmx4g -jar graphhopper-web-11.0.jar server config-grundo.yml
 *   2. npm run lab:routes
 *   3. http://localhost:8787
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { GAMEPLAY } from '../../../src/config/gameplay';
import { distanceM, type LatLng } from '../../../src/game/geo';
import { decodePolyline } from '../../../src/game/polyline';
import { countSelfRevisits, countShortDetours, countUTurns } from '../../../src/game/routeShape';
import {
  cellToBoundary,
  cellToChildren,
  cellToParent,
  cellsToMultiPolygon,
  gridDisk,
  latLngToCell,
  polygonToCells,
} from 'h3-js';

import { areaToGp } from '../../../src/game/scoring';
import { hasCompactInterior, loopCellCount } from '../../../src/game/loopInterior';
import { windingCounts } from '../../../src/game/winding';
import { graphhopperConfigured, routeToTracePoints, type DirectionsRoute } from '../lib/directions';
import { shapeCandidateCells } from '../lib/missionEvaluate';
import {
  planDirectRoute,
  planTwoSidedLoop,
  type DetourSize,
  type RoutePreference,
  type TerrainPreference,
} from '../lib/routePlan';

const PORT = Number(process.env.ROUTE_LAB_PORT ?? 8787);

process.env.GRAPHHOPPER_URL ??= 'http://127.0.0.1:8989';

/*
  A birtokviszony-lekérdezéshez a Firebase Admin SDK-nak projektazonosító kell.
  Emulátor mellett a demó projekt, egyébként az éles — így a
  `gcloud auth application-default login` után nincs több kézi lépés.

  ⚠️ EMULÁTOR NÉLKÜL EZ AZ ÉLES ADATBÁZIST OLVASSA (`grundo-db`). A labor
  írni semmit nem ír, de tudni kell, hogy valódi adat jön vissza.
*/
process.env.GOOGLE_CLOUD_PROJECT ??= process.env.FIRESTORE_EMULATOR_HOST
  ? 'demo-grundo'
  : 'grundo';

/** A térképhez a kliens publikus tokenje kell — ugyanaz, ami a bundle-ben van. */
function mapboxToken(): string {
  for (const file of ['.env.local', '.env']) {
    try {
      const raw = readFileSync(resolve(process.cwd(), '..', file), 'utf8');
      const match = /VITE_MAPBOX_TOKEN=(\S+)/.exec(raw);
      if (match?.[1]) return match[1];
    } catch {
      /* nincs ilyen fájl — a következőt próbáljuk */
    }
  }
  return '';
}

interface PlanRequest {
  from: LatLng;
  to: LatLng;
  stops: LatLng[];
  profile: 'walking' | 'cycling';
  mode: 'direct' | 'loop';
  detour: DetourSize;
  preference: RoutePreference;
  preferCycleways: boolean;
  terrain: TerrainPreference;
  geometry: boolean;
  ownership: boolean;
}

function parseRequest(body: string): PlanRequest {
  const input = JSON.parse(body) as Partial<PlanRequest>;
  const point = (value: unknown): LatLng => {
    const candidate = value as LatLng | undefined;
    if (!candidate || !Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) {
      throw new Error('Hiányzó vagy hibás koordináta.');
    }
    return { lat: candidate.lat, lng: candidate.lng };
  };
  const stops = Array.isArray((input as { stops?: unknown }).stops)
    ? ((input as { stops: unknown[] }).stops.map(point) as LatLng[])
    : [];
  return {
    from: point(input.from),
    to: point(input.to),
    stops,
    preferCycleways: Boolean((input as { preferCycleways?: unknown }).preferCycleways),
    terrain:
      input.terrain === 'flat' || input.terrain === 'hilly' ? input.terrain : 'balanced',
    geometry: Boolean((input as { geometry?: unknown }).geometry),
    ownership: Boolean((input as { ownership?: unknown }).ownership),
    profile: input.profile === 'cycling' ? 'cycling' : 'walking',
    mode: input.mode === 'direct' ? 'direct' : 'loop',
    detour:
      input.detour === 'small' || input.detour === 'large' ? input.detour : 'medium',
    preference:
      input.preference === 'protected' || input.preference === 'quiet'
        ? input.preference
        : 'fast',
  };
}

/**
 * Birtokviszony a VALÓDI Firestore-ból.
 *
 * ⚠️ KÜLÖN KAPCSOLÓ, ÉS KÜLÖN KÖLTSÉG. Ez az egyetlen pont, ahol a labor
 * kilép a saját folyamatából: a `grundo-db` grid blokkjait olvassa. Írni
 * semmit nem ír.
 *
 * A `firebase-admin` a betöltéskor hitelesítést vár, ezért DINAMIKUS import:
 * enélkül a labor el sem indulna azon a gépen, ahol nincs beállítva
 * hitelesítés. Ha nem megy, őszinte hibaüzenetet adunk vissza, nem üres
 * eredményt — az utóbbi azt sugallná, hogy az egész terület szabad.
 */
async function measureOwnership(
  cells: Iterable<string>,
  profile: 'walking' | 'cycling',
): Promise<Record<string, unknown>> {
  const started = performance.now();
  try {
    const { loadOwnership } = await import('../lib/grid');
    const { blocksFor } = await import('../lib/gridMath');
    const { MAX_OWNERSHIP_BLOCKS } = await import('../lib/missionEvaluate');
    const layer = profile === 'cycling' ? 'bike' : 'foot';

    /*
      ⚠️ PLAFON A BLOKKSZÁMRA — ez HIBAJAVÍTÁS, nem óvatoskodás (mérve,
      2026-09-12). A `loadOwnership` EGYETLEN `db.getAll(...refs)`-szel kéri az
      összes res9 blokkot, kötegelés nélkül. Egy Balaton-méretű kör több ezer
      blokkot jelent: a labor 11+ percig lógott nyitott Firestore-kapcsolattal,
      0% CPU-val, és a folyamat annyira beragadt, hogy utána egy BUDAPESTI
      kérést sem szolgált ki.

      Az éles kód ezt a hibát nem tudja elkövetni: a küldetés-ajánló
      `limitByBlocks(…, MAX_OWNERSHIP_BLOCKS)`-szal vág, a foglalás pedig
      `BLOCKS_PER_GROUP = 200`-as kötegekben olvas. A labor UGYANAZT a plafont
      használja, hogy amit itt látsz, az élesben is érvényes legyen.
    */
    const blocks = blocksFor(layer, cells as Iterable<never>);
    if (blocks.size > MAX_OWNERSHIP_BLOCKS) {
      return {
        available: false,
        reason:
          `Túl nagy kör a birtokviszony-lekérdezéshez: ${blocks.size.toLocaleString('hu-HU')} ` +
          `blokk, a plafon ${MAX_OWNERSHIP_BLOCKS}. Élesben a küldetés-ajánló ` +
          'ugyanennél a határnál vág. A geometria birtokviszony nélkül továbbra is megy.',
        blocks: blocks.size,
        maxBlocks: MAX_OWNERSHIP_BLOCKS,
        elapsedMs: Math.round(performance.now() - started),
      };
    }

    const ownership = await loadOwnership(layer, cells as Iterable<never>);

    const byLevel = new Map<number, number>();
    const byOwner = new Map<string, number>();
    let owned = 0;
    for (const entry of ownership.values()) {
      if (!entry?.owner) continue;
      owned += 1;
      byOwner.set(entry.owner, (byOwner.get(entry.owner) ?? 0) + 1);
      const level = Math.min(5, Math.max(1, Math.round(entry.defense ?? 1)));
      byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
    }

    const top = await topVictims(byOwner);

    const total = [...cells].length;
    return {
      available: true,
      /* A blokkszám a lekérdezés VALÓDI ára — ezen múlik, belefér-e. */
      blocks: blocks.size,
      maxBlocks: MAX_OWNERSHIP_BLOCKS,
      total,
      free: total - owned,
      owned,
      owners: byOwner.size,
      top,
      ownedByLevel: Object.fromEntries([...byLevel].sort((a, b) => a[0] - b[0])),
      elapsedMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const message = (error as Error).message;
    /*
      A nyers Google-hiba nem mondja meg, mit kell tenni. A laborban két út
      van: az emulátor vagy a valódi projekt hitelesítése.
    */
    const credentials = /Project Id|credential|permission|UNAUTHENTICATED/i.test(message);
    return {
      available: false,
      reason: credentials
        ? 'Nincs Firestore-hitelesítés. Vagy az emulátor kell ' +
          '(FIRESTORE_EMULATOR_HOST=localhost:8080 és GOOGLE_CLOUD_PROJECT=demo-grundo), ' +
          'vagy valódi hozzáférés (gcloud auth application-default login és ' +
          'GOOGLE_CLOUD_PROJECT=grundo).'
        : message,
    };
  }
}

/**
 * Akiktől a legtöbb területet vennénk el — legfeljebb három.
 *
 * ⚠️ A NÉV CSAK PUBLIKUS FIÓKNÁL JELENIK MEG. Ugyanaz a szabály, mint a
 * küldetés-ajánlóban (`resolveVictimNames`, `docs/02-funkcionalis-spec.md`):
 * privát fióknál a szöveg „helyi játékos". A területet amúgy is látni a
 * térképen, de a tervező nem lehet célzott zaklatási eszköz.
 */
async function topVictims(
  byOwner: ReadonlyMap<string, number>,
): Promise<{ name: string; cells: number; areaM2: number }[]> {
  const ranked = [...byOwner].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (ranked.length === 0) return [];

  const { db, COLLECTIONS } = await import('../lib/firebase');
  const docs = await db.getAll(
    ...ranked.map(([uid]) => db.collection(COLLECTIONS.users).doc(uid)),
  );

  const names = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data() as { username?: string; privacy?: { account?: string } };
    if (data.privacy?.account === 'private') continue;
    const username = String(data.username ?? '');
    if (username) names.set(doc.id, username);
  }

  return ranked.map(([uid, cells]) => ({
    name: names.get(uid) ?? 'helyi játékos',
    cells,
    areaM2: cells * GAMEPLAY.CELL_AREA_M2,
  }));
}

/**
 * Ennél több cellát nem küldünk EGYBEN a tervezés válaszában.
 *
 * ⚠️ EZ NEM A SZÁMÍTÁS PLAFONJA. A bezárt cellahalmazt a motor tömör belsővel
 * tetszőleges méretben kiszámolja (lásd `src/game/loopInterior.ts`); itt a
 * VÁLASZ MÉRETE a korlát. Mérve (2026-09-12): a cellánkénti GeoJSON 244
 * byte/cella, tehát 40 000 cella már 9,3 MB, 200 000 pedig 47 MB.
 *
 * E fölött nem marad el a cellarajz: igény szerint, a LÁTHATÓ nézetre jön —
 * lásd `cellsInBbox` és a lap `refreshVisibleCells` függvénye. Ugyanaz az
 * eljárás, mint az éles appban (`TerritoryScreen` → `api.tiles(view)`).
 */
const CELL_RENDER_LIMIT = 40_000;

/**
 * A nézet szerinti lekérdezés bucket-felbontása.
 *
 * A rajzolt cellákat res8 szülő szerint csoportosítjuk, így egy bbox-kérésnél
 * nem kell végigmenni több százezer cellán — csak a metsző bucketeken. Egy res8
 * szülő 7^4 = 2401 res12 cellát fog össze (~0,7 km²), tehát a zoom 15-ös
 * képernyő tipikusan néhány bucketet érint.
 */
const CELL_BUCKET_RES = 8;

/** A nézet szerinti válasz plafonja — védőkorlát elszabadult bbox ellen. */
const VISIBLE_CELL_LIMIT = 60_000;

/**
 * A LEGUTÓBBI tervezés kirajzolható területe.
 *
 * ⚠️ A TÖMÖR BELSŐT NEM BONTJUK KI ELŐRE. Ez hibajavítás (mérve, 2026-09-12):
 * a korábbi megoldás a parenteket egy 200 000-es plafonig bontotta res12-re,
 * és mivel a `fullParents` bejárási sorrendje NEM térbeli, a plafon fölött
 * véletlenszerűen szétszórt foltok maradtak — a térképen KONFETTI, egybefüggő
 * terület helyett. Egy Balaton-kör 2,1 millió cellája sosem fér bele.
 *
 * Helyette: a pontos cellák (fal + határsáv) bucketelve maradnak, a tömör
 * belső pedig PARENTKÉNT — és csak akkor bomlik ki, amikor egy konkrét
 * nézetre tényleg kell (`cellsInBbox`).
 *
 * ⚠️ EGY FELHASZNÁLÓRA MÉRETEZVE. A labor kézi eszköz, egy folyamat, egy fül:
 * szándékosan nincs munkamenet-azonosító, a következő tervezés felülírja.
 */
interface Drawing {
  /** A pontos res12 cellák (fal + határsáv), res8 bucketekben, szinttel. */
  fine: Map<string, { cell: string; level: number }[]>;
  /** A tömör belső parentjei, kibontatlanul. */
  parents: Set<string>;
  /** A parentek H3 felbontása (a motortól, jellemzően res10). */
  parentRes: number;
}
let lastDrawing: Drawing | null = null;

/** A bucketelt rajz felépítése — a tervezés végén, egyszer. */
function indexDrawing(byLevel: ReadonlyMap<number, string[]>) {
  const buckets = new Map<string, { cell: string; level: number }[]>();
  for (const [level, cells] of byLevel) {
    for (const cell of cells) {
      const parent = cellToParent(cell, CELL_BUCKET_RES);
      const bucket = buckets.get(parent);
      if (bucket) bucket.push({ cell, level });
      else buckets.set(parent, [{ cell, level }]);
    }
  }
  return buckets;
}

/**
 * A látható nézetbe eső cellák GeoJSON-ja a legutóbbi tervezésből.
 *
 * ⚠️ KÉT MAGVETÉS KELL, NEM EGY — mérve (2026-09-12): a `polygonToCells` csak
 * azokat a szülőket adja, amelyeknek a KÖZÉPPONTJA a bboxban van. Nagy
 * nagyításon a nézet KISEBB, mint egy res8 cella (~0,74 km²), ilyenkor egyetlen
 * középpont sem esik bele, a halmaz üres, és a rács eltűnik — pont ott, ahol a
 * részletet néznéd. Ezért a sarkok és a közép szülőjét is felvesszük, és az
 * egészet egy gyűrűvel kiterjesztjük (a szélen belógó szülők miatt).
 */
function cellsInBbox(bbox: { w: number; s: number; e: number; n: number }) {
  if (!lastDrawing) return { geojson: null as Record<string, unknown> | null, cells: 0 };

  const ring: [number, number][] = [
    [bbox.w, bbox.s],
    [bbox.e, bbox.s],
    [bbox.e, bbox.n],
    [bbox.w, bbox.n],
    [bbox.w, bbox.s],
  ];
  // `true` = GeoJSON sorrend ([lng, lat]).
  const seeds = polygonToCells(ring, CELL_BUCKET_RES, true);
  const centre: [number, number] = [(bbox.w + bbox.e) / 2, (bbox.s + bbox.n) / 2];
  for (const [lng, lat] of [...ring, centre]) {
    seeds.push(latLngToCell(lat, lng, CELL_BUCKET_RES));
  }

  const parents = new Set<string>();
  for (const seed of seeds) for (const near of gridDisk(seed, 1)) parents.add(near);

  const byLevel = new Map<number, string[]>();
  const seen = new Set<string>();
  let count = 0;
  const add = (cell: string, level: number) => {
    if (count >= VISIBLE_CELL_LIMIT || seen.has(cell)) return;
    seen.add(cell);
    const list = byLevel.get(level);
    if (list) list.push(cell);
    else byLevel.set(level, [cell]);
    count += 1;
  };

  // 1) A pontos cellák (fal + határsáv) a metsző bucketekből.
  for (const parent of parents) {
    const bucket = lastDrawing.fine.get(parent);
    if (!bucket) continue;
    for (const { cell, level } of bucket) add(cell, level);
  }

  /*
    2) A TÖMÖR BELSŐ — csak a nézetbe eső parentek, ÉS csak most kibontva.
    Ugyanaz a magvetés, mint fent: a bbox parentjei plusz egy gyűrű, hogy a
    szélen belógó szülők se maradjanak ki. A belső cellák szintje 1 — a
    körüljárás csak a falra ad magasabbat.
  */
  if (lastDrawing.parents.size > 0) {
    const interiorSeeds = polygonToCells(ring, lastDrawing.parentRes, true);
    for (const [lng, lat] of [...ring, centre]) {
      interiorSeeds.push(latLngToCell(lat, lng, lastDrawing.parentRes));
    }
    const wanted = new Set<string>();
    for (const seed of interiorSeeds) for (const near of gridDisk(seed, 1)) wanted.add(near);

    for (const parent of wanted) {
      if (count >= VISIBLE_CELL_LIMIT) break;
      if (!lastDrawing.parents.has(parent)) continue;
      for (const child of cellToChildren(parent, GAMEPLAY.H3_RESOLUTION)) add(child, 1);
    }
  }

  return { geojson: cellsToGeoJson(byLevel), cells: count };
}

/**
 * ÖSSZEVONT területpoligonok szintenként — a távoli nézethez.
 *
 * ⚠️ EZ A GYEREKBETEGSÉG JAVÍTÁSA, amit a Grund nézet már egyszer megkapott
 * (lásd `src/lib/hexAreas.ts`): cellánként egy poligonnál a Mapbox a
 * vektorcsempe méretkorlátja fölött CSENDBEN eldob feature-öket, ezért
 * kizoomolva foltokban hiányzik a terület, bezoomolva viszont visszatér.
 * Összevonva egy egybefüggő birtokból egyetlen feature lesz.
 *
 * ⚠️ KIZÁRÓLAG MEGJELENÍTÉS. A terület továbbra is cellahalmazból számolódik;
 * ebből a poligonból soha nem kerülhet vissza érték az elszámolásba.
 */
/**
 * A TERÜLET EGYBEFÜGGŐ FOLTJA a távoli nézethez — DURVA felbontáson.
 *
 * ⚠️ EZ NEM A CELLÁKBÓL ÉPÜL. Egy Balaton-kör 2,1 millió res12 cellája sem
 * összevonható, sem átküldhető; a korábbi megoldás ezért egy plafonig bontotta
 * ki a tömör belsőt, és a maradékból szétszórt foltok lettek (KONFETTI).
 *
 * A tömör belső PARENTJEI viszont pont azt írják le, amit távolról látni
 * akarunk: a terület kitöltött magját. Ezeket a fal durva szülőivel együtt
 * egyetlen poligonná vonjuk össze — 2,1 millió cella helyett néhány tízezer
 * parentből. Amit veszítünk, az a határ pár száz méteres pontossága; azon a
 * nagyításon, ahol ez a réteg látszik, az egy képpont alatt van. Közelről
 * úgyis a pontos cellarács veszi át (`cellsInBbox`).
 */
function compactAreaGeoJson(
  parents: ReadonlySet<string>,
  wall: Iterable<string>,
  parentRes: number,
): Record<string, unknown> {
  const coarse = new Set<string>(parents);
  for (const cell of wall) coarse.add(cellToParent(cell, parentRes));
  try {
    const coordinates = cellsToMultiPolygon([...coarse], true);
    if (coordinates.length === 0) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        // Egyetlen folt, szint nélkül: távolról a birtoklás ténye számít.
        properties: { level: 1 },
        geometry: { type: 'MultiPolygon', coordinates },
      }],
    };
  } catch (error) {
    console.warn(`⚠️  durva területösszevonás elhasalt: ${(error as Error).message}`);
    return { type: 'FeatureCollection', features: [] };
  }
}

function cellsToAreaGeoJson(byLevel: ReadonlyMap<number, string[]>): Record<string, unknown> {
  const features: Record<string, unknown>[] = [];
  for (const [level, cells] of byLevel) {
    try {
      const coordinates = cellsToMultiPolygon(cells, true);
      if (coordinates.length === 0) continue;
      features.push({
        type: 'Feature',
        properties: { level },
        geometry: { type: 'MultiPolygon', coordinates },
      });
    } catch (error) {
      /*
        ⚠️ EZ A CATCH KORÁBBAN NÉMA VOLT, és pont azt okozta, amit meg akart
        előzni: a terület CSENDBEN eltűnt a térképről, miközben a telemetria
        tízezres cellaszámot írt (mérve, 2026-09-12, 58 493 cellás körön).
        Ha elnyeljük, legalább mondjuk meg, mit.
      */
      console.warn(
        `⚠️  cellsToMultiPolygon elhasalt a(z) ${level}. szinten ` +
          `(${cells.length} cella): ${(error as Error).message}`,
      );
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Hatszög-határok GeoJSON-ná, szintenként címkézve. */
function cellsToGeoJson(byLevel: ReadonlyMap<number, string[]>): Record<string, unknown> {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  const features: Record<string, unknown>[] = [];
  for (const [level, cells] of byLevel) {
    for (const cell of cells) {
      // `true` = GeoJSON sorrend ([lng, lat]) és zárt gyűrű.
      const ring = cellToBoundary(cell, true).map(([lng, lat]) => [round(lng), round(lat)]);
      features.push({
        type: 'Feature',
        properties: { level },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * A JÁTÉKBELI geometria: mely cellák zárulnak be, és mennyi terület.
 *
 * ⚠️ EZ A DRÁGA FÉL. Mérve (2026-09-12): a bezárt cellahalmaz kiszámítása
 * 20–25 km-en 8 s, 60 km-en 35 s — ezért kapcsolható ki-be, és ezért nem fut
 * alapból. Részletek: `docs/routing/benchmark.md` → „Hol megy el az idő”.
 *
 * ⚠️ BIRTOKVISZONY NÉLKÜL. A valódi GP függ attól, kié most a cella (foglalás,
 * rajtaütés, védelem), és azt csak Firestore-ból lehet megmondani. Amit itt
 * látsz, az a FELSŐ HATÁR: minden cella szabadnak véve.
 */
function measureGeometry(
  legs: { route: DirectionsRoute; points: LatLng[] }[],
  profile: 'walking' | 'cycling',
) {
  const started = performance.now();

  // Egyetlen, folytonos nyomvonal a legekből — a bezárás a teljes körön áll elő.
  const trace: { lat: number; lng: number; t: number }[] = [];
  let clock = 0;
  for (const leg of legs) {
    const part = routeToTracePoints(leg.route, leg.points, clock);
    clock = part.at(-1)?.t ?? clock;
    trace.push(...part);
  }

  const shapedAt = performance.now();
  const shaped = shapeCandidateCells(trace);
  const shapeMs = Math.round(performance.now() - shapedAt);

  /*
    ELVETETT BEZÁRÁSOK — a motor NÉMÁN dobja el a túl nagy hurkot.
    (`loopDetection.ts`: `LoopTooLargeError` → `rejected` + `continue`.) Ettől
    egy bezáródó körre 0 terület jöhet ki, minden hibaüzenet nélkül — ez volt
    a „hol van lila folt, hol nincs” rejtélye. Ok szerint összesítve kiírjuk.
  */
  const rejected: Record<string, number> = {};
  for (const item of shaped.geometry.loopDiagnostics.rejected) {
    rejected[item.reason] = (rejected[item.reason] ?? 0) + 1;
  }

  /*
    ⚠️ A TERÜLET NEM A MATERIALIZÁLT CELLÁK SZÁMA. Nagy huroknál a motor
    SZÁNDÉKOSAN nem bontja ki a belsőt több millió res12 cellára, hanem tömör
    parentekben tartja (lásd `loopInterior.ts` és a DECISIONS „Compact"
    szakasza). A `shaped.cells` ilyenkor gyakorlatilag csak a FAL — abból
    számolva a terület töredékét kapnánk.

    A `loopCellCount` a reprezentációtól függetlenül adja a res12-egyenértékű
    cellaszámot.
  */
  const cellCount = shaped.geometry.loops.reduce((sum, loop) => sum + loopCellCount(loop), 0);
  const compact = shaped.geometry.loops.some(hasCompactInterior);
  const areaM2 = cellCount * GAMEPLAY.CELL_AREA_M2;

  /*
    CELLÁNKÉNTI SZINT a körüljárásból — ugyanaz a mérték, amiből az éles
    motor a védelmet képezi (`src/game/winding.ts`).

    ⚠️ SZABAD TERÜLETET FELTÉTELEZÜNK. Az éles elszámolás figyelembe veszi,
    kié most a cella (áttörés, elvétel, megerősítés); birtokviszony nélkül a
    körüljárás száma adja a szintet, egyre vágva és a maximumon megállítva.
  */
  const windingAt = performance.now();
  const turns = windingCounts(shaped.geometry.cellPath, shaped.cells);
  const windingMs = Math.round(performance.now() - windingAt);

  const expandAt = performance.now();

  /*
    ⚠️ A TÖMÖR BELSŐT NEM BONTJUK KI. Korábban igen, egy 200 000-es plafonig —
    és mivel a `fullParents` bejárási sorrendje nem térbeli, a plafon fölött
    szétszórt foltok maradtak a térképen (KONFETTI) egybefüggő terület helyett.
    Egy Balaton-kör 2,1 millió cellája amúgy sem férne bele.

    Helyette a parentek ÉRINTETLENÜL mennek a rajz-indexbe, és csak arra a
    nézetre bomlanak ki, amit a felhasználó tényleg néz (`cellsInBbox`). A
    távoli nézet foltját a `compactAreaGeoJson` adja, durva felbontáson.

    ⚠️ HALMAZ, NEM TÖMB — ez is hibajavítás (mérve, 2026-09-12): a
    `cellsToMultiPolygon` ISMÉTLŐDŐ cellára `Duplicate input (code: 10)` hibát
    dob, és attól a lila területréteg NÉMÁN eltűnt a térképről.
  */
  const parents = new Set<string>();
  let parentRes: number = GAMEPLAY.H3_RESOLUTION;
  for (const loop of shaped.geometry.loops) {
    const compact = loop.compactInterior;
    if (!compact) continue;
    parentRes = compact.parentResolution;
    for (const parent of compact.fullParents) parents.add(parent);
  }
  const drawable = new Set<string>(shaped.cells);

  const byLevel = new Map<number, string[]>();
  for (const cell of drawable) {
    const level = Math.min(GAMEPLAY.MAX_DEFENSE, Math.max(1, turns.get(cell) ?? 1));
    const bucket = byLevel.get(level);
    if (bucket) bucket.push(cell);
    else byLevel.set(level, [cell]);
  }
  /*
    A rajz-index MINDIG felépül: a nézet szerinti lekérdezés akkor is jól jön,
    ha a pontos halmaz belefért a válaszba (a Mapbox a csempe méretkorlátja
    fölött csendben eldob feature-öket).
  */
  lastDrawing = { fine: indexDrawing(byLevel), parents, parentRes };
  const expandMs = Math.round(performance.now() - expandAt);

  const distanceKm = legs.reduce((sum, leg) => sum + leg.route.distanceM, 0) / 1000;
  const perKm = GAMEPLAY.BASE_GP_PER_KM[profile === 'cycling' ? 'ride' : 'run'];

  const geoJsonAt = performance.now();
  /*
    KÉT ÚT A TÁVOLI FOLTHOZ. Tömör belső nélkül a pontos cellákból vonjuk össze
    (pontos határ, olcsó). Tömör belsővel a parentekből, durván — mert a pontos
    út ott sem nem összevonható, sem nem átküldhető.
  */
  const areaGeoJson = parents.size > 0
    ? compactAreaGeoJson(parents, drawable, parentRes)
    : cellsToAreaGeoJson(byLevel);
  const cellsGeoJson = parents.size === 0 && drawable.size <= CELL_RENDER_LIMIT
    ? cellsToGeoJson(byLevel)
    : null;
  const geoJsonMs = Math.round(performance.now() - geoJsonAt);

  return {
    cells: cellCount,
    compact,
    loops: shaped.loopCount,
    levels: Object.fromEntries([...byLevel].map(([level, list]) => [level, list.length])),
    /*
      A kirajzoláshoz kész GeoJSON megy át, nem cellaazonosítók: így a lapnak
      nem kell H3-könyvtárat betöltenie. PLAFONNAL — egy 60 km-es kör több
      százezer cellát zár be, az több tíz megabájt lenne.
    */
    /* Távoli nézethez összevonva, közelihez cellánként. */
    areaGeoJson,
    cellsGeoJson,
    /* Ha nem ment cellarajz a válaszban, a lap a látható nézetre kéri. */
    cellsOnDemand: cellsGeoJson === null,
    drawnCells: drawable.size,
    /* Hány parent képviseli a tömör belsőt — ennyit NEM kellett kibontani. */
    compactParents: parents.size,
    /* Ok szerint, hogy a némán eldobott hurok LÁTHATÓ legyen — lásd fent. */
    rejected,
    /* A geometria fázisai külön — ez a „Számítás” bontása. */
    phases: { shape: shapeMs, winding: windingMs, expand: expandMs, geojson: geoJsonMs },
    /* Csak a birtokviszony-lekérdezéshez kell; a válaszból kimarad. */
    cellIds: [...shaped.cells] as string[],
    areaM2,
    // A `DEFAULT_GAMEPLAY` alapértékkel — a labor nem olvas élő konfigurációt.
    claimGp: Math.round(areaToGp(areaM2)),
    distanceGp: Math.round(distanceKm * perKm),
    elapsedMs: Math.round(performance.now() - started),
  };
}

function legStats(points: readonly LatLng[]) {
  return {
    uTurns: countUTurns(points),
    shortDetours: countShortDetours(points),
    revisits: countSelfRevisits(points),
  };
}

/** A geometria mellé a birtokviszony, ha kérték — a cellahalmaz már megvan. */
async function withOwnership(
  geometry: ReturnType<typeof measureGeometry>,
  request: PlanRequest,
): Promise<Record<string, unknown>> {
  if (!request.ownership || geometry.cellIds.length === 0) {
    const { cellIds: _unused, ...rest } = geometry;
    return { geometry: rest };
  }
  const ownership = await measureOwnership(geometry.cellIds, request.profile);
  const { cellIds: _unused, ...rest } = geometry;
  return { geometry: rest, ownership };
}

async function plan(request: PlanRequest) {
  const started = performance.now();

  if (request.mode === 'direct') {
    const routes = await planDirectRoute(
      request.from,
      request.to,
      request.profile,
      request.preference,
      {
        stops: request.stops,
        preferCycleways: request.preferCycleways,
        terrain: request.terrain,
      },
    );
    const route = routes[0];
    if (!route) return { ok: false as const, reason: 'no_direct_route' };
    const points = decodePolyline(route.polyline);
    return {
      ok: true as const,
      mode: 'direct' as const,
      elapsedMs: Math.round(performance.now() - started),
      outbound: points.map((point) => [point.lng, point.lat]),
      inbound: [],
      totalDistanceM: route.distanceM,
      directDistanceM: route.distanceM,
      totalDurationS: route.durationS,
      /* ⚠️ A „Csak oda" nem zár kört, tehát NEM ad területet — csak GP-t. */
      closesLoop: false,
      quality: { ...legStats(points), sharedPathRatio: 0, outboundSideM: 0, inboundSideM: 0 },
      legs: { outbound: legStats(points), inbound: null },
      ...(request.geometry
        ? await withOwnership(
            measureGeometry([{ route, points }], request.profile),
            request,
          )
        : {}),
    };
  }

  /* A megállók CSAK az odaútra vonatkoznak; a visszaút egyben megy B-ből A-ba. */
  const result = await planTwoSidedLoop(request.from, request.to, request.profile, {
    detour: request.detour,
    preference: request.preference,
    preferCycleways: request.preferCycleways,
    terrain: request.terrain,
    stops: request.stops,
  });
  if (!result.ok) return { ok: false as const, reason: result.reason };

  /*
    ⚠️ AZ `elapsedMs` A GRAPHHOPPER-FÁZIS, NEM A TELJES MUNKA. A geometria
    utána jön, és nagy körnél TÖBB, mint maga a tervezés. Korábban ez csak az
    objektum-literál kiértékelési sorrendjéből következett — most kimondva,
    mert erre épül a felület „Tervezés” és „Számítás” sora.
  */
  const routeMs = Math.round(performance.now() - started);

  const { loop } = result;
  return {
    ok: true as const,
    mode: 'loop' as const,
    elapsedMs: routeMs,
    outbound: loop.outbound.points.map((point) => [point.lng, point.lat]),
    inbound: loop.inbound.points.map((point) => [point.lng, point.lat]),
    totalDistanceM: loop.totalDistanceM,
    directDistanceM: loop.directDistanceM,
    totalDurationS: loop.totalDurationS,
    closesLoop: true,
    requestedOffsetM: Math.min(
      GAMEPLAY.ROUTE_DETOUR_OFFSET_M[request.detour],
      distanceM(request.from, request.to) * 0.45,
    ),
    quality: loop.quality,
    legs: {
      outbound: legStats(loop.outbound.points),
      inbound: legStats(loop.inbound.points),
    },
    ...(request.geometry
      ? await withOwnership(
          measureGeometry([loop.outbound, loop.inbound], request.profile),
          request,
        )
      : {}),
  };
}

/**
 * Címkeresés — KÉT Mapbox-végpont összefésülve.
 *
 * ⚠️ EGYIK SEM ELÉG ÖNMAGÁBAN, ez mérésből derült ki (2026-09-12):
 *
 *   - a **Geocoding v6** PONTOS NÉVEGYEZÉST keres. A „deák tér" ezért csak a
 *     csepeli Deák teret találja meg, a Deák FERENC teret nem — a neve nem
 *     egyezik. Házszámos címre viszont ez a jó.
 *   - a **Search Box forward** helyneveket és POI-kat is ad, és ő megtalálja a
 *     Deák Ferenc teret — viszont utcanevekre szűkszavúbb.
 *
 * A kettő uniója, koordináta szerint deduplikálva, távolság szerint rendezve
 * adja azt, amit a felhasználó vár.
 *
 * ⚠️ ITT NEM TÁROLUNK SEMMIT. A találat a Mapbox saját térképén jelenik meg,
 * és a folyamat végén eltűnik — ez a Mapbox feltételei szerint megengedett
 * használat. Az ÉLES funkcióban viszont a mentett útvonalhoz a címet is el
 * akarjuk tenni; az a tartós tárolás külön jogosultságot igényel, és még
 * nyitott kérdés (lásd `docs/routing/point-to-point.md` → Geocoding).
 */
interface SearchHit {
  label: string;
  lat: number;
  lng: number;
  distanceM: number;
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface MapboxFeature {
  properties?: {
    full_address?: string;
    place_formatted?: string;
    name?: string;
  };
  geometry?: { coordinates?: [number, number] };
}

/** Egy Mapbox-találat egységes alakra hozása. */
function toHit(feature: MapboxFeature, origin: LatLng): SearchHit | null {
  const properties = feature.properties ?? {};
  const name = properties.name ?? '';
  const context = properties.full_address ?? properties.place_formatted ?? '';
  // A `place_formatted` gyakran megismétli a nevet — ilyenkor elég egyszer.
  const label = !name
    ? context
    : !context || context.startsWith(name)
      ? context || name
      : `${name} — ${context}`;

  const lng = feature.geometry?.coordinates?.[0];
  const lat = feature.geometry?.coordinates?.[1];
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    label,
    lat: lat as number,
    lng: lng as number,
    distanceM: Math.round(distanceM(origin, { lat: lat as number, lng: lng as number })),
  };
}

async function geocode(query: string, token: string, near: string): Promise<unknown> {
  const parts = near.split(',').map(Number);
  const nearLng = parts[0] ?? Number.NaN;
  const nearLat = parts[1] ?? Number.NaN;
  const origin: LatLng = {
    lat: Number.isFinite(nearLat) ? nearLat : 47.5,
    lng: Number.isFinite(nearLng) ? nearLng : 19.05,
  };

  const common =
    `?q=${encodeURIComponent(query)}` +
    `&access_token=${encodeURIComponent(token)}` +
    `&proximity=${encodeURIComponent(near)}` +
    '&limit=8&language=hu&country=hu';

  const [addresses, places] = await Promise.all([
    fetchJson(`https://api.mapbox.com/search/geocode/v6/forward${common}&autocomplete=true`),
    fetchJson(`https://api.mapbox.com/search/searchbox/v1/forward${common}`),
  ]);

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const source of [places, addresses]) {
    for (const feature of ((source?.features as MapboxFeature[]) ?? [])) {
      const hit = toHit(feature, origin);
      if (!hit) continue;
      // ~11 méteres azonossági küszöb: ugyanaz a hely kétszer ne szerepeljen.
      const key = `${hit.lat.toFixed(4)},${hit.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }

  /*
    ⚠️ TÁVOLSÁG SZERINT RENDEZÜNK, nem a szolgáltató relevanciája szerint.
    Mérve: a „Blaha Lujza tér" keresésre budapesti nézetből is Kiskunfélegyháza
    jött elsőnek — a Mapbox a pontos névegyezést erősebbnek látja a
    proximity-nél. Útvonaltervezéshez viszont majdnem mindig a közeli találat a
    keresett.
  */
  hits.sort((a, b) => a.distanceM - b.distanceM);
  return { results: hits.slice(0, 8) };
}

const PAGE = (token: string, slopeAvailable: boolean) => `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GRUNDO útvonal-labor</title>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet" />
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #10151c; color: #e8edf4; }
  #app { display: grid; grid-template-columns: 320px 1fr; height: 100vh; }
  aside { overflow-y: auto; border-right: 1px solid #223; padding: 14px; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .hint { color: #8fa3bd; font-size: 12px; margin: 0 0 14px; }
  fieldset { border: 1px solid #24303f; border-radius: 10px; margin: 0 0 12px; padding: 10px 12px; }
  legend { color: #8fa3bd; font-size: 12px; padding: 0 4px; }
  .field { margin-bottom: 10px; }
  .field:last-child { margin-bottom: 0; }
  .field > span { display: block; color: #8fa3bd; font-size: 11px; margin-bottom: 3px; }

  /* Minden választó ugyanaz a 2 vagy 3 állású kapcsoló. */
  .seg { display: flex; gap: 3px; background: #141b24; border: 1px solid #24303f;
    border-radius: 9px; padding: 3px; }
  .seg button { flex: 1; padding: 6px 4px; background: none; color: #8fa3bd; border: 0;
    border-radius: 6px; cursor: pointer; font: inherit; font-size: 13px; white-space: nowrap; }
  .seg button[aria-pressed="true"] { background: #2b3b4f; color: #e8edf4; }
  .seg button:disabled { opacity: .35; cursor: not-allowed; }
  fieldset:disabled .seg button { opacity: .35; cursor: not-allowed; }

  #searchBox { position: relative; margin-bottom: 10px; }
  #search { width: 100%; padding: 7px 9px; background: #141b24; color: #e8edf4;
    border: 1px solid #24303f; border-radius: 8px; font: inherit; }
  #results { position: absolute; z-index: 5; left: 0; right: 0; top: 100%; margin-top: 4px;
    background: #18202b; border: 1px solid #24303f; border-radius: 8px; overflow: hidden; }
  #results button { display: block; width: 100%; text-align: left; padding: 7px 9px;
    background: none; color: #e8edf4; border: 0; border-bottom: 1px solid #24303f;
    cursor: pointer; font: inherit; font-size: 12px; }
  #results button:last-child { border-bottom: 0; }
  #results button:hover { background: #24303f; }
  #results .away { display: block; color: #8fa3bd; font-size: 11px; }
  /* A palettabeli --success (#22c55e) világosabb változata sötét panelre. */
  #results .hit { color: #4ade80; font-weight: 700; }

  #saveRow { display: flex; gap: 4px; margin-top: 10px; }
  #saveRow input { flex: 1; min-width: 0; padding: 6px 8px; background: #141b24;
    color: #e8edf4; border: 1px solid #24303f; border-radius: 8px; font: inherit; font-size: 12px; }
  #saveRow button { padding: 6px 10px; background: #18202b; color: #e8edf4;
    border: 1px solid #24303f; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; }
  #saveRow button:hover { background: #24303f; }
  #savedList { margin-top: 6px; }
  #savedList .row { cursor: pointer; }
  #savedList .row:hover .what { color: #9d71ff; }

  #pointList { margin-top: 10px; }
  .row { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0;
    border-top: 1px solid #1c2531; }
  .row:first-child { border-top: 0; }
  .tag { flex: none; width: 54px; color: #8fa3bd; font-size: 11px; padding-top: 2px; }
  .row .what { flex: 1; font-size: 12px; word-break: break-word; }
  .row .what small { display: block; color: #8fa3bd; font-size: 11px; }
  .row .drop { flex: none; background: none; border: 0; color: #8fa3bd; cursor: pointer;
    font: inherit; padding: 0 2px; }
  .row .drop:hover { color: #e8edf4; }

  #go { width: 100%; padding: 10px; background: #2f6db5; color: #fff; border: 0; border-radius: 9px;
    cursor: pointer; font: inherit; font-weight: 600; }
  #go:disabled { opacity: .5; cursor: not-allowed; }
  #status { margin-top: 10px; font-size: 12px; color: #8fa3bd; min-height: 18px; }
  /* Lebegő ablak a térkép bal felső sarkában. */
  #stopwatch { position: absolute; left: 12px; top: 12px; z-index: 4;
    background: rgba(16,21,28,.94); border: 1px solid #24303f; border-radius: 10px;
    padding: 10px 12px; font-size: 12px; min-width: 168px; }
  #stopwatch b { display: block; margin-bottom: 6px; font-size: 13px; }
  /* A fázisbontás halkabb, mint a főszám: kiegészítés, nem főszereplő. */
  #stopwatch #swPhases { margin-top: 6px; border-top: 1px solid #24303f; padding-top: 5px; }
  #stopwatch #swPhases td { font-size: 11px; padding-top: 1px; }
  #stopwatch #swPhases .sub td:first-child { padding-left: 10px; color: #64748b; }
  #stopwatch #swPhases .dom td { color: #fbbf24; }
  #stopwatch td:first-child { color: #8fa3bd; }
  #stopwatch td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  /* Futás közben az „Aktuális” sor kiemelve, hogy látszódjon: ez most ketyeg. */
  #stopwatch.running #swNow { color: #7dd3fc; }
  #stopwatch.running b::after { content: ' ●'; color: #7dd3fc; animation: swPulse 1s infinite; }
  @keyframes swPulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
  .faster { color: #4ade80; }
  .slower { color: #f87171; }

  #map { height: 100vh; }
  #result { position: absolute; right: 12px; top: 12px; background: rgba(16,21,28,.94);
    border: 1px solid #24303f; border-radius: 10px; padding: 10px 12px; font-size: 12px; min-width: 264px; }
  #result b { display: block; margin-bottom: 6px; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 1px 8px 1px 0; color: #b9c8da; }
  td:last-child { color: #e8edf4; text-align: right; }
  .warn { color: #f5c518; }
  #result .empty { color: #8fa3bd; font-size: 12px; max-width: 240px; }
  .swatch { display: inline-block; width: 20px; height: 3px; vertical-align: middle; margin-right: 6px; }

  #legend { margin-top: 8px; }
  #legendBar { height: 8px; border-radius: 4px;
    background: linear-gradient(90deg, #1a9850, #a6d96a, #fee08b, #fdae61, #f46d43, #d73027); }
  #legendScale { display: flex; justify-content: space-between; color: #8fa3bd; font-size: 11px; }

  /* A flex-közepezés valódi függőleges középre igazítást ad — a line-height nem. */
  .stopBadge { width: 22px; height: 22px; border-radius: 50%; background: #ff2ea6;
    color: #10151c; font: 700 12px system-ui, sans-serif; border: 2px solid #10151c;
    display: flex; align-items: center; justify-content: center; }
</style>
</head>
<body>
<div id="app">
  <aside>
    <h1>Útvonal-labor</h1>
    <p class="hint">Keress címre vagy kattints a térképre. A találat a kijelölt ponthoz kerül.</p>

    <fieldset>
      <legend>Pontok</legend>
      <div id="searchBox">
        <input type="search" id="search" placeholder="Cím keresése…" autocomplete="off" />
        <div id="results" hidden></div>
      </div>
      <div class="seg" id="picking">
        <button type="button" data-value="A" aria-pressed="true">Rajt</button>
        <button type="button" data-value="B" aria-pressed="false">Cél</button>
        <button type="button" data-value="S" aria-pressed="false">Megálló</button>
      </div>
      <div id="pointList"></div>
      <div id="saveRow">
        <input type="text" id="saveName" placeholder="Mentés neve…" autocomplete="off" />
        <button type="button" id="saveSet">Mentés</button>
      </div>
      <div id="savedList"></div>
    </fieldset>

    <fieldset>
      <legend>Tervezés</legend>
      <div class="field">
        <span>Mozgásforma</span>
        <div class="seg" id="profile">
          <button type="button" data-value="walking" aria-pressed="true">Séta / futás</button>
          <button type="button" data-value="cycling" aria-pressed="false">Bringa</button>
        </div>
      </div>
      <div class="field">
        <span>Útvonaltípus</span>
        <div class="seg" id="mode">
          <button type="button" data-value="loop" aria-pressed="true">Oda-vissza</button>
          <button type="button" data-value="direct" aria-pressed="false">Csak oda</button>
        </div>
      </div>
      <div class="field">
        <span>Kerülő mérete</span>
        <div class="seg" id="detour">
          <button type="button" data-value="small" aria-pressed="false">Kis</button>
          <button type="button" data-value="medium" aria-pressed="true">Közepes</button>
          <button type="button" data-value="large" aria-pressed="false">Nagy</button>
        </div>
      </div>
      <div class="field">
        <span>Jelleg</span>
        <div class="seg" id="preference">
          <button type="button" data-value="fast" aria-pressed="true">Gyors</button>
          <button type="button" data-value="protected" aria-pressed="false">Védettebb</button>
          <button type="button" data-value="quiet" aria-pressed="false">Csendes</button>
        </div>
      </div>
      <div class="field" id="terrainField">
        <span id="terrainLabel">Terep</span>
        <div class="seg" id="terrain">
          <button type="button" data-value="flat" aria-pressed="false">Sík</button>
          <button type="button" data-value="balanced" aria-pressed="true">Kiegyensúlyozott</button>
          <button type="button" data-value="hilly" aria-pressed="false">Dombos</button>
        </div>
      </div>
      <div class="field">
        <span>Kerékpárutak előnyben</span>
        <div class="seg" id="cycleways">
          <button type="button" data-value="off" aria-pressed="true">Ki</button>
          <button type="button" data-value="on" aria-pressed="false">Be</button>
        </div>
      </div>
      <div class="field">
        <span>Geometria (terület, cellák)</span>
        <div class="seg" id="geometry">
          <button type="button" data-value="off" aria-pressed="true">Ki</button>
          <button type="button" data-value="on" aria-pressed="false">Be</button>
        </div>
      </div>
      <div class="field">
        <span>Birtokviszony (Firestore)</span>
        <div class="seg" id="ownership">
          <button type="button" data-value="off" aria-pressed="true">Ki</button>
          <button type="button" data-value="on" aria-pressed="false">Be</button>
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend>Térkép</legend>
      <div class="field">
        <span>Domborzat-árnyékolás</span>
        <div class="seg" id="shading">
          <button type="button" data-value="off" aria-pressed="true">Ki</button>
          <button type="button" data-value="on" aria-pressed="false">Be</button>
        </div>
      </div>
      <div class="field">
        <span>Magasság-színek</span>
        <div class="seg" id="colours">
          <button type="button" data-value="off" aria-pressed="true">Ki</button>
          <button type="button" data-value="on" aria-pressed="false">Be</button>
        </div>
        <div id="legend" hidden>
          <div id="legendBar"></div>
          <div id="legendScale"><span>sík</span><span>hegy</span></div>
        </div>
      </div>
      <div class="field">
        <span>Nézet</span>
        <div class="seg" id="view">
          <button type="button" data-value="2d" aria-pressed="true">2D</button>
          <button type="button" data-value="3d" aria-pressed="false">3D</button>
        </div>
      </div>
    </fieldset>

    <button type="button" id="go">Útvonal tervezése</button>
    <div id="status"></div>

  </aside>
  <div style="position:relative">
    <div id="map"></div>
    <div id="stopwatch">
      <b>Stopper</b>
      <table>
        <tr><td>Aktuális</td><td id="swNow">—</td></tr>
        <tr><td>Előző</td><td id="swPrev">—</td></tr>
        <tr><td>Eltérés</td><td id="swDelta">—</td></tr>
      </table>
      <!--
        RÉSZLETEZŐ — a teljes idő fázisokra bontva. Enélkül csak azt látod,
        hogy „lassú”; ebből azt is, hogy MELYIK fél az.
      -->
      <table id="swPhases"></table>
      <div class="seg" style="margin-top:6px">
        <button type="button" id="swReset">Nullázás</button>
      </div>
    </div>
    <div id="result"></div>
  </div>
</div>
<script>
const SLOPE_AVAILABLE = ${String(slopeAvailable)};
mapboxgl.accessToken = ${JSON.stringify(token)};

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/dark-v11',
  center: [19.0544, 47.4979],
  zoom: 12.5,
});

const state = {
  picking: 'A',
  from: { lat: 47.4979, lng: 19.0544, label: null },
  to: null,
  stops: [],
  profile: 'walking',
  mode: 'loop',
  detour: 'medium',
  preference: 'fast',
  terrain: 'balanced',
  cycleways: 'off',
  geometry: 'off',
  ownership: 'off',
};

/* ── Kapcsolók ──────────────────────────────────────────────────────── */

/*
  A VÁLASZTÁSOK TÚLÉLIK AZ ÚJRATÖLTÉST.

  ⚠️ Enélkül minden szerver-újraindítás után a Geometria visszaugrott „Ki"-re,
  és úgy tűnt, hogy „elveszett a területrajz" — pedig csak ki volt kapcsolva.
  A laborban gyakori az újraindítás, ezért ez valódi csapda volt.
*/
const SETTINGS_KEY = 'grundo.routeLab.settings';
const PERSISTED = ['profile', 'mode', 'detour', 'preference', 'terrain', 'cycleways', 'geometry', 'ownership'];

function saveSettings() {
  try {
    const data = {};
    for (const key of PERSISTED) data[key] = state[key];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    /* privát böngészés — nem marad meg, de ne dőljön el tőle */
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Minden szegmentált kapcsoló ugyanígy működik: a gomb értéke az állapot. */
function segment(groupId, onChange) {
  const group = document.getElementById(groupId);
  group.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    for (const other of group.querySelectorAll('button')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
    onChange(button.dataset.value);
    saveSettings();
  });
}

segment('picking', (value) => { state.picking = value; });
segment('profile', (value) => {
  state.profile = value;
  // A kerékpárút-preferencia gyalog értelmetlen.
  const off = value !== 'cycling';
  for (const button of document.querySelectorAll('#cycleways button')) button.disabled = off;
  if (off) setSegment('cycleways', 'off');
});
segment('mode', (value) => {
  state.mode = value;
  for (const button of document.querySelectorAll('#detour button')) button.disabled = value === 'direct';
});
segment('detour', (value) => { state.detour = value; });
segment('preference', (value) => { state.preference = value; });
segment('terrain', (value) => { state.terrain = value; });
segment('cycleways', (value) => { state.cycleways = value; });
segment('geometry', (value) => {
  state.geometry = value;
  // A birtokviszony a bezárt cellákra épül — geometria nélkül nincs mit nézni.
  for (const button of document.querySelectorAll('#ownership button')) {
    button.disabled = value === 'off';
  }
  if (value === 'off') setSegment('ownership', 'off');
});
segment('ownership', (value) => { state.ownership = value; });
for (const button of document.querySelectorAll('#ownership button')) button.disabled = true;

/** Kapcsoló beállítása kívülről. */
function setSegment(groupId, value) {
  for (const button of document.querySelectorAll('#' + groupId + ' button')) {
    button.setAttribute('aria-pressed', String(button.dataset.value === value));
  }
  state[groupId === 'picking' ? 'picking' : groupId] = value;
}

/*
  A terep-választó csak akkor él, ha a gráf ismeri a lejtést. Enélkül a
  GraphHopper hibát adna vissza, nem útvonalat.
*/
if (!SLOPE_AVAILABLE) {
  for (const button of document.querySelectorAll('#terrain button')) button.disabled = true;
  document.getElementById('terrainLabel').textContent = 'Terep — a gráf nem ismeri a lejtést';
}

/* ── Pontok ─────────────────────────────────────────────────────────── */

const markers = {};
const stopMarkers = [];

function describe(point) {
  const coords = point.lat.toFixed(5) + ', ' + point.lng.toFixed(5);
  return point.label
    ? point.label + '<small>' + coords + '</small>'
    : coords;
}

function renderPoints() {
  const rows = [
    '<div class="row"><span class="tag">Rajt</span><span class="what">' +
      describe(state.from) + '</span></div>',
    '<div class="row"><span class="tag">Cél</span><span class="what">' +
      (state.to ? describe(state.to) : '—') + '</span></div>',
    ...state.stops.map((stop, index) =>
      '<div class="row"><span class="tag">Megálló ' + (index + 1) + '</span>' +
      '<span class="what">' + describe(stop) + '</span>' +
      '<button type="button" class="drop" data-remove="' + index + '">✕</button></div>'),
  ];
  document.getElementById('pointList').innerHTML = rows.join('');

  markers.A?.remove();
  markers.A = new mapboxgl.Marker({ color: START_COLOUR })
    .setLngLat([state.from.lng, state.from.lat]).addTo(map);
  markers.B?.remove();
  if (state.to) {
    markers.B = new mapboxgl.Marker({ color: END_COLOUR })
      .setLngLat([state.to.lng, state.to.lat]).addTo(map);
  }

  for (const marker of stopMarkers.splice(0)) marker.remove();
  state.stops.forEach((stop, index) => {
    // Rendes tűhegy-ikon, mint a rajtnál és a célnál — csak sárgán.
    stopMarkers.push(
      new mapboxgl.Marker({ color: STOP_COLOUR }).setLngLat([stop.lng, stop.lat]).addTo(map),
    );
    // A sorszám KÜLÖN buborékban, a tű feje fölött.
    const badge = document.createElement('div');
    badge.className = 'stopBadge';
    badge.textContent = String(index + 1);
    stopMarkers.push(
      new mapboxgl.Marker({ element: badge, anchor: 'bottom', offset: [0, -44] })
        .setLngLat([stop.lng, stop.lat]).addTo(map),
    );
  });
}

document.getElementById('pointList').addEventListener('click', (event) => {
  const index = event.target.closest('button')?.dataset.remove;
  if (index !== undefined) { state.stops.splice(Number(index), 1); renderPoints(); }
});

/* ── Mentett pontkészletek ──────────────────────────────────────────── */

/*
  A böngésző saját tárában — ugyanaz a minta, mint az app mentett útvonalainál
  (src/lib/savedRoutes.ts): eszközfüggő könyvjelző, nem játékadat. A labor
  amúgy sem ír semmit a szerverre.
*/
const SAVED_KEY = 'grundo.routeLab.points';

function readSaved() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Privát böngészésben a tárolás dobhat — ilyenkor egyszerűen nincs mentés.
    return [];
  }
}

function writeSaved(list) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    /* nem marad meg, de ne dőljön el tőle a lap */
  }
}

/** Alapértelmezett név a címekből, vagy koordinátából. */
function defaultName() {
  const short = (point) => {
    if (!point) return '?';
    if (point.label) return point.label.split(',')[0];
    return point.lat.toFixed(3) + ',' + point.lng.toFixed(3);
  };
  const middle = state.stops.length > 0 ? ' (+' + state.stops.length + ')' : '';
  return short(state.from) + ' → ' + short(state.to) + middle;
}

function renderSaved() {
  const list = readSaved();
  document.getElementById('savedList').innerHTML = list
    .map((item, index) =>
      '<div class="row" data-load="' + index + '">' +
      '<span class="what">' + item.name + '<small>' +
      (item.stops?.length ? item.stops.length + ' megálló · ' : '') +
      new Date(item.savedAt).toLocaleDateString('hu-HU') + '</small></span>' +
      '<button type="button" class="drop" data-drop="' + index + '">✕</button></div>')
    .join('');
}

document.getElementById('saveSet').addEventListener('click', () => {
  if (!state.to) {
    document.getElementById('status').textContent = 'Előbb jelölj ki célt.';
    return;
  }
  const input = document.getElementById('saveName');
  const list = readSaved();
  list.unshift({
    name: input.value.trim() || defaultName(),
    savedAt: Date.now(),
    from: state.from,
    to: state.to,
    stops: state.stops,
  });
  writeSaved(list.slice(0, 30));
  input.value = '';
  renderSaved();
});

document.getElementById('savedList').addEventListener('click', (event) => {
  const drop = event.target.closest('button')?.dataset.drop;
  if (drop !== undefined) {
    const list = readSaved();
    list.splice(Number(drop), 1);
    writeSaved(list);
    renderSaved();
    return;
  }

  const load = event.target.closest('.row')?.dataset.load;
  if (load === undefined) return;
  const item = readSaved()[Number(load)];
  if (!item) return;

  state.from = item.from;
  state.to = item.to;
  state.stops = item.stops ?? [];
  renderPoints();
  clearResult('Betöltve: ' + item.name + ' — indíts tervezést.');

  const points = [state.from, state.to, ...state.stops];
  const bounds = points.reduce(
    (acc, point) => acc.extend([point.lng, point.lat]),
    new mapboxgl.LngLatBounds([state.from.lng, state.from.lat], [state.from.lng, state.from.lat]),
  );
  map.fitBounds(bounds, { padding: 90, duration: 600 });
});

/** Ráközelítés a kiválasztott címre. */
const ADDRESS_ZOOM = 16;

/* A pont MINDIG az éppen kijelölt szerephez kerül: rajt, cél vagy megálló. */
function assignPoint(point, fly) {
  if (state.picking === 'A') { state.from = point; setSegment('picking', 'B'); }
  else if (state.picking === 'S') { state.stops.push(point); }
  else { state.to = point; }
  renderPoints();
  if (fly) map.flyTo({ center: [point.lng, point.lat], zoom: ADDRESS_ZOOM, duration: 700 });
}

map.on('click', (event) => {
  assignPoint({ lat: event.lngLat.lat, lng: event.lngLat.lng, label: null }, false);
});

/* ── Címkeresés ─────────────────────────────────────────────────────── */

/*
  A TALÁLAT EGYEZŐ RÉSZÉNEK KIEMELÉSE.

  Ékezet- és kisbetű-független, de KARAKTERHELYES: az összehasonlító alak
  ugyanolyan hosszú, mint az eredeti, ezért az indexek visszavetíthetők a
  megjelenítendő szövegre. (Az NFD-normalizálás magában megnyújtaná a
  sztringet, és elcsúsznának a kiemelés határai.)
*/
function fold(text) {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const decomposed = text[index].normalize('NFD');
    out += (decomposed[0] || text[index]).toLowerCase();
  }
  return out;
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function highlight(label, query) {
  // Szóközre bontunk, nem regexszel: a sablon-literál lenyelné a visszapert.
  const tokens = fold(query).split(' ').filter((token) => token.length > 0);
  const haystack = fold(label);
  const marked = new Array(label.length).fill(false);

  for (const token of tokens) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(token, from);
      if (at < 0) break;
      for (let index = at; index < at + token.length; index += 1) marked[index] = true;
      from = at + token.length;
    }
  }

  let html = '';
  let index = 0;
  while (index < label.length) {
    const on = marked[index];
    let end = index;
    while (end < label.length && marked[end] === on) end += 1;
    const part = escapeHtml(label.slice(index, end));
    html += on ? '<b class="hit">' + part + '</b>' : part;
    index = end;
  }
  return html;
}

const searchInput = document.getElementById('search');
const resultsBox = document.getElementById('results');
let searchTimer = 0;

function hideResults() { resultsBox.hidden = true; resultsBox.innerHTML = ''; }

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  if (query.length < 3) { hideResults(); return; }
  // Gépelés közben ne induljon kérés minden leütésre.
  searchTimer = setTimeout(async () => {
    try {
      const centre = map.getCenter();
      const near = centre.lng.toFixed(4) + ',' + centre.lat.toFixed(4);
      const response = await fetch(
        '/geocode?q=' + encodeURIComponent(query) + '&near=' + encodeURIComponent(near),
      );
      const data = await response.json();
      if (!data.results.length) { hideResults(); return; }
      resultsBox.innerHTML = data.results
        .map((item, index) => {
          const away = item.distanceM < 1000
            ? Math.round(item.distanceM) + ' m'
            : (item.distanceM / 1000).toFixed(1) + ' km';
          return '<button type="button" data-index="' + index + '">' +
            highlight(item.label, query) +
            '<span class="away">' + away + '</span></button>';
        })
        .join('');
      resultsBox.dataset.payload = JSON.stringify(data.results);
      resultsBox.hidden = false;
    } catch { hideResults(); }
  }, 250);
});

resultsBox.addEventListener('click', (event) => {
  const index = event.target.closest('button')?.dataset.index;
  if (index === undefined) return;
  const item = JSON.parse(resultsBox.dataset.payload)[Number(index)];
  assignPoint({ lat: item.lat, lng: item.lng, label: item.label }, true);
  searchInput.value = '';
  hideResults();
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideResults();
});

/* ── Térképrétegek ──────────────────────────────────────────────────── */

/*
  Magasság-színskála: zöld a síkon, piros a hegyen.

  SZINTVONALBÓL, NEM RASZTERBŐL. A Mapbox GL JS-nek NINCS color-relief
  rétegtípusa (a MapLibre-é van); a raster-dem forrás csak hillshade réteggel
  használható, ami szürke árnyékolást ad, magasságot nem. A Mapbox Terrain v2
  contour rétegében viszont ott van az "ele" mező, és abból színezhető a
  szintvonal — ez adja a topográfiai hatást.

  A budapesti tartomány: Duna ~96 m, János-hegy 527 m.
*/
const CONTOUR_COLOUR = [
  'interpolate', ['linear'], ['get', 'ele'],
  95, '#1a9850', 200, '#a6d96a', 300, '#fee08b',
  400, '#fdae61', 500, '#d73027',
];

function ensureDem() {
  if (!map.getSource('dem')) {
    map.addSource('dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512 });
  }
}

function firstSymbolLayerId() {
  return map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
}

function layerSwitch(groupId, layerId, build) {
  segment(groupId, (value) => {
    if (value === 'off') {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    } else if (!map.getLayer(layerId)) {
      ensureDem();
      map.addLayer(build(), firstSymbolLayerId());
    }
    if (layerId === 'contourColour') document.getElementById('legend').hidden = value === 'off';
  });
}

layerSwitch('shading', 'hillshade', () => ({
  id: 'hillshade', type: 'hillshade', source: 'dem',
  paint: { 'hillshade-exaggeration': 0.45 },
}));

layerSwitch('colours', 'contourColour', () => ({
  id: 'contourColour', type: 'line', source: 'composite', 'source-layer': 'contour',
  layout: { 'line-join': 'round' },
  paint: {
    'line-color': CONTOUR_COLOUR,
    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 13, 4, 16, 10],
    'line-opacity': 0.85,
  },
}));

segment('view', (value) => {
  if (value === '3d') {
    ensureDem();
    map.setTerrain({ source: 'dem', exaggeration: 1.4 });
    map.easeTo({ pitch: 62, duration: 600 });
  } else {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }
});

/* ── Tervezés ───────────────────────────────────────────────────────── */

/*
  ⚠️ A KÉT LEG EGYMÁS MELLÉ TOLVA RAJZOLÓDIK. Ahol az odaút és a visszaút
  ugyanazon a szakaszon fut, a később rajzolt réteg teljesen eltakarná a
  másikat — a felhasználó csak a kék visszautat látná, és azt hinné, hogy az
  odaút eltűnt.

  A line-offset a vonal SAJÁT haladási irányához képest tol. A közös
  szakaszon a két leg ellentétes irányban halad, ezért ugyanaz az előjelű
  eltolás a két oldalra viszi őket — pont úgy, mint egy út két menetiránya.
*/
const LEG_OFFSET_PX = 3;

/*
  Az odaút a territory-stolen korall — EZZEL rajzolja az app a tervezett
  útvonalat (MapView, ghost réteg). A visszaút a layer-bike ciánja: brand szín,
  és a lila területen is, a korall mellett is tisztán elválik.
*/
const OUTBOUND_COLOUR = '#fa5f73';
const INBOUND_COLOUR = '#2fd3e1';

function drawLine(id, coordinates, colour, options) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  if (!coordinates || coordinates.length < 2) return;
  const dashed = options?.dashed === true;
  map.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } } });
  map.addLayer({
    id, type: 'line', source: id,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': colour,
      'line-width': dashed ? 2 : 4,
      'line-opacity': dashed ? 0.8 : 0.95,
      ...(options?.offset ? { 'line-offset': options.offset } : {}),
      ...(dashed ? { 'line-dasharray': [2, 2] } : {}),
    },
  });
}

/* Terület MINDIG km², 3 tizedessel — ugyanaz a szabály, mint az appban. */
function formatArea(m2) {
  return (m2 / 1000000).toLocaleString('hu-HU', {
    minimumFractionDigits: 3, maximumFractionDigits: 3,
  }) + ' km²';
}

/*
  A CELLÁK KIRAJZOLÁSA — ugyanaz a rétegzés, mint az appban (MapView):
  kitöltés végig, cellahatár közelről, szintcímke még közelebbről.

  Szín a SZINT szerint: zöld a frissen szerzett, piros a többször körüljárt.
*/
/*
  EGY SZÍNCSALÁD, nem öt külön szín. Öt eltérő színárnyalat (zöld–sárga–piros)
  a térképen zajos volt: úgy nézett ki, mintha ötféle DOLOG lenne ott, holott
  ugyanaz a terület, csak más megerősítéssel. Egy hue, világostól sötétig —
  a szint pontos értéke a címkében van, ahol pontosan kell.
*/
/*
  A GRUNDO SAJÁT PALETTÁJA (src/styles/tokens.css), nem kitalált színek:

    --territory-own   #8b5cf6  a terület
    --territory-stolen #fa5f73  ezzel rajzolja az app a TERVEZETT útvonalat
    --layer-bike      #2fd3e1  rétegszín, a második leghez

  A védelmi szint NEM külön színárnyalat, hanem UGYANANNAK A LILÁNAK az
  erősödő kitöltése — ezt a mintát az admin szimulációs labor is használja
  (simulation-lab.css: 22% → 74%). Öt külön hue azt sugallná, hogy ötféle
  dolog van ott, holott ugyanaz a terület, csak más megerősítéssel.
*/
const TERRITORY_COLOUR = '#8b5cf6';

/*
  A pontok jelölői is a palettából:

    rajt     accent-hover    #9d71ff  — a brand lila VILÁGOSABB változata, hogy
                                        a lila területen is látszódjon a pin
    cél      weather-precip  #60a5fa  — kék, és nem a cián visszaút színe
    megálló  accent-magenta  #ff2ea6
*/
const START_COLOUR = '#9d71ff';
const END_COLOUR = '#60a5fa';
const STOP_COLOUR = '#ff2ea6';

/*
  Szintenkénti kitöltés — a simulation-lab.css lépcsői.

  ⚠️ A ZOOM-KIFEJEZÉS CSAK LEGKÜLSŐ LEHET a Mapboxban: szorzat belsejébe téve
  a réteg némán nem jön létre. Ezért a zoom az interpolate tetején van, és a
  szintenkénti érték a megállók KIMENETE.
*/
function levelOpacity(scale) {
  return [
    'match', ['get', 'level'],
    1, 0.22 * scale, 2, 0.32 * scale, 3, 0.44 * scale, 4, 0.58 * scale, 5, 0.74 * scale,
    0.22 * scale,
  ];
}

/*
  Ugyanaz a rétegzés, mint az appban: TÁVOLRÓL összevont terület, KÖZELRŐL
  cellák. A cellánkénti poligon kizoomolva nemcsak fölösleges, hanem hibás is
  — a Mapbox a csempe méretkorlátja fölött csendben eldob feature-öket.
*/
const CELL_DETAIL_MIN_ZOOM = 15;

/*
  NÉZET SZERINTI CELLARAJZ. Nagy területnél a teljes cellahalmaz nem fér egy
  válaszba (mérve: 244 byte/cella), ezért a szerver a LÁTHATÓ bbox celláit adja
  — ugyanaz az eljárás, mint az appban (TerritoryScreen → api.tiles(view)).
  A rács úgyis csak CELL_DETAIL_MIN_ZOOM fölött látszik, tehát amit nem
  kérünk le, azt amúgy sem látnád.
*/
let cellsOnDemand = false;
let visibleCellsToken = 0;

async function refreshVisibleCells() {
  if (!cellsOnDemand || !map.getSource('cells')) return;
  if (map.getZoom() < CELL_DETAIL_MIN_ZOOM) return;

  const bounds = map.getBounds();
  const bbox = [
    bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
  ].map((value) => value.toFixed(6)).join(',');

  // Az utolsó kérés nyer: pásztázás közben a régi válasz ne írja felül az újat.
  const token = ++visibleCellsToken;
  try {
    const response = await fetch('/cells?bbox=' + bbox);
    const data = await response.json();
    if (token !== visibleCellsToken) return;
    const source = map.getSource('cells');
    if (source && data.geojson) source.setData(data.geojson);
  } catch {
    // A cellarács kiegészítő réteg — a hibája ne vigye el a térképet.
  }
}

map.on('moveend', () => { void refreshVisibleCells(); });

function drawCells(geometry) {
  for (const id of ['cellLabel', 'cellLine', 'cellFill', 'areaFill', 'areaLine']) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of ['cells', 'areas']) if (map.getSource(id)) map.removeSource(id);
  cellsOnDemand = false;
  if (!geometry) return;

  // A vonalak ALÁ megy, hogy az útvonal olvasható maradjon.
  const before = map.getLayer('outbound') ? 'outbound' : firstSymbolLayerId();

  if (geometry.areaGeoJson) {
    map.addSource('areas', { type: 'geojson', data: geometry.areaGeoJson });
    map.addLayer({
      id: 'areaFill', type: 'fill', source: 'areas',
      paint: {
        'fill-color': TERRITORY_COLOUR,
        // Szint szerinti erősség, közelről halkítva: ott a cellarács visz.
        'fill-opacity': ['interpolate', ['linear'], ['zoom'],
          CELL_DETAIL_MIN_ZOOM - 1, levelOpacity(1),
          CELL_DETAIL_MIN_ZOOM + 0.5, levelOpacity(0.55)],
      },
    }, before);
    map.addLayer({
      id: 'areaLine', type: 'line', source: 'areas',
      paint: { 'line-color': TERRITORY_COLOUR, 'line-width': 1.2, 'line-opacity': 0.8 },
    }, before);
  }

  /*
    A forrás akkor is létrejön, ha a cellák nem fértek a válaszba — üresen,
    és a moveend tölti fel a látható nézetre. Enélkül a rétegek sem
    születnének meg, és a rács nagy területnél teljesen eltűnne.
  */
  if (!geometry.cellsGeoJson && !geometry.cellsOnDemand) return;
  cellsOnDemand = Boolean(geometry.cellsOnDemand);
  map.addSource('cells', {
    type: 'geojson',
    data: geometry.cellsGeoJson ?? { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'cellLine', type: 'line', source: 'cells', minzoom: CELL_DETAIL_MIN_ZOOM,
    paint: {
      'line-color': TERRITORY_COLOUR,
      'line-width': 0.8,
      'line-opacity': ['interpolate', ['linear'], ['zoom'],
        CELL_DETAIL_MIN_ZOOM, 0, CELL_DETAIL_MIN_ZOOM + 1, 0.7],
    },
  }, before);
  map.addLayer({
    id: 'cellLabel', type: 'symbol', source: 'cells', minzoom: 16.5,
    layout: {
      'text-field': ['to-string', ['get', 'level']],
      'text-size': ['interpolate', ['linear'], ['zoom'], 16.5, 9, 19, 13],
      'text-allow-overlap': false,
    },
    /*
      A SZÁM A CELLA SAJÁT SZÍNÉT KAPJA. A korábbi sötét szöveg fehér
      kontúrral kiugrott a területből: távolról fehér pöttyöknek látszott, és
      elvonta a figyelmet magáról az útvonalról. Így beleolvad — halvány, sötét
      kontúrral csak annyira emeljük ki, hogy közelről olvasható maradjon.
    */
    paint: {
      'text-color': TERRITORY_COLOUR,
      'text-opacity': 0.85,
      // A térkép saját háttere (map-bg), hogy a szám beleolvadjon.
      'text-halo-color': '#0b0a0f',
      'text-halo-width': 0.9,
    },
  });

  // Az első adag azonnal, ne csak a következő pásztázásra jelenjen meg a rács.
  void refreshVisibleCells();
}

/* Üres állapot: a doboz mondja meg, mire vár, ne csak üresen álljon. */
function clearResult(message) {
  document.getElementById('result').innerHTML =
    '<b>Telemetria</b><div class="empty">' +
    (message || 'Indíts útvonaltervezést az adatokhoz.') +
    '</div>';
}

function row(label, value, warn) {
  return '<tr><td>' + label + '</td><td' + (warn ? ' class="warn"' : '') + '>' + value + '</td></tr>';
}

/*
  STOPPER — a teljes kör mérése: kattintástól a kirajzolt eredményig.
  Ez TÖBB, mint a szerver „Tervezés" száma: benne van a hálózat, a geometria,
  a birtokviszony-lekérdezés és a térképi rajzolás is. Épp ezért ez az, amit a
  felhasználó megvár.
*/
const stopwatch = { current: null, previous: null, startedAt: null, ticker: 0, phases: null };

/*
  A FÁZISOK — mit mér melyik szám.

  A „Tervezés” és a „Számítás” a SZERVER két, egymás UTÁN futó fele, nem
  ugyanannak a munkának két nézete: előbb a GraphHopper-hívások és a jelöltek
  pontozása, utána a bezárt cellahalmaz felépítése. A kettő összege plusz az
  átvitel és a rajzolás adja a stoppert — ezért volt korábban „megmagyarázatlan”
  másodpercek eltérés a „Tervezés” és a stopper között: a geometria hiányzott
  a képből.
*/
function renderPhases() {
  const table = document.getElementById('swPhases');
  const p = stopwatch.phases;
  if (!p) { table.innerHTML = ''; return; }

  const ms = (value) => (value === null || value === undefined ? '—' : Math.round(value) + ' ms');
  // A legdrágább SZERVEROLDALI fázis kiemelve — az a szűk keresztmetszet.
  const top = Math.max(p.route ?? 0, p.geometry ?? 0, p.transfer ?? 0, p.draw ?? 0);
  const line = (label, value, cls) =>
    '<tr class="' + (cls || '') + (value === top && value > 0 ? ' dom' : '') + '">' +
    '<td>' + label + '</td><td>' + ms(value) + '</td></tr>';

  let html = line('Tervezés (GH)', p.route);
  html += line('Geometria', p.geometry);
  if (p.detail) {
    html += '<tr class="sub"><td>hurokdetektálás</td><td>' + ms(p.detail.shape) + '</td></tr>';
    html += '<tr class="sub"><td>körüljárás</td><td>' + ms(p.detail.winding) + '</td></tr>';
    html += '<tr class="sub"><td>kibontás</td><td>' + ms(p.detail.expand) + '</td></tr>';
    html += '<tr class="sub"><td>GeoJSON</td><td>' + ms(p.detail.geojson) + '</td></tr>';
  }
  if (p.ownership !== null && p.ownership !== undefined) html += line('Birtokviszony', p.ownership);
  html += line('Átvitel + JSON', p.transfer);
  html += line('Rajzolás', p.draw);
  table.innerHTML = html;
}

function formatMs(value) {
  return value === null ? '—' : (value / 1000).toFixed(2) + ' s';
}

/*
  A KIJELZETT idő futás közben az eltelt időből jön, végén a lezárt mérésből.
  A ketyegés csak megjelenítés: a VÉGSŐ szám továbbra is egyetlen
  performance.now() különbség, nem a tickek összege — a képfrissítés
  ritkítása (vagy a háttérfülön való visszafogása) így nem rontja a mérést.
*/
function stopwatchDisplay() {
  if (stopwatch.startedAt !== null) return performance.now() - stopwatch.startedAt;
  return stopwatch.current;
}

function renderStopwatch() {
  const running = stopwatch.startedAt !== null;
  document.getElementById('stopwatch').classList.toggle('running', running);
  renderPhases();
  document.getElementById('swNow').textContent = formatMs(stopwatchDisplay());
  document.getElementById('swPrev').textContent = formatMs(stopwatch.previous);
  const delta = document.getElementById('swDelta');
  /* Futás közben nincs értelmes eltérés: még nincs lezárt „aktuális”. */
  if (running || stopwatch.current === null || stopwatch.previous === null) {
    delta.textContent = '—';
    delta.className = '';
    return;
  }
  const diff = stopwatch.current - stopwatch.previous;
  delta.textContent = (diff > 0 ? '+' : '') + (diff / 1000).toFixed(2) + ' s';
  delta.className = diff < 0 ? 'faster' : diff > 0 ? 'slower' : '';
}

/*
  50 ms-onként — a kijelző két tizedesig megy, ennél sűrűbb frissítés már nem
  látszana, csak a tervezés alatt venne el gépidőt a térképtől.
*/
function startStopwatch() {
  stopwatch.previous = stopwatch.current;
  stopwatch.current = null;
  stopwatch.phases = null;
  stopwatch.startedAt = performance.now();
  clearInterval(stopwatch.ticker);
  stopwatch.ticker = setInterval(renderStopwatch, 50);
  renderStopwatch();
}

function stopStopwatch() {
  clearInterval(stopwatch.ticker);
  stopwatch.ticker = 0;
  if (stopwatch.startedAt !== null) {
    stopwatch.current = Math.round(performance.now() - stopwatch.startedAt);
    stopwatch.startedAt = null;
  }
  renderStopwatch();
}

document.getElementById('swReset').addEventListener('click', () => {
  clearInterval(stopwatch.ticker);
  stopwatch.ticker = 0;
  stopwatch.current = null;
  stopwatch.previous = null;
  stopwatch.startedAt = null;
  stopwatch.phases = null;
  renderStopwatch();
});

document.getElementById('go').addEventListener('click', async () => {
  if (!state.to) { document.getElementById('status').textContent = 'Előbb jelölj ki célt.'; return; }
  const button = document.getElementById('go');
  startStopwatch();
  button.disabled = true;
  document.getElementById('status').textContent = 'Tervezés…';

  try {
    const response = await fetch('/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: state.from, to: state.to, stops: state.stops, profile: state.profile,
        mode: state.mode, detour: state.detour, preference: state.preference,
        preferCycleways: state.cycleways === 'on',
        terrain: SLOPE_AVAILABLE ? state.terrain : 'balanced',
        geometry: state.geometry === 'on',
        ownership: state.ownership === 'on',
      }),
    });
    const data = await response.json();

    /*
      ÁTVITEL = a teljes kör MÍNUSZ amit a szerver magára mért. Nem külön
      mérjük a hálózatot és a JSON-t, mert a kettő itt összefolyik (a fetch
      már olvassa a törzset, amíg a szerver még ír). Localhoston ez a szám
      lényegében a JSON szerializálás + parse ára.
    */
    const serverMs = (data.elapsedMs ?? 0) + (data.geometry?.elapsedMs ?? 0) +
      (data.ownership?.elapsedMs ?? 0);
    const receivedAt = performance.now() - stopwatch.startedAt;
    stopwatch.phases = {
      route: data.elapsedMs ?? null,
      geometry: data.geometry?.elapsedMs ?? null,
      detail: data.geometry?.phases ?? null,
      ownership: data.ownership?.elapsedMs ?? null,
      transfer: Math.max(0, receivedAt - serverMs),
      draw: null,
    };

    if (!data.ok) {
      document.getElementById('status').textContent = 'Nincs útvonal: ' + data.reason;
      clearResult('Nincs útvonal — ' + data.reason);
      drawLine('outbound', [], OUTBOUND_COLOUR);
      drawLine('inbound', [], INBOUND_COLOUR);
      drawCells(null);
      return;
    }

    // Oda-vissza módban a két leg egymás mellé tolva látszik; „Csak oda"
    // módban nincs mihez képest tolni.
    const offset = data.mode === 'loop' ? LEG_OFFSET_PX : 0;
    const drawAt = performance.now();
    drawLine('outbound', data.outbound, OUTBOUND_COLOUR, { offset });
    drawLine('inbound', data.inbound, INBOUND_COLOUR, { offset });
    drawCells(data.geometry ?? null);
    /*
      ⚠️ EZ A RÉTEGEK FELÉPÍTÉSE, NEM A KIRAJZOLT KÉP. A Mapbox a csempézést
      és a festést a következő képkockákon, aszinkron végzi — azt innen nem
      látjuk. A stopper teljes ideje viszont tartalmazza.
    */
    if (stopwatch.phases) stopwatch.phases.draw = performance.now() - drawAt;

    const all = data.outbound.concat(data.inbound);
    const bounds = all.reduce((acc, point) => acc.extend(point), new mapboxgl.LngLatBounds(all[0], all[0]));
    map.fitBounds(bounds, { padding: 70, duration: 400 });

    const q = data.quality;
    const out = data.legs.outbound;
    const back = data.legs.inbound;
    document.getElementById('result').innerHTML =
      '<b>Telemetria</b>' +
      '<div><span class="swatch" style="background:' + OUTBOUND_COLOUR + '"></span>odaút</div>' +
      (data.inbound.length
        ? '<div><span class="swatch" style="background:' + INBOUND_COLOUR + '"></span>visszaút</div>'
        : '') +
      '<table>' +
      row('Útvonaltípus', data.mode === 'loop' ? 'Oda-vissza' : 'Csak oda') +
      row('Teljes táv', (data.totalDistanceM / 1000).toFixed(1) + ' km') +
      row('Közvetlen', (data.directDistanceM / 1000).toFixed(1) + ' km') +
      row('Becsült idő', Math.round(data.totalDurationS / 60) + ' perc') +
      (data.requestedOffsetM ? row('Tényleges kerülő', Math.round(data.requestedOffsetM) + ' m') : '') +
      (data.mode === 'loop'
        ? row('Elért oldal', Math.round(q.outboundSideM) + ' / ' + Math.round(q.inboundSideM) + ' m') +
          row('Közös szakasz', q.sharedPathRatio.toFixed(2), q.sharedPathRatio > 0.15)
        : row('Terület', 'nincs — nem zár kört', true)) +
      row('Visszafordulás (o/v)', out.uTurns + (back ? ' / ' + back.uTurns : ''), out.uTurns + (back?.uTurns ?? 0) > 2) +
      row('Rövid kitérő (o/v)', out.shortDetours + (back ? ' / ' + back.shortDetours : '')) +
      row('Önmagába visszatérés (o/v)', out.revisits + (back ? ' / ' + back.revisits : ''), out.revisits + (back?.revisits ?? 0) > 0) +
      row('Tervezés', data.elapsedMs + ' ms') +
      (data.geometry
        ? '<tr><td colspan="2" style="padding-top:6px;color:#8fa3bd">Geometria — birtokviszony nélkül</td></tr>' +
          row('Bezárt terület', formatArea(data.geometry.areaM2), data.geometry.cells === 0) +
          row('Cellák', data.geometry.cells.toLocaleString('hu-HU') +
            (data.geometry.compact ? ' (tömör belső)' : '')) +
          row('Bezárások', data.geometry.loops) +
          /*
            ELVETETT BEZÁRÁSOK — a motor némán dobja el őket. A too_large a
            fontos: ott a kör tényleg bezáródott, csak a plafon fölé esett.
          */
          (Object.keys(data.geometry.rejected ?? {}).length
            ? row('Elvetett bezárás',
                Object.entries(data.geometry.rejected)
                  .map(([reason, count]) => count + '× ' + reason).join(' · '),
                Boolean(data.geometry.rejected.too_large))
            : '') +
          row('Szintek (1–5)', [1,2,3,4,5].map((l) => data.geometry.levels[l] ?? 0).join(' · ')) +
          (data.geometry.cellsOnDemand
            ? row('Cellánkénti rajz', 'a látható nézetre — zoomolj rá')
            : '') +
          (data.geometry.compactParents
            ? row('Tömör belső', data.geometry.compactParents.toLocaleString('hu-HU') +
                ' parent — távolról egy folt')
            : '') +
          row('GP területből', data.geometry.claimGp) +
          row('GP távból', data.geometry.distanceGp) +
          row('Számítás', data.geometry.elapsedMs + ' ms', data.geometry.elapsedMs > 3000)
        : '') +
      (data.ownership
        ? '<tr><td colspan="2" style="padding-top:6px;color:#8fa3bd">Birtokviszony</td></tr>' +
          (data.ownership.available
            ? row('Szabad cella', data.ownership.free.toLocaleString('hu-HU')) +
              row('Foglalt cella', data.ownership.owned.toLocaleString('hu-HU'),
                data.ownership.owned > 0) +
              row('Tulajdonosok', data.ownership.owners) +
              (data.ownership.top ?? [])
                .map((victim, index) =>
                  row('&nbsp;&nbsp;' + (index + 1) + '. ' + victim.name,
                    formatArea(victim.areaM2) + ' · ' + victim.cells + ' cella'))
                .join('') +
              row('Foglalt szintek', [1,2,3,4,5]
                .map((l) => (data.ownership.ownedByLevel ?? {})[l] ?? 0).join(' · ')) +
              row('Lekérdezés', data.ownership.elapsedMs + ' ms') +
              /* A blokkszám a plafonhoz mérve — ezen múlik, belefér-e. */
              row('Blokk', data.ownership.blocks + ' / ' + data.ownership.maxBlocks,
                data.ownership.blocks > data.ownership.maxBlocks * 0.8)
            : row('Nem elérhető', data.ownership.reason, true))
        : '') +
      '</table>';
    document.getElementById('status').textContent = '';
  } catch (error) {
    document.getElementById('status').textContent = 'Hiba: ' + error.message;
  } finally {
    button.disabled = false;
    stopStopwatch();
  }
});

/* A mentett választások visszaállítása — a kapcsolók kezelőin keresztül,
   hogy a függő állapotok (letiltás, réteg be/ki) is helyükre kerüljenek. */
const restored = loadSettings();
if (restored) {
  for (const key of PERSISTED) {
    const value = restored[key];
    if (!value || value === state[key]) continue;
    const button = document.querySelector('#' + key + ' button[data-value="' + value + '"]');
    if (button && !button.disabled) button.click();
  }
}

renderPoints();
renderSaved();
renderStopwatch();
clearResult();
</script>
</body>
</html>`;

/**
 * Ismeri-e a gráf a lejtést?
 *
 * A terep-választó csak akkor élhet, ha az `average_slope` kódolt érték benne
 * van a gráfban — enélkül a rá hivatkozó szabály hibát ad, nem útvonalat.
 * A GraphHopper `/info` végpontja felsorolja a kódolt értékeket.
 */
async function slopeSupported(): Promise<boolean> {
  const base = process.env.GRAPHHOPPER_URL;
  if (!base) return false;
  try {
    const response = await fetch(`${base}/info`);
    if (!response.ok) return false;
    return JSON.stringify(await response.json()).includes('average_slope');
  } catch {
    return false;
  }
}

const token = mapboxToken();
if (!token) {
  console.warn('⚠️  Nincs VITE_MAPBOX_TOKEN a .env.local-ban — a térkép üres marad.');
}
if (!graphhopperConfigured()) {
  console.warn('⚠️  Nincs GRAPHHOPPER_URL — a tervező nem fog útvonalat adni.');
}

let slopeAvailable = false;
void slopeSupported().then((value) => {
  slopeAvailable = value;
  console.log(`Lejtés a gráfban: ${value ? 'igen' : 'nem'}`);
});

createServer((request, response) => {
  if (request.method === 'GET' && request.url?.startsWith('/geocode?')) {
    const params = new URL(request.url, 'http://localhost').searchParams;
    const query = params.get('q') ?? '';
    const near = params.get('near') ?? '19.05,47.50';
    void (async () => {
      const result =
        query.trim().length < 3 ? { results: [] } : await geocode(query, token, near);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(result));
    })();
    return;
  }

  /*
    A LÁTHATÓ NÉZET cellái — ugyanaz az eljárás, mint az éles appban
    (`TerritoryScreen` → `api.tiles(view)`). A teljes halmaz egyben túl nagy
    lenne (mérve: 244 byte/cella), és kizoomolva úgyis rejtve van: a cellarács
    csak `CELL_DETAIL_MIN_ZOOM` fölött látszik.
  */
  if (request.method === 'GET' && request.url?.startsWith('/cells?')) {
    const params = new URL(request.url, 'http://localhost').searchParams;
    const parts = (params.get('bbox') ?? '').split(',').map(Number);
    if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
      response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: false, reason: 'hibás bbox' }));
      return;
    }
    const [w, s, e, n] = parts as [number, number, number, number];
    const result = cellsInBbox({ w, s, e, n });
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(result));
    return;
  }

  if (request.method === 'POST' && request.url === '/plan') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', async () => {
      try {
        const result = await plan(parseRequest(body));
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ ok: false, reason: (error as Error).message }));
      }
    });
    return;
  }

  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(PAGE(token, slopeAvailable));
}).listen(PORT, () => {
  console.log(`Útvonal-labor: http://localhost:${PORT}`);
  console.log(`GraphHopper:   ${process.env.GRAPHHOPPER_URL}`);
});
