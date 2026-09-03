/**
 * Bandák — létrehozás, keresés, csatlakozás, részletek.
 *
 * Phase 1 (lásd docs/ai/CURRENT_STATE.md): mag-CRUD. Nincs még benne az
 * appon belüli meghívás+értesítés, a hírfolyam, a chat fal és a
 * beállítások (moderátor-kinevezés, kirúgás, tulajdonos-átruházás) — ezek
 * Phase 2/3 tárgya.
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
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import {
  DEFAULT_BANDA_SETTINGS,
  generateInviteCode,
  newBandaDoc,
  normalizeBandaName,
  validateBandaDescription,
  validateBandaName,
  zeroBandaTotals,
  type BandaRole,
  type BandaVisibility,
} from '../lib/bandas';
import type { AuthedRequest } from '../../server';

export const bandasRouter = Router();

const SEARCH_LIMIT = 20;
const MEMBER_LIST_LIMIT = 200;
/** Ennyi próbálkozás után adjuk fel az ütközésmentes kód generálását. */
const INVITE_CODE_MAX_ATTEMPTS = 10;

interface BandaSummary {
  id: string;
  name: string;
  description: string | null;
  photoURL: string | null;
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

    let inviteCode: string | null = null;
    if (visibility === 'private') {
      inviteCode = await reserveInviteCode(bandaRef.id);
    }

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
   POST /api/bandas/:id/join — publikus bandához azonnali csatlakozás
   ═══════════════════════════════════════════════════════════════════ */

bandasRouter.post('/:id/join', async (req: AuthedRequest, res: Response, next) => {
  try {
    const uid = req.uid!;
    const bandaId = String(req.params.id ?? '');
    const bandaRef = db.collection(COLLECTIONS.bandas).doc(bandaId);

    const role = await db.runTransaction(async (tx) => {
      const bandaSnap = await tx.get(bandaRef);
      if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
      const data = bandaSnap.data() as Record<string, unknown>;
      if (data.visibility !== 'public') {
        throw forbidden('Ez a banda privát — meghívókód kell a csatlakozáshoz.');
      }

      const memberRef = bandaRef.collection('members').doc(uid);
      const memberSnap = await tx.get(memberRef);
      if (memberSnap.exists) throw conflict('already_member', 'Már tagja vagy ennek a bandának.');

      tx.set(memberRef, { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() });
      tx.set(
        db.collection(COLLECTIONS.users).doc(uid).collection('bandas').doc(bandaId),
        { role: 'member' as BandaRole, joinedAt: FieldValue.serverTimestamp() },
      );
      tx.set(bandaRef, { memberCount: FieldValue.increment(1) }, { merge: true });
      return 'member' as BandaRole;
    });

    res.json({ role });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   POST /api/bandas/join-by-code — privát bandához meghívókóddal
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

    res.json({ role: 'member' as BandaRole, ...result });
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

    const [bandaSnap, memberSnap] = await Promise.all([
      bandaRef.get(),
      bandaRef.collection('members').doc(uid).get(),
    ]);
    if (!bandaSnap.exists) throw notFound('banda_not_found', 'Nincs ilyen banda.');
    const data = bandaSnap.data() as Record<string, unknown>;

    const isMember = memberSnap.exists;
    if (data.visibility !== 'public' && !isMember) {
      throw forbidden('Ez a banda privát — csak a tagjai láthatják.');
    }

    const role = isMember ? ((memberSnap.data() as { role?: BandaRole }).role ?? 'member') : null;
    const settings = data.settings as Record<string, unknown> | undefined;

    res.json({
      banda: toSummary(bandaId, data),
      role,
      isMember,
      settings: settings ?? DEFAULT_BANDA_SETTINGS,
      // A meghívókód csak a tagoknak megy ki — a `settings.inviteCodeVisibleTo`
      // finomítása (mod/csak alapító) Phase 2 tárgya, addig minden tag látja.
      inviteCode: isMember ? ((data.inviteCode as string | undefined) ?? null) : null,
    });
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
        };
      })
      .filter((item) => item.username);

    res.json({ items, hasMore: membersSnapshot.docs.length >= MEMBER_LIST_LIMIT });
  } catch (error) {
    next(error);
  }
});
