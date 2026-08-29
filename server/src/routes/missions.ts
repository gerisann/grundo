import { Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, HttpError } from '../lib/errors';
import { gameDay, loadOwnership, weekOf } from '../lib/grid';
import { getGameplaySnapshot } from '../lib/gameplayConfig';
import { directionsConfigured, planMissionLoop, routeToTracePoints, type RouteCharacter } from '../lib/directions';
import {
  evaluateCandidate,
  limitByBlocks,
  ownedBlockIds,
  MAX_OWNERSHIP_BLOCKS,
  shapeCandidateCells,
  type ShapedCandidate,
} from '../lib/missionEvaluate';
import { decodePolyline } from '../../../src/game/polyline';
import { layerOf } from '../../../src/game/cells';
import {
  countShortDetours,
  countUTurns,
  measureStraightness,
  selectMissionRoutes,
} from '../../../src/game/routeShape';
import {
  averagePaceSecPerKm,
  directionsProfile,
  missionBearings,
  pickMissions,
  targetDistanceKm,
  withinTolerance,
  type Mission,
  type MissionCandidate,
} from '../../../src/game/missions';
import { distanceM } from '../../../src/game/geo';
import type { GameplayConfig } from '../../../src/config/gameplay';
import type { ActivityType, CellId, Layer, TracePoint } from '../../../src/types';
import type { AuthedRequest } from '../../server';

export const missionsRouter = Router();

/**
 * Ha a tűréshatáron belül nincs jelölt, EDDIG a hosszeltérésig még
 * felajánljuk a legközelebbieket.
 *
 * 45 % egy 45 perces kérésnél nagyjából 20 perc csúszás — ennél többet már
 * nem szabad „küldetésnek" nevezni, mert a felhasználó nem érne vissza.
 */
const MAX_FALLBACK_ERROR = 0.45;

/** A tűréshatáron kívülről legfeljebb ennyi ajánlat jöhet. */
const FALLBACK_LIMIT = 4;

/** Ezek a szerepkörök nem fogyasztanak generálási kvótát. */
const ADMIN_ROLES = new Set(['owner', 'admin', 'moderator']);

/**
 * A célhossz felső korlátja kilométerben.
 *
 * ⚠️ EZ TELJESÍTMÉNYI VÉDŐKORLÁT, nem játékszabály. A bezárt terület a
 * kerület NÉGYZETÉVEL nő: mérve egy 16 km-es kör 52 000 cellát zár be, egy
 * 24 km-es már 116 000-et.
 *
 * ⚠️ 2026-08-29-től 300 km (Geri kérése; korábban 50). Amit tudni kell hozzá:
 * a hurok VALÓDI felső korlátja nem ez, hanem a `MAX_LOOP_BBOX_CELLS`
 * (500 000 cella ≈ 150 km²). Egy 300 km kerületű, tömör kör ~7 150 km²-t
 * zárna be, tehát az ilyen jelöltet a `LoopTooLargeError` elutasítja — a
 * felhasználó ilyenkor NEM kap küldetést, csak lassabban tudja meg. A korlát
 * emelése tehát a TERVEZÉST engedi el, nem a bezárást: nagyon hosszú körre
 * akkor lesz ajánlat, ha az útvonal nem egy nagy, tömör kör, hanem visszatérő
 * kisebb hurkokból áll.
 *
 * A `MAX_MINUTES` (8 óra) miatt ez az IDŐALAPÚ utat is felszabadítja: nyolc óra
 * bringával, 30 km/h-val 240 km-es célhossz.
 */
const MAX_TARGET_KM = 300;

/**
 * Hány jelöltre fusson le a DRÁGA geometria — abszolút felső korlát.
 *
 * ⚠️ TELJESÍTMÉNYI PLAFON, mérésből (2026-08-29). A geometriaépítés drága
 * fele a `detectLoopsDetailed`, ami jelöltkapunként flood fillt futtat:
 * mérve 3,4 s/jelölt egy 7,5 km-es sétakörnél, 4,8 s/jelölt egy 16 km-es
 * bringakörnél. Nyers jelöltből 18–19 érkezik, tehát plafon nélkül ez
 * egymagában 60–90 s.
 *
 * Hatot tartunk meg, nem négyet: a `pickMissions` legfeljebb négy karaktert
 * oszt ki, de egy jelölt kieshet (nem zár kört, túl nagy hurok, vagy egy
 * másikkal túl nagy az átfedése). A két tartalék azt fedezi, hogy emiatt ne
 * fogyjon el a mezőny — cserébe a legrosszabb eset korlátos marad.
 */
const MAX_SHAPED_CANDIDATES = 6;

/**
 * A jelöltszám plafonja a CÉLHOSSZ szerint.
 *
 * ⚠️ MÉRÉSBŐL, a 300 km-es felső határ bevezetésekor (2026-08-29). A
 * geometria ideje nem a hosszal arányos, hanem a nyomvonal pontszámával és a
 * kontaktfoltokkal — mérve, bringa, egy jelöltre:
 *
 *   50 km → 1,0 s ·  100 km → 2,1 s ·  200 km → 15,9 s ·  300 km → 18,9 s
 *
 * Hat jelölttel egy 300 km-es kérés így egymagában ~2 perc lenne. A hosszú
 * körökre ezért kevesebb jelöltet dolgozunk fel: a választék szűkül, de a
 * várakozás korlátos marad (~40 s a legrosszabb esetben). Rövid körökön —
 * ahol a felhasználók döntő többsége van — semmi nem változik.
 */
function shapedCandidateLimit(targetKm: number): number {
  if (targetKm <= 30) return MAX_SHAPED_CANDIDATES;
  if (targetKm <= 100) return 4;
  return 2;
}

/**
 * POST /api/missions/generate
 *
 * A küldetés-ajánló. NEM egyszerű útvonaltervező: a bemenet IDŐ vagy TÁVOLSÁG, a
 * kimenet pedig játékbeli tét.
 *
 *   { lat, lng, minutes: 45, type: 'run' }
 *   → 3–4 küldetés: Hódítás · Rajtaütés · Erősítés · Felfedezés
 *
 * A MENET (docs/02-funkcionalis-spec.md → Küldetés-ajánló):
 *   1. célhossz a felhasználó SAJÁT átlagtempójából
 *   2. kör-jelöltek nyolc irányban, valódi úthálózaton (saját GraphHopper, Mapbox tartalékban)
 *   3. mindegyikre a bezáruló cellahalmaz — UGYANAZ a motor, mint élesben
 *   4. értékelés a JELENLEGI birtokviszonyok ellen
 *   5. karakterenként a legjobb, érdemben különböző ajánlat
 *
 * ⚠️ A 3. LÉPÉS NEM BECSLÉS. A `processActivity` fut le, ugyanaz a függvény,
 * ami a valódi mentésnél a területet adja — csak nem írunk vele semmit. Amit
 * a küldetés ígér, azt a felhasználó pontosan meg is kapja, ha végigmegy
 * rajta (a GPS-pontosság határain belül).
 */
missionsRouter.post('/generate', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const input = parseInput(req.body);

    if (!directionsConfigured()) {
      /*
        Üzemeltetési hiba, és a szöveg ezt ki is mondja — nem a felhasználó
        böngészőjével van baj. Ugyanaz a hangnem, mint a push `no_vapid_key`
        ágánál a `NotificationsScreen`-en.
      */
      res.status(503).json({
        code: 'directions_unavailable',
        message:
          'Az útvonaltervező nincs beállítva ezen a kiszolgálón. Ez a mi hibánk, nem a tiéd — szólj nekünk.',
      });
      return;
    }

    const snapshot = await getGameplaySnapshot(new Date());
    const cfg = snapshot.config;
    const layer = layerOf(input.type);
    const today = gameDay(new Date());

    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const userSnap = await userRef.get();
    const user = (userSnap.data() ?? {}) as {
      pro?: { active?: boolean };
      streak?: { current?: number };
      missionQuota?: { week?: number; used?: number };
    };

    /* ── Kvóta: ingyenes heti 5, Pro korlátlan ──────────────────────── */

    /*
      ADMIN NEM FOGYASZT KVÓTÁT.

      Nem kedvezmény, hanem üzemeltetési szükséglet: a küldetés-ajánlót
      hangolni kell (kerülő-szorzó, tűréshatár, mozgásformák), és ahhoz
      sokszor egymás után kell generálni. Öt hetit elfogyasztva a saját
      funkciónkat nem tudnánk kipróbálni. A szerepkör a Firebase
      egyéni igényéből jön, ugyanaz, amit az admin felület is használ.
    */
    const isAdmin = ADMIN_ROLES.has(req.role ?? '');
    const isPro = user.pro?.active === true || isAdmin;
    const week = weekOf(today);
    const usedThisWeek = user.missionQuota?.week === week ? Number(user.missionQuota.used ?? 0) : 0;
    if (!isPro && usedThisWeek >= cfg.FREE_ROUTE_GENERATIONS_PER_WEEK) {
      throw new HttpError(
        403,
        'mission_quota_exhausted',
        `Ezen a héten elfogyott az ${cfg.FREE_ROUTE_GENERATIONS_PER_WEEK} ingyenes küldetés-generálásod. Jövő hétfőn újratöltődik.`,
      );
    }

    /* ── 1. Célhossz a saját tempóból ───────────────────────────────── */

    const paceSamples = await recentPaceSamples(uid, input.type, cfg.MISSION_PACE_SAMPLE_ACTIVITIES);
    const measuredPace = averagePaceSecPerKm(paceSamples);
    const pace = input.paceSecPerKm ?? measuredPace ?? cfg.MISSION_DEFAULT_PACE_S_PER_KM[input.type];
    // A plafon teljesítményi védelem — lásd `MAX_TARGET_KM`. A felület a
    // ténylegesen használt célhosszt írja ki, tehát a vágás nem néma.
    const targetKm = Math.min(
      input.distanceKm ?? targetDistanceKm(input.minutes!, pace, cfg),
      MAX_TARGET_KM,
    );

    /* ── 2. Kör-jelöltek nyolc irányban ─────────────────────────────── */

    const origin = { lat: input.lat, lng: input.lng };
    const profile = directionsProfile(input.type);
    const bearings = orderBearings(missionBearings(cfg), input.preferredBearing);

    const planAt = async (bearing: number, wantedKm: number) => {
      const routes = await planMissionLoop(origin, bearing, wantedKm, profile, cfg, input.routeCharacter);
      return routes.length > 0 ? { bearing, routes } : null;
    };

    /*
      KÉT MENET — a második ÖNKALIBRÁL.

      Az első menet a `MISSION_DETOUR_FACTOR` becslésével indul: mennyivel
      hosszabb a valódi útvonal a mértani körnél. Ez a becslés VÁROSFÜGGŐ —
      egy sűrű belvárosi rácsban más, mint egy folyóparti, kevés átkötésű
      környéken. Ha egyetlen fix számra hagyatkozunk, rossz helyen minden
      jelölt kilóg a tűréshatáron, és a felhasználó azt kapja, hogy „nincs
      kör" — pedig van, csak rossz méretűt kértünk.

      A második menet ezt méréssel javítja: tudjuk a TÉNYLEGES hosszt, tehát
      a sugarat a `cél / tényleges` aránnyal skálázzuk, és újrakérjük. Így a
      kerülő-szorzó becslése már csak kiindulópont, nem sorsdöntő.
    */
    const firstPass = await Promise.all(bearings.map((bearing) => planAt(bearing, targetKm)));

    /** A célhosszhoz viszonyított eltérés — kalibráláshoz és válogatáshoz. */
    const relativeError = (km: number) => Math.abs(km - targetKm) / targetKm;

    const secondPass = await Promise.all(
      firstPass.map(async (entry, index) => {
        if (!entry) return null;
        const reference = [...entry.routes].sort(
          (a, b) => relativeError(a.distanceM / 1000) - relativeError(b.distanceM / 1000),
        )[0];
        const km = (reference?.distanceM ?? 0) / 1000;
        if (!(km > 0) || entry.routes.some((route) => withinTolerance(route.distanceM / 1000, targetKm, cfg))) {
          return null;
        }
        // A sugár lineárisan hat a kerületre, tehát ez az arány közvetlenül
        // a korrigált célhossz.
        return planAt(bearings[index]!, targetKm * (targetKm / km));
      }),
    );

    /*
      Nem dobjuk el a Directions alternatíváit a Mapbox első helyezése alapján.
      Egy irány első és önkalibrált menetének minden egyedi geometriája tovább
      jut a saját hurok- és hibamérésünkbe. Maguk az alternatívák ugyanabban a
      Directions-válaszban érkeznek, tehát nem igényelnek külön API-hívást.
    */
    const planned = bearings.flatMap((bearing, index) => {
      const seen = new Set<string>();
      const routes = [
        ...(firstPass[index]?.routes ?? []),
        ...(secondPass[index]?.routes ?? []),
      ];
      return routes.flatMap((route) => {
        if (seen.has(route.polyline)) return [];
        seen.add(route.polyline);
        return [{ bearing, route }];
      });
    });

    /* ── 3. Válogatás CELLÁK NÉLKÜL — a drága geometria elé ─────────── */

    /*
      ⚠️ A SORREND ITT TELJESÍTMÉNYI DÖNTÉS, MÉRÉSSEL (2026-08-29).

      Korábban a cellafeldolgozás MINDEN nyers jelöltre lefutott, és csak
      utána válogattunk. Mérve: 7,5 km séta, 18 jelölt → 60,65 s a
      cellafeldolgozásban, miközben a végén 2 kártya lett belőle. A drága
      fél a `detectLoopsDetailed` (jelöltkapunként flood fill), nem a
      `loopCells` — az utóbbi 0,00 s.

      A válogatás viszont NEM igényel cellát: a `selectMissionRoutes` csak
      `uTurns`/`shortDetours`/`turnCount`-ot néz (mind a vonalláncból), a
      tűréshatár pedig a hosszból. Ezért a válogatás előre kerül, és a
      geometria már csak a ténylegesen kártyára kerülő jelölteken fut le.
    */

    /** Diagnosztika: az üres válasz OKA — enélkül nem lehet hangolni. */
    let routesReturned = 0;
    let closedLoops = 0;

    interface PlannedCandidate {
      bearing: number;
      distanceKm: number;
      polyline: string;
      points: TracePoint[];
      uTurns: number;
      shortDetours: number;
      turnCount: number;
      error: number;
    }

    const measured: PlannedCandidate[] = [];
    for (const entry of planned) {
      routesReturned += 1;

      const distanceKm = entry.route.distanceM / 1000;
      const coordinates = decodePolyline(entry.route.polyline);
      if (coordinates.length < 2) continue;

      measured.push({
        bearing: entry.bearing,
        distanceKm,
        polyline: entry.route.polyline,
        points: routeToTracePoints(entry.route, coordinates),
        // Az útvonal ALAKJA — ezzel bontja fel a válogatás a döntetlent, hogy
        // ne egy mellékutcákba beszaladgáló kör kerüljön a kártyára.
        // Külön mérték: egy valódi visszafordulás mindig erősebb hiba, mint
        // a lazább helyi kerülő-heurisztika. Összevonva a teljesen
        // U-fordulásmentes jelöltek is hibásnak látszottak.
        uTurns: countUTurns(coordinates),
        shortDetours: countShortDetours(coordinates),
        turnCount: measureStraightness(coordinates).turnCount,
        error: relativeError(distanceKm),
      });
    }

    /*
      A TŰRÉSHATÁR ELŐNY, NEM KIZÁRÓ OK.

      Korábban a határon kívüli jelölt egyszerűen kiesett, és ha mind kiesett,
      a felhasználó semmit nem kapott. Márpedig egy 9 km-es ajánlat a kért
      7,5 helyett még mindig sokkal többet ér, mint az „ezen a környéken nincs
      kör" üzenet — főleg, hogy a kártya kiírja a tényleges hosszt, tehát a
      felhasználó dönthet. Ha van a tűrésen belüli, azok nyernek; ha nincs,
      a legközelebbieket kínáljuk fel, egy józan felső határig.
    */
    const inTolerance = measured.filter((candidate) => candidate.error <= cfg.MISSION_DISTANCE_TOLERANCE);
    const usable = inTolerance.length > 0
      ? inTolerance
      : measured
          .filter((candidate) => candidate.error <= MAX_FALLBACK_ERROR)
          .sort((a, b) => a.error - b.error)
          .slice(0, FALLBACK_LIMIT);

    const directional = preferDirection(usable, input.preferredBearing);
    const preselected = selectMissionRoutes(
      directional.map(({ error: _error, ...candidate }) => candidate),
    ).slice(0, shapedCandidateLimit(targetKm));

    /* ── 3a. GYORS FÁZIS VÉGE — itt fordul vissza a `plan` kérés ────── */

    /*
      A kártya ilyenkor MÁR KIRAJZOLHATÓ: van vonallánc (térkép), hossz és
      irány. Ami hiányzik — terület, mező, GP, karakter —, az mind a lassú
      geometriából jön, azt a kliens az `/evaluate` végponttól kéri el, és a
      kártya utólag egészül ki.

      ⚠️ A „NEM BECSLÉS" SZABÁLY (AGENTS.md 2. döntés) ÉRVÉNYBEN MARAD. Itt
      nem adunk közelítő területet, amit később felülírnánk: a mező egyszerűen
      hiányzik, amíg a valódi motor ki nem számolja. A felület ezalatt töltő
      jelzést mutat, nem számot.
    */
    if (input.phase === 'plan') {
      if (!isPro) {
        await userRef.set({ missionQuota: { week, used: usedThisWeek + 1 } }, { merge: true });
      }
      res.json({
        targetKm: round2(targetKm),
        paceSecPerKm: Math.round(pace),
        quota: isPro
          ? { unlimited: true as const }
          : { unlimited: false as const, used: usedThisWeek + 1, limit: cfg.FREE_ROUTE_GENERATIONS_PER_WEEK },
        routes: preselected.map((candidate) => ({
          polyline: candidate.polyline,
          distanceKm: round2(candidate.distanceKm),
          bearing: candidate.bearing,
        })),
        /*
          A `no_loops` ITT NEM ÁLLAPÍTHATÓ MEG: azt csak a geometria tudná
          eldönteni, ami ebben a fázisban szándékosan nem futott le. Ha egyik
          kiválasztott jelölt sem zár kört, az az `/evaluate` üres válaszából
          derül ki.
        */
        reason: preselected.length > 0
          ? undefined
          : routesReturned === 0
            ? 'no_routes'
            : 'no_fit',
      });
      return;
    }

    /* ── 3b. Geometria: CSAK a kiválasztottakra ─────────────────────── */

    const shaped: ShapedCandidate[] = [];
    for (const candidate of preselected) {
      try {
        // A cellákat a MENTÉS geometriája adja, nem külön detektor — lásd
        // `shapeCandidateCells`. Enélkül a küldetés mást ígér, mint amit az
        // `evaluateCandidate` ugyanabból a nyomvonalból kiszámol.
        const { loopCount, cells, geometry } = shapeCandidateCells(candidate.points);
        if (loopCount === 0) continue; // nem zár kört: nincs mit ajánlani
        closedLoops += 1;

        shaped.push({
          bearing: candidate.bearing,
          distanceKm: candidate.distanceKm,
          polyline: candidate.polyline,
          points: candidate.points,
          cells,
          // Az `evaluateCandidate` ezt kapja meg, hogy a hurokdetektálás ne
          // fusson le másodszor ugyanarra a nyomvonalra.
          geometry,
          uTurns: candidate.uTurns,
          shortDetours: candidate.shortDetours,
          turnCount: candidate.turnCount,
        });
      } catch {
        // Túl nagy hurok (`LoopTooLargeError`) vagy hibás geometria: kimarad.
        continue;
      }
    }

    if (shaped.length === 0) {
      res.json({
        missions: [],
        targetKm: round2(targetKm),
        paceSecPerKm: Math.round(pace),
        /*
          A HÁROM OK KÜLÖNVÁLASZTVA. Korábban mindegyik `no_loops` volt, és
          emiatt nem lehetett megmondani, hogy az úthálózat nem ad kört,
          vagy csak rossz méretűt kértünk — ez a hangolást lehetetlenné tette.

          ⚠️ A SORREND SZÁMÍT, és 2026-08-29-en meg is fordult. Amióta a
          válogatás a geometria ELŐTT fut, a `closedLoops` már csak a
          kiválasztott jelöltekre vonatkozik. Ha a hossz-szűrés mindent
          kidobott, a geometriaciklus le sem fut — ilyenkor `closedLoops`
          nulla, de az OK a méret, nem az úthálózat. Ezért a `no_fit`
          vizsgálata megelőzi a `no_loops`-ot.
        */
        reason: routesReturned === 0
          ? 'no_routes'
          : preselected.length === 0
            ? 'no_fit'
            : 'no_loops',
        diagnostics: {
          routesReturned,
          /** Hány jelölt jutott el a drága geometriáig (plafon: `MAX_SHAPED_CANDIDATES`). */
          preselected: preselected.length,
          closedLoops,
          bearings: bearings.length,
        },
      });
      return;
    }

    /* ── 4–6. A lassú fél — UGYANAZ, mint amit az `/evaluate` futtat ── */

    const missions = await evaluateShapedCandidates({
      uid,
      shaped,
      layer,
      type: input.type,
      today,
      cfg,
      streakDays: Number(user.streak?.current ?? 0),
      priority: input.priority,
    });

    if (!isPro) {
      await userRef.set(
        { missionQuota: { week, used: usedThisWeek + 1 } },
        { merge: true },
      );
    }

    res.json({
      targetKm: round2(targetKm),
      paceSecPerKm: Math.round(pace),
      quota: isPro
        ? { unlimited: true as const }
        : { unlimited: false as const, used: usedThisWeek + 1, limit: cfg.FREE_ROUTE_GENERATIONS_PER_WEEK },
      missions,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/missions/evaluate
 *
 * A LASSÚ FÉL, külön kérésben. A `/generate?phase=plan` már visszaadta a
 * jelölt útvonalakat, a kártyák tehát kirajzolva állnak — ez a végpont tölti
 * ki rajtuk a terület, mező, GP és karakter mezőket.
 *
 * ⚠️ MIÉRT KÜLÖN KÉRÉS, ÉS NEM HÁTTÉRMUNKA A VÁLASZ UTÁN? Mert Cloud Runon a
 * konténer CPU-ja a válasz elküldése után nem garantáltan fut tovább — egy
 * „majd befejezem a háttérben" megoldás ott némán félbemaradna. Így minden
 * kérés önmagában zárt, nincs job-állapot, nincs poll, nincs új adatmodell.
 *
 * ⚠️ NINCS ÁLLAPOT A KÉT FÁZIS KÖZÖTT. A kliens visszaküldi a vonalláncot, és
 * a hosszt a szerver ABBÓL számolja újra — nem hisz a kliens számának. Ez nem
 * biztonsági kockázat egyébként sem (a küldetés csak ajánlat, nem ír
 * játékadatot), de így a GP-becslés sem csúszhat el egy elgépelt mezőtől.
 *
 * ⚠️ NEM FOGYASZT KVÓTÁT: azt már a `plan` fázis elszámolta. Különben egy
 * generálás kétszer terhelné a heti keretet.
 */
missionsRouter.post('/evaluate', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const input = parseEvaluateInput(req.body);

    const snapshot = await getGameplaySnapshot(new Date());
    const cfg = snapshot.config;
    const layer = layerOf(input.type);
    const today = gameDay(new Date());

    const userSnap = await db.collection(COLLECTIONS.users).doc(uid).get();
    const user = (userSnap.data() ?? {}) as { streak?: { current?: number } };

    /* A geometria — ugyanaz a `shapeCandidateCells`, mint a `full` úton. */
    const shaped: ShapedCandidate[] = [];
    for (const route of input.routes) {
      const coordinates = decodePolyline(route.polyline);
      if (coordinates.length < 2) continue;

      /*
        A hossz a VONALLÁNCBÓL, nem a kérésből. A `durationS` csak a
        szintetikus időbélyeghez kell, és a cellalánc-építés nem használja
        (lásd `routeToTracePoints`) — ezért itt a mért hosszból származó,
        nagyságrendileg helyes menetidő is elég.
      */
      const distanceKm = polylineLengthM(coordinates) / 1000;
      const points = routeToTracePoints(
        { polyline: route.polyline, distanceM: distanceKm * 1000, durationS: distanceKm * 300 },
        coordinates,
      );

      try {
        const { loopCount, cells, geometry } = shapeCandidateCells(points);
        if (loopCount === 0) continue;
        shaped.push({
          bearing: route.bearing,
          distanceKm,
          polyline: route.polyline,
          points,
          cells,
          geometry,
          uTurns: countUTurns(coordinates),
          shortDetours: countShortDetours(coordinates),
          turnCount: measureStraightness(coordinates).turnCount,
        });
      } catch {
        continue;
      }
    }

    if (shaped.length === 0) {
      res.json({ missions: [], reason: 'no_loops' });
      return;
    }

    const missions = await evaluateShapedCandidates({
      uid,
      shaped,
      layer,
      type: input.type,
      today,
      cfg,
      streakDays: Number(user.streak?.current ?? 0),
      priority: input.priority,
    });

    res.json({ missions });
  } catch (error) {
    next(error);
  }
});

/* ════════════════════════════════════════════════════════════════════════
   Segédek
   ════════════════════════════════════════════════════════════════════════ */

/** A küldetés kimeneti alakja — a `full` és az `evaluate` út UGYANEZT adja. */
interface MissionPayload {
  kind: string;
  distanceKm: number;
  polyline: string;
  areaM2: number;
  estimatedGp: number;
  cellCount: number;
  counts: { free: number; reclaimed: number; stolen: number; breakthrough: number } | null;
  newBlocks: number;
  victimName: string | null;
  victimAreaM2: number;
}

/**
 * A lánc lassú fele: birtokviszony → értékelés → válogatás → célpontnevek.
 *
 * ⚠️ EGY HELYEN VAN, SZÁNDÉKOSAN. A `full` és a `plan`+`evaluate` út
 * ugyanezt futtatja, tehát a kétféle hívás ugyanazt a küldetést adja
 * ugyanarra a jelöltre. Ha ez a rész kettéválna, a két út idővel elcsúszna,
 * és a felhasználó attól függően kapna más eredményt, hogy melyik kliens
 * verziót futtatja.
 */
async function evaluateShapedCandidates(args: {
  uid: string;
  shaped: ShapedCandidate[];
  layer: Layer;
  type: ActivityType;
  today: number;
  cfg: GameplayConfig;
  streakDays: number;
  priority: MissionInput['priority'];
}): Promise<MissionPayload[]> {
  const { uid, shaped, layer, type, today, cfg, streakDays, priority } = args;

  /* ── Birtokviszony EGY olvasásban, az összes jelöltre ────────────── */

  const affordable = limitByBlocks(shaped, layer, MAX_OWNERSHIP_BLOCKS);
  const allCells = new Set<CellId>();
  for (const candidate of affordable) for (const cell of candidate.cells) allCells.add(cell);

  const ownership = await loadOwnership(layer, allCells, today);

  /* ── Értékelés a VALÓDI motorral ─────────────────────────────────── */

  const context = {
    uid,
    layer,
    type,
    ownership,
    streakDays,
    gpEarnedToday: await dailyGpTotal(uid, today),
    cfg,
  };
  const ownedBlocks = ownedBlockIds(ownership, uid, layer);

  const candidates: MissionCandidate[] = [];
  for (const candidate of affordable) {
    const evaluated = evaluateCandidate(candidate, context, ownedBlocks);
    if (evaluated) candidates.push(evaluated);
  }

  /* ── Válogatás és a célpontok feloldása ──────────────────────────── */

  const missions = prioritizeMissions(pickMissions(candidates), priority);
  const named = await resolveVictimNames(uid, missions, today);

  return missions.map((mission) => ({
    kind: mission.kind,
    distanceKm: round2(mission.distanceKm),
    polyline: mission.polyline,
    areaM2: mission.gainedM2,
    estimatedGp: mission.estimatedGp,
    cellCount: mission.cells.size,
    counts: mission.claim?.counts ?? null,
    newBlocks: mission.newBlocks,
    /** A célpont neve CSAK publikus fióknál — lásd `resolveVictimNames`. */
    victimName: named.get(mission) ?? null,
    victimAreaM2: Math.round(mission.topVictimCells * cfg.CELL_AREA_M2),
  }));
}

/** Egy vonallánc hossza méterben — a kliens számát nem vesszük készpénznek. */
function polylineLengthM(coordinates: readonly { lat: number; lng: number }[]): number {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distanceM(coordinates[index - 1]!, coordinates[index]!);
  }
  return total;
}

interface EvaluateInput {
  type: ActivityType;
  priority: MissionInput['priority'];
  routes: { polyline: string; bearing: number }[];
}

/**
 * Az `/evaluate` bemenete.
 *
 * A `MAX_SHAPED_CANDIDATES` itt is plafon: a végpont a drága geometriát
 * futtatja, tehát nem szabad, hogy egy kérés tetszőleges sok vonallánccal
 * terhelje a szolgáltatást.
 */
function parseEvaluateInput(body: unknown): EvaluateInput {
  const raw = (body ?? {}) as Record<string, unknown>;

  const type = String(raw.type ?? 'run');
  if (type !== 'run' && type !== 'walk' && type !== 'ride') {
    throw badRequest('invalid_type', 'Ismeretlen mozgásforma.');
  }

  const priorities = new Set(['balanced', 'conquest', 'raid', 'fortify', 'explore']);
  const priority = typeof raw.priority === 'string' && priorities.has(raw.priority)
    ? raw.priority as MissionInput['priority']
    : 'balanced';

  if (!Array.isArray(raw.routes) || raw.routes.length === 0) {
    throw badRequest('invalid_routes', 'Nem érkezett kiértékelendő útvonal.');
  }

  const routes = raw.routes.slice(0, MAX_SHAPED_CANDIDATES).map((entry) => {
    const route = (entry ?? {}) as Record<string, unknown>;
    const polyline = String(route.polyline ?? '');
    if (!polyline) throw badRequest('invalid_routes', 'Hiányzik az útvonal vonallánca.');
    const bearing = Number(route.bearing);
    return {
      polyline,
      bearing: Number.isFinite(bearing) ? bearing : 0,
    };
  });

  return { type, priority, routes };
}

interface MissionInput {
  lat: number;
  lng: number;
  minutes?: number;
  distanceKm?: number;
  paceSecPerKm?: number;
  priority: 'balanced' | 'conquest' | 'raid' | 'fortify' | 'explore';
  preferredBearing?: number;
  type: ActivityType;
  /**
   * Útvonal-karakter kapcsoló (döntés: 2026-08-29). A felület sétánál nem
   * kínálja fel, de itt nincs rá külön ág — hiányzó/ismeretlen érték `twisty`.
   */
  routeCharacter: RouteCharacter;
  /**
   * Melyik fázis fusson le.
   *
   * `full` (az ALAPÉRTELMEZETT) — a teljes lánc, ahogy eddig. ⚠️ Azért ez az
   * alapértelmezés, mert a backend külön települ a klienstől: egy már
   * telepített web/iOS kliens `phase` nélkül hív, és neki továbbra is a kész
   * küldetéslistát kell megkapnia.
   *
   * `plan` — csak a GYORS fele: útvonaltervezés és cellamentes válogatás.
   * A válasz a jelölt útvonalakat adja vissza (vonallánc, hossz), terület és
   * GP nélkül; azokat a kliens a `/evaluate` végponttól kéri el utána.
   * Mérve (2026-08-29): a gyors fázis 0,5–2,2 s, míg a teljes lánc nagy
   * bringakörnél 12,7 s — a kártya tehát sokkal hamarabb kirajzolható.
   */
  phase: 'full' | 'plan';
}

function parseInput(body: unknown): MissionInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw badRequest('invalid_position', 'Hiányzik vagy hibás a szélességi fok.');
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw badRequest('invalid_position', 'Hiányzik vagy hibás a hosszúsági fok.');
  }

  /*
    SZABADON MEGADHATÓ IDŐ, nem rögzített lista.

    Korábban csak az öt előre megadott érték közül lehetett választani. A
    felület azóta egyedi megadást is enged (perc vagy óra), ezért itt
    TARTOMÁNYT ellenőrzünk, nem felsorolást. A korlátok a józan ész
    határai: öt percnél rövidebb kör nem zár be semmit, nyolc óránál
    hosszabbra pedig nem tervezünk útvonalat (a Directions is elhasalna).
  */
  const hasDistance = raw.distanceKm !== undefined;
  const minutes = Math.round(Number(raw.minutes));
  const distanceKm = Number(raw.distanceKm);
  if (hasDistance) {
    if (!Number.isFinite(distanceKm) || distanceKm < 0.5 || distanceKm > MAX_TARGET_KM) {
      throw badRequest('invalid_distance', `A célhossz 0,5 és ${MAX_TARGET_KM} km között lehet.`);
    }
  } else if (!Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    throw badRequest('invalid_minutes', `Az időkeret ${MIN_MINUTES} és ${MAX_MINUTES} perc között lehet.`);
  }

  const paceSecPerKm = raw.paceSecPerKm === undefined ? undefined : Number(raw.paceSecPerKm);
  if (paceSecPerKm !== undefined && (!Number.isFinite(paceSecPerKm) || paceSecPerKm < 60 || paceSecPerKm > 3600)) {
    throw badRequest('invalid_pace', 'A megadott átlagtempó nem reális.');
  }
  const priorities = new Set(['balanced', 'conquest', 'raid', 'fortify', 'explore']);
  const priority = typeof raw.priority === 'string' && priorities.has(raw.priority)
    ? raw.priority as MissionInput['priority']
    : 'balanced';
  const preferredBearing = raw.preferredBearing === undefined ? undefined : Number(raw.preferredBearing);
  if (preferredBearing !== undefined && (!Number.isFinite(preferredBearing) || preferredBearing < 0 || preferredBearing >= 360)) {
    throw badRequest('invalid_bearing', 'A választott irány hibás.');
  }

  const type = String(raw.type ?? 'run');
  if (type !== 'run' && type !== 'walk' && type !== 'ride') {
    throw badRequest('invalid_type', 'Ismeretlen mozgásforma.');
  }

  const routeCharacter = raw.routeCharacter === 'straight' ? 'straight' : 'twisty';
  // Ismeretlen érték = `full`: a régi kliens nem küld `phase`-t, és a teljes
  // választ várja.
  const phase = raw.phase === 'plan' ? 'plan' : 'full';

  return {
    lat,
    lng,
    ...(hasDistance ? { distanceKm } : { minutes }),
    ...(paceSecPerKm === undefined ? {} : { paceSecPerKm }),
    priority,
    ...(preferredBearing === undefined ? {} : { preferredBearing }),
    type,
    routeCharacter,
    phase,
  };
}

function orderBearings(bearings: number[], preferred?: number): number[] {
  if (preferred === undefined) return bearings;
  const distance = (bearing: number) => Math.abs(((bearing - preferred + 540) % 360) - 180);
  return [...bearings].sort((a, b) => distance(a) - distance(b));
}

function preferDirection<T extends { bearing: number }>(routes: T[], preferred?: number): T[] {
  if (preferred === undefined) return routes;
  const distance = (bearing: number) => Math.abs(((bearing - preferred + 540) % 360) - 180);
  const preferredHalf = routes.filter((route) => distance(route.bearing) <= 90);
  // Ritka úthálózatnál ne adjunk üres választ csak az irány miatt.
  return preferredHalf.length >= 3 ? preferredHalf : routes;
}

function prioritizeMissions<T extends { kind: string }>(
  missions: T[],
  priority: MissionInput['priority'],
): T[] {
  if (priority === 'balanced') return missions;
  return [...missions].sort((a, b) => Number(b.kind === priority) - Number(a.kind === priority));
}

/**
 * Az elfogadható időkeret határai percben.
 *
 * Az ALAPÉRTÉKBŐL jönnek, nem a futásidejű pillanatképből: a kérés
 * érvényessége nem függhet attól, hogy közben átállított-e valaki egy
 * konfigurációt.
 */
const MIN_MINUTES = 5;
const MAX_MINUTES = 8 * 60;

/** A legutóbbi aktivitások táv/idő párjai — ebből jön az átlagtempó. */
async function recentPaceSamples(
  uid: string,
  type: ActivityType,
  limit: number,
): Promise<{ distanceM: number; movingS: number }[]> {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.activities)
      .where('userId', '==', uid)
      .where('type', '==', type)
      .orderBy('startedAt', 'desc')
      .limit(Math.max(1, limit))
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as { distanceM?: number; movingS?: number };
      return { distanceM: Number(data.distanceM ?? 0), movingS: Number(data.movingS ?? 0) };
    });
  } catch {
    // Hiányzó index vagy átmeneti hiba: az alapértelmezett tempóval megyünk
    // tovább. Egy ajánlat rossz tempóval még mindig jobb, mint semmi.
    return [];
  }
}

async function dailyGpTotal(uid: string, today: number): Promise<number> {
  try {
    const doc = await db.collection(COLLECTIONS.dailyGp).doc(`${uid}_${today}`).get();
    return Number((doc.data() as { total?: number } | undefined)?.total ?? 0);
  } catch {
    return 0;
  }
}

/**
 * A célpontok névre oldása — ADATVÉDELMI KORLÁTTAL.
 *
 * Két szabály a docs/02-ből, és mindkettő itt, szerveroldalon dől el:
 *
 *   1. NÉV CSAK PUBLIKUS FIÓKNÁL. Privát fióknál a küldetés „egy helyi
 *      játékostól" — a terület tulajdonosa a térképen amúgy is látszik, de a
 *      küldetés nem lehet célzott zaklatási eszköz.
 *   2. UGYANAZ A SZEMÉLY NAPONTA LEGFELJEBB EGYSZER jelenhet meg célpontként.
 *      Enélkül valaki minden nap ugyanazt az egy embert kapná ajánlatként,
 *      újra és újra — az pedig nem játék, hanem üldözés.
 *
 * A tiltás mindkét iránya is kizár: akit letiltottam, és aki engem letiltott,
 * sem nevezhető meg.
 */
async function resolveVictimNames(
  uid: string,
  missions: readonly Mission[],
  today: number,
): Promise<Map<Mission, string>> {
  const names = new Map<Mission, string>();
  const targets = missions
    .map((mission) => mission.topVictimUid)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (targets.length === 0) return names;

  const unique = [...new Set(targets)];
  const ownRef = db.collection(COLLECTIONS.users).doc(uid);
  const historyRef = ownRef.collection('private').doc('missionTargets');

  const [docs, blocked, blockedBy, history] = await Promise.all([
    db.getAll(...unique.map((id) => db.collection(COLLECTIONS.users).doc(id))),
    ownRef.collection('blocks').select().get(),
    ownRef.collection('blockedBy').select().get(),
    historyRef.get(),
  ]);

  const excluded = new Set([
    ...blocked.docs.map((doc) => doc.id),
    ...blockedBy.docs.map((doc) => doc.id),
  ]);

  const stored = (history.data() ?? {}) as { day?: number; uids?: string[] };
  const namedToday = new Set(stored.day === today ? (stored.uids ?? []) : []);

  const publicNames = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data() as {
      username?: string;
      privacy?: { account?: string };
    };
    if (data.privacy?.account === 'private') continue;
    const username = String(data.username ?? '');
    if (username) publicNames.set(doc.id, username);
  }

  const namedNow: string[] = [];
  for (const mission of missions) {
    const victim = mission.topVictimUid;
    if (!victim || excluded.has(victim) || namedToday.has(victim)) continue;
    const username = publicNames.get(victim);
    if (!username) continue;
    names.set(mission, username);
    namedNow.push(victim);
  }

  if (namedNow.length > 0) {
    await historyRef.set(
      stored.day === today
        ? { day: today, uids: FieldValue.arrayUnion(...namedNow) }
        : { day: today, uids: namedNow },
      { merge: true },
    );
  }

  return names;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
