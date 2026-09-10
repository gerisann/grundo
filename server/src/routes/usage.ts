/** Előtérben töltött app-idő, idempotens munkamenet-számlálóval. */
import { Router } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { AuthedRequest } from '../../server';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest } from '../lib/errors';
import { GAME_TIMEZONE, gameDay, localHour } from '../lib/gridMath';

export const usageRouter = Router();
const SESSION_ID = /^[a-zA-Z0-9-]{16,80}$/;
const MAX_HEARTBEAT_MS = 90_000;

export function acceptedUsageDelta(input: {
  totalActiveMs: number;
  previousTotalMs: number;
  serverElapsedMs: number | null;
}): number {
  const claimed = Math.max(0, input.totalActiveMs - input.previousTotalMs);
  const plausible = input.serverElapsedMs == null
    ? MAX_HEARTBEAT_MS
    : Math.max(MAX_HEARTBEAT_MS, input.serverElapsedMs + 10_000);
  return Math.round(Math.min(claimed, plausible));
}

usageRouter.post('/heartbeat', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.uid!;
    const sessionId = String(req.body?.sessionId ?? '');
    const totalActiveMs = Number(req.body?.totalActiveMs);
    const platform = String(req.body?.platform ?? 'unknown').slice(0, 16);
    if (!SESSION_ID.test(sessionId)) {
      throw badRequest('invalid_usage_session', 'Érvénytelen használati munkamenet.');
    }
    if (!Number.isFinite(totalActiveMs) || totalActiveMs < 0 || totalActiveMs > 7 * 86_400_000) {
      throw badRequest('invalid_usage_duration', 'Érvénytelen használati idő.');
    }

    const now = new Date();
    const nowTs = Timestamp.fromDate(now);
    const day = gameDay(now);
    const hour = localHour(now, GAME_TIMEZONE);
    const hourKey = `${day}_${hour}`;
    const receiptRef = db.collection(COLLECTIONS.appUsageReceipts).doc(`${uid}_${sessionId}`);
    const hourlyRef = db.collection(COLLECTIONS.appUsageHourly).doc(`${hourKey}_${uid}`);
    const dailyRef = db.collection(COLLECTIONS.appUsageDaily).doc(`${day}_${uid}`);
    const totalRef = db.collection(COLLECTIONS.appUsageTotals).doc(uid);

    const acceptedMs = await db.runTransaction(async (tx) => {
      const receipt = await tx.get(receiptRef);
      const previous = receipt.data() as {
        totalActiveMs?: number;
        updatedAt?: Timestamp;
        lastHourKey?: string;
      } | undefined;
      const previousTotalMs = Number(previous?.totalActiveMs ?? 0);
      const previousAt = previous?.updatedAt?.toMillis?.() ?? null;
      const delta = acceptedUsageDelta({
        totalActiveMs,
        previousTotalMs,
        serverElapsedMs: previousAt == null ? null : Math.max(0, now.getTime() - previousAt),
      });

      tx.set(receiptRef, {
        uid,
        sessionId,
        totalActiveMs: Math.max(previousTotalMs, totalActiveMs),
        updatedAt: nowTs,
        lastHourKey: hourKey,
        platform,
      }, { merge: true });

      if (delta > 0) {
        const common = {
          uid,
          platform,
          durationMs: FieldValue.increment(delta),
          lastSeenAt: nowTs,
        };
        tx.set(hourlyRef, {
          ...common,
          day,
          hour,
          sessions: FieldValue.increment(previous?.lastHourKey === hourKey ? 0 : 1),
        }, { merge: true });
        tx.set(dailyRef, { ...common, day }, { merge: true });
        tx.set(totalRef, { ...common }, { merge: true });
      }
      return delta;
    });

    res.json({ ok: true, acceptedMs });
  } catch (error) {
    next(error);
  }
});

interface UsageDoc {
  uid?: string;
  day?: number;
  hour?: number;
  durationMs?: number;
}

export async function readAdminUsageOverview(now = new Date()) {
  const today = gameDay(now);
  const firstDay = today - 29;
  const [dailySnap, hourlySnap, totalsSnap] = await Promise.all([
    db.collection(COLLECTIONS.appUsageDaily).where('day', '>=', firstDay).get(),
    db.collection(COLLECTIONS.appUsageHourly).where('day', '==', today).get(),
    db.collection(COLLECTIONS.appUsageTotals).get(),
  ]);

  const dailyDocs = dailySnap.docs.map((doc) => doc.data() as UsageDoc);
  const hourlyDocs = hourlySnap.docs.map((doc) => doc.data() as UsageDoc);
  const totalDocs = totalsSnap.docs.map((doc) => ({ uid: doc.id, ...(doc.data() as UsageDoc) }));
  const period = (fromDay: number, docs = dailyDocs) => {
    const selected = docs.filter((doc) => Number(doc.day) >= fromDay);
    return {
      durationMs: selected.reduce((sum, doc) => sum + Number(doc.durationMs ?? 0), 0),
      activeUsers: new Set(selected.map((doc) => doc.uid).filter(Boolean)).size,
    };
  };
  const all = {
    durationMs: totalDocs.reduce((sum, doc) => sum + Number(doc.durationMs ?? 0), 0),
    activeUsers: totalDocs.filter((doc) => Number(doc.durationMs ?? 0) > 0).length,
  };

  const daily = Array.from({ length: 30 }, (_, index) => {
    const day = firstDay + index;
    const selected = dailyDocs.filter((doc) => doc.day === day);
    return {
      day,
      durationMs: selected.reduce((sum, doc) => sum + Number(doc.durationMs ?? 0), 0),
      activeUsers: new Set(selected.map((doc) => doc.uid).filter(Boolean)).size,
    };
  });
  const todayHours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    durationMs: hourlyDocs
      .filter((doc) => doc.hour === hour)
      .reduce((sum, doc) => sum + Number(doc.durationMs ?? 0), 0),
    activeUsers: new Set(hourlyDocs.filter((doc) => doc.hour === hour).map((doc) => doc.uid).filter(Boolean)).size,
  }));

  const userIds = [...new Set(hourlyDocs.map((doc) => doc.uid).filter((uid): uid is string => Boolean(uid)))];
  const userSnaps = userIds.length > 0
    ? await db.getAll(...userIds.map((uid) => db.collection(COLLECTIONS.users).doc(uid)))
    : [];
  const names = new Map(userSnaps.map((snap) => {
    const data = snap.data() as { displayName?: string; username?: string } | undefined;
    return [snap.id, data?.displayName || data?.username || snap.id] as const;
  }));
  const todayUsers = userIds.map((uid) => {
    const docs = hourlyDocs.filter((doc) => doc.uid === uid);
    const hours = Array.from({ length: 24 }, (_, hour) =>
      docs.filter((doc) => doc.hour === hour).reduce((sum, doc) => sum + Number(doc.durationMs ?? 0), 0));
    return { uid, name: names.get(uid) ?? uid, durationMs: hours.reduce((a, b) => a + b, 0), hours };
  }).sort((a, b) => b.durationMs - a.durationMs);

  return {
    generatedAt: now.toISOString(),
    today,
    periods: { day: period(today), week: period(today - 6), month: period(firstDay), all },
    daily,
    todayHours,
    todayUsers,
  };
}
