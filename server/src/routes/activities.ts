import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, notFound } from '../lib/errors';
import { blocksFor, loadOwnership, readBlocks, writeOwnership } from '../lib/grid';
import { processActivity } from '../../../src/game';
import { layerOf } from '../../../src/game/cells';
import { GAMEPLAY } from '../../../src/config/gameplay';
import { distanceM } from '../../../src/game/geo';
import type { ActivityType, TracePoint } from '../../../src/types';
import type { AuthedRequest } from '../../server';

export const activitiesRouter = Router();

/**
 * Legfeljebb ennyi pontot fogadunk el egy aktivitásból.
 *
 * Egy négyórás bringázás másodpercenkénti mintavétellel is 14 400 pont, de a
 * szűrés után jóval kevesebb marad. A 20 000 bőven fedi a valós használatot, és
 * megvéd attól, hogy valaki egy több millió pontos kéréssel fojtsa meg a
 * szolgáltatást.
 */
const MAX_POINTS = 20_000;

/** Ennél régebbi aktivitást nem fogadunk el — az óra elállítása gyanús. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface UploadBody {
  activityId?: unknown;
  type?: unknown;
  points?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  movingMs?: unknown;
}

/**
 * POST /api/activities — egy befejezett aktivitás feldolgozása.
 *
 * A LEGFONTOSABB SZABÁLY: a klienstől érkező SEMMILYEN származtatott érték
 * nem elfogadható. A táv, a cellalánc, a bezárt terület és a pont mind itt
 * számolódik újra, a nyers nyomvonalból. A kliens ugyanezt kiszámolja, de az
 * csak előnézet — ha a kettő eltér, a szerveré az igazság.
 *
 * Ha ez nem így lenne, a foglalás egyetlen módosított kéréssel hamisítható
 * volna, és a játéknak vége.
 *
 * IDEMPOTENS: az `activityId`-t a kliens adja, még a rögzítés indulásakor. Ha
 * a hálózat elszáll és a kliens újrapróbál, ugyanaz az aktivitás nem íródik be
 * kétszer — a terület és a pont nem duplázódik.
 *
 * Ami MÉG NINCS benne (F2): Trust Score, területvesztés-események és
 * értesítések, zónák újraszámolása, előnézeti térképkép, Cloud Tasks szerinti
 * sorbaállítás. Ezek nélkül a foglalás működik, de a csalásszűrés nem.
 */
activitiesRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.uid!;
    const body = req.body as UploadBody;

    const activityId = String(body.activityId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(activityId)) {
      throw badRequest('invalid_activity_id', 'Hiányzó vagy hibás aktivitás-azonosító.');
    }

    const type = body.type as ActivityType;
    if (type !== 'run' && type !== 'walk' && type !== 'ride') {
      throw badRequest('invalid_type', 'Ismeretlen mozgásforma.');
    }

    const points = parsePoints(body.points);
    const startedAt = Number(body.startedAt);
    const endedAt = Number(body.endedAt);
    const movingMs = Math.max(0, Number(body.movingMs) || 0);

    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
      throw badRequest('invalid_time', 'Hibás időadatok.');
    }
    if (Date.now() - startedAt > MAX_AGE_MS) {
      throw badRequest('too_old', 'Ez az aktivitás túl régi ahhoz, hogy feldolgozzuk.');
    }

    const activityRef = db.collection(COLLECTIONS.activities).doc(activityId);

    /**
     * Idempotencia: ha már feldolgoztuk, a tárolt eredményt adjuk vissza.
     *
     * Fontos, hogy a MÁSÉ ne legyen visszaadható: az azonosítót a kliens
     * választja, tehát elvileg eltalálhatná valaki másét.
     */
    const existing = await activityRef.get();
    if (existing.exists) {
      const data = existing.data() as { userId?: string; summary?: unknown };
      if (data.userId !== uid) {
        throw badRequest('activity_conflict', 'Ez az azonosító már foglalt.');
      }
      return res.json({ activityId, summary: data.summary, duplicate: true });
    }

    /* ── Újraszámolás a nyers nyomvonalból ─────────────────────── */

    const serverDistanceM = totalDistance(points);
    if (serverDistanceM < GAMEPLAY.MIN_DISTANCE_M) {
      throw badRequest(
        'too_short',
        `Legalább ${GAMEPLAY.MIN_DISTANCE_M} méter kell ahhoz, hogy az aktivitás számítson.`,
      );
    }

    const layer = layerOf(type);

    // A motor csak a birtokviszonyt kapja meg kívülről; a cellaláncot maga
    // számolja. Ezért előbb egy „száraz" futtatás kell, hogy megtudjuk, mely
    // cellákat érinti — és csak azok tulajdonosát olvassuk be.
    const probe = processActivity({
      points,
      type,
      distanceKm: serverDistanceM / 1000,
      actorId: uid,
      ownership: new Map(),
      streakDays: 0,
      gpEarnedToday: 0,
    });

    const ownership = await loadOwnership(layer, probe.cellPath);

    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) throw notFound('profile_missing', 'Még nincs GRUNDO-profilod.');
    const user = userSnap.data() as {
      streak?: { current?: number };
      counters?: { activities?: number };
    };

    const result = processActivity({
      points,
      type,
      distanceKm: serverDistanceM / 1000,
      actorId: uid,
      ownership,
      streakDays: user.streak?.current ?? 0,
      // TODO(F2): a mai GP a gpLedger napi összegzéséből jöjjön — a napi
      // lágy plafon enélkül nem érvényesül.
      gpEarnedToday: 0,
    });

    const now = new Date();
    const claimUpdates = result.claim?.updates ?? new Map();
    const blockIds = [...blocksFor(layer, claimUpdates.keys()).keys()];

    const summary = {
      distanceM: Math.round(serverDistanceM),
      durationS: Math.round((endedAt - startedAt) / 1000),
      movingS: Math.round(movingMs / 1000),
      cellCount: result.cellPath.length,
      loops: result.loops.length,
      claimedCells: result.claimedCells.size,
      areaGainedM2: result.areaGainedM2,
      gp: result.gp.total,
    };

    await db.runTransaction(async (tx) => {
      // MINDEN olvasás az írások ELŐTT — a Firestore ezt megköveteli.
      const blocks = await readBlocks(tx, blockIds);

      if (claimUpdates.size > 0) {
        writeOwnership(tx, layer, claimUpdates, blocks, now);
      }

      tx.set(activityRef, {
        userId: uid,
        type,
        layer,
        startedAt: new Date(startedAt),
        endedAt: new Date(endedAt),
        distanceM: summary.distanceM,
        durationS: summary.durationS,
        movingS: summary.movingS,
        areaGainedM2: result.areaGainedM2,
        gp: result.gp,
        cellCount: result.cellPath.length,
        pointCount: points.length,
        summary,
        bounds: boundsOf(points),
        visibility: 'everyone',
        createdAt: now,
      });

      /**
       * A TELJES nyomvonal külön aldokumentumba megy.
       *
       * A Firestore-szabályok nem tudnak mezőszinten szűrni: ha a nyomvonal az
       * aktivitás dokumentumában lenne, akkor vagy mindenki látná a pontos
       * lakcímedet, vagy senki nem látná az aktivitást.
       */
      tx.set(activityRef.collection('private').doc('track'), {
        points,
        createdAt: now,
      });

      tx.set(
        db.collection(COLLECTIONS.gpLedger).doc(),
        { userId: uid, activityId, gp: result.gp, createdAt: now },
      );

      tx.set(
        userRef,
        {
          gpTotal: FieldValue.increment(result.gp.total),
          gpWeek: FieldValue.increment(result.gp.total),
          gpMonth: FieldValue.increment(result.gp.total),
          [`territoryM2.${layer}`]: FieldValue.increment(result.areaGainedM2),
          [`cellCount.${layer}`]: FieldValue.increment(result.claimedCells.size),
          'counters.activities': FieldValue.increment(1),
          [`counters.distanceKm.${type}`]: FieldValue.increment(serverDistanceM / 1000),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    res.status(201).json({ activityId, summary });
  } catch (error) {
    next(error);
  }
});

/** GET /api/activities/:id/track — a teljes nyomvonal, csak a tulajdonosnak. */
activitiesRouter.get('/:id/track', async (req: AuthedRequest, res, next) => {
  try {
    const ref = db.collection(COLLECTIONS.activities).doc(String(req.params.id));
    const snapshot = await ref.get();
    if (!snapshot.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    if ((snapshot.data() as { userId?: string }).userId !== req.uid) {
      throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    }
    const track = await ref.collection('private').doc('track').get();
    res.json({ points: track.exists ? (track.data() as { points: TracePoint[] }).points : [] });
  } catch (error) {
    next(error);
  }
});

/** POST /api/activities/:id/report — bejelentés (technikai vagy tartalmi ág). */
activitiesRouter.post('/:id/report', async (_req: AuthedRequest, res) => {
  res.status(501).json({ message: 'Még nincs implementálva.' });
});

/* ═══════════════════════════════════════════════════════════════════
   Segédek
   ═══════════════════════════════════════════════════════════════════ */

function parsePoints(raw: unknown): TracePoint[] {
  if (!Array.isArray(raw)) throw badRequest('invalid_points', 'Hiányzó nyomvonal.');
  if (raw.length < 2) throw badRequest('invalid_points', 'A nyomvonal túl rövid.');
  if (raw.length > MAX_POINTS) throw badRequest('too_many_points', 'A nyomvonal túl hosszú.');

  const points: TracePoint[] = [];
  let previousT = -Infinity;

  for (const item of raw) {
    const p = item as Partial<TracePoint>;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const t = Number(p.t);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw badRequest('invalid_points', 'Hibás koordináta a nyomvonalban.');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw badRequest('invalid_points', 'Hibás koordináta a nyomvonalban.');
    }
    // A növekvő idő nem formaság: erre épül a hurokfelismerés és a
    // sebességszámítás. Rendezetlen nyomvonalból értelmetlen terület jönne.
    if (!Number.isFinite(t) || t < previousT) {
      throw badRequest('invalid_points', 'A nyomvonal időrendje hibás.');
    }
    previousT = t;

    points.push({
      lat,
      lng,
      t,
      ...(Number.isFinite(Number(p.accuracy)) ? { accuracy: Number(p.accuracy) } : {}),
      ...(Number.isFinite(Number(p.elevation)) ? { elevation: Number(p.elevation) } : {}),
    });
  }

  return points;
}

function totalDistance(points: readonly TracePoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += distanceM(points[i - 1]!, points[i]!);
  }
  return sum;
}

function boundsOf(points: readonly TracePoint[]) {
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of points) {
    if (p.lat > north) north = p.lat;
    if (p.lat < south) south = p.lat;
    if (p.lng > east) east = p.lng;
    if (p.lng < west) west = p.lng;
  }
  return { north, south, east, west };
}
