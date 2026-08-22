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

    const isPro = user.pro?.active === true;
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
    const targetKm = targetDistanceKm(input.minutes, pace, cfg);

    /* ── 2. Kör-jelöltek nyolc irányban ─────────────────────────────── */

    const origin = { lat: input.lat, lng: input.lng };
    const profile = directionsProfile(input.type);
    const routes = await Promise.all(
      missionBearings(cfg).map(async (bearing) => {
        const waypoints = loopWaypoints(origin, bearing, targetKm, cfg);
        const route = await planLoop(origin, waypoints, profile);
        return route ? { bearing, route } : null;
      }),
    );

    /* ── 3. Geometria: melyik jelölt mely cellákat zárja be? ────────── */

    const shaped: ShapedCandidate[] = [];
    for (const entry of routes) {
      if (!entry) continue;
      const distanceKm = entry.route.distanceM / 1000;
      // A célhossztól túl messze eső ajánlat nem az, amit a felhasználó kért.
      if (!withinTolerance(distanceKm, targetKm, cfg)) continue;

      const coordinates = decodePolyline(entry.route.polyline);
      if (coordinates.length < 2) continue;
      const points = routeToTracePoints(entry.route, coordinates);

      try {
        const { path } = traceToCellPath(points);
        const loops = detectLoopsDetailed(path).loops;
        if (loops.length === 0) continue; // nem zár kört: nincs mit ajánlani

        const cells = new Set<CellId>();
        for (const loop of loops) for (const cell of loopCells(loop)) cells.add(cell);
        shaped.push({ bearing: entry.bearing, distanceKm, polyline: entry.route.polyline, points, cells });
      } catch {
        // Túl nagy hurok (`LoopTooLargeError`) vagy hibás geometria: kimarad.
        continue;
      }
    }

    if (shaped.length === 0) {
      res.json({ missions: [], targetKm: round2(targetKm), paceSecPerKm: Math.round(pace), reason: 'no_loops' });
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

  const minutes = Number(raw.minutes);
  if (!GAMEPLAY_MINUTES.includes(minutes)) {
    throw badRequest('invalid_minutes', 'Ismeretlen időkeret.');
  }

  const type = String(raw.type ?? 'run');
  if (type !== 'run' && type !== 'walk' && type !== 'ride') {
    throw badRequest('invalid_type', 'Ismeretlen mozgásforma.');
  }

  return { lat, lng, minutes, type };
}

/**
 * A választható időkeretek — a bemenet ellenőrzéséhez.
 *
 * Az ALAPÉRTÉKBŐL jön, nem a futásidejű pillanatképből: a kérés érvényessége
 * nem függhet attól, hogy közben átállított-e valaki egy konfigurációt.
 */
const GAMEPLAY_MINUTES: readonly number[] = [15, 30, 45, 60, 90];

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
