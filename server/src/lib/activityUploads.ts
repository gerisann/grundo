/**
 * A hosszú aktivitásfeldolgozás szerveroldali életjele.
 *
 * Az aktivitás dokumentuma csak a geometria kiszámítása után jön létre. Egy
 * megszakadt HTTP-kapcsolatból ezért önmagában nem derül ki, hogy a kérés el
 * sem jutott a szerverig, vagy a szerver tovább dolgozik rajta. Ez a külön,
 * server-only dokumentum kizárólag ezt a két állapotot választja szét; sem a
 * geometriát, sem birtokviszonyt nem tartalmaz és nem véglegesít.
 */

import { randomUUID } from 'node:crypto';
import { COLLECTIONS, db } from './firebase';

/** A Cloud Run 15 perces kéréskorlátjánál szándékosan hosszabb. */
export const ACTIVITY_UPLOAD_LEASE_MS = 30 * 60 * 1000;

export type BeginActivityUploadResult =
  | { status: 'acquired'; token: string }
  | { status: 'processing' }
  | { status: 'done'; summary: unknown }
  | { status: 'conflict' };

export type ActivityUploadStatus =
  | { status: 'missing' }
  | { status: 'processing' }
  | { status: 'failed'; message: string; retryable: boolean }
  | { status: 'done'; summary: unknown };

function refs(activityId: string) {
  return {
    activity: db.collection(COLLECTIONS.activities).doc(activityId),
    upload: db.collection(COLLECTIONS.activityUploads).doc(activityId),
  };
}

/**
 * Egyetlen feldolgozó kapja meg ugyanazt az azonosítót.
 *
 * A lejárt lease átvehető: így egy konténerleállás nem hagy örökre beragadt
 * mentést. A végleges aktivitást ugyanebben a tranzakcióban ellenőrizzük,
 * ezért a státuszjelző sosem írhatja felül a már elkészült eredményt.
 */
export async function beginActivityUpload(
  activityId: string,
  uid: string,
  now = Date.now(),
): Promise<BeginActivityUploadResult> {
  const { activity, upload } = refs(activityId);
  const token = randomUUID();
  return db.runTransaction(async (tx) => {
    const [activitySnapshot, uploadSnapshot] = await Promise.all([
      tx.get(activity),
      tx.get(upload),
    ]);

    if (activitySnapshot.exists) {
      const data = activitySnapshot.data() as { userId?: string; summary?: unknown };
      return data.userId === uid
        ? { status: 'done' as const, summary: data.summary }
        : { status: 'conflict' as const };
    }

    if (uploadSnapshot.exists) {
      const data = uploadSnapshot.data() as {
        userId?: string;
        status?: string;
        leaseUntil?: number;
      };
      if (data.userId !== uid) return { status: 'conflict' as const };
      if (data.status === 'processing' && Number(data.leaseUntil ?? 0) > now) {
        return { status: 'processing' as const };
      }
    }

    tx.set(upload, {
      userId: uid,
      status: 'processing',
      startedAt: now,
      updatedAt: now,
      leaseUntil: now + ACTIVITY_UPLOAD_LEASE_MS,
      token,
    });
    return { status: 'acquired' as const, token };
  });
}

export async function completeActivityUpload(activityId: string, token: string): Promise<void> {
  const ref = refs(activityId).upload;
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.data()?.token === token) tx.delete(ref);
  });
}

export async function failActivityUpload(
  activityId: string,
  uid: string,
  token: string,
  error: { message: string; retryable: boolean },
): Promise<void> {
  const now = Date.now();
  const ref = refs(activityId).upload;
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.data()?.token !== token) return;
    tx.set(ref, {
      userId: uid,
      status: 'failed',
      message: error.message,
      retryable: error.retryable,
      updatedAt: now,
      leaseUntil: now,
      token,
    });
  });
}

/** A kliens csak a saját mentésének durva állapotát kapja meg. */
export async function readActivityUploadStatus(
  activityId: string,
  uid: string,
  now = Date.now(),
): Promise<ActivityUploadStatus> {
  const { activity, upload } = refs(activityId);
  const [activitySnapshot, uploadSnapshot] = await Promise.all([
    activity.get(),
    upload.get(),
  ]);

  if (activitySnapshot.exists) {
    const data = activitySnapshot.data() as { userId?: string; summary?: unknown };
    return data.userId === uid
      ? { status: 'done', summary: data.summary }
      : { status: 'missing' };
  }
  if (!uploadSnapshot.exists) return { status: 'missing' };

  const data = uploadSnapshot.data() as {
    userId?: string;
    status?: string;
    message?: string;
    retryable?: boolean;
    leaseUntil?: number;
  };
  if (data.userId !== uid) return { status: 'missing' };
  if (data.status === 'processing') {
    if (Number(data.leaseUntil ?? 0) > now) return { status: 'processing' };
    // Nem töröljük itt: egy épp induló új POST már átvehette és felülírhatta
    // a lease-t. A következő `beginActivityUpload` tranzakciósan írja felül a
    // lejárt dokumentumot, versenyhelyzet nélkül.
    return { status: 'missing' };
  }
  if (data.status === 'failed') {
    return {
      status: 'failed',
      message: data.message || 'A mentés feldolgozása megszakadt.',
      retryable: data.retryable !== false,
    };
  }
  return { status: 'missing' };
}
