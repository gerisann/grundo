import { Router, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, conflict, notFound } from '../lib/errors';
import { normalizeUsername } from '../lib/user';
import { toEarnedBadges } from '../lib/badges';
import type { AuthedRequest } from '../../server';

/**
 * Nyilvános felhasználói profil és közösségi gráf.
 *
 * MIÉRT SZERVEROLDALON, ha a `firestore.rules` a `following`/`followers`
 * alkollekciókat amúgy is olvashatóvá teszi? Mert egy követés HÁROM
 * dokumentumot érint (a két él és a két számláló), és ezeknek együtt kell
 * megváltozniuk. A szabályok ezt ki is mondják: a gráfot `allow write: if
 * false` védi, a számlálók pedig a `users/{uid}` szerveroldali mezői közé
 * tartoznak (docs/05 → `counters`).
 *
 * A felhasználót a FELHASZNÁLÓNÉV azonosítja az URL-ben, nem az uid — a
 * profil címe így megosztható és felismerhető (`/felhasznalo/geri`). A
 * feloldás a `usernames/{kisbetűs}` dokumentumon megy, ugyanazon a kulcson,
 * amit a regisztráció foglal le.
 */
export const usersRouter = Router();

/** A bejelentés kategóriái és az az ág, ahová a moderációban kerülnek. */
const REPORT_BRANCH = {
  gps_spoof: 'technical',
  vehicle: 'technical',
  wrong_type: 'technical',
  offensive: 'content',
  privacy: 'content',
  other: 'content',
} as const;

type ReportCategory = keyof typeof REPORT_BRANCH;

/** Egy bejelentés indoklása legfeljebb ennyi karakter. */
const NOTE_MAX = 500;

interface Target {
  uid: string;
  data: Record<string, unknown>;
}

/**
 * Feloldja a felhasználónevet, és eldönti, láthatja-e egyáltalán a kérő.
 *
 * A TILTÁS KÉTIRÁNYÚ, de a két irány NEM ugyanaz a válasz:
 *   - ha a MÁSIK tiltott le engem → 404, mintha nem is létezne. Egy „tiltott
 *     vagy" üzenet maga is információ, amit nem tartozik megtudnia.
 *   - ha ÉN tiltottam le őt → látom a fejlécet és a tiltás tényét, különben
 *     nem tudnám visszavonni.
 */
async function resolveTarget(username: string, viewerUid: string): Promise<Target> {
  const key = normalizeUsername(username);
  if (!key) throw badRequest('invalid_username', 'Hiányzik a felhasználónév.');

  const nameDoc = await db.collection(COLLECTIONS.usernames).doc(key).get();
  const uid = nameDoc.exists ? String((nameDoc.data() as { uid?: string }).uid ?? '') : '';
  if (!uid) throw notFound('user_not_found', 'Nincs ilyen felhasználó.');

  const userDoc = await db.collection(COLLECTIONS.users).doc(uid).get();
  if (!userDoc.exists) throw notFound('user_not_found', 'Nincs ilyen felhasználó.');

  const blockedByThem = await db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .collection('blocks')
    .doc(viewerUid)
    .get();
  if (blockedByThem.exists) throw notFound('user_not_found', 'Nincs ilyen felhasználó.');

  return { uid, data: userDoc.data() as Record<string, unknown> };
}

/** A kérő és a cél viszonya — a felület ebből tudja, melyik gomb kell. */
async function readRelationship(viewerUid: string, targetUid: string) {
  if (viewerUid === targetUid) {
    return { self: true, following: false, followedBy: false, requested: false, blocked: false };
  }
  const users = db.collection(COLLECTIONS.users);
  const [following, followedBy, requested, blocked] = await Promise.all([
    users.doc(viewerUid).collection('following').doc(targetUid).get(),
    users.doc(viewerUid).collection('followers').doc(targetUid).get(),
    db.collection(COLLECTIONS.followRequests).doc(targetUid).collection('items').doc(viewerUid).get(),
    users.doc(viewerUid).collection('blocks').doc(targetUid).get(),
  ]);
  return {
    self: false,
    following: following.exists,
    followedBy: followedBy.exists,
    requested: requested.exists,
    blocked: blocked.exists,
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function millis(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value) {
    return (value as { toMillis(): number }).toMillis();
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   GET /api/users/:username — a nyilvános profil
   ═══════════════════════════════════════════════════════════════════ */

usersRouter.get('/:username', async (req: AuthedRequest, res: Response, next) => {
  try {
    const viewerUid = req.uid!;
    const target = await resolveTarget(String(req.params.username ?? ""), viewerUid);
    const relationship = await readRelationship(viewerUid, target.uid);
    const data = target.data;

    /**
     * A jelvények FÜGGETLENEK a privát fiók korlátozásától.
     *
     * A `firestore.rules` a `users/{uid}/badges` alkollekciót külön, feltétel
     * nélkül olvashatóvá teszi (`allow read: if signedIn()`) — nem esik az
     * `account: 'private'` kapu alá, amit a fejléc lentebb ellenőriz. Ez
     * szándékos elválasztás a sémában: a jelvény elismerés, nem
     * tevékenységi adat, tehát privát fiókon is látszik.
     */
    const badgesSnapshot = await db.collection(COLLECTIONS.users).doc(target.uid).collection('badges').get();
    const badges = toEarnedBadges(badgesSnapshot);

    /**
     * A FEJLÉC MINDIG LÁTSZIK, a többi nem feltétlenül.
     *
     * Privát fióknál (docs/02 → „Privát fióknál csak a fejléc látszik") és
     * általam letiltott felhasználónál csak ennyi megy ki. Ez nem ugyanaz,
     * mint a 404: itt a felhasználó LÉTEZIK, csak nem osztja meg magát — a
     * felületnek meg kell tudnia mutatni a Követés kérése gombot.
     */
    const header = {
      uid: target.uid,
      username: String(data.username ?? ''),
      usernameLower: String(data.usernameLower ?? ''),
      photoURL: (data.photoURL as string | null) ?? null,
      memberSince: millis(data.createdAt),
      pro: { active: Boolean((data.pro as { active?: boolean } | undefined)?.active) },
      account: (data.privacy as { account?: string } | undefined)?.account === 'private'
        ? ('private' as const)
        : ('public' as const),
      badges,
    };

    const restricted =
      relationship.blocked || (header.account === 'private' && !relationship.self && !relationship.following);

    if (restricted) {
      return res.json({ profile: header, relationship, restricted: true });
    }

    const counters = (data.counters ?? {}) as Record<string, unknown>;
    const distanceKm = (counters.distanceKm ?? {}) as Record<string, unknown>;
    const streak = (data.streak ?? {}) as Record<string, unknown>;

    res.json({
      profile: {
        ...header,
        bio: (data.bio as string | undefined) ?? null,
        city: (data.city as string | undefined) ?? null,
        countryCode: (data.countryCode as string | undefined) ?? null,
        gpTotal: num(data.gpTotal),
        territoryM2: {
          foot: num((data.territoryM2 as Record<string, unknown> | undefined)?.foot),
          bike: num((data.territoryM2 as Record<string, unknown> | undefined)?.bike),
        },
        cellCount: {
          foot: num((data.cellCount as Record<string, unknown> | undefined)?.foot),
          bike: num((data.cellCount as Record<string, unknown> | undefined)?.bike),
        },
        zoneCount: {
          foot: num((data.zoneCount as Record<string, unknown> | undefined)?.foot),
          bike: num((data.zoneCount as Record<string, unknown> | undefined)?.bike),
        },
        streak: {
          current: num(streak.current),
          longest: num(streak.longest),
          weeks: num(streak.weeks),
        },
        counters: {
          activities: num(counters.activities),
          followers: num(counters.followers),
          following: num(counters.following),
          distanceKm: {
            run: num(distanceKm.run),
            walk: num(distanceKm.walk),
            ride: num(distanceKm.ride),
          },
        },
      },
      relationship,
      restricted: false,
    });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   Követés
   ═══════════════════════════════════════════════════════════════════ */

/**
 * POST /api/users/:username/follow
 *
 * Nyilvános fióknál azonnal létrejön a kapcsolat, privátnál kérés lesz belőle
 * (`followRequests/{cél}/items/{kérő}`, docs/05 → Közösségi gráf). A művelet
 * IDEMPOTENS: a már meglévő követés újra kérve nem duplázza a számlálót.
 */
usersRouter.post('/:username/follow', async (req: AuthedRequest, res: Response, next) => {
  try {
    const viewerUid = req.uid!;
    const target = await resolveTarget(String(req.params.username ?? ""), viewerUid);
    if (target.uid === viewerUid) {
      throw badRequest('self_follow', 'Magadat nem követheted.');
    }

    const iBlockedThem = await db
      .collection(COLLECTIONS.users)
      .doc(viewerUid)
      .collection('blocks')
      .doc(target.uid)
      .get();
    if (iBlockedThem.exists) {
      throw conflict('blocked', 'Előbb oldd fel a tiltást, utána követheted.');
    }

    const isPrivate =
      (target.data.privacy as { account?: string } | undefined)?.account === 'private';
    const users = db.collection(COLLECTIONS.users);
    const now = FieldValue.serverTimestamp();

    if (isPrivate) {
      const requestRef = db
        .collection(COLLECTIONS.followRequests)
        .doc(target.uid)
        .collection('items')
        .doc(viewerUid);
      const existing = await users.doc(viewerUid).collection('following').doc(target.uid).get();
      if (existing.exists) return res.json({ status: 'following' as const });
      await requestRef.set({ createdAt: now }, { merge: true });
      return res.json({ status: 'requested' as const });
    }

    await db.runTransaction(async (tx) => {
      const followingRef = users.doc(viewerUid).collection('following').doc(target.uid);
      const followerRef = users.doc(target.uid).collection('followers').doc(viewerUid);
      const already = await tx.get(followingRef);
      if (already.exists) return;

      tx.set(followingRef, { createdAt: now });
      tx.set(followerRef, { createdAt: now });
      tx.update(users.doc(viewerUid), { 'counters.following': FieldValue.increment(1) });
      tx.update(users.doc(target.uid), { 'counters.followers': FieldValue.increment(1) });
    });

    res.json({ status: 'following' as const });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/users/:username/follow — követés vagy függő kérés visszavonása.
 *
 * A számláló CSAK akkor csökken, ha tényleg volt él. Enélkül egy kétszer
 * elküldött „nem követem" negatívba vinné a követőszámot.
 */
usersRouter.delete('/:username/follow', async (req: AuthedRequest, res: Response, next) => {
  try {
    const viewerUid = req.uid!;
    const target = await resolveTarget(String(req.params.username ?? ""), viewerUid);
    if (target.uid === viewerUid) {
      throw badRequest('self_follow', 'Magadat nem követheted.');
    }

    await db
      .collection(COLLECTIONS.followRequests)
      .doc(target.uid)
      .collection('items')
      .doc(viewerUid)
      .delete();

    await unfollow(viewerUid, target.uid);
    res.json({ status: 'none' as const });
  } catch (error) {
    next(error);
  }
});

/** A követési él bontása mindkét oldalon, a számlálókkal együtt. */
async function unfollow(followerUid: string, targetUid: string): Promise<boolean> {
  const users = db.collection(COLLECTIONS.users);
  return db.runTransaction(async (tx) => {
    const followingRef = users.doc(followerUid).collection('following').doc(targetUid);
    const followerRef = users.doc(targetUid).collection('followers').doc(followerUid);
    const existing = await tx.get(followingRef);
    if (!existing.exists) return false;

    tx.delete(followingRef);
    tx.delete(followerRef);
    tx.update(users.doc(followerUid), { 'counters.following': FieldValue.increment(-1) });
    tx.update(users.doc(targetUid), { 'counters.followers': FieldValue.increment(-1) });
    return true;
  });
}

/* ═══════════════════════════════════════════════════════════════════
   Tiltás
   ═══════════════════════════════════════════════════════════════════ */

/**
 * POST /api/users/:username/block
 *
 * A tiltás BONTJA A KAPCSOLATOT MINDKÉT IRÁNYBAN, és eltakarítja a függő
 * kéréseket is. Enélkül a letiltott fél továbbra is követő maradna, és a
 * feedjében ott lenne a tiltó minden aktivitása — a tiltás csak látszólag
 * működne.
 */
usersRouter.post('/:username/block', async (req: AuthedRequest, res: Response, next) => {
  try {
    const viewerUid = req.uid!;
    const target = await resolveTarget(String(req.params.username ?? ""), viewerUid);
    if (target.uid === viewerUid) {
      throw badRequest('self_block', 'Magadat nem tilthatod le.');
    }

    await db
      .collection(COLLECTIONS.users)
      .doc(viewerUid)
      .collection('blocks')
      .doc(target.uid)
      .set({ createdAt: FieldValue.serverTimestamp() });

    await Promise.all([
      unfollow(viewerUid, target.uid),
      unfollow(target.uid, viewerUid),
      db.collection(COLLECTIONS.followRequests).doc(target.uid).collection('items').doc(viewerUid).delete(),
      db.collection(COLLECTIONS.followRequests).doc(viewerUid).collection('items').doc(target.uid).delete(),
    ]);

    res.json({ status: 'blocked' as const });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/users/:username/block — a tiltás feloldása. Nem állítja vissza a követést. */
usersRouter.delete('/:username/block', async (req: AuthedRequest, res: Response, next) => {
  try {
    const viewerUid = req.uid!;
    const target = await resolveTarget(String(req.params.username ?? ""), viewerUid);
    await db
      .collection(COLLECTIONS.users)
      .doc(viewerUid)
      .collection('blocks')
      .doc(target.uid)
      .delete();
    res.json({ status: 'none' as const });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   Bejelentés
   ═══════════════════════════════════════════════════════════════════ */

/**
 * POST /api/users/:username/report
 *
 * A bejelentő EGYSZER jelenthet egy felhasználót, amíg az előző nyitva van.
 * Enélkül egy dühös felhasználó ötven azonos bejelentéssel eltemetné a
 * moderációs sort — a `reporterCredibility` súlyozás (docs/05) pedig csak a
 * MEGÍTÉLT bejelentések után igazít, tehát ezt itt kell megfogni.
 */
usersRouter.post('/:username/report', async (req: AuthedRequest, res: Response, next) => {
  try {
    const viewerUid = req.uid!;
    const target = await resolveTarget(String(req.params.username ?? ""), viewerUid);
    if (target.uid === viewerUid) {
      throw badRequest('self_report', 'Magadat nem jelentheted.');
    }

    const category = String((req.body as { category?: unknown } | undefined)?.category ?? '');
    if (!(category in REPORT_BRANCH)) {
      throw badRequest('invalid_category', 'Válassz egy okot a bejelentéshez.');
    }
    const note = String((req.body as { note?: unknown } | undefined)?.note ?? '').trim();
    if (note.length > NOTE_MAX) {
      throw badRequest('note_too_long', `A leírás legfeljebb ${NOTE_MAX} karakter lehet.`);
    }

    const open = await db
      .collection(COLLECTIONS.reports)
      .where('reporterId', '==', viewerUid)
      .where('targetId', '==', target.uid)
      .where('status', '==', 'open')
      .limit(1)
      .get();
    if (!open.empty) {
      throw conflict('already_reported', 'Ezt a felhasználót már bejelentetted, vizsgáljuk.');
    }

    await db.collection(COLLECTIONS.reports).add({
      targetType: 'user',
      targetId: target.uid,
      reporterId: viewerUid,
      category,
      branch: REPORT_BRANCH[category as ReportCategory],
      note: note || null,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
