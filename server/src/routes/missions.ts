import { Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, HttpError } from '../lib/errors';
import { gameDay, loadOwnership, weekOf } from '../lib/grid';
import { getGameplaySnapshot } from '../lib/gameplayConfig';
import { directionsConfigured, planLoop, routeToTracePoints } from '../lib/directions';
import {
  evaluateCandidate,
  limitByBlocks,
  ownedBlockIds,
  MAX_OWNERSHIP_BLOCKS,
  type ShapedCandidate,
} from '../lib/missionEvaluate';
import { decodePolyline } from '../../../src/game/polyline';
import { layerOf, traceToCellPath } from '../../../src/game/cells';
import { detectLoopsDetailed, loopCells } from '../../../src/game/loops';
import { countUTurns } from '../../../src/game/routeShape';
import {
  averagePaceSecPerKm,
  directionsProfile,
  loopWaypoints,
  missionBearings,
  pickMissions,
  targetDistanceKm,
  withinTolerance,
  type Mission,
  type MissionCandidate,
} from '../../../src/game/missions';
import type { ActivityType, CellId } from '../../../src/types';
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
 * 24 km-es már 116 000-et. Bringával a nyolcórás felső időkeret 170 km
 * fölötti kört jelentene — az több millió cella, jelöltenként, nyolcszor.
 * A `LoopTooLargeError` ezt elkapná, de csak azután, hogy elpazaroltuk rá a
 * memóriát és a másodperceket.
 *
 * 50 km egy hosszú, de valós bringakör; gyalog elérhetetlen, tehát futásra
 * és sétára ez a korlát sosem aktiválódik.
 */
const MAX_TARGET_KM = 50;

/**
 * POST /api/missions/generate
 *
 * A küldetés-ajánló. NEM útvonaltervező: a bemenet IDŐ, nem távolság, a
 * kimenet pedig játékbeli tét.
 *
 *   { lat, lng, minutes: 45, type: 'run' }
 *   → 3–4 küldetés: Hódítás · Rajtaütés · Erősítés · Felfedezés
 *
 * A MENET (docs/02-funkcionalis-spec.md → Küldetés-ajánló):
 *   1. célhossz a felhasználó SAJÁT átlagtempójából
 *   2. kör-jelöltek nyolc irányban, valódi úthálózaton (Mapbox Directions)
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
    const pace = measuredPace ?? cfg.MISSION_DEFAULT_PACE_S_PER_KM[input.type];
    // A plafon teljesítményi védelem — lásd `MAX_TARGET_KM`. A felület a
    // ténylegesen használt célhosszt írja ki, tehát a vágás nem néma.
    const targetKm = Math.min(targetDistanceKm(input.minutes, pace, cfg), MAX_TARGET_KM);

    /* ── 2. Kör-jelöltek nyolc irányban ─────────────────────────────── */

    const origin = { lat: input.lat, lng: input.lng };
    const profile = directionsProfile(input.type);
    const bearings = missionBearings(cfg);

    const planAt = async (bearing: number, wantedKm: number) => {
      const waypoints = loopWaypoints(origin, bearing, wantedKm, cfg);
      const route = await planLoop(origin, waypoints, profile);
      return route ? { bearing, route } : null;
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

    const secondPass = await Promise.all(
      firstPass.map(async (entry, index) => {
        if (!entry) return null;
        const km = entry.route.distanceM / 1000;
        if (!(km > 0) || withinTolerance(km, targetKm, cfg)) return null;
        // A sugár lineárisan hat a kerületre, tehát ez az arány közvetlenül
        // a korrigált célhossz.
        return planAt(bearings[index]!, targetKm * (targetKm / km));
      }),
    );

    /** Irányonként a célhosszhoz KÖZELEBBI változat nyer. */
    const relativeError = (km: number) => Math.abs(km - targetKm) / targetKm;
    const best = bearings.map((_, index) => {
      const a = firstPass[index];
      const b = secondPass[index];
      if (!a) return b ?? null;
      if (!b) return a;
      return relativeError(b.route.distanceM / 1000) < relativeError(a.route.distanceM / 1000)
        ? b
        : a;
    });

    /* ── 3. Geometria: melyik jelölt mely cellákat zárja be? ────────── */

    /** Diagnosztika: az üres válasz OKA — enélkül nem lehet hangolni. */
    let routesReturned = 0;
    let closedLoops = 0;

    const withLoops: (ShapedCandidate & { error: number })[] = [];
    for (const entry of best) {
      if (!entry) continue;
      routesReturned += 1;

      const distanceKm = entry.route.distanceM / 1000;
      const coordinates = decodePolyline(entry.route.polyline);
      if (coordinates.length < 2) continue;
      const points = routeToTracePoints(entry.route, coordinates);

      try {
        const { path } = traceToCellPath(points);
        const loops = detectLoopsDetailed(path).loops;
        if (loops.length === 0) continue; // nem zár kört: nincs mit ajánlani
        closedLoops += 1;

        const cells = new Set<CellId>();
        for (const loop of loops) for (const cell of loopCells(loop)) cells.add(cell);
        withLoops.push({
          bearing: entry.bearing,
          distanceKm,
          polyline: entry.route.polyline,
          points,
          cells,
          // Az útvonal ALAKJA — ezzel bontja fel a válogatás a döntetlent, hogy
          // ne egy mellékutcákba beszaladgáló kör kerüljön a kártyára.
          uTurns: countUTurns(coordinates),
          error: relativeError(distanceKm),
        });
      } catch {
        // Túl nagy hurok (`LoopTooLargeError`) vagy hibás geometria: kimarad.
        continue;
      }
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
    const inTolerance = withLoops.filter((candidate) => candidate.error <= cfg.MISSION_DISTANCE_TOLERANCE);
    const usable = inTolerance.length > 0
      ? inTolerance
      : withLoops
          .filter((candidate) => candidate.error <= MAX_FALLBACK_ERROR)
          .sort((a, b) => a.error - b.error)
          .slice(0, FALLBACK_LIMIT);

    const shaped: ShapedCandidate[] = usable.map(({ error: _error, ...candidate }) => candidate);

    if (shaped.length === 0) {
      res.json({
        missions: [],
        targetKm: round2(targetKm),
        paceSecPerKm: Math.round(pace),
        /*
          A KÉT OK KÜLÖNVÁLASZTVA. Korábban mindkettő `no_loops` volt, és
          emiatt nem lehetett megmondani, hogy az úthálózat nem ad kört,
          vagy csak rossz méretűt kértünk — ez a hangolást lehetetlenné tette.
        */
        reason: routesReturned === 0 ? 'no_routes' : closedLoops === 0 ? 'no_loops' : 'no_fit',
        diagnostics: { routesReturned, closedLoops, bearings: bearings.length },
      });
      return;
    }

    /* ── 4. Birtokviszony EGY olvasásban, az összes jelöltre ────────── */

    const affordable = limitByBlocks(shaped, layer, MAX_OWNERSHIP_BLOCKS);
    const allCells = new Set<CellId>();
    for (const candidate of affordable) for (const cell of candidate.cells) allCells.add(cell);

    const ownership = await loadOwnership(layer, allCells, today);

    /* ── 5. Értékelés a VALÓDI motorral ─────────────────────────────── */

    const context = {
      uid,
      layer,
      type: input.type,
      ownership,
      streakDays: Number(user.streak?.current ?? 0),
      gpEarnedToday: await dailyGpTotal(uid, today),
      cfg,
    };
    const ownedBlocks = ownedBlockIds(ownership, uid, layer);

    const candidates: MissionCandidate[] = [];
    for (const candidate of affordable) {
      const evaluated = evaluateCandidate(candidate, context, ownedBlocks);
      if (evaluated) candidates.push(evaluated);
    }

    /* ── 6. Válogatás és a célpontok feloldása ──────────────────────── */

    const missions = pickMissions(candidates);
    const named = await resolveVictimNames(uid, missions, today);

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
      missions: missions.map((mission) => ({
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
      })),
    });
  } catch (error) {
    next(error);
  }
});

/* ════════════════════════════════════════════════════════════════════════
   Segédek
   ════════════════════════════════════════════════════════════════════════ */

interface MissionInput {
  lat: number;
  lng: number;
  minutes: number;
  type: ActivityType;
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
  const minutes = Math.round(Number(raw.minutes));
  if (!Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    throw badRequest(
      'invalid_minutes',
      `Az időkeret ${MIN_MINUTES} és ${MAX_MINUTES} perc között lehet.`,
    );
  }

  const type = String(raw.type ?? 'run');
  if (type !== 'run' && type !== 'walk' && type !== 'ride') {
    throw badRequest('invalid_type', 'Ismeretlen mozgásforma.');
  }

  return { lat, lng, minutes, type };
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
