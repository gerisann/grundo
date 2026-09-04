/**
 * Bandák — létrehozás, keresés, csatlakozás, részletek, meghívás.
 *
 * Phase 1 (lásd docs/ai/CURRENT_STATE.md): mag-CRUD. Phase 2 első darabja
 * (GRUNDO #30): appon belüli meghívás+értesítés (`invites/{uid}`), lásd
 * lent. A hírfolyam, a chat fal és a Phase 3 banda-adminisztráció
 * (beállítások, szerepkörök, kirúgás, tulajdonos-átruházás) is itt él.
 *
 * ⚠️ A TAGSÁG KÉT HELYEN ÉL, TÜKÖRKÉPPEL — a `following`/`followers` és a
 * `rivals` mintája (lásd `lib/rivals.ts` fejléce): `bandas/{id}/members/{uid}`
 * a banda oldaláról („kik a tagjaim"), `users/{uid}/bandas/{id}` a
 * felhasználó oldaláról („milyen bandákban vagyok"). Enélkül a „saját
 * bandáim" lista collectionGroup-lekérdezést igényelne minden banda
 * `members` alkollekcióján, amihez külön engedélyezett indexre volna
 * szükség — a tükrözés ugyanazt egyetlen, olcsó, saját-magam-alatti
 * olvasással oldja meg.
 */

import { Router, type Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, db, FIREBASE_STORAGE_BUCKET, storage } from '../lib/firebase';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors';
import {
  DEFAULT_BANDA_SETTINGS,
  canInvite,
  generateInviteCode,
  newBandaDoc,
  normalizeBandaName,
  validateBandaDescription,
  validateBandaName,
  zeroBandaTotals,
  type BandaRole,
  type BandaSettings,
  type BandaVisibility,
} from '../lib/bandas';
import {
  notifyBandaInvite,
  notifyBandaMemberJoined,
  notifyBandaMemberLeft,
  notifyBandaMemberRemoved,
  notifyBandaPost,
  notifyBandaWallReaction,
} from '../lib/notifications';
import { hideBandaMemberContent } from '../lib/contentModeration';
import type { AuthedRequest } from '../../server';

export const bandasRouter = Router();

const SEARCH_LIMIT = 20;
const DISCOVER_LIMIT = 10;
const MEMBER_LIST_LIMIT = 200;
/** Ennyi próbálkozás után adjuk fel az ütközésmentes kód generálását. */
const INVITE_CODE_MAX_ATTEMPTS = 10;
const ROLE_PERMISSIONS = new Set(['everyone', 'moderators', 'owner']);
const BANDA_SPORTS = ['run', 'walk', 'ride'] as const;

interface BandaSummary {
  id: string;
  name: string;
  description: string | null;
  photoURL: string | null;
  coverURL: string | null;
  city: string | null;
  visibility: BandaVisibility;
  ownerId: string;
  memberCount: number;
  totals: ReturnType<typeof zeroBandaTotals>;
  createdAt: number | null;
}

function millis(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value) {
    return (value as Timestamp).toMillis();
  }
  return null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function bandaStats(value: unknown) {
  const root = (value as Record<string, unknown> | undefined) ?? {};
  return Object.fromEntries(BANDA_SPORTS.map((sport) => {
    const raw = (root[sport] as Record<string, unknown> | undefined) ?? {};
    return [sport, {
      areaDayM2: num(raw.areaDayM2),
      areaWeekM2: num(raw.areaWeekM2),
      areaMonthM2: num(raw.areaMonthM2),
      areaTotalM2: num(raw.areaTotalM2),
      gpDay: num(raw.gpDay),
      gpWeek: num(raw.gpWeek),
      gpMonth: num(raw.gpMonth),
      gpTotal: num(raw.gpTotal),
    }];
  }));
}

function isBandaBrandUrl(raw: string, bandaId: string, uid: string, kind: 'profile' | 'cover'): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com') return false;
    return decodeURIComponent(url.pathname).includes(`/o/bandas/${bandaId}/branding/${uid}/${kind}.jpg`);
  } catch {
    return false;
  }
}

function toSummary(id: string, data: Record<string, unknown>): BandaSummary {
  const totalsRaw = (data.totals as Record<string, unknown> | undefined) ?? {};
  const area = (key: string) => {
    const raw = (totalsRaw[key] as Record<string, unknown> | undefined) ?? {};
    return { foot: num(raw.foot), bike: num(raw.bike) };
  };
  return {
    id,
    name: String(data.name ?? ''),
    description: (data.description as string | null) ?? null,
    photoURL: (data.photoURL as string | null) ?? null,
    coverURL: (data.coverURL as string | null) ?? null,
    city: (data.city as string | null) ?? null,
    visibility: data.visibility === 'private' ? 'private' : 'public',
    ownerId: String(data.ownerId ?? ''),
    memberCount: num(data.memberCount),
    totals: {
      areaM2: area('areaM2'),
      areaDayM2: area('areaDayM2'),
      areaWeekM2: area('areaWeekM2'),
      areaMonthM2: area('areaMonthM2'),
      gpTotal: num(totalsRaw.gpTotal),
      gpWeek: num(totalsRaw.gpWeek),
      gpMonth: num(totalsRaw.gpMonth),
    },
    createdAt: millis(data.createdAt),
  };
}

/**
 * Egyedi meghívókód — ha ütközik (elhanyagolható eséllyel, 32^8 térben),
 * újragenerálja, korlátos próbálkozással.
 */
async function reserveInviteCode(bandaId: string): Promise<string> {
  for (let attempt = 0; attempt < INVITE_CODE_MAX_ATTEMPTS; attempt++) {
    const code = generateInviteCode();
    const ref = db.collection(COLLECTIONS.inviteCodes).doc(code);
    const created = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return false;
      tx.set(ref, { bandaId });
      return true;
    });
    if (created) return code;
  }
  throw conflict('invite_code_exhausted', 'Nem sikerült egyedi meghívókódot generálni. Próbáld újra.');
}

/* ═══════════════════════════════════════════════════════════════════
   POST /api/bandas — létrehozás
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.post('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const body = req.body ?? {};

    const nameError = validateBandaName(String(body.name ?? ''));
    if (nameError) throw badRequest('invalid_name', nameError);

    const descriptionError = validateBandaDescription(
      typeof body.description === 'string' ? body.description : undefined,
    );
    if (descriptionError) throw badRequest('invalid_description', descriptionError);

    const visibility: BandaVisibility = body.visibility === 'private' ? 'private' : 'public';
    const now = new Date();

    const bandaRef = db.collection(COLLECTIONS.bandas).doc();
    const doc = newBandaDoc(
      {
        name: String(body.name),
        description: typeof body.description === 'string' ? body.description : undefined,
        visibility,
        city: typeof body.city === 'string' ? body.city : undefined,
        ownerId: uid,
      },
      now,
    );

    /**
     * MINDEN banda kap kódot, a publikus is. Korábban csak a privát kapott —
     * a publikus banda oldalán ezért nem volt mit megosztani, pedig a kód a
     * legegyszerűbb meghívási mód: elmondható szóban, és a Bandák oldalon
     * beírva azonnal csatlakoztat.
     */
    const inviteCode = await reserveInviteCode(bandaRef.id);

    const batch = db.batch();
    batch.set(bandaRef, inviteCode ? { ...doc, inviteCode } : doc);
    batch.set(bandaRef.collection('members').doc(uid), {
      role: 'owner' as BandaRole,
      joinedAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      db.collection(COLLECTIONS.users).doc(uid).collection('bandas').doc(bandaRef.id),
      { role: 'owner' as BandaRole, joinedAt: FieldValue.serverTimestamp() },
    );
    await batch.commit();

    res.status(201).json({
      banda: toSummary(bandaRef.id, { ...doc, inviteCode }),
      inviteCode,
      role: 'owner' as BandaRole,
    });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   GET /api/bandas/mine — a hívó tagságai
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.get('/mine', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const memberships = await db
      .collection(COLLECTIONS.users)
      .doc(uid)
      .collection('bandas')
      .get();

    if (memberships.empty) {
      res.json({ items: [] });
      return;
    }

    const roleById = new Map(
      memberships.docs.map((doc) => [doc.id, (doc.data().role as BandaRole) ?? 'member']),
    );
    const bandaDocs = await db.getAll(
      ...memberships.docs.map((doc) => db.collection(COLLECTIONS.bandas).doc(doc.id)),
    );

    const items = bandaDocs
      .filter((doc) => doc.exists)
      .map((doc) => ({
        ...toSummary(doc.id, doc.data() as Record<string, unknown>),
        role: roleById.get(doc.id) ?? 'member',
      }));

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   GET /api/bandas/invites/mine — a hívóra váró meghívók (GRUNDO #30)

   A `users/{uid}/bandaInvites/{bandaId}` tükörből — ugyanaz a minta, mint
   a `/mine` a `users/{uid}/bandas`-ból: nincs collectionGroup-lekérdezés a
   bandák `invites` alkollekcióján.
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.get('/invites/mine', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const snapshot = await db.collection(COLLECTIONS.users).doc(uid).collection('bandaInvites').get();

    const items = snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        bandaId: doc.id,
        bandaName: String(data.bandaName ?? ''),
        invitedByUsername: String(data.invitedByUsername ?? ''),
        createdAt: millis(data.createdAt),
      };
    });

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   GET /api/bandas/search?q= — publikus bandák
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.get('/search', async (req: AuthedRequest, res: Response, next) => {
  try {
    const q = normalizeBandaName(String(req.query.q ?? ''));
    if (!q) {
      res.json({ items: [] });
      return;
    }
    const limit = Math.min(SEARCH_LIMIT, Math.max(1, Number(req.query.limit) || SEARCH_LIMIT));

    // Prefix-keresés a `nameLower` mezőn — a felhasználó-keresés mintája
    // (`routes/users.ts` → `/search`).
    const PREFIX_UPPER_BOUND = String.fromCharCode(0xf8ff);
    const snapshot = await db
      .collection(COLLECTIONS.bandas)
      .where('visibility', '==', 'public')
      .orderBy('nameLower')
      .startAt(q)
      .endAt(`${q}${PREFIX_UPPER_BOUND}`)
      .limit(limit)
      .get();

    const items = snapshot.docs.map((doc) => toSummary(doc.id, doc.data() as Record<string, unknown>));
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   GET /api/bandas/discover — popular or newest public bandas
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.get('/discover', async (req: AuthedRequest, res: Response, next) => {
  try {
    const sort =
      req.query.sort === 'new' ? 'new' : req.query.sort === 'popular' ? 'popular' : null;
    if (!sort) throw badRequest('invalid_sort', 'A rendezés csak popular vagy new lehet.');
    const limit = Math.min(DISCOVER_LIMIT, Math.max(1, Number(req.query.limit) || DISCOVER_LIMIT));
    const orderField = sort === 'popular' ? 'memberCount' : 'createdAt';

    const snapshot = await db
      .collection(COLLECTIONS.bandas)
      .where('visibility', '==', 'public')
      .orderBy(orderField, 'desc')
      .limit(limit)
      .get();

    const items = snapshot.docs.map((doc) => toSummary(doc.id, doc.data() as Record<string, unknown>));
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   POST /api/bandas/:id/join — publikus csatlakozás vagy jóváhagyási kérés
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.post('/:id/join', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);

    const result = await db.runTransaction(async (tx) => {
      const memberRef = bandaRef.collection('members').doc(uid);
      const requestRef = bandaRef.collection('joinRequests').doc(uid);
      const userRef = db.collection(COLLECTIONS.users).doc(uid);
      const [bandaSnap, memberSnap, requestSnap, userSnap] = await Promise.all([
        tx.get(bandaRef), tx.get(memberRef), tx.get(requestRef), tx.get(userRef),
      ]);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
      const data = bandaSnap.data() as Record<string, unknown>;
      if (data.visibility !== 'public') {
        throw forbidden('Ez a banda privát — meghívókód kell a csatlakozáshoz.');
      }

      if (memberSnap.exists) throw conflict('already_member', 'Már tagja vagy ennek a bandának.');

      const settings = {
        ...DEFAULT_BANDA_SETTINGS,
        ...((data.settings as Partial<BandaSettings> | undefined) ?? {}),
      };
      const name = String(data.name ?? 'Banda');
      const user = userSnap.data() as { username?: string; photoURL?: string | null } | undefined;
      const username = String(user?.username ?? 'Valaki');
      if (settings.publicJoinMode === 'approval') {
        if (requestSnap.exists) throw conflict('join_request_pending', 'A csatlakozási kérésed már jóváhagyásra vár.');
        tx.set(requestRef, {
          username,
          photoURL: user?.photoURL ?? null,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { status: 'pending' as const, role: null, name, username };
      }

      tx.set(memberRef, { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() });
      tx.set(
        db.collection(COLLECTIONS.users).doc(uid).collection('bandas').doc(bandaId),
        { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() },
      );
      tx.delete(requestRef);
      tx.set(bandaRef, { memberCount: FieldValue.increment(1) }, { merge: true });
      return { status: 'joined' as const, role: 'member' as BandaRole, name, username };
    });

    if (result.status === 'joined') {
      notifyBandaMemberJoined(await notifiableMembers(bandaRef, uid), bandaId, result.name, result.username);
    }
    res.json({ status: result.status, role: result.role });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   POST /api/bandas/join-by-code — csatlakozás meghívókóddal (publikushoz is)
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.post('/join-by-code', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    if (!code) throw badRequest('missing_code', 'Adj meg egy meghívókódot.');

    const codeRef = db.collection(COLLECTIONS.inviteCodes).doc(code);
    const result = await db.runTransaction(async (tx) => {
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists) throw notFound('invalid_code', 'Érvénytelen meghívókód.');
      const bandaId = String((codeSnap.data() as { bandaId?: string }).bandaId ?? '');

      const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
      const bandaSnap = await tx.get(bandaRef);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');

      const memberRef = bandaRef.collection('members').doc(uid);
      const memberSnap = await tx.get(memberRef);
      if (memberSnap.exists) throw conflict('already_member', 'Már tagja vagy ennek a bandának.');

      tx.set(memberRef, { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() });
      tx.set(
        db.collection(COLLECTIONS.users).doc(uid).collection('bandas').doc(bandaId),
        { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() },
      );
      tx.set(bandaRef, { memberCount: FieldValue.increment(1) }, { merge: true });
      return { bandaId, name: String((bandaSnap.data() as { name?: string }).name ?? '') };
    });

    const username = String((await db.collection(COLLECTIONS.users).doc(uid).get()).get('username') ?? 'Valaki');
    const joinedBandaRef = db.collection(COLLECTIONS.bandas).doc(result.bandaId);
    notifyBandaMemberJoined(await notifiableMembers(joinedBandaRef, uid), result.bandaId, result.name, username);
    res.json({ role: 'member' as BandaRole, ...result });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   POST /api/bandas/:id/invite — appon belüli meghívás (GRUNDO #30)

   Ki hívhat meg: a banda `settings.whoCanInvite` szerint (`canInvite`,
   lásd `lib/bandas.ts`). A meghívó `bandas/{id}/invites/{targetUid}` +
   tükörként `users/{targetUid}/bandaInvites/{bandaId}` — a „saját
   meghívóim" lista ebből megy, a tagság-tükör mintájára.
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.post('/:id/invite', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const targetUid = String(req.body?.targetUid ?? '');
    if (!targetUid) throw badRequest('missing_target', 'Nincs megadva, kit hívj meg.');
    if (targetUid === uid) throw badRequest('invalid_target', 'Magadat nem hívhatod meg.');

    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    const [bandaSnap, callerMemberSnap, targetMemberSnap, targetUserSnap, callerUserSnap] = await Promise.all([
      bandaRef.get(),
      bandaRef.collection('members').doc(uid).get(),
      bandaRef.collection('members').doc(targetUid).get(),
      db.collection(COLLECTIONS.users).doc(targetUid).get(),
      db.collection(COLLECTIONS.users).doc(uid).get(),
    ]);
    if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
    if (!targetUserSnap.exists) throw notFound('user_not_found', 'Nincs ilyen felhasználó.');

    const data = bandaSnap.data() as Record<string, unknown>;
    const callerRole = callerMemberSnap.exists
      ? ((callerMemberSnap.data() as { role?: BandaRole }).role ?? 'member')
      : null;
    if (!callerRole) throw forbidden('Csak a banda tagjai hívhatnak meg valakit.');

    const settings = (data.settings as Partial<BandaSettings> | undefined) ?? DEFAULT_BANDA_SETTINGS;
    if (!canInvite(callerRole, settings.whoCanInvite ?? DEFAULT_BANDA_SETTINGS.whoCanInvite)) {
      throw forbidden('Ebben a bandában nincs jogosultságod meghívni.');
    }

    if (targetMemberSnap.exists) throw conflict('already_member', 'Ez a felhasználó már tagja a bandának.');

    const inviteRef = bandaRef.collection('invites').doc(targetUid);
    const existingInvite = await inviteRef.get();
    if (existingInvite.exists) throw conflict('already_invited', 'Már meghívtad ezt a felhasználót.');

    const callerUsername = String((callerUserSnap.data() as { username?: string } | undefined)?.username ?? '');
    const bandaName = String(data.name ?? '');

    const batch = db.batch();
    batch.set(inviteRef, {
      invitedBy: uid,
      invitedByUsername: callerUsername,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection(COLLECTIONS.users).doc(targetUid).collection('bandaInvites').doc(bandaId), {
      bandaName,
      invitedBy: uid,
      invitedByUsername: callerUsername,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    notifyBandaInvite(targetUid, bandaId, bandaName, callerUsername);

    res.status(201).json({ invited: true });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   POST /api/bandas/:id/invite/accept · /decline (GRUNDO #30)

   Csak a meghívott saját magára — a `req.uid` MINDIG a meghívott, nincs
   külön `targetUid` a törzsben.
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.post('/:id/invite/accept', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    const inviteRef = bandaRef.collection('invites').doc(uid);
    const mirrorRef = db.collection(COLLECTIONS.users).doc(uid).collection('bandaInvites').doc(bandaId);

    const result = await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) throw notFound('invite_not_found', 'Nincs függő meghívód ehhez a bandához.');
      const bandaSnap = await tx.get(bandaRef);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');

      const memberRef = bandaRef.collection('members').doc(uid);
      const memberSnap = await tx.get(memberRef);

      tx.delete(inviteRef);
      tx.delete(mirrorRef);

      // Ha időközben már máshogy (kóddal) csatlakozott, a meghívó törlésén
      // túl nincs több teendő — nincs dupla tagság, nincs dupla számláló.
      if (memberSnap.exists) {
        return {
          role: (memberSnap.data() as { role?: BandaRole }).role ?? 'member',
          joined: false,
          name: String((bandaSnap.data() as { name?: string }).name ?? 'Banda'),
        };
      }

      tx.set(memberRef, { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() });
      tx.set(
        db.collection(COLLECTIONS.users).doc(uid).collection('bandas').doc(bandaId),
        { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() },
      );
      tx.set(bandaRef, { memberCount: FieldValue.increment(1) }, { merge: true });
      return {
        role: 'member' as BandaRole,
        joined: true,
        name: String((bandaSnap.data() as { name?: string }).name ?? 'Banda'),
      };
    });

    if (result.joined) {
      const username = String((await db.collection(COLLECTIONS.users).doc(uid).get()).get('username') ?? 'Valaki');
      notifyBandaMemberJoined(await notifiableMembers(bandaRef, uid), bandaId, result.name, username);
    }
    res.json({ role: result.role });
  } catch (error) {
    next(error);
  }
});

bandasRouter.post('/:id/invite/decline', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    const inviteRef = bandaRef.collection('invites').doc(uid);
    const mirrorRef = db.collection(COLLECTIONS.users).doc(uid).collection('bandaInvites').doc(bandaId);

    await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) throw notFound('invite_not_found', 'Nincs függő meghívód ehhez a bandához.');
      tx.delete(inviteRef);
      tx.delete(mirrorRef);
    });

    res.json({ declined: true });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   GET /api/bandas/:id — részletek
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.get('/:id', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);

    const [bandaSnap, memberSnap, joinRequestSnap] = await Promise.all([
      bandaRef.get(),
      bandaRef.collection('members').doc(uid).get(),
      bandaRef.collection('joinRequests').doc(uid).get(),
    ]);
    if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
    const data = bandaSnap.data() as Record<string, unknown>;

    const isMember = memberSnap.exists;
    if (data.visibility !== 'public' && !isMember) {
      throw forbidden('Ez a banda privát — csak a tagjai láthatják.');
    }

    const role = isMember ? ((memberSnap.data() as { role?: BandaRole }).role ?? 'member') : null;
    const storedSettings = (data.settings as Partial<BandaSettings> | undefined) ?? {};
    const settings: BandaSettings = { ...DEFAULT_BANDA_SETTINGS, ...storedSettings };

    /**
     * A kód PÓTLÁSA olvasáskor. A publikus bandák a bevezetéskor nem kaptak
     * kódot, tehát a régiek most sem tudnának megosztani — külön migráció
     * helyett az első arra jogosult megnyitás létrehozza. Idempotens: ha már
     * van kód, nem nyúlunk hozzá.
     */
    let inviteCode = (data.inviteCode as string | undefined) ?? null;
    const maySeeCode = role !== null && canInvite(role, settings.inviteCodeVisibleTo);
    if (inviteCode === null && maySeeCode) {
      inviteCode = await reserveInviteCode(bandaId);
      await bandaRef.set({ inviteCode }, { merge: true });
    }

    res.json({
      banda: toSummary(bandaId, data),
      role,
      isMember,
      settings,
      joinRequestPending: !isMember && joinRequestSnap.exists,
      inviteCode: maySeeCode ? inviteCode : null,
      // A csengő állása. Nem tagnál nincs értelme, ezért `false`.
      notify: isMember && (memberSnap.data() as { notify?: boolean }).notify !== false,
    });
  } catch (error) {
    next(error);
  }
});

/* ══════════════════════════════════════════════════════════════════
   PATCH /api/bandas/:id/notifications — a banda csengője

   Bandánkénti némítás: a tag saját `members/{uid}.notify` mezőjét állítja.
   A GLOBÁLIS értesítés-kapcsolók (Beállítások → Értesítések) ettől
   függetlenek — egy hangos banda kikapcsolása nem némíthatja el a többit.
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.patch('/:id/notifications', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== 'boolean') {
      throw badRequest('invalid_enabled', 'Az `enabled` mező kötelező, igaz/hamis értékkel.');
    }

    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    await loadMemberRole(bandaRef, uid);
    await bandaRef.collection('members').doc(uid).set({ notify: enabled }, { merge: true });

    res.json({ notify: enabled });
  } catch (error) {
    next(error);
  }
});

/* ══════════════════════════════════════════════════════════════════
   Phase 3 — alapítói beállítások és tagkezelés
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.patch('/:id/branding', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    const [bandaSnap, memberSnap] = await Promise.all([
      bandaRef.get(),
      bandaRef.collection('members').doc(uid).get(),
    ]);
    if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
    if (!memberSnap.exists || (memberSnap.data() as { role?: BandaRole }).role !== 'owner') {
      throw forbidden('Csak a banda alapítója módosíthatja a képeket.');
    }

    const body = (req.body as { photoURL?: unknown; coverURL?: unknown } | undefined) ?? {};
    const current = bandaSnap.data() as { photoURL?: string | null; coverURL?: string | null };
    const update: { photoURL?: string | null; coverURL?: string | null; updatedAt: FirebaseFirestore.FieldValue } = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    for (const kind of ['profile', 'cover'] as const) {
      const field = kind === 'profile' ? 'photoURL' : 'coverURL';
      if (!(field in body)) continue;
      const raw = body[field];
      const value = raw == null || raw === '' ? null : String(raw);
      if (value && !isBandaBrandUrl(value, bandaId, uid, kind)) {
        throw badRequest('invalid_banda_image_url', 'A kép nem ehhez a bandához feltöltött fájlra mutat.');
      }
      update[field] = value;
    }
    if (update.photoURL === undefined && update.coverURL === undefined) {
      throw badRequest('missing_branding', 'Válassz profil- vagy borítóképet.');
    }
    await bandaRef.set(update, { merge: true });
    res.json({
      photoURL: update.photoURL === undefined ? current.photoURL ?? null : update.photoURL,
      coverURL: update.coverURL === undefined ? current.coverURL ?? null : update.coverURL,
    });
  } catch (error) {
    next(error);
  }
});

bandasRouter.patch('/:id/settings', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    const body = (req.body as Partial<Record<keyof BandaSettings, unknown>> | undefined) ?? {};
    const permissionKeys: (keyof Pick<BandaSettings, 'whoCanInvite' | 'inviteCodeVisibleTo' | 'postPermission'>)[] = [
      'whoCanInvite', 'inviteCodeVisibleTo', 'postPermission',
    ];
    const keys: (keyof BandaSettings)[] = [...permissionKeys, 'publicJoinMode'];
    if (!keys.some((key) => body[key] !== undefined)) {
      throw badRequest('empty_settings', 'Válassz legalább egy módosítandó beállítást.');
    }
    for (const key of permissionKeys) {
      if (body[key] !== undefined && !ROLE_PERMISSIONS.has(String(body[key]))) {
        throw badRequest('invalid_permission', 'Érvénytelen banda-jogosultság.');
      }
    }
    if (body.publicJoinMode !== undefined && body.publicJoinMode !== 'instant' && body.publicJoinMode !== 'approval') {
      throw badRequest('invalid_join_mode', 'A publikus belépés módja csak azonnali vagy jóváhagyásos lehet.');
    }

    const settings = await db.runTransaction(async (tx) => {
      const memberRef = bandaRef.collection('members').doc(uid);
      const [bandaSnap, memberSnap] = await Promise.all([tx.get(bandaRef), tx.get(memberRef)]);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
      if (!memberSnap.exists || (memberSnap.data() as { role?: BandaRole }).role !== 'owner') {
        throw forbidden('Csak a banda alapítója módosíthatja a beállításokat.');
      }

      const current = (bandaSnap.data() as { settings?: Partial<BandaSettings> }).settings ?? {};
      const updated: BandaSettings = {
        ...DEFAULT_BANDA_SETTINGS,
        ...current,
        ...(body.whoCanInvite !== undefined ? { whoCanInvite: body.whoCanInvite as BandaSettings['whoCanInvite'] } : {}),
        ...(body.inviteCodeVisibleTo !== undefined ? { inviteCodeVisibleTo: body.inviteCodeVisibleTo as BandaSettings['inviteCodeVisibleTo'] } : {}),
        ...(body.postPermission !== undefined ? { postPermission: body.postPermission as BandaSettings['postPermission'] } : {}),
        ...(body.publicJoinMode !== undefined ? { publicJoinMode: body.publicJoinMode as BandaSettings['publicJoinMode'] } : {}),
      };
      tx.update(bandaRef, { settings: updated });
      return updated;
    });

    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

/** Függő publikus csatlakozási kérések — alapítónak és moderátornak. */
bandasRouter.get('/:id/join-requests', async (req: AuthedRequest, res: Response, next) => {
  try {
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    const role = await loadMemberRole(bandaRef, req.uid!);
    if (role === 'member') throw forbidden('Csak az alapító vagy egy moderátor láthatja a csatlakozási kéréseket.');

    const snapshot = await bandaRef.collection('joinRequests').orderBy('createdAt', 'asc').limit(MEMBER_LIST_LIMIT).get();
    res.json({
      items: snapshot.docs.map((doc) => ({
        uid: doc.id,
        username: String(doc.get('username') ?? ''),
        photoURL: typeof doc.get('photoURL') === 'string' ? doc.get('photoURL') : null,
        createdAt: millis(doc.get('createdAt')),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/** Egy függő kérés jóváhagyása vagy elutasítása — tranzakciósan a tagsággal. */
bandasRouter.post('/:id/join-requests/:memberId', async (req: AuthedRequest, res: Response, next) => {
  try {
    const callerUid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const targetUid = String(req.params.memberId ?? '');
    const decision = (req.body as { decision?: unknown } | undefined)?.decision;
    if (decision !== 'approve' && decision !== 'reject') {
      throw badRequest('invalid_decision', 'A döntés jóváhagyás vagy elutasítás lehet.');
    }

    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    const result = await db.runTransaction(async (tx) => {
      const callerRef = bandaRef.collection('members').doc(callerUid);
      const targetRef = bandaRef.collection('members').doc(targetUid);
      const requestRef = bandaRef.collection('joinRequests').doc(targetUid);
      const [bandaSnap, callerSnap, targetSnap, requestSnap] = await Promise.all([
        tx.get(bandaRef), tx.get(callerRef), tx.get(targetRef), tx.get(requestRef),
      ]);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
      const callerRole = (callerSnap.data() as { role?: BandaRole } | undefined)?.role;
      if (callerRole !== 'owner' && callerRole !== 'moderator') {
        throw forbidden('Csak az alapító vagy egy moderátor bírálhatja el a csatlakozási kérést.');
      }
      if (!requestSnap.exists) throw notFound('join_request_not_found', 'Ez a csatlakozási kérés már nem található.');

      tx.delete(requestRef);
      if (decision === 'reject') {
        return { status: 'rejected' as const, joined: false, name: String(bandaSnap.get('name') ?? 'Banda') };
      }
      if (targetSnap.exists) {
        return { status: 'approved' as const, joined: false, name: String(bandaSnap.get('name') ?? 'Banda') };
      }

      tx.set(targetRef, { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() });
      tx.set(
        db.collection(COLLECTIONS.users).doc(targetUid).collection('bandas').doc(bandaId),
        { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() },
      );
      tx.update(bandaRef, { memberCount: FieldValue.increment(1) });
      return { status: 'approved' as const, joined: true, name: String(bandaSnap.get('name') ?? 'Banda') };
    });

    if (result.joined) {
      const username = String((await db.collection(COLLECTIONS.users).doc(targetUid).get()).get('username') ?? 'Valaki');
      notifyBandaMemberJoined(await notifiableMembers(bandaRef, targetUid), bandaId, result.name, username);
    }
    res.json({ status: result.status });
  } catch (error) {
    next(error);
  }
});

bandasRouter.patch('/:id/members/:memberId/role', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const targetUid = String(req.params.memberId ?? '');
    const role = (req.body as { role?: unknown } | undefined)?.role;
    if (role !== 'moderator' && role !== 'member') {
      throw badRequest('invalid_role', 'A szerepkör csak tag vagy moderátor lehet.');
    }

    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    await db.runTransaction(async (tx) => {
      const callerRef = bandaRef.collection('members').doc(uid);
      const targetRef = bandaRef.collection('members').doc(targetUid);
      const [bandaSnap, callerSnap, targetSnap] = await Promise.all([
        tx.get(bandaRef),
        tx.get(callerRef),
        tx.get(targetRef),
      ]);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
      if (!callerSnap.exists || (callerSnap.data() as { role?: BandaRole }).role !== 'owner') {
        throw forbidden('Csak a banda alapítója módosíthat szerepkört.');
      }
      if (!targetSnap.exists) throw notFound('member_not_found', 'Ez a felhasználó nem tagja a bandának.');
      if ((targetSnap.data() as { role?: BandaRole }).role === 'owner') {
        throw conflict('owner_role_locked', 'Az alapító szerepköre itt nem módosítható.');
      }

      tx.update(targetRef, { role });
      tx.update(db.collection(COLLECTIONS.users).doc(targetUid).collection('bandas').doc(bandaId), { role });
    });

    res.json({ role });
  } catch (error) {
    next(error);
  }
});

bandasRouter.delete('/:id/members/:memberId', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const targetUid = String(req.params.memberId ?? '');
    if (targetUid === uid) throw conflict('cannot_kick_self', 'Saját magadat nem rúghatod ki a bandából.');

    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    const bandaName = await db.runTransaction(async (tx) => {
      const callerRef = bandaRef.collection('members').doc(uid);
      const targetRef = bandaRef.collection('members').doc(targetUid);
      const [bandaSnap, callerSnap, targetSnap] = await Promise.all([
        tx.get(bandaRef),
        tx.get(callerRef),
        tx.get(targetRef),
      ]);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
      if (!callerSnap.exists) throw forbidden('Csak a banda alapítója vagy moderátora rúghat ki tagot.');
      if (!targetSnap.exists) throw notFound('member_not_found', 'Ez a felhasználó nem tagja a bandának.');

      const callerRole = (callerSnap.data() as { role?: BandaRole }).role ?? 'member';
      const targetRole = (targetSnap.data() as { role?: BandaRole }).role ?? 'member';
      if (callerRole === 'member') throw forbidden('Csak a banda alapítója vagy moderátora rúghat ki tagot.');
      if (targetRole === 'owner') throw forbidden('A banda alapítója nem rúgható ki.');
      if (callerRole === 'moderator' && targetRole !== 'member') {
        throw forbidden('A moderátor csak tagot rúghat ki.');
      }

      tx.delete(targetRef);
      tx.delete(db.collection(COLLECTIONS.users).doc(targetUid).collection('bandas').doc(bandaId));
      tx.update(bandaRef, { memberCount: FieldValue.increment(-1) });
      return String(bandaSnap.get('name') ?? 'Banda');
    });

    await hideBandaMemberContent(bandaId, targetUid, 'member_removed', uid);
    notifyBandaMemberRemoved(targetUid, bandaName);
    res.json({ removed: true });
  } catch (error) {
    next(error);
  }
});

bandasRouter.post('/:id/transfer-ownership', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const targetUid = String((req.body as { targetUid?: unknown } | undefined)?.targetUid ?? '');
    if (!targetUid) throw badRequest('missing_target', 'Válaszd ki az új alapítót.');
    if (targetUid === uid) throw conflict('already_owner', 'Már te vagy a banda alapítója.');

    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    await db.runTransaction(async (tx) => {
      const callerRef = bandaRef.collection('members').doc(uid);
      const targetRef = bandaRef.collection('members').doc(targetUid);
      const [bandaSnap, callerSnap, targetSnap] = await Promise.all([
        tx.get(bandaRef),
        tx.get(callerRef),
        tx.get(targetRef),
      ]);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
      if (!callerSnap.exists || (callerSnap.data() as { role?: BandaRole }).role !== 'owner') {
        throw forbidden('Csak a banda alapítója adhatja át a tulajdonjogot.');
      }
      if (!targetSnap.exists) throw notFound('member_not_found', 'Az új alapítónak előbb a banda tagjának kell lennie.');

      const oldOwnerMirror = db.collection(COLLECTIONS.users).doc(uid).collection('bandas').doc(bandaId);
      const newOwnerMirror = db.collection(COLLECTIONS.users).doc(targetUid).collection('bandas').doc(bandaId);
      tx.update(bandaRef, { ownerId: targetUid });
      tx.update(callerRef, { role: 'moderator' as BandaRole });
      tx.update(oldOwnerMirror, { role: 'moderator' as BandaRole });
      tx.update(targetRef, { role: 'owner' as BandaRole });
      tx.update(newOwnerMirror, { role: 'owner' as BandaRole });
    });

    res.json({ ownerId: targetUid, previousOwnerRole: 'moderator' as BandaRole });
  } catch (error) {
    next(error);
  }
});

bandasRouter.post('/:id/leave', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const deleteContent = (req.body as { deleteContent?: unknown } | undefined)?.deleteContent === true;
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    const bandaName = await db.runTransaction(async (tx) => {
      const memberRef = bandaRef.collection('members').doc(uid);
      const [bandaSnap, memberSnap] = await Promise.all([tx.get(bandaRef), tx.get(memberRef)]);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
      if (!memberSnap.exists) throw notFound('member_not_found', 'Nem vagy tagja ennek a bandának.');
      if ((memberSnap.data() as { role?: BandaRole }).role === 'owner') {
        throw conflict(
          'owner_must_transfer',
          'Alapítóként csak akkor léphetsz ki, ha előbb átadod valakinek az alapítói rangot.',
        );
      }

      tx.delete(memberRef);
      tx.delete(db.collection(COLLECTIONS.users).doc(uid).collection('bandas').doc(bandaId));
      tx.update(bandaRef, { memberCount: FieldValue.increment(-1) });
      return String(bandaSnap.get('name') ?? 'Banda');
    });

    if (deleteContent) await hideBandaMemberContent(bandaId, uid, 'member_left', uid);
    const username = String((await db.collection(COLLECTIONS.users).doc(uid).get()).get('username') ?? 'Valaki');
    notifyBandaMemberLeft(await notifiableMembers(bandaRef, uid), bandaId, bandaName, username);
    res.json({ left: true });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   GET /api/bandas/:id/members — teljes tag-lista
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.get('/:id/members', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);

    const [bandaSnap, memberSnap] = await Promise.all([
      bandaRef.get(),
      bandaRef.collection('members').doc(uid).get(),
    ]);
    if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
    const data = bandaSnap.data() as Record<string, unknown>;
    if (data.visibility !== 'public' && !memberSnap.exists) {
      throw forbidden('Ez a banda privát — csak a tagjai láthatják.');
    }

    const membersSnapshot = await bandaRef
      .collection('members')
      .orderBy('joinedAt', 'asc')
      .limit(MEMBER_LIST_LIMIT)
      .get();

    const ids = membersSnapshot.docs.map((doc) => doc.id);
    const roleById = new Map(
      membersSnapshot.docs.map((doc) => [doc.id, (doc.data().role as BandaRole) ?? 'member']),
    );
    const userDocs = ids.length
      ? await db.getAll(...ids.map((id) => db.collection(COLLECTIONS.users).doc(id)))
      : [];

    const items = userDocs
      .filter((doc) => doc.exists)
      .map((doc) => {
        const profile = doc.data() as Record<string, unknown>;
        return {
          uid: doc.id,
          username: String(profile.username ?? ''),
          photoURL: (profile.photoURL as string | null) ?? null,
          role: roleById.get(doc.id) ?? 'member',
          stats: bandaStats(profile.bandaStats),
        };
      })
      .filter((item) => item.username);

    res.json({ items, hasMore: membersSnapshot.docs.length >= MEMBER_LIST_LIMIT });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   Hírfolyam és chat fal (GRUNDO #30, Phase 2 folytatása)

   Mindkettő csak tagoknak olvasható/írható. A hírfolyamra a
   `settings.postPermission` szerint posztolhat (a `canInvite`
   mintájára, `meetsRolePermission`-nel) — a chat falra bárki tag ír,
   arra nincs külön beállítás (`docs/02-funkcionalis-spec.md`).

   A hírfolyam a legfrissebb poszttal kezdődik és tízesével bővíthető. Az
   üzenőfal beszélgetés marad: a legfrissebb N üzenetet kérjük le, majd
   időrendben adjuk vissza, hogy alul folytatódjon.
   ═══════════════════════════════════════════════════════════════════ */

const POST_MAX = 1000;
const FEED_PAGE = 10;
const FEED_PAGE_MAX = 50;
const FEED_SCAN_MAX = 250;
const WALL_PAGE = 100;
const COMMENT_MAX = 500;

async function loadMemberRole(bandaRef: FirebaseFirestore.DocumentReference, uid: string): Promise<BandaRole> {
  const memberSnap = await bandaRef.collection('members').doc(uid).get();
  if (!memberSnap.exists) throw forbidden('Csak a banda tagjai láthatják.');
  return (memberSnap.data() as { role?: BandaRole }).role ?? 'member';
}

/**
 * Kiknek mehet értesítés EBBŐL a bandából.
 *
 * A `notify` hiánya BEKAPCSOLTAT jelent — ugyanaz a döntés, mint a globális
 * kapcsolóknál: egy alapból néma bandában senki nem találná meg a
 * bekapcsolót. A `skipUid` a saját cselekvésé: a posztolónak nem kell
 * értesítés a saját posztjáról.
 */
async function notifiableMembers(
  bandaRef: FirebaseFirestore.DocumentReference,
  skipUid: string,
): Promise<string[]> {
  const snapshot = await bandaRef.collection('members').select('notify').get();
  return snapshot.docs
    .filter((doc) => doc.id !== skipUid && (doc.data() as { notify?: boolean }).notify !== false)
    .map((doc) => doc.id);
}

/** Kér-e a tag értesítést erről a bandáról? */
async function wantsBandaNotifications(
  bandaRef: FirebaseFirestore.DocumentReference,
  uid: string,
): Promise<boolean> {
  const snap = await bandaRef.collection('members').doc(uid).get();
  return snap.exists && (snap.data() as { notify?: boolean }).notify !== false;
}

function toPostSummary(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() as Record<string, unknown>;
  return {
    id: doc.id,
    authorUid: String(data.authorUid ?? ''),
    authorUsername: String(data.authorUsername ?? ''),
    authorPhotoURL: typeof data.authorPhotoURL === 'string' ? data.authorPhotoURL : null,
    text: String(data.text ?? ''),
    format: data.format === 'markdown-v1' ? 'markdown-v1' : 'plain',
    hasImage: typeof data.imagePath === 'string' && data.imagePath.length > 0,
    likeCount: num(data.likeCount),
    commentCount: num(data.commentCount),
    replyToId: typeof data.replyToId === 'string' ? data.replyToId : null,
    replyToUsername: typeof data.replyToUsername === 'string' ? data.replyToUsername : null,
    updatedAt: millis(data.updatedAt),
    createdAt: millis(data.createdAt),
  };
}

async function postSummaries(docs: FirebaseFirestore.QueryDocumentSnapshot[], uid: string) {
  return Promise.all(docs.map(async (doc) => ({
    ...toPostSummary(doc),
    likedByMe: (await doc.ref.collection('likes').doc(uid).get()).exists,
  })));
}

function requestedLimit(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(1, parsed)) : fallback;
}

bandasRouter.get('/:id/feed', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    await loadMemberRole(bandaRef, uid);

    const limit = requestedLimit(req.query.limit, FEED_PAGE, FEED_PAGE_MAX);
    const snapshot = await bandaRef.collection('feed').orderBy('createdAt', 'desc').limit(FEED_SCAN_MAX).get();
    const visible = snapshot.docs.filter((doc) => doc.get('hiddenAt') == null);
    res.json({ items: await postSummaries(visible.slice(0, limit), uid), hasMore: visible.length > limit });
  } catch (error) {
    next(error);
  }
});

bandasRouter.post('/:id/feed', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const text = String((req.body as { text?: unknown } | undefined)?.text ?? '').trim();
    const format = (req.body as { format?: unknown } | undefined)?.format === 'markdown-v1'
      ? 'markdown-v1'
      : 'plain';
    const imagePathValue = (req.body as { imagePath?: unknown } | undefined)?.imagePath;
    const imagePath = typeof imagePathValue === 'string' ? imagePathValue : null;
    if (!text) throw badRequest('empty_post', 'Írj valamit a posztba.');
    if (text.length > POST_MAX) throw badRequest('post_too_long', `A poszt legfeljebb ${POST_MAX} karakter.`);

    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    const [bandaSnap, role, userSnap] = await Promise.all([
      bandaRef.get(),
      loadMemberRole(bandaRef, uid),
      db.collection(COLLECTIONS.users).doc(uid).get(),
    ]);
    if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');

    const settings = (bandaSnap.data() as { settings?: Partial<BandaSettings> }).settings ?? DEFAULT_BANDA_SETTINGS;
    if (!canInvite(role, settings.postPermission ?? DEFAULT_BANDA_SETTINGS.postPermission)) {
      throw forbidden('Ebben a bandában nincs jogosultságod posztolni.');
    }

    if (imagePath) {
      const prefix = `bandas/${bandaId}/feed/${uid}/`;
      const fileName = imagePath.slice(prefix.length);
      if (!imagePath.startsWith(prefix) || !/^[A-Za-z0-9._-]+\.jpg$/.test(fileName)) {
        throw badRequest('invalid_feed_image', 'Érvénytelen posztkép-hivatkozás.');
      }
      try {
        const [metadata] = await storage.bucket(FIREBASE_STORAGE_BUCKET).file(imagePath).getMetadata();
        if (metadata.contentType !== 'image/jpeg' || Number(metadata.size ?? 0) > 2 * 1024 * 1024) {
          throw badRequest('invalid_feed_image', 'A posztkép csak JPEG lehet, legfeljebb 2 MB méretben.');
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw badRequest('invalid_feed_image', 'A feltöltött posztkép nem található.');
      }
    }

    const userData = userSnap.data() as { username?: string; photoURL?: string | null } | undefined;
    const authorUsername = String(userData?.username ?? '');
    const postRef = bandaRef.collection('feed').doc();
    await postRef.set({
      authorUid: uid,
      authorUsername,
      authorPhotoURL: userData?.photoURL ?? null,
      text,
      format,
      likeCount: 0,
      commentCount: 0,
      ...(imagePath ? { imagePath } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });

    const bandaName = String((bandaSnap.data() as { name?: string }).name ?? 'Banda');
    notifyBandaPost(await notifiableMembers(bandaRef, uid), bandaId, bandaName, authorUsername);

    res.status(201).json({ id: postRef.id });
  } catch (error) {
    next(error);
  }
});

bandasRouter.patch('/:id/feed/:postId', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    await loadMemberRole(bandaRef, uid);
    const text = String((req.body as { text?: unknown } | undefined)?.text ?? '').trim();
    if (!text) throw badRequest('empty_post', 'Írj valamit a posztba.');
    if (text.length > POST_MAX) throw badRequest('post_too_long', `A poszt legfeljebb ${POST_MAX} karakter.`);
    const postRef = bandaRef.collection('feed').doc(String(req.params.postId ?? ''));
    const postSnap = await postRef.get();
    if (!postSnap.exists || postSnap.get('hiddenAt') != null) throw notFound('post_not_found', 'Nincs ilyen poszt.');
    if (postSnap.get('authorUid') !== uid) throw forbidden('Csak a saját posztodat szerkesztheted.');
    await postRef.update({ text, format: 'markdown-v1', updatedAt: FieldValue.serverTimestamp() });
    res.json({ updated: true });
  } catch (error) {
    next(error);
  }
});

bandasRouter.delete('/:id/feed/:postId', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    const role = await loadMemberRole(bandaRef, uid);
    const postRef = bandaRef.collection('feed').doc(String(req.params.postId ?? ''));
    const postSnap = await postRef.get();
    if (!postSnap.exists) throw notFound('post_not_found', 'Nincs ilyen poszt.');
    if (postSnap.get('authorUid') !== uid && role !== 'owner') throw forbidden('Ezt a posztot nem törölheted.');
    await postRef.update({
      hiddenAt: FieldValue.serverTimestamp(),
      hiddenReason: 'post_deleted',
      hiddenBy: uid,
    });
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

bandasRouter.post('/:id/feed/:postId/like', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    await loadMemberRole(bandaRef, uid);
    const postRef = bandaRef.collection('feed').doc(String(req.params.postId ?? ''));
    const result = await db.runTransaction(async (transaction) => {
      const likeRef = postRef.collection('likes').doc(uid);
      const [postSnap, likeSnap] = await Promise.all([transaction.get(postRef), transaction.get(likeRef)]);
      if (!postSnap.exists || postSnap.get('hiddenAt') != null) throw notFound('post_not_found', 'Nincs ilyen poszt.');
      const current = num(postSnap.get('likeCount'));
      if (likeSnap.exists) {
        transaction.delete(likeRef);
        transaction.update(postRef, { likeCount: Math.max(0, current - 1) });
        return { liked: false, likeCount: Math.max(0, current - 1) };
      }
      transaction.set(likeRef, { createdAt: FieldValue.serverTimestamp() });
      transaction.update(postRef, { likeCount: current + 1 });
      return { liked: true, likeCount: current + 1 };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

function toCommentSummary(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() as Record<string, unknown>;
  const hidden = data.hiddenAt != null;
  return {
    id: doc.id,
    authorUid: hidden ? '' : String(data.authorUid ?? ''),
    authorUsername: hidden ? 'törölt komment vagy tag' : String(data.authorUsername ?? ''),
    authorPhotoURL: hidden ? null : typeof data.authorPhotoURL === 'string' ? data.authorPhotoURL : null,
    text: hidden ? 'törölt komment vagy tag' : String(data.text ?? ''),
    hidden,
    replyToId: typeof data.replyToId === 'string' ? data.replyToId : null,
    replyToUsername: typeof data.replyToUsername === 'string' ? data.replyToUsername : null,
    createdAt: millis(data.createdAt),
  };
}

bandasRouter.get('/:id/feed/:postId/comments', async (req: AuthedRequest, res: Response, next) => {
  try {
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    await loadMemberRole(bandaRef, req.uid!);
    const postRef = bandaRef.collection('feed').doc(String(req.params.postId ?? ''));
    const postSnap = await postRef.get();
    if (!postSnap.exists || postSnap.get('hiddenAt') != null) throw notFound('post_not_found', 'Nincs ilyen poszt.');
    const snapshot = await postRef.collection('comments').orderBy('createdAt', 'asc').limit(100).get();
    const items = snapshot.docs.map(toCommentSummary);
    const hiddenIds = new Set(items.filter((item) => item.hidden).map((item) => item.id));
    res.json({
      items: items.map((item) => item.replyToId && hiddenIds.has(item.replyToId)
        ? { ...item, replyToUsername: 'törölt komment vagy tag' }
        : item),
    });
  } catch (error) {
    next(error);
  }
});

bandasRouter.post('/:id/feed/:postId/comments', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    await loadMemberRole(bandaRef, uid);
    const text = String((req.body as { text?: unknown } | undefined)?.text ?? '').trim();
    const replyToIdValue = (req.body as { replyToId?: unknown } | undefined)?.replyToId;
    const replyToId = typeof replyToIdValue === 'string' && replyToIdValue ? replyToIdValue : null;
    if (!text) throw badRequest('empty_comment', 'Írj valamit a kommentbe.');
    if (text.length > COMMENT_MAX) throw badRequest('comment_too_long', `A komment legfeljebb ${COMMENT_MAX} karakter.`);
    const postRef = bandaRef.collection('feed').doc(String(req.params.postId ?? ''));
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const [postSnap, userSnap, replySnap] = await Promise.all([
      postRef.get(),
      userRef.get(),
      replyToId ? postRef.collection('comments').doc(replyToId).get() : Promise.resolve(null),
    ]);
    if (!postSnap.exists || postSnap.get('hiddenAt') != null) throw notFound('post_not_found', 'Nincs ilyen poszt.');
    if (replyToId && !replySnap?.exists) throw badRequest('invalid_reply', 'A megválaszolt komment már nem található.');
    const user = userSnap.data() as { username?: string; photoURL?: string | null } | undefined;
    const commentRef = postRef.collection('comments').doc();
    const batch = db.batch();
    batch.set(commentRef, {
      authorUid: uid,
      authorUsername: String(user?.username ?? ''),
      authorPhotoURL: user?.photoURL ?? null,
      text,
      ...(replyToId ? {
        replyToId,
        replyToUsername: replySnap?.get('hiddenAt') != null
          ? 'törölt komment vagy tag'
          : String(replySnap?.get('authorUsername') ?? ''),
      } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(postRef, { commentCount: FieldValue.increment(1) });
    await batch.commit();
    res.status(201).json({ id: commentRef.id });
  } catch (error) {
    next(error);
  }
});

bandasRouter.get('/:id/feed/:postId/image', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const postId = String(req.params.postId ?? '');
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    await loadMemberRole(bandaRef, uid);

    const postSnap = await bandaRef.collection('feed').doc(postId).get();
    const imagePath = (postSnap.data() as { imagePath?: unknown } | undefined)?.imagePath;
    if (!postSnap.exists || postSnap.get('hiddenAt') != null || typeof imagePath !== 'string') {
      throw notFound('feed_image_missing', 'Nincs ilyen posztkép.');
    }

    const expectedPrefix = `bandas/${bandaId}/feed/`;
    if (!imagePath.startsWith(expectedPrefix)) {
      throw notFound('feed_image_missing', 'Nincs ilyen posztkép.');
    }

    const file = storage.bucket(FIREBASE_STORAGE_BUCKET).file(imagePath);
    try {
      const [metadata] = await file.getMetadata();
      if (metadata.contentType !== 'image/jpeg') {
        throw notFound('feed_image_missing', 'Nincs ilyen posztkép.');
      }
      const [contents] = await file.download();
      res.set({
        'Cache-Control': 'private, max-age=300',
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
      });
      res.send(contents);
    } catch (error) {
      if (Number((error as { code?: unknown }).code) === 404) {
        throw notFound('feed_image_missing', 'Nincs ilyen posztkép.');
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

bandasRouter.get('/:id/wall', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    await loadMemberRole(bandaRef, uid);

    /**
     * LEGÚJABB ELÖL. Korábban chat-sorrendben (legrégebbi elöl) ment vissza a
     * lista; az üzenőfalon viszont a friss üzenet a lényeg, és az üzenetírás is
     * a lista fölött van — így nem kell végiggörgetni a régieket.
     */
    const snapshot = await bandaRef.collection('wall').orderBy('createdAt', 'desc').limit(WALL_PAGE).get();
    const visible = snapshot.docs.filter((doc) => doc.get('hiddenAt') == null);
    res.json({ items: await postSummaries(visible, uid), hasMore: snapshot.docs.length >= WALL_PAGE });
  } catch (error) {
    next(error);
  }
});

bandasRouter.post('/:id/wall', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const text = String((req.body as { text?: unknown } | undefined)?.text ?? '').trim();
    const replyToIdValue = (req.body as { replyToId?: unknown } | undefined)?.replyToId;
    const replyToId = typeof replyToIdValue === 'string' && replyToIdValue ? replyToIdValue : null;
    if (!text) throw badRequest('empty_message', 'Írj valamit az üzenetbe.');
    if (text.length > POST_MAX) throw badRequest('message_too_long', `Az üzenet legfeljebb ${POST_MAX} karakter.`);

    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);
    // Nincs jogosultság-ellenőrzés — a chat falra bárki tag ír.
    await loadMemberRole(bandaRef, uid);
    const [userSnap, replySnap] = await Promise.all([
      db.collection(COLLECTIONS.users).doc(uid).get(),
      replyToId ? bandaRef.collection('wall').doc(replyToId).get() : Promise.resolve(null),
    ]);
    if (replyToId && (!replySnap?.exists || replySnap.get('hiddenAt') != null)) throw badRequest('invalid_reply', 'A megválaszolt üzenet már nem található.');

    const userData = userSnap.data() as { username?: string; photoURL?: string | null } | undefined;
    const authorUsername = String(userData?.username ?? '');
    const messageRef = bandaRef.collection('wall').doc();
    await messageRef.set({
      authorUid: uid,
      authorUsername,
      authorPhotoURL: userData?.photoURL ?? null,
      text,
      likeCount: 0,
      ...(replyToId ? {
        replyToId,
        replyToUsername: String(replySnap?.get('authorUsername') ?? ''),
      } : {}),
      createdAt: FieldValue.serverTimestamp(),
    });

    /**
     * Válasznál a MEGVÁLASZOLT üzenet szerzője kap értesítést — de csak ha
     * nem ő maga válaszolt, és ha ebből a bandából kér értesítést.
     */
    const replyTargetUid = String(replySnap?.get('authorUid') ?? '');
    if (replyTargetUid && replyTargetUid !== uid && await wantsBandaNotifications(bandaRef, replyTargetUid)) {
      const bandaName = String((await bandaRef.get()).get('name') ?? 'Banda');
      notifyBandaWallReaction(replyTargetUid, bandaId, bandaName, authorUsername, 'reply');
    }

    res.status(201).json({ id: messageRef.id });
  } catch (error) {
    next(error);
  }
});

bandasRouter.post('/:id/wall/:messageId/like', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(String(req.params.id ?? ''));
    await loadMemberRole(bandaRef, uid);
    const messageRef = bandaRef.collection('wall').doc(String(req.params.messageId ?? ''));
    const result = await db.runTransaction(async (transaction) => {
      const likeRef = messageRef.collection('likes').doc(uid);
      const [messageSnap, likeSnap] = await Promise.all([transaction.get(messageRef), transaction.get(likeRef)]);
      if (!messageSnap.exists || messageSnap.get('hiddenAt') != null) throw notFound('message_not_found', 'Nincs ilyen üzenet.');
      const current = num(messageSnap.get('likeCount'));
      const authorUid = String(messageSnap.get('authorUid') ?? '');
      if (likeSnap.exists) {
        transaction.delete(likeRef);
        transaction.update(messageRef, { likeCount: Math.max(0, current - 1) });
        return { liked: false, likeCount: Math.max(0, current - 1), authorUid };
      }
      transaction.set(likeRef, { createdAt: FieldValue.serverTimestamp() });
      transaction.update(messageRef, { likeCount: current + 1 });
      return { liked: true, likeCount: current + 1, authorUid };
    });

    // Csak a szív TEVÉSE értesít, a levétele nem — a visszavont reakció nem hír.
    if (result.liked && result.authorUid && result.authorUid !== uid) {
      const [bandaSnap, wanted] = await Promise.all([
        bandaRef.get(),
        wantsBandaNotifications(bandaRef, result.authorUid),
      ]);
      if (wanted) {
        const actor = String((await db.collection(COLLECTIONS.users).doc(uid).get()).get('username') ?? '');
        notifyBandaWallReaction(
          result.authorUid,
          bandaRef.id,
          String(bandaSnap.get('name') ?? 'Banda'),
          actor,
          'like',
        );
      }
    }

    res.json({ liked: result.liked, likeCount: result.likeCount });
  } catch (error) {
    next(error);
  }
});
