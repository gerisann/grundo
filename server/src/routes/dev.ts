import { Router } from 'express';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, forbidden, notFound } from '../lib/errors';
import type { AuthedRequest } from '../../server';
import type { ActivityAuditData } from '../lib/activityAudit';

export const devRouter = Router();

const DEV_ROLES = new Set(['owner', 'admin', 'moderator']);

devRouter.use((req: AuthedRequest, _res, next) => {
  if (!req.role || !DEV_ROLES.has(req.role)) return next(forbidden('Ez a fejlesztői felület csak adminisztrátoroknak érhető el.'));
  next();
});

devRouter.get('/activities', async (req: AuthedRequest, res, next) => {
  try {
    const requestedLimit = Number(req.query.limit ?? 30);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      throw badRequest('invalid_limit', 'A lista mérete 1 és 100 közötti egész szám lehet.');
    }

    let query = db.collection(COLLECTIONS.activities).orderBy('startedAt', 'desc').limit(requestedLimit);
    const cursor = String(req.query.cursor ?? '').trim();
    if (cursor) {
      const cursorDoc = await db.collection(COLLECTIONS.activities).doc(cursor).get();
      if (!cursorDoc.exists) throw badRequest('invalid_cursor', 'A lapozási hivatkozás már nem érvényes.');
      query = query.startAfter(cursorDoc);
    }

    const snapshot = await query.get();
    const userIds = [...new Set(snapshot.docs.map((doc) => String(doc.data().userId ?? '')).filter(Boolean))];
    const [users, audits] = await Promise.all([
      userIds.length > 0
        ? db.getAll(...userIds.map((id) => db.collection(COLLECTIONS.users).doc(id)))
        : Promise.resolve([]),
      snapshot.docs.length > 0
        ? db.getAll(...snapshot.docs.map((doc) => db.collection(COLLECTIONS.activityAudits).doc(doc.id)))
        : Promise.resolve([]),
    ]);
    const usernames = new Map(users.map((doc) => [doc.id, String(doc.data()?.username ?? 'ismeretlen')]));
    const audited = new Set(audits.filter((doc) => doc.exists).map((doc) => doc.id));

    res.json({
      activities: snapshot.docs.map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const summary = asRecord(data.summary);
        const userId = String(data.userId ?? '');
        return {
          id: doc.id,
          userId,
          username: usernames.get(userId) ?? 'ismeretlen',
          type: data.type,
          layer: data.layer,
          title: data.title ?? null,
          startedAt: toMillis(data.startedAt),
          distanceM: Number(data.distanceM ?? summary.distanceM ?? 0),
          durationS: Number(data.durationS ?? summary.durationS ?? 0),
          loops: Number(summary.loops ?? 0),
          claimedCells: Number(summary.claimedCells ?? 0),
          areaGainedM2: Number(data.areaGainedM2 ?? summary.areaGainedM2 ?? 0),
          gp: Number(asRecord(data.gp).total ?? summary.gp ?? 0),
          trustVerdict: data.trustVerdict,
          deleted: data.deletedAt != null,
          hasAudit: audited.has(doc.id),
        };
      }),
      nextCursor: snapshot.size === requestedLimit ? snapshot.docs.at(-1)?.id ?? null : null,
    });
  } catch (error) {
    next(error);
  }
});

devRouter.get('/activities/:id', async (req: AuthedRequest, res, next) => {
  try {
    const activityId = String(req.params.id);
    const activityRef = db.collection(COLLECTIONS.activities).doc(activityId);
    const [activity, track, audit] = await Promise.all([
      activityRef.get(),
      activityRef.collection('private').doc('track').get(),
      db.collection(COLLECTIONS.activityAudits).doc(activityId).get(),
    ]);
    if (!activity.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

    const data = activity.data() as Record<string, unknown>;
    const summary = asRecord(data.summary);
    const userId = String(data.userId ?? '');
    const auditData = audit.exists ? (audit.data() as unknown as ActivityAuditData) : null;
    const victimIds = auditData?.claim.victims.map((victim) => victim.userId) ?? [];
    const relatedIds = [...new Set([userId, ...victimIds].filter(Boolean))];
    const userDocs = relatedIds.length > 0
      ? await db.getAll(...relatedIds.map((id) => db.collection(COLLECTIONS.users).doc(id)))
      : [];
    const usernames = new Map(userDocs.map((doc) => [doc.id, String(doc.data()?.username ?? 'ismeretlen')]));
    const trackData = track.data() as { points?: unknown } | undefined;

    res.json({
      activity: {
        id: activity.id,
        userId,
        username: usernames.get(userId) ?? 'ismeretlen',
        type: data.type,
        layer: data.layer,
        title: data.title ?? null,
        startedAt: toMillis(data.startedAt),
        endedAt: toMillis(data.endedAt),
        distanceM: Number(data.distanceM ?? summary.distanceM ?? 0),
        durationS: Number(data.durationS ?? summary.durationS ?? 0),
        movingS: Number(data.movingS ?? summary.movingS ?? 0),
        loops: Number(summary.loops ?? 0),
        claimedCells: Number(summary.claimedCells ?? 0),
        areaGainedM2: Number(data.areaGainedM2 ?? summary.areaGainedM2 ?? 0),
        gp: Number(asRecord(data.gp).total ?? summary.gp ?? 0),
        trustVerdict: data.trustVerdict,
        deleted: data.deletedAt != null,
      },
      points: Array.isArray(trackData?.points) ? trackData.points : [],
      audit: auditData
        ? {
            ...auditData,
            claim: decorateClaim(auditData.claim, usernames),
            loops: {
              ...auditData.loops,
              successful: auditData.loops.successful.map((loop) => ({
                ...loop,
                claim: decorateClaim(loop.claim, usernames),
              })),
            },
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function decorateClaim(claim: ActivityAuditData['claim'], usernames: ReadonlyMap<string, string>) {
  return {
    ...claim,
    victims: claim.victims.map((victim) => ({
      ...victim,
      username: usernames.get(victim.userId) ?? 'ismeretlen',
    })),
  };
}

function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const stamp = value as { toMillis?: () => number } | undefined;
  return typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0;
}
