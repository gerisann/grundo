import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, db } from '../lib/firebase';
import { badRequest, notFound } from '../lib/errors';
import { blocksFor, gameDay, loadOwnership, readBlocks, writeOwnership } from '../lib/grid';
import { computeTrustScore } from '../trust/score';
import { processActivity } from '../../../src/game';
import { layerOf } from '../../../src/game/cells';
import { levelFor } from '../../../src/game/levels';
import { encodePolyline, simplifyTrace } from '../../../src/game/polyline';
import { DEFAULT_PRIVACY, trimPrivateEnds, type PrivacySettings } from '../../../src/game/privacy';
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
     * Előszűrés — a MUNKA megspórolására, nem az idempotencia biztosítására.
     *
     * A valódi védelem a tranzakción belül van (lásd lejjebb): ez itt csak
     * annyit ér el, hogy egy nyilvánvaló ismétlésnél ne fussunk le a teljes
     * motoron és a rács-olvasáson.
     */
    const preflight = await activityRef.get();
    if (preflight.exists) {
      const data = preflight.data() as { userId?: string; summary?: unknown };
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
      streak?: StoredStreak;
      trust?: { cleanActivities?: number; upheldReports?: number };
      privacy?: Partial<PrivacySettings>;
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

    /**
     * Trust Score — MIELŐTT bármit módosítana a birtokviszonyokon.
     *
     * A gyanús aktivitás nem tűnik el: elmentjük, megjelenik a profilban és a
     * feedben, de a rácshoz és a pontokhoz nem nyúl, amíg nem validálódik.
     * Nem büntetjük az ártatlant azzal, hogy letagadjuk a futását — de nem is
     * engedjük, hogy egy hamisított nyom átrendezze a térképet.
     *
     * ⚠️ A PONTSZÁM ÉS A RÉSZJELEK NEM MENNEK KI A KLIENSNEK. Csak a verdikt
     * és a felhasználónak szánt indoklás. Ha a szám látszana, visszafejthető
     * és kijátszható lenne.
     */
    const trust = computeTrustScore({
      points,
      type,
      distanceKm: serverDistanceM / 1000,
      durationS: Math.max(1, (endedAt - startedAt) / 1000),
      history: {
        cleanActivities: user.trust?.cleanActivities ?? 0,
        upheldReports: user.trust?.upheldReports ?? 0,
      },
      credibleReports: 0,
      largeGaps: result.diagnostics.largeGaps,
    });
    /**
     * Megfigyelő módban a verdikt elmentődik, de nem blokkol — lásd
     * `TRUST_OBSERVE_ONLY`. Így a heurisztikát valós adaton lehet kalibrálni
     * anélkül, hogy közben ártatlan aktivitásokat nyelne el.
     */
    const trusted = GAMEPLAY.TRUST_OBSERVE_ONLY || trust.verdict === 'trusted';

    /**
     * A NYILVÁNOS nyomvonal — levágva és ritkítva.
     *
     * Ez kerül az aktivitás fő dokumentumába, amit mindenki elolvashat, aki
     * az aktivitást látja (lásd firestore.rules). Ezért ELŐBB vágjuk le a
     * privát zónát, és csak utána tároljuk: a levágott szakasz így soha nem
     * kerül olyan helyre, ahonnan visszaolvasható lenne.
     *
     * A TELJES nyomvonal külön, a `private/track` dokumentumba megy — azt
     * kizárólag a tulajdonos éri el.
     */
    const privacy: PrivacySettings = { ...DEFAULT_PRIVACY, ...(user.privacy ?? {}) };
    const publicRoute = encodeRoute(trimPrivateEnds(points, privacy).points);

    const now = new Date();
    const nextStreak = advanceStreak(user.streak, gameDay(now));
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
      trustVerdict: trust.verdict,
      trustReasons: trust.reasons,
    };

    let duplicate = false;

    await db.runTransaction(async (tx) => {
      // MINDEN olvasás az írások ELŐTT — a Firestore ezt megköveteli.

      /**
       * AZ IDEMPOTENCIA IGAZI HELYE: a tranzakción BELÜL.
       *
       * A fenti előszűrés önmagában nem elég. Két egyszerre érkező feltöltés
       * mindkettő „még nincs ilyen"-t lát, aztán mindkettő ír — és a terület,
       * a pont, a táv meg az aktivitásszám kétszer könyvelődik. Élesben pontosan
       * ez történt: 2 × 1,144 km² lett a profilon, 2 × 12,7 km táv, és három
       * aktivitásból hat.
       *
       * A tranzakción belüli olvasás viszont a Firestore-nál egyben ütközés-
       * figyelés is: ha közben más ír ugyanerre a dokumentumra, a tranzakció
       * újrafut, és a második futásban már látja az elsőt.
       */
      const existing = await tx.get(activityRef);
      if (existing.exists) {
        duplicate = true;
        return;
      }

      /**
       * A profilt a TRANZAKCIÓN BELÜL is beolvassuk, mert a szinthez a
       * ténylegesen új GP-összeg kell — a `FieldValue.increment` értékét a
       * kliens nem látja. A tranzakción kívüli olvasás itt elavulhatna: két
       * egyszerre feldolgozott aktivitás közül a második régi összeget látna,
       * és visszaírna egy alacsonyabb szintet.
       */
      const userNow = await tx.get(userRef);
      const gpAfter = Number((userNow.data() as { gpTotal?: number })?.gpTotal ?? 0)
        + result.gp.total;

      const blocks = await readBlocks(tx, blockIds);

      // A rácshoz CSAK hiteles aktivitás nyúlhat.
      if (trusted && claimUpdates.size > 0) {
        writeOwnership(tx, layer, claimUpdates, blocks, now, uid);
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
        /**
         * A levágott, ritkított nyomvonal — a feed-kártya és a részletek
         * térképéhez. Üres sztring, ha az egész aktivitás a védőkörön belül
         * zajlott: ilyenkor a felület „Az útvonal rejtve" feliratot ír ki.
         */
        route: publicRoute,
        /**
         * Megkülönbözteti a „levágtuk"-at a „nincs"-től.
         *
         * A felületnek másképp kell fogalmaznia a kettőről: a rejtett útvonal
         * a felhasználó saját döntése, a hiányzó pedig hiba vagy régi adat.
         * Egy közös üres mezőből ez nem lenne kiolvasható.
         */
        routeHidden: publicRoute.length === 0,
        visibility: 'everyone',
        // A verdikt és az indoklás MEHET a kliensre; a pontszám és a
        // részjelek maradnak itt, a szerveren.
        trustVerdict: trust.verdict,
        trustReasons: trust.reasons,
        trustScore: trust.score,
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
        // A mezőnevek az indexekhez igazodnak (`userId + at`, `userId + day`).
        { userId: uid, activityId, gp: result.gp, at: now, day: gameDay(now) },
      );

      /**
       * BEÁGYAZOTT OBJEKTUMOK, nem pontozott kulcsok.
       *
       * A `set(..., { merge: true })` a pontot NEM útvonalnak érti, hanem a
       * mezőnév részének: a `{ 'territoryM2.foot': ... }` egy „territoryM2.foot"
       * NEVŰ, felső szintű mezőt hoz létre, a beágyazott érték pedig érintetlen
       * marad. (A pontot csak az `update()` kezeli útvonalként.)
       *
       * Ez a hiba élesben abban látszott, hogy a `gpTotal` nőtt, a terület
       * viszont nulla maradt a profilon — és emiatt a ranglista is üres volt,
       * hiszen az a `territoryM2.foot` szerint rendez.
       */
      /**
       * A pontok és az összesítők is csak hiteles aktivitás után frissülnek.
       *
       * A `pending_review` aktivitás GP-je FÜGGŐBEN van — nem elveszett. Ha a
       * validálás átengedi, akkor kerül jóváírásra.
       */
      if (!trusted) return;

      tx.set(
        userRef,
        {
          gpTotal: FieldValue.increment(result.gp.total),
          gpWeek: FieldValue.increment(result.gp.total),
          gpMonth: FieldValue.increment(result.gp.total),
          /**
           * A szint SZÁMÍTOTT érték; ez a mező csak gyorsítótár. A felület a
           * `gpTotal`-ból számolja újra (src/game/levels.ts), tehát a lépcső
           * hangolása nem igényel migrációt. Itt azért írjuk mégis, hogy a
           * ranglisták és az értesítések ne kényszerüljenek újraszámolásra.
           */
          level: levelFor(gpAfter),
          territoryM2: { [layer]: FieldValue.increment(result.areaGainedM2) },
          cellCount: { [layer]: FieldValue.increment(result.claimedCells.size) },
          counters: {
            activities: FieldValue.increment(1),
            distanceKm: { [type]: FieldValue.increment(serverDistanceM / 1000) },
          },
          streak: nextStreak,
          // A tiszta aktivitások száma a történeti jel bemenete.
          trust: { cleanActivities: FieldValue.increment(1) },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    if (duplicate) return res.json({ activityId, summary, duplicate: true });
    res.status(201).json({ activityId, summary });
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

    if (scope === 'following') {
      return res.json({ activities: [], unavailable: 'following' });
    }

    const collection = db.collection(COLLECTIONS.activities);

    const query =
      scope === 'mine'
        ? collection.where('userId', '==', req.uid!).orderBy('startedAt', 'desc').limit(limit)
        : collection
            .where('visibility', '==', 'everyone')
            .orderBy('startedAt', 'desc')
            .limit(scope === 'local' ? LOCAL_SCAN_LIMIT : limit);

    const snapshot = await query.get();
    let rows = snapshot.docs.map((doc) => toFeedRow(doc.id, doc.data() as Record<string, unknown>));

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

    res.json({ activities: await withAuthors(rows), truncated });
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
async function withAuthors(rows: FeedRow[]) {
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

  return rows.map(({ userId, center, ...rest }) => ({
    ...rest,
    center,
    author: authors.get(userId) ?? { username: 'ismeretlen', photoURL: null },
  }));
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

    const data = snapshot.data() as Record<string, unknown>;
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

    const summary = (data.summary ?? {}) as Record<string, unknown>;
    const author = await loadAuthor(owner);

    res.json({
      activity: {
        id: snapshot.id,
        mine,
        type: data.type,
        layer: data.layer,
        title: (data.title as string | undefined) ?? null,
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
        // A verdikt és az indoklás MEHET a kliensre — a pontszám és a
        // részjelek soha. És csak a saját aktivitásodnál: más hitelességi
        // állapota nem tartozik rád.
        ...(mine
          ? {
              trustVerdict: data.trustVerdict ?? 'trusted',
              trustReasons: (data.trustReasons as string[] | undefined) ?? [],
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

/**
 * Ennyi pontnál többet nem tárolunk a nyilvános nyomvonalban.
 *
 * Egy négyórás bringázás ritkítás után is ezres nagyságrendű pontot adhat, és
 * ez a mező MINDEN feed-lekérdezésben átmegy a hálózaton — húsz kártyánál
 * húszszor. A hatszáz pont egy telefonképernyőn már bőven a pixelfelbontás
 * alatt van: több pontnak nincs látható haszna, csak forgalma.
 */
const MAX_ROUTE_POINTS = 600;

function encodeRoute(points: readonly TracePoint[]): string {
  if (points.length < 2) return '';

  // A küszöböt addig lazítjuk, amíg a nyomvonal be nem fér. Egy városi
  // futásnál az első kör elég; a plafon a nagyon hosszú túrákra szól.
  let simplified = simplifyTrace(points, 6);
  for (let epsilon = 12; simplified.length > MAX_ROUTE_POINTS && epsilon <= 200; epsilon *= 2) {
    simplified = simplifyTrace(points, epsilon);
  }

  return encodePolyline(simplified);
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

function totalDistance(points: readonly TracePoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += distanceM(points[i - 1]!, points[i]!);
  }
  return sum;
}

interface StoredStreak {
  current?: number;
  longest?: number;
  /** A legutóbbi aktív nap, játéknap-számként. */
  lastActiveDay?: number;
}

/**
 * A sorozat léptetése.
 *
 * Három eset van, és a különbség lényegi:
 *   - ma már volt aktivitás  → a sorozat NEM nő. Aki naponta ötször fut, az
 *     nem ötnapos sorozatot épít.
 *   - tegnap volt az utolsó  → +1, ez a folytatás.
 *   - régebben (vagy soha)   → újrakezdés 1-gyel.
 *
 * A `longest` sosem csökken: az elért csúcs megmarad akkor is, ha a sorozat
 * megszakad — ez a felhasználó teljesítménye, nem az aktuális állapota.
 */
function advanceStreak(streak: StoredStreak | undefined, today: number) {
  const current = streak?.current ?? 0;
  const last = streak?.lastActiveDay;

  const next = last === today ? Math.max(1, current) : last === today - 1 ? current + 1 : 1;

  return {
    current: next,
    longest: Math.max(next, streak?.longest ?? 0),
    lastActiveDay: today,
  };
}

function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const stamp = value as { toMillis?: () => number } | undefined;
  return typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0;
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
