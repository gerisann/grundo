import { Router } from 'express';
import { type DocumentReference, type Query } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { distanceM } from '../../../src/game/geo';
import type { ActivityType, TracePoint } from '../../../src/types';
import type { AuthedRequest } from '../../server';
import {
  buildPublicRoutePatch,
  buildOwnerRouteView,
  normalizePrivacy,
  publicRouteNeedsRebuild,
  PUBLIC_ROUTE_VERSION,
} from '../lib/publicRoute';
/**
 * A MENTÉS logikája külön modulban él.
 *
 * Ez a fájl a HTTP-felület: útvonalak, bemenet-ellenőrzés, válaszformátum. A
 * területfoglalás, a pontszámítás és a tranzakció az `activityCommit`-ban van
 * — lásd az ottani fejlécet arról, miért pont ott húzódik a határ.
 */
import {
  commitActivity,
  fitsOneTransaction,
  planActivity,
  sanitizePublicSummary,
} from '../lib/activityCommit';
import { commitChunkedActivity } from '../lib/activityChunked';

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
 * A Trust Score, a területvesztés-események és a napi GP-plafon MÁR ITT VAN,
 * mind a mentés tranzakciójában. Ami még hiányzik: a zónák újraszámolása, az
 * előnézeti térképkép, és a nagy foglalások sorbaállítása — az utóbbi a
 * jelenlegi egyetlen valódi méretkorlát (lásd FIRESTORE_MAX_TRANSACTION_WRITES).
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

    /**
     * Előszűrés — a MUNKA megspórolására, nem az idempotencia biztosítására.
     *
     * A valódi védelem a tranzakción belül van (`commitActivity`): ez itt csak
     * annyit ér el, hogy egy nyilvánvaló ismétlésnél ne fussunk le a teljes
     * motoron és a rács-olvasáson.
     */
    const preflight = await db.collection(COLLECTIONS.activities).doc(activityId).get();
    if (preflight.exists) {
      const data = preflight.data() as { userId?: string; summary?: unknown };
      if (data.userId !== uid) {
        throw badRequest('activity_conflict', 'Ez az azonosító már foglalt.');
      }
      return res.json({ activityId, summary: sanitizePublicSummary(data.summary), duplicate: true });
    }

    // Geometria és méretellenőrzés — determinisztikus, tranzakción kívül.
    const plan = planActivity({ activityId, uid, type, points, startedAt, endedAt, movingMs });

    /**
     * A birtokviszonytól függő rész — KÉT ÚT KÖZÜL AZ EGYIKEN.
     *
     * A hétköznapi aktivitás elfér egyetlen tranzakcióban, és azon a gyors
     * úton megy: ütközéskor a Firestore újrafuttatja a callbacket, friss
     * állapotból. Ami nem fér bele — nagyjából 26 km kerületű kör fölött —,
     * az a darabolt úton, blokkcsoportonként egy tranzakcióval.
     *
     * A méret önmagában tehát SOHA nem ok arra, hogy elvesszen a kör.
     */
    const committed = fitsOneTransaction(plan)
      ? await db.runTransaction((tx) => commitActivity(tx, plan))
      : await commitChunkedActivity(plan);

    if (committed.duplicate) {
      return res.json({ activityId, summary: committed.summary, duplicate: true });
    }
    res.status(201).json({ activityId, summary: committed.summary });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/activities — a feed.
 *
 * Nézetek (`scope`):
 *   mine      — a sajátjaim
 *   world     — mindenki, időrendben
 *   local     — mindenki, de csak a közelben (lat/lng/radiusKm kell hozzá)
 *   following — akiket követek
 *
 * A KÖVETÉS még nem működik: nincs követési gráf az adatbázisban. A végpont
 * ezt őszintén megmondja (`unavailable: 'following'`), hogy a felület ne úgy
 * tegyen, mintha csak épp nem követnél senkit.
 *
 * A HELYI nézet földrajzi szűrése ITT történik, nem a lekérdezésben: a
 * Firestore nem tud „adott ponttól x km-en belül" kérdést. A rendes megoldás
 * geohash-tartományok lennének; addig a friss aktivitásokat kérjük le, és
 * távolság szerint szűrünk.
 *
 * MIKOR KELL CSERÉLNI? Amikor a napi aktivitások száma meghaladja a
 * `LOCAL_SCAN_LIMIT`-et — onnantól egy távoli város aktivitásai kiszoríthatják
 * a közelieket a vizsgált halmazból, és a helyi feed hiányosan töltődne.
 */
const LOCAL_SCAN_LIMIT = 300;

type Scope = 'mine' | 'world' | 'local' | 'following';

activitiesRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const scope = parseScope(req.query.scope);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const dateFrom = parseFeedDate(req.query.dateFrom, 'dateFrom');
    const dateTo = parseFeedDate(req.query.dateTo, 'dateTo');
    if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
      throw badRequest('invalid_date_range', 'Az időszak kezdete nem lehet később a végénél.');
    }

    if (scope === 'following') {
      return res.json({ activities: [], unavailable: 'following' });
    }

    const collection = db.collection(COLLECTIONS.activities);

    let query: Query = scope === 'mine'
      ? collection.where('userId', '==', req.uid!)
      : collection.where('visibility', '==', 'everyone');
    if (dateFrom !== null) query = query.where('startedAt', '>=', new Date(dateFrom));
    if (dateTo !== null) query = query.where('startedAt', '<=', new Date(dateTo));
    query = query
      .orderBy('startedAt', 'desc')
      // A saját listában a 30 napig tárolt soft-delete dokumentumokat csak a
      // lekérés után tudjuk kiszűrni, ezért kis ráhagyással olvasunk.
      .limit(scope === 'local' ? LOCAL_SCAN_LIMIT : scope === 'mine' ? Math.min(150, limit * 3) : limit);

    const snapshot = await query.get();
    const repairLimit = scope === 'local' ? Math.min(50, snapshot.docs.length) : snapshot.docs.length;
    const documents = await Promise.all(
      snapshot.docs.map(async (doc, index) => {
        const data = doc.data() as Record<string, unknown>;
        if (index >= repairLimit || data.deletedAt != null) return data;
        return repairActivityRoute(doc.ref, data);
      }),
    );
    let rows = documents
      .map((data, index) => ({ data, doc: snapshot.docs[index]! }))
      .filter(({ data }) => data.deletedAt == null)
      .map(({ data, doc }) => toFeedRow(doc.id, data));
    rows = await withOwnerFullRoutes(rows, req.uid!);
    if (scope === 'mine') rows = rows.slice(0, limit);

    let truncated = false;
    if (scope === 'local') {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radiusKm = Math.min(200, Math.max(1, Number(req.query.radiusKm) || 10));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw badRequest('missing_position', 'A helyi nézethez meg kell adni a pozíciót.');
      }
      rows = rows
        .filter((row) => row.center !== null && distanceM({ lat, lng }, row.center) <= radiusKm * 1000)
        .slice(0, limit);
      truncated = snapshot.size >= LOCAL_SCAN_LIMIT;
    }

    res.json({ activities: await withAuthors(rows, req.uid!), truncated });
  } catch (error) {
    next(error);
  }
});

function parseScope(raw: unknown): Scope {
  const value = String(raw ?? 'mine');
  if (value === 'mine' || value === 'world' || value === 'local' || value === 'following') {
    return value;
  }
  throw badRequest('invalid_scope', 'Ismeretlen nézet.');
}

interface FeedRow {
  id: string;
  userId: string;
  type: unknown;
  layer: unknown;
  startedAt: number;
  distanceM: number;
  movingS: number;
  areaGainedM2: number;
  gp: number;
  /** A nyomvonal közepe — a helyi szűréshez és a térképhez. */
  center: { lat: number; lng: number } | null;
  /** A levágott, kódolt nyomvonal a kártya térképéhez. */
  route: string;
  /** Üres a nyomvonal, mert a privát zóna teljesen lefedte? */
  routeHidden: boolean;
  title: string | null;
  photos: ActivityPhoto[];
  likeCount: number;
  commentCount: number;
}

export interface ActivityPhoto {
  /** A Storage-beli útvonal — ez alapján lehet törölni. */
  path: string;
  /** Letöltési cím tokennel; ez megy az `<img src>`-be. */
  url: string;
}

function toFeedRow(id: string, data: Record<string, unknown>): FeedRow {
  const bounds = data.bounds as
    | { north: number; south: number; east: number; west: number }
    | undefined;
  return {
    id,
    userId: String(data.userId ?? ''),
    type: data.type,
    layer: data.layer,
    startedAt: toMillis(data.startedAt),
    distanceM: Number(data.distanceM ?? 0),
    movingS: Number(data.movingS ?? 0),
    areaGainedM2: Number(data.areaGainedM2 ?? 0),
    gp: (data.gp as { total?: number } | undefined)?.total ?? 0,
    // Ez már levágott nyomvonal (lásd a feltöltésnél), tehát mindenkinek
    // kiadható, aki magát az aktivitást láthatja.
    route: String(data.route ?? ''),
    routeHidden: data.routeHidden === true,
    title: (data.title as string | undefined) || null,
    photos: parseStoredPhotos(data.photos),
    likeCount: Number(data.likeCount ?? 0),
    commentCount: Number(data.commentCount ?? 0),
    center: bounds
      ? { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 }
      : null,
  };
}

/**
 * A szerzők nevének hozzáfűzése.
 *
 * Az aktivitás csak `userId`-t tárol. Név nélkül a globális feed névtelen
 * sorok listája lenne, ami használhatatlan. A neveket kötegelve olvassuk, és
 * csak az EGYEDI szerzőkre — húsz aktivitás jellemzően néhány embertől van.
 */
async function withAuthors(rows: FeedRow[], viewerUid: string) {
  const ids = [...new Set(rows.map((row) => row.userId).filter(Boolean))];
  const authors = new Map<string, { username: string; photoURL: string | null }>();

  if (ids.length > 0) {
    const refs = ids.map((id) => db.collection(COLLECTIONS.users).doc(id));
    for (const snapshot of await db.getAll(...refs)) {
      if (!snapshot.exists) continue;
      const data = snapshot.data() as { username?: string; photoURL?: string | null };
      authors.set(snapshot.id, {
        username: data.username ?? 'ismeretlen',
        photoURL: data.photoURL ?? null,
      });
    }
  }

  /**
   * „Én kedveltem-e?" — KÖTEGELVE, nem soronként.
   *
   * A kedvelés a `likes/{uid}` aldokumentum LÉTEZÉSE. Húsz kártyánál ez húsz
   * dokumentum, de egyetlen `getAll` hívásban: soronkénti lekérdezésnél a feed
   * betöltése húsz körbefordulóval lassulna.
   */
  const likeRefs = rows.map((row) =>
    db.collection(COLLECTIONS.activities).doc(row.id).collection('likes').doc(viewerUid),
  );
  const liked = new Set<string>();
  if (likeRefs.length > 0) {
    const snapshots = await db.getAll(...likeRefs);
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) liked.add(rows[index]!.id);
    });
  }

  return rows.map(({ userId, center, ...rest }) => ({
    ...rest,
    center,
    likedByMe: liked.has(rest.id),
    author: authors.get(userId) ?? { username: 'ismeretlen', photoURL: null },
  }));
}

/** Kedvelte-e ez a felhasználó ezt az aktivitást? */
async function hasLiked(activityId: string, uid: string): Promise<boolean> {
  const snapshot = await db
    .collection(COLLECTIONS.activities)
    .doc(activityId)
    .collection('likes')
    .doc(uid)
    .get();
  return snapshot.exists;
}

/**
 * A tárolt fotólista beolvasása.
 *
 * Védekező: a mező régi aktivitásoknál hiányzik, és sosem szabad megbízni
 * abban, hogy a szerkezete ép — egy hibás elem miatt ne dőljön el a feed.
 */
function parseStoredPhotos(raw: unknown): { path: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { path: string; url: string } => {
      const photo = item as { path?: unknown; url?: unknown };
      return typeof photo?.path === 'string' && typeof photo?.url === 'string';
    })
    .slice(0, MAX_PHOTOS)
    .map((photo) => ({ path: photo.path, url: photo.url }));
}

/**
 * GET /api/activities/:id — egy aktivitás részletei.
 *
 * A nyomvonal itt a LEVÁGOTT, nyilvános változat. A tulajdonos a teljes
 * nyomvonalat a `/:id/track` végpontról kapja meg, és a felület jelzi neki,
 * hogy a két vég mások elől rejtve van.
 */
activitiesRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const snapshot = await db.collection(COLLECTIONS.activities).doc(String(req.params.id)).get();
    if (!snapshot.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

    let data = snapshot.data() as Record<string, unknown>;
    if (data.deletedAt != null) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    const owner = String(data.userId ?? '');
    const mine = owner === req.uid;

    /**
     * A nem látható aktivitás NEM 403, hanem 404.
     *
     * A 403 elárulná, hogy az azonosító létezik — egy privát aktivitás
     * puszta létezése is információ. A „nincs ilyen" nem szivárogtat.
     */
    if (!mine && data.visibility !== 'everyone') {
      throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    }

    // A publikus útvonalat a szerver a privát teljes nyomból javítja. Ez
    // minden nézőnél biztonságos: a teljes nyom soha nem kerül a válaszba.
    data = await repairActivityRoute(snapshot.ref, data);

    const summary = (data.summary ?? {}) as Record<string, unknown>;
    const author = await loadAuthor(owner);

    res.json({
      activity: {
        id: snapshot.id,
        mine,
        type: data.type,
        layer: data.layer,
        title: (data.title as string | undefined) || null,
        description: (data.description as string | undefined) || null,
        photos: parseStoredPhotos(data.photos),
        likeCount: Number(data.likeCount ?? 0),
        commentCount: Number(data.commentCount ?? 0),
        likedByMe: await hasLiked(snapshot.id, req.uid!),
        startedAt: toMillis(data.startedAt),
        endedAt: toMillis(data.endedAt),
        distanceM: Number(data.distanceM ?? 0),
        durationS: Number(data.durationS ?? 0),
        movingS: Number(data.movingS ?? 0),
        areaGainedM2: Number(data.areaGainedM2 ?? 0),
        gp: (data.gp ?? { total: 0 }) as Record<string, number>,
        cellCount: Number(data.cellCount ?? 0),
        loops: Number(summary.loops ?? 0),
        claimedCells: Number(summary.claimedCells ?? 0),
        route: String(data.route ?? ''),
        routeHidden: data.routeHidden === true,
        bounds: data.bounds ?? null,
        author,
        // Csak a saját aktivitás verdiktje látható. A diagnosztika és a
        // pontszám admin-only `activityTrust` dokumentumban marad.
        ...(mine
          ? {
              trustVerdict: data.trustVerdict ?? 'trusted',
            }
          : {}),
      },
    });
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
    const activity = snapshot.data() as { userId?: string; deletedAt?: unknown };
    if (activity.deletedAt != null || activity.userId !== req.uid) {
      throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    }
    const track = await ref.collection('private').doc('track').get();
    res.json({ points: track.exists ? (track.data() as { points: TracePoint[] }).points : [] });
  } catch (error) {
    next(error);
  }
});

/* ══════════════════════════════════════════════════════════════════
   Szerkesztés — cím, leírás, fotók
   ══════════════════════════════════════════════════════════════════ */

/** Ennyi fotó tartozhat egy aktivitáshoz. */
const MAX_PHOTOS = 5;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 2000;

/**
 * PATCH /api/activities/:id — a leíró mezők szerkesztése.
 *
 * CSAK a leíró mezők: cím, leírás, fotók. A metrikák, a nyomvonal, a foglalás
 * és a pont szerveroldali számítás eredménye — ha ezek a klienstől jöhetnének,
 * a játék egyetlen kéréssel hamisítható volna.
 *
 * A fotókat a kliens tölti fel közvetlenül a Storage-ba (a szabályok csak a
 * saját mappájába engedik), és csak a HIVATKOZÁST küldi ide. A több
 * megabájtos képeket értelmetlen lenne a Cloud Runon átereszteni.
 */
activitiesRouter.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.uid!;
    const ref = db.collection(COLLECTIONS.activities).doc(String(req.params.id));
    const snapshot = await ref.get();
    if (!snapshot.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    const stored = snapshot.data() as Record<string, unknown>;
    if (stored.deletedAt != null || stored.userId !== uid) {
      throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
    }

    const body = req.body as { title?: unknown; description?: unknown; photos?: unknown };
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title !== undefined) {
      const title = String(body.title ?? '').trim();
      if (title.length > MAX_TITLE) {
        throw badRequest('title_too_long', `A név legfeljebb ${MAX_TITLE} karakter lehet.`);
      }
      // Az ÜRES cím nem hiba, hanem visszatérés az automatikus névhez
      // („Délutáni bringázás"). Ezt a `null` fejezi ki, nem az üres sztring.
      patch.title = title.length > 0 ? title : null;
    }

    if (body.description !== undefined) {
      const description = String(body.description ?? '').trim();
      if (description.length > MAX_DESCRIPTION) {
        throw badRequest(
          'description_too_long',
          `A leírás legfeljebb ${MAX_DESCRIPTION} karakter lehet.`,
        );
      }
      patch.description = description.length > 0 ? description : null;
    }

    if (body.photos !== undefined) {
      patch.photos = parsePhotos(body.photos, uid, ref.id);
    }

    /**
     * Régi aktivitásoknál a nyilvános útvonal hiányozhat, illetve a korábbi
     * vágó a zárt hurkot tévesen teljesen elrejthette. Az első szerkesztés
     * ilyenkor migráció is: a privát teljes nyomból, a felhasználó AKTUÁLIS
     * privátzóna-beállításával állítjuk elő ugyanazt a levágott útvonalat,
     * amelyből a kliens a Mapbox statikus előnézetét rajzolja.
     *
     * A verziójel megakadályozza, hogy egy valóban, helyesen rejtett rövid
     * aktivitást minden későbbi szerkesztés újra meg újra feldolgozzunk.
     */
    const routePatch = await buildRoutePatchIfNeeded(ref, stored);
    if (routePatch) Object.assign(patch, routePatch);

    await ref.set(patch, { merge: true });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/activities/:id — tulajdonosi, 30 napos soft-delete.
 *
 * A publikus tartalom azonnal eltűnik, de a dokumentum és a privát nyomvonal
 * 30 napig megmarad egy későbbi visszaállítás/GDPR-folyamat számára. A már
 * kiosztott GP-t és a globális területállapotot nem tekerjük vissza: azokat
 * csak moderátori, auditált helyreállítás módosíthatja biztonságosan.
 */
activitiesRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.uid!;
    const ref = db.collection(COLLECTIONS.activities).doc(String(req.params.id));
    const userRef = db.collection(COLLECTIONS.users).doc(uid);
    const now = new Date();
    const purgeAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.runTransaction(async (tx) => {
      const activity = await tx.get(ref);
      if (!activity.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
      const data = activity.data() as Record<string, unknown>;
      if (data.userId !== uid) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
      if (data.deletedAt != null) return;

      const user = await tx.get(userRef);
      const profile = user.data() as {
        counters?: {
          activities?: number;
          distanceKm?: Partial<Record<ActivityType, number>>;
        };
      } | undefined;
      const counted = data.trustVerdict === 'trusted';
      const type = data.type as ActivityType;
      const distanceKm = Number(data.distanceM ?? 0) / 1000;

      tx.set(ref, {
        previousVisibility: data.visibility ?? 'everyone',
        visibility: 'only_me',
        deletedAt: now,
        purgeAt,
        deletedBy: 'owner',
        updatedAt: now,
      }, { merge: true });

      if (counted && user.exists && (type === 'run' || type === 'walk' || type === 'ride')) {
        tx.update(userRef, {
          'counters.activities': Math.max(0, Number(profile?.counters?.activities ?? 0) - 1),
          [`counters.distanceKm.${type}`]: Math.max(
            0,
            Number(profile?.counters?.distanceKm?.[type] ?? 0) - distanceKm,
          ),
          updatedAt: now,
        });
      }
    });

    res.json({ ok: true, purgeAt: purgeAt.getTime() });
  } catch (error) {
    next(error);
  }
});

/**
 * A fotóhivatkozások ellenőrzése.
 *
 * A LÉNYEG az útvonal-előtag vizsgálata. A kliens tetszőleges sztringet
 * küldhetne, és ha elfogadnánk, egy felhasználó BEHIVATKOZHATNÁ más
 * felhasználó fájljait a saját aktivitásába. A Storage-szabály csak az
 * ÍRÁST korlátozza a saját mappára; a hivatkozást itt kell megkötni.
 */
function parsePhotos(raw: unknown, uid: string, activityId: string) {
  if (!Array.isArray(raw)) throw badRequest('invalid_photos', 'Hibás fotólista.');
  if (raw.length > MAX_PHOTOS) {
    throw badRequest('too_many_photos', `Legfeljebb ${MAX_PHOTOS} kép tartozhat egy aktivitáshoz.`);
  }

  const prefix = `activities/${uid}/${activityId}/`;
  return raw.map((item) => {
    const photo = item as { path?: unknown; url?: unknown };
    const path = String(photo?.path ?? '');
    const url = String(photo?.url ?? '');

    if (!path.startsWith(prefix)) {
      throw badRequest('invalid_photo_path', 'Ez a kép nem ehhez az aktivitáshoz tartozik.');
    }
    if (!url.startsWith('https://')) {
      throw badRequest('invalid_photo_url', 'Hibás képhivatkozás.');
    }
    return { path, url };
  });
}

/* ══════════════════════════════════════════════════════════════════
   Kedvelés
   ══════════════════════════════════════════════════════════════════ */

/**
 * POST/DELETE /api/activities/:id/like
 *
 * MIÉRT A SZERVEREN, ha a `firestore.rules` a kedvelést közvetlenül is
 * engedélyezné? Mert a SZÁMLÁLÓ nem: a `likeCount` az aktivitás
 * dokumentumán van, amit a kliens nem írhat. Számláló nélkül minden kártya
 * külön lekérdezést igényelne csak azért, hogy megtudjuk, hányan kedvelték.
 *
 * Idempotens: a kétszer elküldött kedvelés nem növeli kétszer a számlálót.
 * A tranzakción belüli olvasás dönti el, van-e valódi változás.
 */
async function setLike(activityId: string, uid: string, liked: boolean) {
  const activityRef = db.collection(COLLECTIONS.activities).doc(activityId);
  const likeRef = activityRef.collection('likes').doc(uid);

  return db.runTransaction(async (tx) => {
    const activity = await tx.get(activityRef);
    const existing = await tx.get(likeRef);
    if (!activity.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

    const count = Number((activity.data() as { likeCount?: number }).likeCount ?? 0);
    if (existing.exists === liked) return { likeCount: count, likedByMe: liked };

    if (liked) tx.set(likeRef, { createdAt: new Date() });
    else tx.delete(likeRef);

    const next = Math.max(0, count + (liked ? 1 : -1));
    tx.set(activityRef, { likeCount: next }, { merge: true });
    return { likeCount: next, likedByMe: liked };
  });
}

activitiesRouter.post('/:id/like', async (req: AuthedRequest, res, next) => {
  try {
    res.json(await setLike(String(req.params.id), req.uid!, true));
  } catch (error) {
    next(error);
  }
});

activitiesRouter.delete('/:id/like', async (req: AuthedRequest, res, next) => {
  try {
    res.json(await setLike(String(req.params.id), req.uid!, false));
  } catch (error) {
    next(error);
  }
});

/* ══════════════════════════════════════════════════════════════════
   Hozzászólások
   ══════════════════════════════════════════════════════════════════ */

const MAX_COMMENT = 1000;
const COMMENT_PAGE = 100;

/** Az aktivitás, ha a kérő láthatja — különben 404. */
async function readableActivity(activityId: string, uid: string) {
  const ref = db.collection(COLLECTIONS.activities).doc(activityId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

  const data = snapshot.data() as { userId?: string; visibility?: string };
  if (data.userId !== uid && data.visibility !== 'everyone') {
    throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
  }
  return ref;
}

/** GET /api/activities/:id/comments — időrendben, a legrégebbi elöl. */
activitiesRouter.get('/:id/comments', async (req: AuthedRequest, res, next) => {
  try {
    const activityRef = await readableActivity(String(req.params.id), req.uid!);

    /**
     * A beszélgetés a LEGRÉGEBBIVEL kezdődik, nem a legfrissebbel.
     *
     * Egy hozzászólás-szál nem hírfolyam: fordított sorrendben olvashatatlan,
     * mert a válaszok a kérdéseik előtt állnának.
     */
    const snapshot = await activityRef
      .collection('comments')
      .orderBy('createdAt', 'asc')
      .limit(COMMENT_PAGE)
      .get();

    const rows = snapshot.docs.map((doc) => {
      const comment = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        userId: String(comment.userId ?? ''),
        text: String(comment.text ?? ''),
        createdAt: toMillis(comment.createdAt),
      };
    });

    const authorIds = [...new Set(rows.map((row) => row.userId).filter(Boolean))];
    const authors = new Map<string, { username: string; photoURL: string | null }>();
    if (authorIds.length > 0) {
      const refs = authorIds.map((id) => db.collection(COLLECTIONS.users).doc(id));
      for (const doc of await db.getAll(...refs)) {
        const user = doc.data() as { username?: string; photoURL?: string | null } | undefined;
        authors.set(doc.id, {
          username: user?.username ?? 'ismeretlen',
          photoURL: user?.photoURL ?? null,
        });
      }
    }

    res.json({
      comments: rows.map(({ userId, ...rest }) => ({
        ...rest,
        mine: userId === req.uid,
        author: authors.get(userId) ?? { username: 'ismeretlen', photoURL: null },
      })),
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/activities/:id/comments */
activitiesRouter.post('/:id/comments', async (req: AuthedRequest, res, next) => {
  try {
    const text = String((req.body as { text?: unknown }).text ?? '').trim();
    if (text.length === 0) throw badRequest('empty_comment', 'Írj valamit a hozzászólásba.');
    if (text.length > MAX_COMMENT) {
      throw badRequest('comment_too_long', `A hozzászólás legfeljebb ${MAX_COMMENT} karakter.`);
    }

    const activityRef = db.collection(COLLECTIONS.activities).doc(String(req.params.id));
    const commentRef = activityRef.collection('comments').doc();
    const now = new Date();

    await db.runTransaction(async (tx) => {
      const activity = await tx.get(activityRef);
      if (!activity.exists) throw notFound('activity_missing', 'Nincs ilyen aktivitás.');

      const data = activity.data() as {
        userId?: string;
        visibility?: string;
        allowComments?: boolean;
        commentCount?: number;
      };
      if (data.userId !== req.uid && data.visibility !== 'everyone') {
        throw notFound('activity_missing', 'Nincs ilyen aktivitás.');
      }
      // A szerző kikapcsolhatja a hozzászólásokat; ez nem hiba, hanem döntés.
      if (data.allowComments === false) {
        throw forbidden('Ehhez az aktivitáshoz nem lehet hozzászólni.');
      }

      tx.set(commentRef, { userId: req.uid, text, createdAt: now });
      tx.set(activityRef, { commentCount: Number(data.commentCount ?? 0) + 1 }, { merge: true });
    });

    res.status(201).json({ id: commentRef.id, text, createdAt: now.getTime() });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/activities/:id/comments/:commentId — csak a sajátodat. */
activitiesRouter.delete('/:id/comments/:commentId', async (req: AuthedRequest, res, next) => {
  try {
    const activityRef = db.collection(COLLECTIONS.activities).doc(String(req.params.id));
    const commentRef = activityRef.collection('comments').doc(String(req.params.commentId));

    await db.runTransaction(async (tx) => {
      const activity = await tx.get(activityRef);
      const comment = await tx.get(commentRef);
      if (!comment.exists) throw notFound('comment_missing', 'Nincs ilyen hozzászólás.');

      const data = activity.data() as { userId?: string; commentCount?: number } | undefined;
      const author = (comment.data() as { userId?: string }).userId;
      // A saját hozzászólásodat te törölheted, az aktivitásodon lévőt
      // szerzőként szintén — a saját posztod alatt moderálhatsz.
      if (author !== req.uid && data?.userId !== req.uid) {
        throw forbidden('Ezt a hozzászólást nem törölheted.');
      }

      tx.delete(commentRef);
      tx.set(
        activityRef,
        { commentCount: Math.max(0, Number(data?.commentCount ?? 0) - 1) },
        { merge: true },
      );
    });

    res.json({ ok: true });
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

async function buildRoutePatchIfNeeded(
  ref: DocumentReference,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const uid = String(data.userId ?? '');
  if (!uid || data.deletedAt != null) return null;
  // A privacy-módosító végpont `routePending` állapotot hagy maga után, ha a
  // tömeges újravágás félbeszakad. Minden más naprakész route-nál megspóroljuk
  // a profil plusz Firestore-olvasását a feed minden kártyáján.
  if (Number(data.routeVersion ?? 0) >= PUBLIC_ROUTE_VERSION && data.routePending !== true) {
    return null;
  }
  const user = await db.collection(COLLECTIONS.users).doc(uid).get();
  const privacy = normalizePrivacy((user.data() as { privacy?: unknown } | undefined)?.privacy);
  if (!publicRouteNeedsRebuild(data, privacy)) return null;
  return buildPublicRoutePatch(ref, uid, privacy);
}

/**
 * A specifikáció szerint a tulajdonos MINDEN saját nézetben a teljes
 * nyomvonalat látja, nem csak az aktivitás adatlapján. A fő dokumentumban
 * továbbra is kizárólag a levágott route marad; ezt a teljes változatot csak
 * a hitelesített tulajdonos konkrét API-válaszába tesszük bele.
 */
async function withOwnerFullRoutes(rows: FeedRow[], viewerUid: string): Promise<FeedRow[]> {
  const owned = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.userId === viewerUid);
  if (owned.length === 0) return rows;

  const refs = owned.map(({ row }) =>
    db.collection(COLLECTIONS.activities).doc(row.id).collection('private').doc('track'),
  );
  const tracks = await db.getAll(...refs);
  const replacements = new Map<number, FeedRow>();

  tracks.forEach((snapshot, ownedIndex) => {
    const target = owned[ownedIndex];
    if (!target || !snapshot.exists) return;
    const view = buildOwnerRouteView((snapshot.data() as { points?: unknown }).points);
    if (!view) return;
    replacements.set(target.index, {
      ...target.row,
      route: view.route,
      routeHidden: view.routeHidden,
      center: {
        lat: (view.bounds.north + view.bounds.south) / 2,
        lng: (view.bounds.east + view.bounds.west) / 2,
      },
    });
  });

  return rows.map((row, index) => replacements.get(index) ?? row);
}

async function repairActivityRoute(
  ref: DocumentReference,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const patch = await buildRoutePatchIfNeeded(ref, data);
  if (!patch) return data;
  await ref.set(patch, { merge: true });
  return { ...data, ...patch };
}

async function loadAuthor(uid: string) {
  if (!uid) return { username: 'ismeretlen', photoURL: null };
  const snapshot = await db.collection(COLLECTIONS.users).doc(uid).get();
  const data = snapshot.data() as { username?: string; photoURL?: string | null } | undefined;
  return { username: data?.username ?? 'ismeretlen', photoURL: data?.photoURL ?? null };
}

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




function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const stamp = value as { toMillis?: () => number } | undefined;
  return typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0;
}


function parseFeedDate(raw: unknown, field: string): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 8_640_000_000_000_000) {
    throw badRequest('invalid_date', `Hibás ${field} időbélyeg.`);
  }
  return value;
}

