/**
 * A→B útvonaltervezés — a kliens ezen éri el a tervezőmotort.
 *
 * A motor (`lib/routePlan.ts`) a `#47` menet óta kész, és a kézi próbapadból
 * (`scripts/routeLab.ts`) hangoltuk. Ez a végpont NEM tartalmaz tervezési
 * logikát: hitelesít, kvótát fogyaszt, validál, és őszinte nemleges választ ad.
 *
 * Spec: `docs/routing/point-to-point.md`, `docs/02-funkcionalis-spec.md`.
 */

import { Router, type Response } from 'express';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, HttpError } from '../lib/errors';
import { gameDay, loadOwnership, weekOf } from '../lib/grid';
import { getGameplaySnapshot } from '../lib/gameplayConfig';
import { directionsConfigured } from '../lib/directions';
import { geocodeConfigured, searchPlaces } from '../lib/geocode';
import {
  planDirectRoute,
  planTwoSidedLoop,
  type DetourSize,
  type RoutePreference,
  type TerrainPreference,
} from '../lib/routePlan';
import { MAX_OWNERSHIP_BLOCKS } from '../lib/missionEvaluate';
import { computeGeometryOffThread, GeometryTimeout } from '../lib/geometryOffThread';
import { blocksFor } from '../lib/gridMath';
import { areaToGp } from '../../../src/game/scoring';
import { decodePolyline, encodePolyline } from '../../../src/game/polyline';
import { distanceM, type LatLng } from '../../../src/game/geo';
import { GAMEPLAY, type GameplayConfig } from '../../../src/config/gameplay';
import type { Layer, RouteManeuver, TracePoint } from '../../../src/types';
import type { AuthedRequest } from '../../server';

export const routesRouter = Router();

/** Ugyanaz a kör, mint a küldetés-ajánlónál — lásd `missions.ts`. */
const ADMIN_ROLES = new Set(['owner', 'admin', 'moderator']);

/**
 * A tervezhető távolság plafonja (légvonalban, rajt és cél között).
 *
 * A TERVEZÉS maga olcsó: a GraphHopper-hívások párhuzamosan mennek, mérve
 * 3,6–7 s még nagy távon is. Ez a plafon Geri döntése (2026-09-12): az ország
 * bármely két pontja közé essen bele.
 */
const MAX_DIRECT_DISTANCE_KM = 100;

/*
  ⚠️ A TERÜLET-ELŐNÉZETNEK NINCS TÁVOLSÁG-KÜSZÖBE, és ez tudatos.

  Korábban volt egy 25 km-es határ, mert a számítás a fő szálon futott és
  blokkolta az event loopot. Mérve viszont az derült ki, hogy a HOSSZ ROSSZ
  PREDIKTOR: egy 42 km-es budapesti kör 11 417 ms, egy 205 km-es Balaton-kör
  50 217 ms. A távolság alapján tiltani tehát vagy túl szigorú, vagy hatástalan.

  Helyette a számítás KÜLÖN SZÁLON fut (`lib/geometryOffThread.ts`), ami két
  dolgot ad: az event loop szabad marad (mérve: más kérések akadálytalanul
  futnak közben), és a munka MEGSZAKÍTHATÓ. Így nem a kérést korlátozzuk méret
  szerint, hanem a tényleges munkát vágjuk el időkorláttal.
*/

/** Legfeljebb ennyi megálló — a tervező minden megállóra külön leget tervez. */
const MAX_STOPS = 5;

interface PlanInput {
  from: LatLng;
  to: LatLng;
  stops: LatLng[];
  profile: 'walking' | 'cycling';
  mode: 'loop' | 'direct';
  detour: DetourSize;
  preference: RoutePreference;
  terrain: TerrainPreference;
  preferCycleways: boolean;
  /** Kiszámoljuk-e a terület-előnézetet — távolság dönti el, lásd lent. */
  geometry: boolean;
}

function parsePoint(value: unknown, field: string): LatLng {
  const point = value as { lat?: unknown; lng?: unknown } | null;
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw badRequest('invalid_point', `A(z) „${field}” pont hiányzik vagy hibás.`);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw badRequest('invalid_point', `A(z) „${field}” pont a Földön kívülre esik.`);
  }
  return { lat, lng };
}

function parseInput(body: unknown): PlanInput {
  const raw = (body ?? {}) as Record<string, unknown>;

  const from = parsePoint(raw.from, 'rajt');
  const to = parsePoint(raw.to, 'cél');

  const stopsRaw = Array.isArray(raw.stops) ? raw.stops : [];
  if (stopsRaw.length > MAX_STOPS) {
    throw badRequest('too_many_stops', `Legfeljebb ${MAX_STOPS} megállót tudunk betervezni.`);
  }
  const stops = stopsRaw.map((stop, index) => parsePoint(stop, `megálló ${index + 1}`));

  const directKm = distanceM(from, to) / 1000;
  if (directKm > MAX_DIRECT_DISTANCE_KM) {
    throw badRequest(
      'too_far',
      `A rajt és a cél ${directKm.toFixed(0)} km-re van egymástól, ` +
        `a tervezhető legnagyobb távolság ${MAX_DIRECT_DISTANCE_KM} km.`,
    );
  }
  if (directKm < 0.1) {
    throw badRequest('too_close', 'A rajt és a cél gyakorlatilag egy helyen van.');
  }

  const profile = raw.profile === 'cycling' ? 'cycling' : 'walking';

  /*
    A TERÜLET-ELŐNÉZET MINDENKINEK JÁR, MÉRETTŐL FÜGGETLENÜL — ez a tervezés
    lényege: indulás előtt lássuk, mit nyerhetünk. Ami korlátoz, az az
    időkorlát a külön szálon, nem a távolság (lásd fent).
  */
  const geometry = true;

  return {
    from,
    to,
    stops,
    profile,
    mode: raw.mode === 'direct' ? 'direct' : 'loop',
    detour: raw.detour === 'small' || raw.detour === 'large' ? raw.detour : 'medium',
    preference:
      raw.preference === 'protected' || raw.preference === 'quiet' ? raw.preference : 'fast',
    terrain: raw.terrain === 'flat' || raw.terrain === 'hilly' ? raw.terrain : 'balanced',
    /* Gyalog értelmetlen — a felület sem mutatja, de a szerver sem hiszi el. */
    preferCycleways: profile === 'cycling' && raw.preferCycleways === true,
    geometry,
  };
}

/**
 * Címkeresés a rajt/cél/megálló kijelöléséhez.
 *
 * ⚠️ HITELESÍTÉS MÖGÖTT, SZÁNDÉKOSAN. A geocoding külön termék és külön
 * számlázódik (`docs/routing/point-to-point.md`), tehát nyitva hagyva ingyenes
 * Mapbox-proxy lennénk bárkinek, a saját számlánkra — ugyanaz a megfontolás,
 * mint az időjárás-végpontnál.
 *
 * ⚠️ A TALÁLATOT NEM TÁROLJUK EL — lásd `lib/geocode.ts` fejléc.
 */
routesRouter.get('/geocode', async (req: AuthedRequest, res: Response, next) => {
  try {
    if (!geocodeConfigured()) {
      res.status(503).json({
        code: 'geocode_unavailable',
        message:
          'A címkeresés nincs beállítva ezen a kiszolgálón. Ez a mi hibánk, nem a tiéd — ' +
          'addig is a térképre koppintva jelölhetsz ki pontot.',
      });
      return;
    }

    const query = String(req.query.q ?? '');

    /*
      A KÖZELSÉG a térkép közepe, `lng,lat` sorrendben (ez a Mapbox alakja).

      ⚠️ AZ ÜRES ÉRTÉK NEM NULLA. A `Number('')` nem `NaN`, hanem **0**, tehát
      a kézenfekvő `Number.isFinite(...)` ellenőrzés az üres paramétert
      érvényes nullának veszi — és a közelség a Föld nullpontjára esik. Mérve
      (2026-09-12, valódi végponti próbán): a „Deák Ferenc tér” 1427 km-re
      látszott Budapesttől, mert az origin az Atlanti-óceánra került.
      Ezért a darabolás ELŐTT kell eldönteni, hogy egyáltalán kaptunk-e értéket.
    */
    const raw = String(req.query.near ?? '').trim();
    const parts = raw ? raw.split(',').map(Number) : [];
    const origin = {
      lng: Number.isFinite(parts[0]) ? (parts[0] as number) : 19.05,
      lat: Number.isFinite(parts[1]) ? (parts[1] as number) : 47.5,
    };

    res.json({ results: await searchPlaces(query, origin) });
  } catch (error) {
    next(error);
  }
});

routesRouter.post('/plan', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;

    const isAdmin = ADMIN_ROLES.has(req.role ?? '');
    const input = parseInput(req.body);

    if (!directionsConfigured()) {
      /* Üzemeltetési hiba — ugyanaz a hangnem, mint a küldetés-ajánlónál. */
      res.status(503).json({
        code: 'directions_unavailable',
        message:
          'Az útvonaltervező nincs beállítva ezen a kiszolgálón. Ez a mi hibánk, nem a tiéd — szólj nekünk.',
      });
      return;
    }

    const snapshot = await getGameplaySnapshot(new Date());
    const cfg = snapshot.config;
    const today = gameDay(new Date());
    const week = weekOf(today);

    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const userSnap = await userRef.get();
    const user = (userSnap.data() ?? {}) as {
      pro?: { active?: boolean };
      missionQuota?: { week?: number; used?: number };
    };

    /*
      ── Kvóta ────────────────────────────────────────────────────────
      UGYANAZ a heti keret, mint a küldetés-ajánlónál, szándékosan: enélkül a
      tervező megkerülné a küldetés-ajánló korlátját (spec:
      `docs/routing/point-to-point.md` → Játékszabályi következmények).
      Az admin itt sem fogyaszt — a tervezőt hangolni kell tudni.
    */
    const isPro = user.pro?.active === true || isAdmin;
    const usedThisWeek = user.missionQuota?.week === week ? Number(user.missionQuota.used ?? 0) : 0;
    if (!isPro && usedThisWeek >= cfg.FREE_ROUTE_GENERATIONS_PER_WEEK) {
      throw new HttpError(
        403,
        'route_quota_exhausted',
        `Ezen a héten elfogyott az ${cfg.FREE_ROUTE_GENERATIONS_PER_WEEK} ingyenes útvonaltervezésed. Jövő hétfőn újratöltődik.`,
      );
    }

    const started = Date.now();

    /* ── „Csak oda” ─────────────────────────────────────────────────── */

    if (input.mode === 'direct') {
      const routes = await planDirectRoute(
        input.from,
        input.to,
        input.profile,
        input.preference,
        { stops: input.stops, preferCycleways: input.preferCycleways, terrain: input.terrain },
      );
      const route = routes[0];
      if (!route) {
        throw new HttpError(
          422,
          'no_route',
          'Erre a két pontra nem találtunk útvonalat. Próbálj másik célt, vagy tegyél be egy megállót.',
        );
      }

      if (!isPro) {
        await userRef.set({ missionQuota: { week, used: usedThisWeek + 1 } }, { merge: true });
      }

      const points = decodePolyline(route.polyline);
      res.json({
        ok: true,
        mode: 'direct',
        outbound: points.map((p) => [p.lng, p.lat]),
        inbound: [],
        totalDistanceM: route.distanceM,
        directDistanceM: route.distanceM,
        totalDurationS: route.durationS,
        /*
          ⚠️ A „Csak oda” NEM ZÁR KÖRT, tehát NEM AD TERÜLETET — csak a megtett
          táv utáni GP-t. A felületnek ezt indulás ELŐTT ki kell mondania
          (spec: `point-to-point.md` → Játékszabályi következmények).
        */
        closesLoop: false,
        /* Lásd a loop ágat: a vezetett navigáció bemenete. */
        polyline: route.polyline,
        maneuvers: route.maneuvers ?? [],
        roadClasses: route.roadClasses ?? [],
        quotaLeft: isPro ? null : cfg.FREE_ROUTE_GENERATIONS_PER_WEEK - usedThisWeek - 1,
        elapsedMs: Date.now() - started,
      });
      return;
    }

    /* ── Oda-vissza kör ─────────────────────────────────────────────── */

    const result = await planTwoSidedLoop(input.from, input.to, input.profile, {
      detour: input.detour,
      preference: input.preference,
      preferCycleways: input.preferCycleways,
      terrain: input.terrain,
      stops: input.stops,
    });

    if (!result.ok) {
      /*
        ŐSZINTE NEMLEGES VÁLASZ. A motor megmondja, min bukott el; ezt nem
        nyeljük el egy általános hibába, mert a felhasználó tud rajta
        segíteni (másik cél, kisebb kerülő).
      */
      throw new HttpError(
        422,
        'no_loop',
        'Erre a célra nem tudtunk kört tervezni — a környék úthálózata nem engedi a kért kerülőt. ' +
          'Próbálj kisebb kerülőt, másik célt, vagy válts „Csak oda” módra.',
      );
    }

    if (!isPro) {
      await userRef.set({ missionQuota: { week, used: usedThisWeek + 1 } }, { merge: true });
    }

    const { loop } = result;
    res.json({
      ok: true,
      mode: 'loop',
      outbound: loop.outbound.points.map((p) => [p.lng, p.lat]),
      inbound: loop.inbound.points.map((p) => [p.lng, p.lat]),
      totalDistanceM: loop.totalDistanceM,
      directDistanceM: loop.directDistanceM,
      totalDurationS: loop.totalDurationS,
      closesLoop: true,
      /*
        A VEZETETT NAVIGÁCIÓ BEMENETE. A rögzítés ugyanazt a `GhostRoute`
        alakot várja, amit a küldetésekből ismer (`src/lib/ghostRoute.ts`):
        egyetlen kódolt vonallánc és a hozzá tartozó manőverek. Enélkül a
        tervezett útvonalon nem indulna el a Play gomb.
      */
      polyline: encodePolyline([...loop.outbound.points, ...loop.inbound.points]),
      maneuvers: joinManeuvers(loop.outbound, loop.inbound),
      /* A vonal vastagságához: melyik szakasz milyen úton megy. */
      roadClasses: joinRoadClasses(loop.outbound, loop.inbound),
      requestedOffsetM: Math.min(
        GAMEPLAY.ROUTE_DETOUR_OFFSET_M[input.detour],
        distanceM(input.from, input.to) * 0.45,
      ),
      quotaLeft: isPro ? null : cfg.FREE_ROUTE_GENERATIONS_PER_WEEK - usedThisWeek - 1,
      elapsedMs: Date.now() - started,
      /*
        A ZSÁKMÁNY-ELŐNÉZET — ez táplálja az „Útvonal adatok” panelt. Ha a
        távolság a küszöb fölött van, a terv ettől még kész: csak ez marad ki,
        és a felület ezt ki is mondja.
      */
      ...(await rewardOrReason(loop.outbound, loop.inbound, uid, input.profile, cfg)),
    });
  } catch (error) {
    next(error);
  }
});


/**
 * A ZSÁKMÁNY ELŐNÉZETE — ez táplálja az „Útvonal adatok” panelt.
 *
 * Azt mondja meg, amit a felhasználó indulás ELŐTT tudni akar: hány cellát
 * szerezhet, ebből mennyi szabad és mennyi elvett, mekkora terület, mennyi GP,
 * és kiktől venné el a legtöbbet.
 *
 * ⚠️ EZ FELSŐ HATÁR, NEM ÍGÉRET. Két okból:
 *   - a tervezett nyomvonal és a ténylegesen megtett út nem ugyanaz (GPS,
 *     kitérők, lerövidítés);
 *   - a birtokviszony a tervezés PILLANATÁBAN igaz — mire odaérsz, más is
 *     mozoghatott ugyanott.
 * A felületnek ezt ki kell mondania; nem szabad garanciaként mutatni.
 *
 * ⚠️ NEM ÍR SEMMIT. Se cellát, se GP-t, se aktivitást — a foglalás kizárólag a
 * rögzítés végén, a szokásos úton történik (`routes/activities.ts`).
 */
async function previewReward(
  outbound: { points: readonly LatLng[] },
  inbound: { points: readonly LatLng[] },
  uid: string,
  profile: 'walking' | 'cycling',
  cfg: GameplayConfig,
) {
  const started = Date.now();

  // Egyetlen, folytonos nyomvonal — a bezárás a teljes körön áll elő.
  const trace: TracePoint[] = [];
  let clock = 0;
  for (const leg of [outbound, inbound]) {
    for (const point of leg.points) {
      trace.push({ lat: point.lat, lng: point.lng, t: clock });
      clock += 1000;
    }
  }

  /* ⚠️ KÜLÖN SZÁLON, időkorláttal — lásd `geometryOffThread.ts`. */
  const shaped = await computeGeometryOffThread({ trace });
  const cellCount = shaped.cellCount;
  if (cellCount === 0) {
    /* Nem zárt kört — nincs mit mutatni, de ez nem hiba. */
    return { closesArea: false as const, elapsedMs: Date.now() - started };
  }

  const areaM2 = cellCount * GAMEPLAY.CELL_AREA_M2;
  const layer: Layer = profile === 'cycling' ? 'bike' : 'foot';

  /*
    ⚠️ A BIRTOKVISZONY PLAFONOS. A `loadOwnership` egyetlen, kötegeletlen
    `db.getAll(...)`-lal dolgozik; nagy körnél több ezer blokkot kérne
    egyszerre, és a kiszolgáló percekre beragad (mérve, 2026-09-12, az
    Útvonal-laborban). Ugyanaz a plafon, amit a küldetés-ajánló használ.
  */
  const blocks = blocksFor(layer, shaped.cells);
  let stolenCells = 0;
  const byOwner = new Map<string, number>();
  let ownershipKnown = false;

  if (blocks.size <= MAX_OWNERSHIP_BLOCKS) {
    const ownership = await loadOwnership(layer, shaped.cells);
    ownershipKnown = true;
    for (const [, held] of ownership) {
      /* A SAJÁT cellád nem „lopás” — az megerősítés. */
      if (!held?.owner || held.owner === uid) continue;
      stolenCells += 1;
      byOwner.set(held.owner, (byOwner.get(held.owner) ?? 0) + 1);
    }
  }

  /*
    ⚠️ A LOPOTT CELLÁK SZÁMA A FALRA ÉS A HATÁRSÁVRA IGAZ. Nagy, tömör belsejű
    körnél a belső cellákat NEM olvassuk be egyenként (az lenne a több millió
    olvasás) — az „új” szám ezért ott felső becslés.
  */
  const newCells = Math.max(0, cellCount - stolenCells);

  return {
    closesArea: true as const,
    cells: cellCount,
    newCells,
    stolenCells,
    /* Hamis, ha a kör túl nagy volt a birtokviszony beolvasásához. */
    ownershipKnown,
    areaM2,
    gp: Math.round(areaToGp(areaM2, cfg)),
    /* Top 3 rivális — név, cellaszám, terület. A panel ezt listázza. */
    topRivals: await topRivals(byOwner),
    elapsedMs: Date.now() - started,
  };
}

/**
 * A három legnagyobb „áldozat” neve.
 *
 * ⚠️ A PRIVÁT FIÓK NEVE NEM JELENIK MEG. Aki privátra állította magát, az
 * „helyi játékos” néven szerepel — a cellaszám ettől még látszik, mert az a
 * térképen úgyis látható, a NÉV viszont nem publikus adat.
 */
async function topRivals(byOwner: ReadonlyMap<string, number>) {
  const ranked = [...byOwner].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (ranked.length === 0) return [];

  const docs = await db.getAll(...ranked.map(([id]) => db.collection(COLLECTIONS.users).doc(id)));
  const names = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data() as { username?: string; privacy?: { account?: string } };
    if (data.privacy?.account === 'private') continue;
    const username = String(data.username ?? '');
    if (username) names.set(doc.id, username);
  }

  return ranked.map(([id, cells]) => ({
    name: names.get(id) ?? 'helyi játékos',
    cells,
    areaM2: cells * GAMEPLAY.CELL_AREA_M2,
  }));
}

/**
 * A zsákmány-előnézet, vagy az ŐSZINTE indoklás, ha nem fért bele.
 *
 * Az időkorlát nem hiba: a terv kész, a navigáció működik, csak az előnézetet
 * nem tudtuk időben kiszámolni. A felhasználónak ezt ki kell mondani —
 * némán hiányzó adat rosszabb, mint egy őszinte mondat.
 */
async function rewardOrReason(
  outbound: { points: readonly LatLng[] },
  inbound: { points: readonly LatLng[] },
  uid: string,
  profile: 'walking' | 'cycling',
  cfg: GameplayConfig,
) {
  try {
    return { reward: await previewReward(outbound, inbound, uid, profile, cfg), rewardSkipped: null };
  } catch (error) {
    if (error instanceof GeometryTimeout) {
      return {
        reward: null,
        rewardSkipped:
          'Ezt az útvonalat nem tudtuk időben kiértékelni, ezért a várható zsákmányt most nem mutatjuk. ' +
          'A terv és a navigáció ettől még működik — a területet menet közben, a szokásos módon kapod meg.',
      };
    }
    throw error;
  }
}

/**
 * A két leg manővereinek összefűzése EGY útvonalra.
 *
 * ⚠️ AZ ELTOLÁS NEM ELHAGYHATÓ. A `routeOffsetM` az útvonal ELEJÉTŐL mért
 * távolság; ha a visszaút manővereit eltolás nélkül fűznénk hozzá, a navigáció
 * a kör második felét az elejére vetítené, és minden kanyart rossz helyen
 * jelezne. Az azonosítókat is előtagozzuk, mert a két leg külön válaszból jön,
 * és az `id` csak EGY válaszon belül egyedi.
 */
function joinManeuvers(
  outbound: { route: { distanceM: number; maneuvers?: RouteManeuver[] } },
  inbound: { route: { maneuvers?: RouteManeuver[] } },
): RouteManeuver[] {
  const first = (outbound.route.maneuvers ?? []).map((m) => ({ ...m, id: `o:${m.id}` }));
  const second = (inbound.route.maneuvers ?? []).map((m) => ({
    ...m,
    id: `i:${m.id}`,
    routeOffsetM: m.routeOffsetM + outbound.route.distanceM,
  }));
  return [...first, ...second];
}

/**
 * A két leg út-osztályainak összefűzése EGY útvonalra.
 *
 * ⚠️ AZ ELTOLÁS ITT IS KÖTELEZŐ, ugyanazért, mint a manővereknél: az
 * intervallumok a saját leg PONTJAIRA mutatnak. Eltolás nélkül a visszaút
 * osztályai az odaút elejére vetülnének, és a vonal rossz helyeken
 * vastagodna-vékonyodna.
 */
function joinRoadClasses(
  outbound: { route: { roadClasses?: [number, number, string][] }; points: readonly LatLng[] },
  inbound: { route: { roadClasses?: [number, number, string][] } },
): [number, number, string][] {
  const first = outbound.route.roadClasses ?? [];
  const offset = outbound.points.length;
  const second = (inbound.route.roadClasses ?? []).map(
    ([from, to, cls]) => [from + offset, to + offset, cls] as [number, number, string],
  );
  return [...first, ...second];
}
