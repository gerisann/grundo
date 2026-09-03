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

/** Amit az aktivitás dokumentumából a készültséghez ki kell olvasni. */
interface ActivityState {
  userId?: string;
  summary?: unknown;
  claimStatus?: unknown;
}

/**
 * ELKÉSZÜLT-E — mert a dokumentum LÉTEZÉSE nem ugyanaz.
 *
 * ⚠️ EZ ÉLES HIBÁT OKOZOTT (2026-09-02, `ebb3c240…`, 143 km-es bringakör). A
 * darabolt úton (`activityChunked.ts`) az aktivitás dokumentuma már az első
 * fázisban létrejön, `claimStatus: 'pending'` állapotban — a `summary` viszont
 * csak a könyvzáráskor, több tranzakcióval később. A korábbi kód a puszta
 * létezést késznek vette, ezért a menet közbeni újraküldés és a
 * státuszlekérdezés is `{ status: 'done', summary: undefined }` választ kapott.
 * A kliens ezt elhitte, és az eredményképernyő `summary.distanceM`-nél
 * elszállt („undefined is not an object"), miközben a mentés valójában
 * félbemaradt.
 *
 * KÉT FELTÉTEL, mert kettő különböző hibát fog meg:
 *
 *   - `claimStatus !== 'pending'` — a darabolt mentés még dolgozik. (Az
 *     egytranzakciós gyors út nem ír ilyen mezőt: ott a dokumentum és a
 *     `summary` UGYANABBAN a tranzakcióban születik, tehát a hiánya készet
 *     jelent.)
 *   - `summary` megvan — a végső háló. Bármi is történjék, `done` választ
 *     `summary` nélkül nem adunk ki: a már telepített kliensek (jamal #29-es
 *     buildje is) kötelező mezőként olvassák.
 *
 * Éles adaton ellenőrizve (2026-09-03, mind a 45 aktivitás): egyedül a fenti,
 * beragadt kör hiányos — nincs olyan régi mentés, amit ez tévesen
 * befejezetlennek minősítene.
 */
function isSettledActivity(data: ActivityState): boolean {
  return data.claimStatus !== 'pending' && data.summary !== undefined;
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
      const data = activitySnapshot.data() as ActivityState;
      if (data.userId !== uid) return { status: 'conflict' as const };
      if (isSettledActivity(data)) return { status: 'done' as const, summary: data.summary };
      /**
       * FÉLBEMARADT DARABOLT MENTÉS — nem kész, de nem is ütközés.
       *
       * A vezérlés szándékosan ÁTESIK a lease-ágra: ha épp dolgozik rajta egy
       * másik kérés, `processing` a válasz; ha nem, a kliens megkapja a
       * feldolgozási jogot, és a `commitChunkedActivity` a hiányzó
       * csoportoktól FOLYTATJA. Enélkül a kör örökre 0 GP-vel állna.
       */
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
    const data = activitySnapshot.data() as ActivityState;
    if (data.userId !== uid) return { status: 'missing' };
    if (isSettledActivity(data)) return { status: 'done', summary: data.summary };
    // Félbemaradt mentésnél a feldolgozás állapota dönt: fut-e még valaki
    // rajta (`processing`), elhasalt-e (`failed`), vagy újraküldhető
    // (`missing`). Készként jelenteni sosem szabad — lásd `isSettledActivity`.
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
