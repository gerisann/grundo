/**
 * Bugreport API — tesztelői hibabejelentések.
 *
 * Két, élesen elváló felület él ebben a fájlban:
 *
 * - `bugReportsRouter` — a BEKÜLDŐ oldal (`/api/bugreports`). Tesztelői vagy
 *   admin jogosultságot kér, és semmi mást nem enged: a beküldő a saját
 *   bejelentését sem olvashatja vissza.
 * - `adminBugReportsRouter` — a TRIÁZS (`/api/admin/bugreports`), a
 *   `routes/admin.ts` szerepkör-kapuja mögé bekötve.
 *
 * ⚠️ A dokumentumot MINDIG a szerver írja. A `status`, a `createdAt` és a
 * `uid` hitelessége a triázs egyetlen fogódzója; egy kliensről érkező
 * időbélyeg a készülék állítható órájáról jön. A MELLÉKLET viszont
 * közvetlenül a Storage-ba megy (`storage.rules`), mert egy 30 másodperces
 * videó nem fér át a Cloud Run kérésméretén.
 *
 * docs/ai/terv-2026-09-09-bugreport-rendszer.md
 */

import { Router } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { AuthedRequest } from '../../server';
import { COLLECTIONS, FIREBASE_STORAGE_BUCKET, db, storage } from '../lib/firebase';
import { audit } from '../lib/adminAudit';
import { badRequest, forbidden, notFound } from '../lib/errors';

export const bugReportsRouter = Router();
export const adminBugReportsRouter = Router();

const KINDS = new Set(['report', 'screenshot', 'video', 'crash']);
const STATUSES = new Set(['new', 'triaged', 'in_progress', 'fixed', 'wontfix', 'duplicate']);
const SEVERITIES = new Set(['low', 'normal', 'high']);

/** Aki a triázst végezheti. A `readonly` néz, de nem ír. */
const TRIAGE_ROLES = new Set(['owner', 'admin', 'moderator', 'support']);

const MAX_NOTE = 2000;
/** Ennyi morzsa fér egy bejelentésbe — a gyűrűpuffer is ennyit tart. */
const MAX_LOGS = 200;
const MAX_LOG_MESSAGE = 500;
const MAX_MEDIA = 4;
const LIST_LIMIT = 50;
/** A melléklet aláírt olvasó-URL-je ennyi ideig él az admin adatlapján. */
const MEDIA_URL_TTL_MS = 15 * 60_000;

interface StoredMedia {
  path: string;
  contentType: string;
  bytes: number;
  durationMs?: number;
}

/* ── Beküldés ───────────────────────────────────────────────────────────── */

/**
 * Ki küldhet be egyáltalán.
 *
 * A `tester` mező a felhasználó dokumentumában él, és kizárólag adminból
 * állítható (`POST /api/admin/testers`). Az admin szerepkör
 * önmagában is elég — aki a triázst látja, az tesztelhet is.
 */
async function assertReporter(req: AuthedRequest): Promise<void> {
  if (req.role) return;
  const snapshot = await db.collection(COLLECTIONS.users).doc(req.uid!).get();
  const tester = snapshot.exists ? (snapshot.data() as { tester?: unknown }).tester : false;
  if (tester !== true) {
    throw forbidden('A hibabejelentő a tesztelői körnek szól.');
  }
}

function readNote(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw badRequest('invalid_note', 'A megjegyzés csak szöveg lehet.');
  return value.trim().slice(0, MAX_NOTE);
}

/**
 * A morzsanapló vágása a SZERVEREN is megtörténik.
 *
 * A kliens gyűrűpuffere 200 elemű, de arra nem lehet építeni: egy elrontott
 * vagy régi build tetszőleges méretű tömböt küldhetne, és egy Firestore
 * dokumentum kemény 1 MB-os korlátba ütközik — a bejelentés akkor nem
 * csonkulna, hanem elveszne.
 */
function readLogs(value: unknown): Array<{ t: number; level: string; msg: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_LOGS).map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      t: Number.isFinite(row.t) ? Number(row.t) : 0,
      level: String(row.level ?? 'info').slice(0, 16),
      msg: String(row.msg ?? '').slice(0, MAX_LOG_MESSAGE),
    };
  });
}

/**
 * A melléklet útvonala tényleg EHHEZ a bejelentéshez és EHHEZ a felhasználóhoz
 * tartozik-e.
 *
 * ⚠️ Ez a határ két oldalának egyike: a `storage.rules` ugyanezt kényszeríti ki
 * a feltöltésnél, ez pedig a bejelentésnél. Ha csak az egyik lenne meg, egy
 * elrontott kliens (vagy egy szándékos hívás) MÁS felhasználó fájljára mutató
 * hivatkozást tehetne a saját bejelentésébe, és az admin adatlapja aláírt
 * URL-t adna ki rá.
 *
 * A prefix-egyezés önmagában nem elég: az előtaggal PONTOSAN egyező útvonal
 * (fájlnév nélkül) nem fájl, és a `..` szegmens sem maradhat benne.
 */
export function mediaPathBelongsTo(path: string, uid: string, reportId: string): boolean {
  const prefix = `bugreports/${uid}/${reportId}/`;
  if (!path.startsWith(prefix) || path.length <= prefix.length) return false;
  return !path.split('/').includes('..');
}

/** Ismeretlen kulcsokat is átengedünk, de csak sekélyen és rövidítve. */
function readBag(value: unknown, maxKeys = 40): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= maxKeys) break;
    if (raw == null) continue;
    if (typeof raw === 'string') out[key] = raw.slice(0, 500);
    else if (typeof raw === 'number' || typeof raw === 'boolean') out[key] = raw;
    else if (typeof raw === 'object' && !Array.isArray(raw)) out[key] = readBag(raw, 20);
  }
  return out;
}

bugReportsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    await assertReporter(req);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const kind = String(body.kind ?? 'report');
    if (!KINDS.has(kind)) throw badRequest('invalid_kind', 'Ismeretlen bejelentés-típus.');

    const severity = String(body.severity ?? 'normal');
    if (!SEVERITIES.has(severity)) throw badRequest('invalid_severity', 'Ismeretlen súlyosság.');

    const note = readNote(body.note);
    if (!note && kind === 'report') {
      throw badRequest('note_required', 'Írd le pár szóban, mi történt.');
    }

    const userDoc = await db.collection(COLLECTIONS.users).doc(req.uid!).get();
    const username = userDoc.exists ? String((userDoc.data() as { username?: unknown }).username ?? '') : '';

    const document = {
      kind,
      status: 'new',
      severity,
      // Szerveridő, mindig: a beküldések sorrendje a triázs alapja, a
      // készülék órája pedig állítható.
      createdAt: FieldValue.serverTimestamp(),
      uid: req.uid,
      username,
      note,
      device: readBag(body.device),
      context: readBag(body.context),
      state: readBag(body.state),
      logs: readLogs(body.logs),
      media: [] as StoredMedia[],
      ...(body.crash ? { crash: readBag(body.crash) } : {}),
    };

    const ref = await db.collection(COLLECTIONS.bugReports).add(document);
    res.status(201).json({
      reportId: ref.id,
      /** Ide — és csak ide — tölthet fel mellékletet a kliens. */
      uploadPrefix: `bugreports/${req.uid}/${ref.id}/`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * A feltöltött melléklet bejelentése.
 *
 * A bájtok már a Storage-ban vannak; itt csak a HIVATKOZÁS kerül a
 * dokumentumba, miután az előtag igazolta, hogy a beküldő a saját mappájába
 * írt. A `storage.rules` ugyanezt kényszeríti ki — a kettő szándékosan
 * fedi egymást, mert ez a határ két oldala.
 */
bugReportsRouter.post('/:id/media', async (req: AuthedRequest, res, next) => {
  try {
    await assertReporter(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const path = String(body.path ?? '');
    const reportId = String(req.params.id ?? '');
    if (!mediaPathBelongsTo(path, req.uid!, reportId)) {
      throw badRequest('invalid_media_path', 'A melléklet útvonala nem a bejelentéshez tartozik.');
    }

    const ref = db.collection(COLLECTIONS.bugReports).doc(reportId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw notFound('report_not_found', 'Nincs ilyen bejelentés.');
    const stored = snapshot.data() as { uid?: string; media?: StoredMedia[] };
    if (stored.uid !== req.uid) throw forbidden('Ez nem a te bejelentésed.');
    if ((stored.media?.length ?? 0) >= MAX_MEDIA) {
      throw badRequest('too_many_media', 'Ehhez a bejelentéshez már nem fér több melléklet.');
    }

    const media: StoredMedia = {
      path,
      contentType: String(body.contentType ?? 'application/octet-stream').slice(0, 100),
      bytes: Number.isFinite(body.bytes) ? Number(body.bytes) : 0,
      ...(Number.isFinite(body.durationMs) ? { durationMs: Number(body.durationMs) } : {}),
    };
    await ref.update({ media: FieldValue.arrayUnion(media) });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* ── Triázs ─────────────────────────────────────────────────────────────── */

function toMillis(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

function toListItem(id: string, data: Record<string, unknown>) {
  const device = (data.device ?? {}) as Record<string, unknown>;
  return {
    id,
    kind: String(data.kind ?? 'report'),
    status: String(data.status ?? 'new'),
    severity: String(data.severity ?? 'normal'),
    createdAt: toMillis(data.createdAt),
    uid: String(data.uid ?? ''),
    username: String(data.username ?? ''),
    note: String(data.note ?? ''),
    platform: String(device.platform ?? ''),
    appVersion: String(device.appVersion ?? ''),
    revision: String(device.revision ?? ''),
    mediaCount: Array.isArray(data.media) ? data.media.length : 0,
  };
}

adminBugReportsRouter.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';

    /**
     * A rendezés MINDIG `createdAt desc`, és a szűrés egyszerű egyenlőség —
     * így a Firestore egyetlen összetett indexszel kiszolgálja mindkét
     * szűrőt, és nem kell kézzel karbantartott index-mátrix.
     */
    let query = db
      .collection(COLLECTIONS.bugReports)
      .orderBy('createdAt', 'desc')
      .limit(LIST_LIMIT);
    if (status && STATUSES.has(status)) query = query.where('status', '==', status);
    if (kind && KINDS.has(kind)) query = query.where('kind', '==', kind);

    const snapshot = await query.get();
    res.json({
      reports: snapshot.docs.map((doc) => toListItem(doc.id, doc.data() as Record<string, unknown>)),
    });
  } catch (error) {
    next(error);
  }
});

adminBugReportsRouter.get('/:id', async (req, res, next) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.bugReports).doc(String(req.params.id ?? '')).get();
    if (!snapshot.exists) throw notFound('report_not_found', 'Nincs ilyen bejelentés.');
    const data = snapshot.data() as Record<string, unknown>;
    const media = Array.isArray(data.media) ? (data.media as StoredMedia[]) : [];

    /**
     * Aláírt, rövid életű URL — tartós Firebase download token NÉLKÜL. A
     * Storage-szabály a bugreport-mellékletet senkinek nem adja ki
     * olvasásra; az egyetlen út idevezet, és ez a szerepkör-kapu mögött van.
     */
    const expiresAt = Date.now() + MEDIA_URL_TTL_MS;
    const withUrls = await Promise.all(
      media.map(async (item) => {
        const [url] = await storage
          .bucket(FIREBASE_STORAGE_BUCKET)
          .file(item.path)
          .getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt });
        return { ...item, url };
      }),
    );

    res.json({
      report: {
        ...toListItem(snapshot.id, data),
        device: data.device ?? {},
        context: data.context ?? {},
        state: data.state ?? {},
        logs: Array.isArray(data.logs) ? data.logs : [],
        crash: data.crash ?? null,
        adminNote: String(data.adminNote ?? ''),
        resolvedAt: toMillis(data.resolvedAt),
        media: withUrls,
      },
    });
  } catch (error) {
    next(error);
  }
});

adminBugReportsRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    if (!req.role || !TRIAGE_ROLES.has(req.role)) {
      throw forbidden('A bejelentés kezeléséhez legalább support jogosultság kell.');
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reportId = String(req.params.id ?? '');
    const ref = db.collection(COLLECTIONS.bugReports).doc(reportId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw notFound('report_not_found', 'Nincs ilyen bejelentés.');
    const before = snapshot.data() as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (body.status != null) {
      const status = String(body.status);
      if (!STATUSES.has(status)) throw badRequest('invalid_status', 'Ismeretlen státusz.');
      patch.status = status;
      // A lezárás időpontja a státuszból következik, nem külön mezőből: két
      // forrásból előbb-utóbb az egyik elcsúszik.
      patch.resolvedAt = ['fixed', 'wontfix', 'duplicate'].includes(status)
        ? FieldValue.serverTimestamp()
        : null;
    }
    if (body.severity != null) {
      const severity = String(body.severity);
      if (!SEVERITIES.has(severity)) throw badRequest('invalid_severity', 'Ismeretlen súlyosság.');
      patch.severity = severity;
    }
    if (body.adminNote != null) patch.adminNote = String(body.adminNote).slice(0, MAX_NOTE);
    if (Object.keys(patch).length === 0) {
      throw badRequest('empty_patch', 'Nincs mit módosítani a bejelentésen.');
    }

    await ref.update(patch);
    await audit(req, 'bug_report_update', 'bugReport', reportId, {
      status: before.status ?? null,
      severity: before.severity ?? null,
      adminNote: before.adminNote ?? null,
    }, patch);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
